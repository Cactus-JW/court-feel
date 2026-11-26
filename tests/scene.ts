import { SIM, type PositionId } from '../src/config';
import { SLOT_ROLE, SLOTS, TeamAI, type Slot } from '../src/ai/team';
import { netYaw } from '../src/ai/brain';
import { Athlete } from '../src/game/athlete';
import type { Touch } from '../src/game/ballEntity';
import type { Brain } from '../src/game/brains';
import type { ContactEvent } from '../src/game/contact';
import type { Outcome } from '../src/game/judge';
import type { SeatHost } from '../src/game/seat';
import { Simulation, type SimDrill, type SimulationHooks } from '../src/game/simulation';
import type { V3 } from '../src/physics/ball';
import { solveApex, solveFixedTime } from '../src/physics/solve';
import { brokenInvariants } from './invariants';
import { NO_HOOKS } from './simHooks';

// A scene: a real `Simulation` with the few things a test puts on the court. A test of the play
// builds one here and steps it, so what it sees is what the game does: the real ball, the real
// contact system, the real clock, and the step in the game's own order (brains, athletes, contacts,
// the ball, the judge, the teams). Nothing here is a stand-in.
//
// Two things a scene may hold still, and only here, because a test of one fact has to keep the
// rest out of the way: the dice (`dice`) and the touch (`touches`). Every test that asks for one
// says in a comment what it isolates.
//
// A scene is the simulation, not the app. Three things differ from a game someone is playing, and
// a test that needs one of them asks for it:
//
// - A player has every assist off: no aim assist, no set assist, no auto jump set. (An athlete
//   nobody plays has the game's own, `ASSIST.ai`: the simulation gives it.) The app gives a new
//   player the default settings, and so does `tests/headlessGame.ts`. A scene takes them through
//   `hooks` (`aimAssist`, `setAssist`) and through the seat's host (`user: { autoJumpSet }`).
// - `send` puts a ball in play and arms nothing: it is not a touch. The simulation arms the judge
//   on a clean touch it resolves itself. A test of a call on a ball it sent arms the judge by hand
//   (`sim.judge.arm(sim.ball)`), as a drill does when it feeds one.
// - `step` and `run` play fixed steps, and no seat's frame runs between them. What the game does
//   for a player once a frame is the seat's (`Seat.frame`): the controller that turns the intent
//   they hold into what their athlete does, the last steps onto a set, the walk back between reps.
//   A test of one of those plays frames, as the app does: `frame`. A test of a drill's own rules is
//   built on `tests/headlessGame.ts`, which is a scene with a real drill and its host.

/** one fixed step of the simulation (s) */
export const DT = 1 / SIM.hz;

/** the fixed steps in one frame: the simulation's 120 Hz under a screen's 60 */
const STEPS_A_FRAME = 2;

/** one frame (s) */
export const FRAME = STEPS_A_FRAME * DT;

const NO_SPIN: V3 = { x: 0, y: 0, z: 0 };

export interface SceneOptions {
  /** the simulation's dice (default 1) */
  seed?: number;
  /** hooks on top of NO_HOOKS. Touches and outcomes are logged whatever is passed */
  hooks?: Partial<SimulationHooks>;
  /**
   * What the drill being played answers: where a pass goes, the setter's options and pick, who may
   * serve. The scene is the drill: its `step` runs the scene's teams, then this one's. A harness
   * that plays a real drill gives the simulation that drill in the scene's place
   * (tests/headlessGame.ts).
   */
  drill?: Partial<SimDrill>;
  /**
   * Fixed dice: every roll of the simulation's random stream comes up `roll` and every gaussian
   * draw is `noise` (0 when not given). `roll` may be a function, for a test that walks through
   * the rolls one scene at a time. 'seeded' (the default) is the game's own stream from `seed`.
   */
  dice?: 'seeded' | { roll: number | (() => number); noise?: number };
  /**
   * 'none': nobody's pass, set or block meets the ball (the contact system answers "not yet" to
   * each), so a test can watch what the players read and where they go with the ball never
   * played. A swing and an AI setter's own set are not held back. 'real' is the default.
   */
  touches?: 'real' | 'none';
}

/** a ball to send: at a velocity, over an apex, or in a fixed time */
export type Flight = { from: V3; v: V3; w?: V3 } | { from: V3; to: V3; apex: number; w?: V3 } | { from: V3; to: V3; time: number; w?: V3 };

/** the touch a sent ball came from. `t` is now when not given */
export type SentBy = Omit<Touch, 't'> & { t?: number };

/** where a team stands at the start of a rally */
export type Formation = 'defense' | 'receive' | 'offense';

