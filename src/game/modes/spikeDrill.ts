import * as THREE from 'three';
import { COACH_TOSS, COURT, RUN_UP_GO, SPIKE_DRILL, type PositionId } from '../../config';
import { R } from '../../physics/ball';
import { solveApex } from '../../physics/solve';
import { SetterBrain } from '../../ai/setter';
import { Athlete } from '../athlete';
import type { ContactEvent } from '../contact';
import { outcomeLabel, type Outcome } from '../judge';
import {
  attackHeight,
  laneFor,
  quickSetFor,
  quickSpot,
  SET_PLAYS,
  SETTER_SPOT,
  SETTER_TARGET,
  setterTouchY,
  type AttackLane,
  type SetPlay,
} from '../plays';
import type { ApproachLine } from '../tutorial';
import { kbd } from '../../core/kbd';
import type { GuideMark, ShadowMark, ZoneMark } from './markers';
import { Mode } from './mode';
import { planApproach, planQuick, planToPoint, simulateApproach, type ApproachPlan } from '../approach';
import { BlockerBrain } from '../../ai/blocker';
import { blockShadowOnCourt, HANDS_WIDTH, type HandSpan } from '../blockShadow';
import type { RouteView } from '../routes';

/** block practice: nobody, one blocker fronting your lane, or that blocker plus a middle closing */
export type BlockLevel = 0 | 1 | 2;
const BLOCK_NAMES = ['off', 'single', 'double'] as const;

interface Zone {
  name: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** opponent-court target zones (far side, z < 0) for a left-side attacker */
const ZONES: readonly Zone[] = SPIKE_DRILL.zones.pin;

/** target zones for this position: mirrored for right-side attackers; a middle hits zone 1 or 5 */
function zonesFor(pos: PositionId): readonly Zone[] {
  if (pos === 'MB') return SPIKE_DRILL.zones.middle;
  if (pos === 'OPP' || pos === 'S') return ZONES.map((z) => ({ ...z, x0: -z.x1, x1: -z.x0 }));
  return ZONES;
}

type Phase = 'intro' | 'feed' | 'live' | 'result';

/**
 * Spike drill: a coach tosses to the setter, the setter sets the user's lane,
 * the user approaches and attacks. Timing, power and placement are scored.
 */
export class SpikeDrill extends Mode {
  readonly id = 'spike' as const;
  private setter: Athlete | null = null;
  private coach!: Athlete;
  private phase: Phase = 'intro';
  private t = 0;
  private zone!: Zone;
  private zoneMarker!: ZoneMark;
  /** where your feet go: the plant spot (and, in the first-run lesson, the arrows to it) */
  private guide!: GuideMark;
  private line: ApproachLine = {
    tGo: -1,
    tPlant: -1,
    hold: 0,
    dirX: 0,
    dirZ: -1,
    yaw: 0,
    spot: { x: 0, z: 0 },
    start: { x: 0, z: 0 },
    plant: null,
  };
  private lastGrade: ContactEvent | null = null;
  private userTouched = false;
  private tossed = false;
  /** when a perfect approach would start for the current set (the GO cue) */
  private goAt = -1;
  private plannedFor: unknown = null;
  private ringPulse = 0;
  private tmp = { x: 0, y: 0, z: 0 };
  /** the routes this position calls (keys 1-5), if it has any */
  private plays: readonly SetPlay[] | null = null;
  private callIdx = 0;
  /** an approach planned before the set (quick / tempo balls) for the autopilot */
  earlyPlan: ApproachPlan | null = null;
  earlyFor: unknown = null;
  /** opposing block (key B): off / single / double */
  blockLevel: BlockLevel = 0;
  private blockers: { a: Athlete; brain: BlockerBrain }[] = [];
  /** the block's shadow on their floor: where a straight ball from your contact cannot go */
  private shadow!: ShadowMark;

  private get play(): SetPlay | null {
    return this.plays ? this.plays[this.callIdx] : null;
  }

  /** the lane of the current set call */
  private get lane(): AttackLane {
    return this.play?.lane ?? laneFor(this.position, 1);
  }

  private setTitle(): void {
    if (this.g.tutorial.active) {
      this.g.hud.setTitle('Spike Drill · Outside');
      return;
    }
    const block = this.blockLevel ? ` · block: ${BLOCK_NAMES[this.blockLevel]}` : '';
    this.g.hud.setTitle('Spike Drill · ' + this.lane.label + block);
  }

