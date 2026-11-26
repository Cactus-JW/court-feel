import * as THREE from 'three';
import { ASSIST, COURT, type SetLevel } from '../config';
import { Rng } from '../core/mathx';
import type { BallEnv, CollisionEvent } from '../physics/ball';
import type { Athlete } from './athlete';
import { BallEntity, type TouchKind } from './ballEntity';
import type { AiHost, Brain } from './brains';
import { ContactSystem, type ContactEvent, type SetOption } from './contact';
import { Judge, type Outcome } from './judge';
import { defaultPassTarget, defaultSetOptions } from './plays';
import { Seat, type SeatHost } from './seat';
import type { SetPick } from './setterCalls';

/**
 * What the simulation asks of whoever runs it, and what it tells them. The answers come from
 * outside because they are not the simulation's to know: where the player is looking is the
 * camera's, how much the aim is helped is a setting.
 */
export interface SimulationHooks {
  /** how much this player's aim is helped (0..1). Asked only of an athlete a player plays: an AI player's is `ASSIST.ai` */
  aimAssist(a: Athlete): number;
  /** how much this player's set is helped (0..1); their aim assist when not given */
  setAssist?(a: Athlete): number;
  /** the player sets by feel, with no timing cues (a setting): their set's windows are wider */
  setByFeel?(): boolean;
  /** where this athlete is aiming on the floor */
  aimTargetFor(a: Athlete, out: THREE.Vector3): THREE.Vector3;
  /**
   * A touch was resolved, and nothing has acted on it yet: the judge is not armed and the drill has
   * not heard. What has to be shown before the drill's own words goes here (the grade, ahead of the
   * drill's banner).
   */
  touched?(ev: ContactEvent): void;
  /** a touch was resolved: a clean one has armed the judge, and the drill has heard of it */
  contact(ev: ContactEvent): void;
  /** a touch a brain made without the contact system (the AI setter's set) */
  aiContact(a: Athlete, kind: TouchKind, speed: number): void;
  /** the ball hit the floor, the net, a post */
  ballEvent(e: CollisionEvent): void;
  /** a float has just broken, and how hard */
  floatBreak(strength: number): void;
  /** the judge called the rally */
  outcome(o: Outcome): void;
  /** how hard the player's set is to time (a setting; Easy without one) */
  setLevel?(): SetLevel;
}

/** the drill being played, as the simulation sees it */
export interface SimDrill {
  step(dt: number): void;
  /** a touch was resolved (a missed swing too). A clean one has armed the judge by now */
  onContact?(ev: ContactEvent): void;
  onOutcome(o: Outcome): void;
  passTarget?(a: Athlete): { x: number; y: number; z: number; apex: number };
  setOptions?(a: Athlete): SetOption[];
  /** the hitter the player picked for this set, if any */
  setPick?(a: Athlete): SetPick | null;
  canServe?(a: Athlete): boolean;
  /** the next ball is the player's to set (a pass is in the air for them): their seat takes the last steps onto it, and takes them up for it */
  userSetsNext?(): boolean;
}

/**
 * The simulation: the athletes, the players' seats, the ball, the clock, the random stream, the
 * brains, the contact system and the judge, and the one step that moves them all. It has no renderer and no DOM, so it
 * can be built and stepped in a unit test (docs/adr/0010). `Game` holds one and draws it.
 */
export class Simulation implements AiHost {
  athletes: Athlete[] = [];
  /** the players: one seat each. Seat 0 is this machine's player; a game nobody is playing has none */
  readonly seats: Seat[] = [];
  readonly ball = new BallEntity();
  readonly env: BallEnv = { netTop: COURT.netHeightMen };
  readonly rng = new Rng(2024);
  readonly brains = new Map<Athlete, Brain>();
  readonly contact: ContactSystem;
  readonly judge = new Judge();
  drill: SimDrill | null = null;
  simTime = 0;
  /** rally modes: is the ball in play (AI teams read this) */
  ballLive = false;

