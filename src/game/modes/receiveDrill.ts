import * as THREE from 'three';
import { yawFromDir } from '../../core/mathx';
import { COACH_TOSS, FX, RECEIVE_DRILL, type PositionId } from '../../config';
import { solveApex } from '../../physics/solve';
import { HitterBrain } from '../../ai/hitter';
import { ServerBrain } from '../../ai/server';
import { SetterBrain } from '../../ai/setter';
import { Athlete } from '../athlete';
import type { ContactEvent } from '../contact';
import type { Outcome } from '../judge';
import { attackHeight, laneFor, SETTER_SPOT, SETTER_TARGET } from '../plays';
import { kbd } from '../../core/kbd';
import type { HaloMark } from './markers';
import { Mode, type DrillHost } from './mode';

/** where the user receives from, by position */
const RECEIVE_SPOT: Record<PositionId, { x: number; z: number }> = RECEIVE_DRILL.cast.spot;

type Phase = 'intro' | 'feed' | 'live' | 'result';

/** 0-3 pass rating from where the ball will come down near the setter */
export function ratePass(g: Pick<DrillHost, 'ball' | 'env' | 'simTime'>, side: 1 | -1): { rating: number; dist: number; over: boolean } {
  const R = RECEIVE_DRILL.rate;
  const pred = g.ball.ensurePrediction(g.env, g.simTime);
  const t = pred.descendThrough(RECEIVE_DRILL.target.y, g.simTime);
  const target = { x: SETTER_TARGET.x * side, z: SETTER_TARGET.z * side };
  // (99: no distance to give, the pass never comes down on this side)
  if (pred.netCrossT > 0 && (t < 0 || pred.netCrossT < t)) return { rating: 0, dist: 99, over: true };
  if (t < 0) return { rating: 0, dist: 99, over: false };
  const p = { x: 0, y: 0, z: 0 };
  pred.posAt(t, p);
  const dist = Math.hypot(p.x - target.x, p.z - target.z);
  const playable = Math.abs(p.x) < R.playable.side && p.z * side > -R.playable.past && p.z * side < R.playable.deep;
  const rating = dist <= R.three ? 3 : dist <= R.two ? 2 : playable ? 1 : 0;
  return { rating, dist, over: false };
}

/**
 * Serve receive / dig: alternating float serves and attacks from the far
 * side; pass (E) to the setter target. Passes are rated 0-3 like real stats,
 * and your setter + outside hitter finish good passes.
 */
export class ReceiveDrill extends Mode {
  readonly id = 'receive' as const;
  private server!: Athlete;
  private serverBrain!: ServerBrain;
  private oppSetter!: Athlete;
  private oppHitter!: Athlete;
  private oppHitterBrain!: HitterBrain;
  private coach!: Athlete;
  private setter!: Athlete;
  private hitter!: Athlete;
  private phase: Phase = 'intro';
  private t = 0;
  private kind: 'serve' | 'attack' = 'serve';
  private passed: { rating: number; grade: string } | null = null;
  private targetHalo!: HaloMark;
  private tossed = false;
  private attackTarget = new THREE.Vector3();