  /** B: cycle the opposing block off → single → double (the 3 is how many levels there are, not a number to tune) */
  cycleBlock(): void {
    this.setBlock(((this.blockLevel + 1) % 3) as BlockLevel);
  }

  setBlock(level: BlockLevel): void {
    this.blockLevel = level;
    this.ensureBlockers();
    this.placeBlockers();
    this.setTitle();
    this.updateScore();
    const what =
      level === 0 ? 'Block off' : level === 1 ? 'Block: single · hit around it' : 'Block: double · line or cross, or over the top';
    this.g.hud.message(what, SPIKE_DRILL.say.block);
  }

  /** spawn the two opposing blockers the first time the block is turned on */
  private ensureBlockers(): void {
    if (this.blockers.length || this.blockLevel === 0) return;
    const g = this.g;
    const B = SPIKE_DRILL.block;
    const specs: { role: PositionId; range: number; closeInside: number; seed: number }[] = [
      // a pin blocker fronting your lane, and a middle running to close next to them
      { role: 'OPP', ...B.pin },
      { role: 'MB', ...B.middle },
    ];
    for (const sp of specs) {
      const a = new Athlete(sp.role, -1);
      a.place(0, B.homeZ, Math.PI);
      g.addAthlete(a, sp.seed);
      this.spawned.push(a);
      const brain = new BlockerBrain(a, 0, sp.range);
      brain.closeInside = sp.closeInside;
      // the setter position attacks the coach's toss straight away: that is the ball to read
      brain.readFeed = this.position === 'S';
      g.setBrain(a, brain);
      this.blockers.push({ a, brain });
    }
  }

  /** each rep: the active blockers back at home facing you, the rest parked in the free zone */
  private placeBlockers(): void {
    const laneX = this.play?.inFront !== undefined ? quickSpot(SETTER_TARGET.x, 1, this.play.inFront).x : this.lane.x;
    const B = SPIKE_DRILL.block;
    this.blockers.forEach((b, i) => {
      const active = i < this.blockLevel;
      b.brain.enabled = active;
      b.brain.reset();
      b.a.endAction();
      if (active) {
        b.brain.homeX = i === 0 ? laneX : 0;
        b.a.place(b.brain.homeX, B.homeZ, Math.PI);
      } else b.a.place(i === 0 ? -B.park.x : B.park.x, B.park.z, Math.PI);
    });
  }

  /** the blockers who are in play */
  private activeBlockers(): Athlete[] {
    return this.blockers.slice(0, this.blockLevel).map((b) => b.a);
  }

  /** where your contact will be (the set when it is up, otherwise the lane) */
  private contactPoint(out: { x: number; y: number; z: number }): void {
    const g = this.g;
    const me = g.me;
    const play = this.play;
    const quick = play?.inFront !== undefined;
    const spot = quick ? quickSpot(SETTER_TARGET.x, 1, play!.inFront) : this.lane;
    out.x = spot.x;
    out.y = attackHeight(me);
    out.z = spot.z;
    const lt = g.ball.lastTouch;
    const setUp = g.ball.active && lt && (lt.kind === 'set' || (this.position === 'S' && lt.kind === 'feed'));
    if (setUp) {
      const pred = g.ball.ensurePrediction(g.env, g.simTime);
      const tc = pred.descendThrough(out.y, g.simTime);
      if (tc > 0) pred.posAt(tc, out);
    }
  }

  /** redraw the block shadow from where the blockers are right now */
  private updateShadow(): void {
    const show = this.blockLevel > 0 && this.phase !== 'intro';
    if (show) this.contactPoint(this.tmp);
    this.drawShadow(show, this.tmp, show ? this.activeBlockers().map((a) => a.pos.x) : []);
  }

  /** during a replay: the shadow of the replayed block (where it is in the replay) from the replayed contact */
  replayFrame(): void {
    const xs: number[] = [];
    for (const a of this.activeBlockers()) {
      const v = this.g.views.get(a);
      // a blocker the replay hides was not there yet at this point of it
      if (v && v.root.visible) xs.push(v.root.position.x);
    }
    this.drawShadow(this.blockLevel > 0, this.g.fx.replay.contact, xs);
  }