  constructor(private hooks: SimulationHooks) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const sim = this;
    this.contact = new ContactSystem({
      ball: this.ball,
      get simTime() {
        return sim.simTime;
      },
      env: this.env,
      // a player's is a setting. An athlete nobody plays has the play's own number: `isUser`, not a
      // seat, since a drill can hand the player's athlete to a brain (the Mini Rally under `autoUser`)
      aimAssist: (a) => (a.isUser ? hooks.aimAssist(a) : ASSIST.ai),
      setAssist: (a) => (a.isUser ? (hooks.setAssist ?? hooks.aimAssist)(a) : ASSIST.ai),
      setByFeel: () => hooks.setByFeel?.() ?? false,
      aimTargetFor: (a, out) => hooks.aimTargetFor(a, out),
      emitContact: (ev) => this.touched(ev),
      rand: () => this.rng.next(),
      passTarget: (a) => this.drill?.passTarget?.(a) ?? defaultPassTarget(a),
      setOptions: (a) => this.drill?.setOptions?.(a) ?? defaultSetOptions(a),
      setPick: (a) => this.drill?.setPick?.(a) ?? null,
      setLevel: () => hooks.setLevel?.() ?? 'easy',
      canServe: (a) => (this.drill?.canServe ? this.drill.canServe(a) : !this.ball.active || this.ball.state.rest),
    });
    // an attack is aimed where its player looks: that is in their seat's intent
    this.contact.userAimYaw = (a) => this.seatOf(a)?.intent.yaw ?? 0;
  }

  /** give a player a seat: the athlete is theirs to play from now on */
  addSeat(athlete: Athlete, host: SeatHost = {}): Seat {
    const seat = new Seat(this.seats.length, athlete, this, host);
    this.seats.push(seat);
    return seat;
  }

  /** the seat that plays this athlete, if a player does */
  seatOf(a: Athlete): Seat | undefined {
    return this.seats.find((s) => s.athlete === a);
  }

  /** the athlete of this machine's player (seat 0) */
  get me(): Athlete {
    return this.seats[0].athlete;
  }
  set me(a: Athlete) {
    if (this.seats.length) this.seats[0].athlete = a;
    else this.addSeat(a);
  }

  setBrain(a: Athlete, b: Brain): void {
    this.brains.set(a, b);
  }

  clearBrains(): void {
    this.brains.clear();
  }

  /**
   * A touch was resolved. A clean one puts the rally in the judge's hands, then the drill hears of
   * it, then whoever runs the game: nobody who builds a simulation has to remember to do either.
   * A missed swing, or a touch the ball did not leave (a lift), arms nothing.
   */
  private touched(ev: ContactEvent): void {
    this.hooks.touched?.(ev);
    if (ev.grade !== 'Miss' && ev.speed > 0) this.judge.arm(this.ball);
    this.drill?.onContact?.(ev);
    this.hooks.contact(ev);
  }

  onAiContact(a: Athlete, kind: TouchKind, speed: number): void {
    this.hooks.aiContact(a, kind, speed);
  }

  /** one fixed step: brains, each player's seat (the auto jump set), athletes, the players' actions, contacts, the ball, the judge, the drill, in that order */
  step(dt: number): void {
    this.simTime += dt;
    for (const [, b] of this.brains) b.step(dt, this);
    // each player's arms get ready, and their body goes up for a set by itself (Auto jump set)
    for (const seat of this.seats) seat.beforeStep();
    // assist magnet for a player's mid-air drift
    for (const seat of this.seats) this.contact.magnet(seat.athlete);
    for (const a of this.athletes) a.step(dt, this.simTime);
    // each player's held actions (a pass, a set, a block waiting on its moment)
    for (const seat of this.seats) seat.actions.step(dt);
    this.contact.step(this.athletes);
    // cleanup finished actions
    for (const a of this.athletes) {
      const act = a.action;
      if (!act) continue;
      if (act.kind === 'swing' && act.resolved && this.simTime > act.contactT + 0.35) a.endAction();
      // a wind-up never released before landing is dropped
      else if (act.kind === 'windup' && a.state === 'land' && a.stateT >= 0 && act.t0 < this.simTime - a.stateT) a.endAction();
      else if (act.kind === 'block' && !act.held && this.simTime > act.releaseT + 0.25) a.endAction();
      else if (act.kind === 'toss' && this.simTime > act.t0 + 1.6) a.endAction();
      else if (act.kind === 'set' && act.resolved && this.simTime > act.contactT + 0.45) a.endAction();
      else if (act.kind === 'pass' && act.resolved && this.simTime > act.contactT + 0.4) a.endAction();
    }
    this.ball.step(dt, this.env);
    for (const e of this.ball.events) this.hooks.ballEvent(e);
    if (this.ball.broke > 0) this.hooks.floatBreak(this.ball.broke);
    const out = this.judge.step(this.ball, this.ball.events, this.env.netTop);
    if (out) {
      this.hooks.outcome(out);
      this.drill?.onOutcome(out);
    }
    this.drill?.step(dt);
  }
}