export interface Scene {
  sim: Simulation;
  /** every touch the contact system resolved, with its time */
  touches: { t: number; ev: ContactEvent }[];
  /** what the judge called */
  outcomes: { t: number; o: Outcome }[];
  /**
   * An athlete on the court, facing the net unless `yaw` says otherwise. `user` gives them a seat
   * (the first one is `sim.me`), and may be what that seat's host answers (the player's settings:
   * auto jump set); `brain` makes the brain the simulation steps for them; `build` is the
   * athlete's own body and hand.
   */
  athlete(
    role: PositionId,
    side: 1 | -1,
    at: { x: number; z: number; yaw?: number },
    o?: { user?: boolean | SeatHost; brain?: (a: Athlete) => Brain; build?: ConstructorParameters<typeof Athlete>[2] },
  ): Athlete;
  /**
   * Six athletes under a real TeamAI, stepped as the game steps it: after the ball and the judge,
   * home before away. `user` puts a player in that slot. `place` is the formation they start in
   * ('defense' when not given), the player on their book spot too. Two teams in one scene are each
   * other's opponents.
   */
  team(side: 1 | -1, o?: { user?: Slot; place?: Formation; serving?: boolean }): TeamAI;
  /**
   * Put a team in a formation, as at the start of a rally, its player on their book spot too. (A
   * `TeamAI` places the bodies its brains play and never the player's: in the game the drill puts
   * the player there.)
   */
  place(team: TeamAI, form: Formation): void;
  /**
   * Send the ball, in play. `by` is the touch it came from; without it the ball's last touch is
   * left as it was. Returns the velocity it left with.
   */
  send(ball: Flight, by?: SentBy): V3;
  /** play fixed steps, the invariants checked at each */
  step(n?: number): void;
  /**
   * Play frames, as the app does: every seat plays the intent it holds (`Seat.frame`: the
   * controller, the last steps onto a set, the walk back), then the simulation steps twice.
   * Feed a seat its player's hands by writing what it holds (`sim.seats[i].intent`).
   */
  frame(n?: number): void;
  /**
   * Play for `seconds` (a part of a step is played as a whole one), or until `until` is true after
   * a step. Returns whether it became true.
   */
  run(seconds: number, until?: () => boolean): boolean;
}

/** a real simulation with nobody watching, and what a test needs to put on its court */
export function scene(o: SceneOptions = {}): Scene {
  const touches: Scene['touches'] = [];
  const outcomes: Scene['outcomes'] = [];
  const teams: TeamAI[] = [];
  const hooks = o.hooks ?? {};
  const sim: Simulation = new Simulation({
    ...NO_HOOKS,
    ...hooks,
    contact: (ev) => {
      touches.push({ t: sim.simTime, ev });
      hooks.contact?.(ev);
    },
    outcome: (out) => {
      outcomes.push({ t: sim.simTime, o: out });
      hooks.outcome?.(out);
    },
  });
  sim.rng.reseed(o.seed ?? 1);
  if (o.dice && o.dice !== 'seeded') {
    const { roll, noise = 0 } = o.dice;
    sim.rng.next = typeof roll === 'function' ? roll : () => roll;
    sim.rng.gauss = () => noise;
  }
  if (o.touches === 'none') {
    sim.contact.tryPass = () => false;
    sim.contact.trySet = () => false;
    sim.contact.tryBlock = () => false;
  }
  const drill = o.drill ?? {};
  sim.drill = {
    ...drill,
    step: (dt) => {
      for (const t of teams) t.step();
      drill.step?.(dt);
    },
    onOutcome: (out) => drill.onOutcome?.(out),
  };

  const athlete: Scene['athlete'] = (role, side, at, opts = {}) => {
    const a = new Athlete(role, side, opts.build);
    a.place(at.x, at.z, at.yaw ?? a.yaw);
    sim.athletes.push(a);
    if (opts.user) sim.addSeat(a, opts.user === true ? {} : opts.user);
    if (opts.brain) sim.setBrain(a, opts.brain(a));
    return a;
  };

  const place: Scene['place'] = (t, form) => {
    t.place(form);
    const you = t.user;
    if (!you || !t.userSlot) return;
    const spot = t.formSpot(form, t.userSlot);
    // a player is put on a spot through their seat: their look turns with their body
    sim.seatOf(you)!.place(spot.x, spot.z, netYaw(t.side));
  };

  const team: Scene['team'] = (side, opts = {}) => {
    const t = new TeamAI(side, sim);
    for (const slot of SLOTS) {
      const mine = slot === opts.user;
      t.add(slot, athlete(SLOT_ROLE[slot], side, { x: 0, z: 0 }, { user: mine }), mine);
    }
    if (opts.serving) t.serving = true;
    place(t, opts.place ?? 'defense');
    for (const other of teams) {
      if (other.side === side) continue;
      t.opponents = other;
      other.opponents = t;
    }
    teams.push(t);
    teams.sort((a, b) => b.side - a.side);
    return t;
  };

  const send: Scene['send'] = (ball, by) => {
    const v = { x: 0, y: 0, z: 0 };
    const w = { x: 0, y: 0, z: 0 };
    if ('v' in ball) Object.assign(v, ball.v);
    else if ('apex' in ball) solveApex(ball.from, ball.to, ball.apex, ball.w ?? NO_SPIN, v);
    else solveFixedTime(ball.from, ball.to, ball.time, ball.w ?? NO_SPIN, v);
    if (ball.w) Object.assign(w, ball.w);
    sim.ball.launch(ball.from, v, w, 0, sim.simTime);
    sim.ballLive = true;
    if (by) sim.ball.lastTouch = { ...by, t: by.t ?? sim.simTime };
    return v;
  };

  const step: Scene['step'] = (n = 1) => {
    for (let i = 0; i < n; i++) {
      const before = sim.simTime;
      sim.step(DT);
      const broken = brokenInvariants(sim, before, DT);
      if (broken.length) throw new Error(`at ${sim.simTime.toFixed(4)} s: ${broken.join('; ')}`);
    }
  };

  const run: Scene['run'] = (seconds, until) => {
    for (let i = 0; i < seconds * SIM.hz; i++) {
      step();
      if (until?.()) return true;
    }
    return false;
  };

  const frame: Scene['frame'] = (n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const seat of sim.seats) seat.frame(FRAME);
      step(STEPS_A_FRAME);
    }
  };

  return { sim, touches, outcomes, athlete, team, place, send, step, frame, run };
}