  /** the shadow on their floor of hands at these x along the net, for a ball hit from `contact` */
  private drawShadow(show: boolean, contact: { x: number; y: number; z: number }, handsX: number[]): void {
    if (!show) {
      this.shadow.draw(null);
      return;
    }
    const spans: HandSpan[] = handsX.map((x) => ({ x0: x - HANDS_WIDTH / 2, x1: x + HANDS_WIDTH / 2 }));
    this.shadow.draw(
      blockShadowOnCourt(contact, spans, this.g.env.netTop + SPIKE_DRILL.block.handsAboveNet, COURT.halfWidth, COURT.halfLength),
    );
  }

  /** your routes and the one you are calling (the route strip and panel) */
  routes(): RouteView | null {
    if (!this.plays || this.g.tutorial.active) return null;
    return { position: this.position as RouteView['position'], plays: this.plays, on: this.callIdx, play: null, high: false };
  }

  /** choose the set call for the next ball (0-based) */
  selectCall(i: number): void {
    if (!this.plays || i < 0 || i >= this.plays.length) return;
    this.callIdx = i;
    const g = this.g;
    this.setTitle();
    g.hud.message(`Next set: ${i + 1} · ${this.plays[i].name}`, SPIKE_DRILL.say.call);
    this.updateScore();
    // not tossed yet: head to the new approach start
    if ((this.phase === 'intro' || this.phase === 'feed') && !this.tossed) {
      const l = this.lane;
      if (Math.hypot(g.me.pos.x - l.sx, g.me.pos.z - l.sz) > SPIKE_DRILL.slack) g.returnUser(l.sx, l.sz, 0);
      this.placeBlockers();
    }
  }

  setup(): void {
    const g = this.g;
    const me = g.me;
    const cast = SPIKE_DRILL.cast;
    this.plays = SET_PLAYS[this.position] ?? null;
    this.callIdx = 0;
    const lane = this.lane;
    g.placeUser(lane.sx, lane.sz, 0);
    // setter (unless the user is the setter: then the coach passes straight to you)
    if (this.position !== 'S') {
      const s = new Athlete('S', 1);
      s.place(SETTER_SPOT.x, SETTER_SPOT.z, Math.PI / 2);
      g.addAthlete(s, cast.seed.setter);
      this.spawned.push(s);
      this.setter = s;
      const b = new SetterBrain(s, SETTER_SPOT, Math.PI / 2);
      b.shouldPlay = () => !this.userTouched && this.g.ball.lastTouch?.kind === 'feed';
      b.call = () => {
        // a quick meets you at the top of your jump if you went with the setter's touch
        const play = this.play;
        if (play?.inFront !== undefined) return quickSetFor(me, this.g.simTime, this.g.ball.pos, undefined, play.inFront);
        const target = this.lane;
        const y = attackHeight(me);
        return { target: { x: target.x, y, z: target.z }, apex: y + target.apexAbove, hitter: me };
      };
      g.setBrain(s, b);
    }
    // coach on the right-back of our court, tossing to the setter
    this.coach = new Athlete('OPP', 1);
    this.coach.place(cast.coach.x, cast.coach.z, cast.coach.yaw);
    g.addAthlete(this.coach, cast.seed.coach, 'coach');
    this.spawned.push(this.coach);
    this.coach.airIntent = 'neutral';

    this.zoneMarker = g.markers.zone();
    this.guide = g.markers.approachGuide();
    this.shadow = g.markers.blockShadow();
    this.pickZone();
    this.setTitle();
    this.updateScore();
    this.phase = 'intro';
    this.t = 0;
    // the tutorial speaks through the coach line; the drill's own intro (and its tip mention) stays down
    if (!g.tutorial.active) {
      const routes = this.plays ? ` · 1-${this.plays.length} call your route · C see them` : '';
      g.hud.message(
        this.position === 'MB'
          ? `Quick: run on the pass · jump as the setter touches it · hold LMB, release to hit${routes}`
          : this.plays
            ? `Approach: Shift + W · plant: Space · hold LMB, release to hit${routes}`
            : 'Approach: Shift + W · plant: Space · hold LMB to wind up, release to hit',
        SPIKE_DRILL.say.intro,
        true,
      );
    }
  }

  private pickZone(): void {
    const prev = this.zone;
    const zones = zonesFor(this.position);
    do this.zone = zones[Math.floor(this.g.rng.next() * zones.length)];
    while (prev && this.zone === prev && zones.length > 2);
    const z = this.zone;
    this.zoneMarker.set(z.x0, z.x1, z.z0, z.z1);
  }