  setup(): void {
    const g = this.g;
    const cast = RECEIVE_DRILL.cast;
    const spot = RECEIVE_SPOT[this.position];
    g.placeUser(spot.x, spot.z, 0);
    // far side: server, setter, hitter, coach
    this.server = this.spawn('OPP', -1, cast.server.x, cast.server.z, cast.seed.server);
    this.serverBrain = new ServerBrain(this.server);
    g.setBrain(this.server, this.serverBrain);
    this.oppSetter = this.spawn('S', -1, -SETTER_SPOT.x, -SETTER_SPOT.z, cast.seed.theirSetter);
    const osb = new SetterBrain(this.oppSetter, { x: -SETTER_SPOT.x, z: -SETTER_SPOT.z }, -Math.PI / 2);
    osb.shouldPlay = () => this.kind === 'attack' && this.g.ball.lastTouch?.kind === 'feed';
    osb.call = () => {
      const lane = laneFor('OH', -1);
      const y = attackHeight(this.oppHitter);
      return { target: { x: lane.x, y, z: lane.z }, apex: y + lane.apexAbove, hitter: this.oppHitter };
    };
    g.setBrain(this.oppSetter, osb);
    this.oppHitter = this.spawn('OH', -1, laneFor('OH', -1).sx, laneFor('OH', -1).sz, cast.seed.theirHitter);
    this.oppHitterBrain = new HitterBrain(this.oppHitter, laneFor('OH', -1));
    this.oppHitterBrain.isMySet = () => this.g.ball.lastTouch?.kind === 'set' && this.g.ball.lastTouch.side === -1;
    this.oppHitterBrain.tipChance = RECEIVE_DRILL.attack.tipChance;
    this.oppHitterBrain.chooseAim = () => {
      // attack at you (dig drill): within ~1.5 m
      const me = this.g.me;
      const A = RECEIVE_DRILL.attack;
      this.attackTarget.set(me.pos.x + this.g.rng.gauss() * A.spreadX, 0, me.pos.z + this.g.rng.gauss() * A.spreadZ);
      return this.attackTarget.clone();
    };
    this.oppHitterBrain.skill = RECEIVE_DRILL.attack.skill;
    g.setBrain(this.oppHitter, this.oppHitterBrain);
    this.coach = this.spawn('MB', -1, cast.coach.x, cast.coach.z, cast.seed.coach, 'coach');
    this.coach.airIntent = 'neutral';
    // our side: setter + outside hitter to finish good passes
    this.setter = this.spawn('S', 1, SETTER_SPOT.x, SETTER_SPOT.z, cast.seed.setter);
    this.setter.yaw = Math.PI / 2;
    const sb = new SetterBrain(this.setter, SETTER_SPOT, Math.PI / 2);
    sb.shouldPlay = () => {
      const lt = this.g.ball.lastTouch;
      return !!lt && lt.athlete === this.g.me && (lt.kind === 'pass' || lt.kind === 'dig') && (this.passed?.rating ?? 0) >= 1;
    };
    sb.call = () => {
      const lane = laneFor('OH', 1);
      const y = attackHeight(this.hitter);
      return { target: { x: lane.x, y, z: lane.z }, apex: y + lane.apexAbove, hitter: this.hitter };
    };
    g.setBrain(this.setter, sb);
    if (this.position !== 'OH') {
      this.hitter = this.spawn('OH', 1, laneFor('OH', 1).sx, laneFor('OH', 1).sz, cast.seed.hitter);
    } else {
      this.hitter = this.spawn('OPP', 1, laneFor('OPP', 1).sx, laneFor('OPP', 1).sz, cast.seed.hitter);
    }
    const hb = new HitterBrain(this.hitter, laneFor(this.hitter.role === 'OH' ? 'OH' : 'OPP', 1));
    hb.isMySet = () => this.g.ball.lastTouch?.kind === 'set' && this.g.ball.lastTouch.side === 1;
    if (this.hitter.role === 'OPP') {
      sb.call = () => {
        const lane = laneFor('OPP', 1);
        const y = attackHeight(this.hitter);
        return { target: { x: lane.x, y, z: lane.z }, apex: y + lane.apexAbove, hitter: this.hitter };
      };
    }
    g.setBrain(this.hitter, hb);

    // setter target marker
    const target = RECEIVE_DRILL.target;
    g.markers.ring(target.ring, target.ringSize).place(SETTER_TARGET.x, SETTER_TARGET.z);
    this.targetHalo = g.markers.halo(SETTER_TARGET.x, target.y, SETTER_TARGET.z);
    g.hud.setTitle('Serve Receive / Dig');
    this.updateScore();
    g.hud.message('Get behind the ball · press E early to form the platform', RECEIVE_DRILL.say.intro, true);
    this.toPhase('intro');
  }

  private spawn(role: PositionId, side: 1 | -1, x: number, z: number, seed: number, kit: 'team' | 'coach' = 'team'): Athlete {
    const a = new Athlete(role, side);
    a.place(x, z, side === 1 ? 0 : Math.PI);
    this.g.addAthlete(a, seed, kit);
    this.spawned.push(a);
    return a;
  }

  passTarget(a: Athlete) {
    const s = a.side;
    return { x: SETTER_TARGET.x * s, y: RECEIVE_DRILL.target.y, z: SETTER_TARGET.z * s, apex: RECEIVE_DRILL.target.apex };
  }

  canServe(a: Athlete): boolean {
    return (
      a === this.server &&
      this.phase === 'live' &&
      this.kind === 'serve' &&
      (!this.g.ball.active || this.g.ball.state.rest || this.g.ball.lastTouch?.athlete === a)
    );
  }

  hint(): string {
    return `${kbd('WASD')} get behind the ball · ${kbd('E')} pass / dig (press early, hold) · ${kbd('V')} camera · ${kbd('N')} reset`;
  }

  private updateScore(): void {
    this.g.hud.setScore(`${this.score} pts · rep ${this.reps}${this.reps ? ` · avg ${(this.ratingSum / this.reps).toFixed(2)}` : ''}`);
  }
  private ratingSum = 0;

  restartRep(): void {
    this.nextRep();
  }