  private updateScore(): void {
    if (this.g.tutorial.active) {
      // the mocks leave off the set call, the block and the target: one story
      const rep = this.phase === 'result' ? this.reps : this.reps + 1;
      this.g.hud.setScore(`${this.score} pts · rep ${rep}`);
      return;
    }
    const call = this.play ? ` · set ${this.callIdx + 1}: ${this.play.name}` : '';
    const block = this.blockLevel ? ` · block: ${BLOCK_NAMES[this.blockLevel]}` : '';
    this.g.hud.setScore(`${this.score} pts · rep ${this.reps}${call}${block} · target: ${this.zone.name}`);
  }

  hint(): string {
    const me = this.g.me;
    if (me.state === 'air' || me.action?.kind === 'windup')
      return `hold ${kbd('LMB')} = wind up (longer = harder) · release = hit · tap = tip &nbsp; aim with the mouse`;
    if (me.state === 'load') return `release ${kbd('Space')} to jump`;
    const calls = this.plays ? ` · ${kbd('1')}-${kbd(String(this.plays.length))} route · ${kbd('C')} routes` : '';
    const block = ` · ${kbd('B')} block: ${BLOCK_NAMES[this.blockLevel]}`;
    if (this.play?.inFront !== undefined)
      return `${kbd('Shift')}+${kbd('W')} run on the pass · ${kbd('Space')} jump with the setter's touch${calls}${block} · ${kbd('V')} camera · ${kbd('N')} reset rep`;
    return `${kbd('Shift')}+${kbd('W')} approach · ${kbd('Space')} plant & jump${calls}${block} · ${kbd('V')} camera · ${kbd('N')} reset rep`;
  }

  restartRep(snap = false): void {
    this.endRep(null, true, snap);
  }

  step(dt: number): void {
    const g = this.g;
    const T = SPIKE_DRILL.timing;
    this.t += dt;
    // coach faces the setter
    this.coach.cmd.faceYaw = Math.atan2(-(SETTER_TARGET.x - this.coach.pos.x), -(SETTER_TARGET.z - this.coach.pos.z));
    switch (this.phase) {
      case 'intro':
        // the lesson's welcome: no toss yet
        if (g.tutorial.holdingFeed()) {
          this.t = 0;
          break;
        }
        if (this.t > (g.tutorial.active ? T.lessonIntro : T.intro)) this.toPhase('feed');
        break;
      case 'feed': {
        if (g.userReturning) {
          this.t = 0;
          break;
        }
        if (!this.tossed && this.t > T.toss) {
          this.coach.startAction('toss', g.simTime);
          this.tossed = true;
        }
        if (this.tossed && this.t > T.release) {
          this.coach.endAction();
          this.feedBall();
          this.toPhase('live');
        }
        break;
      }
      case 'live': {
        const ball = g.ball;
        if (ball.state.rest || this.t > T.liveMax) this.endRep(null);
        break;
      }
      case 'result':
        // the lesson: the next toss waits until the coach's line about this rep has been read
        if (g.tutorial.holdingResult()) break;
        if (this.t > T.result) this.nextRep();
        break;
    }
    // approach ring: where your feet should be when you hit (fades once the set is up)
    const lane = this.lane;
    const me = g.me;
    const play = this.play;
    const quick = play?.inFront !== undefined;
    // fast sets (quicks, go / fast back) need the run to start before the set: plan them from the pass
    const early = !!play && (quick || lane.apexAbove < SPIKE_DRILL.guide.fastSetApex);
    const off = new THREE.Vector3();
    me.idealContact(off, new THREE.Vector3(0, 0, 0)).setY(0);
    const spot = quick ? quickSpot(SETTER_TARGET.x, 1, play!.inFront) : lane;
    this.line.spot.x = spot.x - off.x;
    this.line.spot.z = spot.z - off.z;
    this.line.start.x = lane.sx;
    this.line.start.z = lane.sz;
    // GO cue: when a perfect approach would start
    const lt = g.ball.lastTouch;
    const setUp = g.ball.active && lt && (early ? lt.kind === 'feed' : lt.kind === 'set' || (this.position === 'S' && lt.kind === 'feed'));
    if (setUp && lt !== this.plannedFor && me.state === 'ground') {
      this.plannedFor = lt;
      const pred = g.ball.ensurePrediction(g.env, g.simTime);
      let plan: ApproachPlan | null = null;
      if (early) {
        const tSet = pred.descendThrough(setterTouchY(this.setter), g.simTime);
        if (tSet > 0) {
          pred.posAt(tSet, this.tmp);
          if (quick) plan = planQuick(me, g.simTime, quickSpot(this.tmp.x, 1, play!.inFront), tSet, 0, 0);
          else {
            // where and when the set will meet you (the setter's solved arc)
            const y = attackHeight(me);
            const contact = new THREE.Vector3(lane.x, y, lane.z);
            const v = { x: 0, y: 0, z: 0 };
            const arc = solveApex({ ...this.tmp }, contact, y + lane.apexAbove, { x: 0, y: 0, z: 0 }, v);
            plan = planToPoint(me, g.simTime, contact, tSet + arc.T, 0, 0);
          }
        }
        this.earlyPlan = plan;
        this.earlyFor = lt;
      } else plan = planApproach(me, pred, g.simTime, 0, 0);
      this.goAt = plan && plan.error < SPIKE_DRILL.guide.goError ? plan.tStart : -1;
      if (plan) {
        const l = this.line;
        l.tGo = plan.tStart;
        l.tPlant = plan.tPress;
        l.hold = plan.hold;
        l.dirX = plan.dir.x;
        l.dirZ = plan.dir.z;
        l.yaw = plan.runYaw;
        // where that run plants: the line to jump from (the jump carries on to the spot)
        const at = simulateApproach(me, g.simTime, plan.tStart, plan.tPress, plan.hold, plan.dir, plan.runYaw, plan.airYaw, plan.tPress);
        l.plant = { x: at.pos.x, z: at.pos.z };
      }
    }
    const showRing = g.settings.runUpGuide || g.tutorial.active;
    if (this.goAt > 0 && g.simTime >= this.goAt) {
      this.goAt = -1;
      if (showRing) {
        g.hud.go();
        this.ringPulse = 1;
      }
    }
    this.ringPulse = Math.max(0, this.ringPulse - dt * RUN_UP_GO.fade);
    this.updateShadow();
  }

  refreshHud(): void {
    this.setTitle();
    this.updateScore();
  }

  /** the approach for the set in the air (the first-run lesson reads it) */
  approachLine(): ApproachLine {
    return this.line;
  }

  frame(dt: number): void {
    this.zoneMarker.update(dt);
    const g = this.g;
    const teach = g.tutorial.active;
    this.guide.update(
      {
        spot: g.settings.runUpGuide || teach ? this.line.spot : null,
        from: teach && g.tutorial.showPath() ? this.line.start : null,
        plant: this.line.plant,
        feet: g.me.rpos,
        pulse: this.ringPulse,
        urge: g.tutorial.urgeRun(),
      },
      dt,
    );
    // one Outside set, block off: swallow the call and block keys until the lesson ends
    if (this.g.tutorial.active) {
      if (this.plays) for (let i = 0; i < this.plays.length; i++) this.g.keyPressed('Digit' + (i + 1));
      this.g.keyPressed('KeyB');
      return;
    }
    if (this.plays) {
      for (let i = 0; i < this.plays.length; i++) if (this.g.keyPressed('Digit' + (i + 1))) this.selectCall(i);
    }
    if (this.g.keyPressed('KeyB')) this.cycleBlock();
  }

  private feedBall(): void {
    const g = this.g;
    const from = { x: this.coach.pos.x - COACH_TOSS.hand.x, y: COACH_TOSS.hand.y, z: this.coach.pos.z - COACH_TOSS.hand.z };
    let target: { x: number; y: number; z: number };
    let apex: number;
    if (this.position === 'S') {
      // pass straight to the setter's attack spot
      const lane = laneFor('S', 1);
      const y = attackHeight(g.me);
      target = { x: lane.x, y, z: lane.z };
      apex = y + lane.apexAbove + SPIKE_DRILL.feed.setterApexAbove;
    } else {
      target = { x: SETTER_TARGET.x, y: COACH_TOSS.targetY, z: SETTER_TARGET.z };
      apex = SETTER_TARGET.height + COACH_TOSS.apexAbove;
    }
    const v = { x: 0, y: 0, z: 0 };
    solveApex(from, target, apex, { x: 0, y: 0, z: 0 }, v);
    g.ball.launch(from, v, { x: -COACH_TOSS.spin, y: 0, z: 0 }, 0, g.simTime);
    g.ball.lastTouch = { athlete: this.coach, kind: 'feed', t: g.simTime, side: 1 };
    g.judge.arm(g.ball);
    this.userTouched = false;
    this.lastGrade = null;
  }