  step(dt: number): void {
    const g = this.g;
    this.t += dt;
    const T = RECEIVE_DRILL.timing;
    const F = RECEIVE_DRILL.feed;
    this.targetHalo.turn(dt * RECEIVE_DRILL.target.haloTurn);
    switch (this.phase) {
      case 'intro':
        if (this.t > T.intro) this.toPhase('feed');
        break;
      case 'feed':
        if (g.userReturning) break;
        this.kind = this.reps % F.attackEvery === F.attackEvery - 1 ? 'attack' : 'serve';
        this.passed = null;
        this.toPhase('live');
        if (this.kind === 'serve') {
          const me = g.me;
          const tgt = new THREE.Vector3(me.pos.x + g.rng.gauss() * F.spreadX, 0, me.pos.z + g.rng.gauss() * F.spreadZ);
          this.serverBrain.serve(tgt, g.rng.range(-F.serveFrom, F.serveFrom));
          g.hud.message('Serve!', RECEIVE_DRILL.say.feed);
        } else g.hud.message('Attack: dig it!', RECEIVE_DRILL.say.feed);
        break;
      case 'live':
        if (this.kind === 'attack' && !this.tossed && this.t > T.toss) {
          this.tossed = true;
          this.coach.startAction('toss', g.simTime);
          const from = { x: this.coach.pos.x + COACH_TOSS.hand.x, y: COACH_TOSS.hand.y, z: this.coach.pos.z + COACH_TOSS.hand.z };
          const v = { x: 0, y: 0, z: 0 };
          solveApex(
            from,
            { x: -SETTER_TARGET.x, y: COACH_TOSS.targetY, z: -SETTER_TARGET.z },
            SETTER_TARGET.height + COACH_TOSS.apexAbove,
            { x: 0, y: 0, z: 0 },
            v,
          );
          g.ball.launch(from, v, { x: COACH_TOSS.spin, y: 0, z: 0 }, 0, g.simTime);
          g.ball.lastTouch = { athlete: this.coach, kind: 'feed', t: g.simTime, side: -1 };
        }
        if (this.coach.action?.kind === 'toss' && g.simTime - this.coach.action.t0 > T.arm) this.coach.endAction();
        if (this.t > T.liveMax || (g.ball.state.rest && this.t > T.rest)) this.finish(null);
        break;
      case 'result':
        if (this.t > T.result) this.nextRep();
        break;
    }
    this.coach.cmd.faceYaw = yawFromDir(-SETTER_TARGET.x - this.coach.pos.x, -SETTER_TARGET.z - this.coach.pos.z);
  }

  /** only the serve or the attack is the user's: what their setter and hitter do with the pass is not */
  userBall(): boolean {
    const lt = this.g.ball.lastTouch;
    return !!lt && lt.side === -1 && lt.kind !== 'block';
  }

  onContact(ev: ContactEvent): void {
    const g = this.g;
    if (ev.athlete === g.me && (ev.kind === 'pass' || ev.kind === 'dig')) {
      const r = ratePass(g, 1);
      this.passed = { rating: r.rating, grade: ev.grade ?? '' };
      const label = r.over ? 'OVERPASS' : `${r.rating}-PASS`;
      g.hud.showBanner(
        `${label}${r.rating === 3 ? ' · PERFECT TO TARGET' : ''}`,
        r.rating >= 2 ? 'good' : r.rating === 1 ? 'neutral' : 'bad',
        FX.grade.pass,
      );
      g.crowd(r.rating >= 2 ? RECEIVE_DRILL.crowd.good : RECEIVE_DRILL.crowd.other);
    }
  }

  onOutcome(o: Outcome): void {
    if (this.phase !== 'live') return;
    const lt = this.g.ball.lastTouch;
    // the rally ends: either our attack finished, or the ball got through
    if (this.passed || (lt && lt.side === -1) || o.side === 1) this.finish(o);
  }

  private finish(_o: Outcome | null): void {
    const g = this.g;
    if (this.phase === 'result') return;
    this.toPhase('result');
    this.reps++;
    const p = this.passed;
    const rating = p ? p.rating : 0;
    this.ratingSum += rating;
    const pts = RECEIVE_DRILL.points[rating];
    this.score += pts;
    this.bumpStreak(rating >= 2);
    if (!p) g.hud.showBanner(this.kind === 'serve' ? 'ACE' : 'NO DIG', 'bad');
    else g.hud.message(`+${pts}`, RECEIVE_DRILL.say.points);
    this.updateScore();
  }

  private nextRep(): void {
    const g = this.g;
    g.judge.disarm();
    g.ball.hide();
    this.tossed = false;
    this.serverBrain.phase = 'idle';
    this.server.endAction();
    this.server.place(RECEIVE_DRILL.cast.server.x, RECEIVE_DRILL.cast.server.z, Math.PI);
    this.oppHitterBrain.reset();
    this.oppHitter.place(laneFor('OH', -1).sx, laneFor('OH', -1).sz, Math.PI);
    this.oppSetter.place(-SETTER_SPOT.x, -SETTER_SPOT.z, -Math.PI / 2);
    this.setter.place(SETTER_SPOT.x, SETTER_SPOT.z, Math.PI / 2);
    const hb = g.brains.get(this.hitter) as HitterBrain | undefined;
    hb?.reset();
    const lane = laneFor(this.hitter.role === 'OH' ? 'OH' : 'OPP', 1);
    this.hitter.place(lane.sx, lane.sz, 0);
    const spot = RECEIVE_SPOT[this.position];
    const me = g.me;
    if (Math.hypot(me.pos.x - spot.x, me.pos.z - spot.z) > RECEIVE_DRILL.slack) g.returnUser(spot.x, spot.z, 0);
    this.toPhase('feed');
  }

  private toPhase(p: Phase): void {
    this.phase = p;
    this.t = 0;
  }
}