  onContact(ev: ContactEvent): void {
    if (ev.athlete !== this.g.me) return;
    this.userTouched = true;
    this.lastGrade = ev;
    if (ev.grade) this.g.tutorial.noteContact(ev.grade, ev.note ?? '');
    if (ev.grade === 'Miss') {
      this.score += 0;
    }
  }

  onOutcome(o: Outcome): void {
    if (this.phase !== 'live') return;
    this.endRep(o);
  }

  private endRep(o: Outcome | null, silent = false, snap = false): void {
    const g = this.g;
    if (silent) {
      this.nextRep(snap);
      return;
    }
    this.toPhase('result');
    this.reps++;
    const ev = this.lastGrade;
    const P = SPIKE_DRILL.points;
    const C = SPIKE_DRILL.crowd;
    let pts = 0;
    let label = 'NO ATTACK';
    let good = false;
    // the opposing block touched your ball: stuffed back onto our floor, or tooled off their hands
    const lt = g.ball.lastTouch;
    // (a spike that went round the antenna was out before their hands met it: that is no tool)
    const outWide = o?.kind === 'outside-antenna' && o.winner === -1;
    const blockTouch = this.blockLevel > 0 && lt?.kind === 'block' && lt.side === -1 && !outWide;
    let tooled = false;
    if (ev && ev.grade !== 'Miss' && blockTouch) {
      if (o && o.kind === 'in' && o.side === 1) label = 'BLOCKED';
      else {
        tooled = true;
        pts += (ev.grade === 'Perfect' ? P.perfect : ev.grade === 'Good' ? P.good : P.other) + P.tooled;
        label = 'TOOLED';
      }
    } else if (ev && ev.grade !== 'Miss') {
      const gradePts = ev.grade === 'Perfect' ? P.perfect : ev.grade === 'Good' ? P.good : P.other;
      pts += gradePts;
      // (3.6: m/s to km/h, not a number to tune)
      const kmh = ev.speed * 3.6;
      pts += Math.max(0, Math.round(kmh - P.speedOver));
      if (o) {
        label = outcomeLabel(o, 1);
        if (o.kind === 'in' && o.side === -1) {
          pts += P.kill;
          const z = this.zone;
          const inZone = o.x >= z.x0 - R && o.x <= z.x1 + R && o.z >= z.z0 - R && o.z <= z.z1 + R;
          if (inZone) {
            pts += P.onTarget;
            label = 'KILL · ON TARGET';
          } else label = 'KILL';
          good = ev.grade === 'Perfect' || ev.grade === 'Good';
        }
      }
    } else if (ev && ev.grade === 'Miss') {
      label = 'WHIFF';
    }
    this.score += pts;
    if (!tooled) this.bumpStreak(good);
    g.hud.showBanner(
      pts > 0 ? `${label}  +${pts}` : label,
      good ? 'good' : tooled || (o && o.kind === 'in' && o.side === -1) ? 'neutral' : 'bad',
    );
    g.crowd(good ? (ev?.perfect ? C.perfect : C.good) : C.other, good);
    this.updateScore();
    g.tutorial.noteRepEnd(!!o && o.kind === 'in' && o.side === -1);
  }

  private nextRep(snap = false): void {
    const g = this.g;
    g.judge.disarm();
    const lane = this.lane;
    const me = g.me;
    g.ball.hide();
    if (this.setter) this.setter.place(SETTER_SPOT.x, SETTER_SPOT.z, Math.PI / 2);
    this.placeBlockers();
    this.pickZone();
    this.updateScore();
    // Skip puts them on the ground at the start. N jogs back, including after a landing.
    if (snap) g.placeUser(lane.sx, lane.sz, 0);
    else if (Math.hypot(me.pos.x - lane.sx, me.pos.z - lane.sz) > SPIKE_DRILL.slack || me.state !== 'ground')
      g.returnUser(lane.sx, lane.sz, 0);
    // N during the lesson's welcome must not toss the ball early
    if (g.tutorial.holdingFeed()) this.toPhase('intro');
    else this.toPhase('feed');
  }

  private toPhase(p: Phase): void {
    this.phase = p;
    this.t = 0;
    if (p === 'feed') {
      this.tossed = false;
      this.line.tGo = this.line.tPlant = -1;
      this.g.tutorial.noteFeed();
    }
  }
}

export { COURT };
