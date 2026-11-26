import { CONTACT, FREE_PLAY } from '../../config';
import { solveApex, solveSpeedToFloor } from '../../physics/solve';
import type { ContactEvent } from '../contact';
import type { Outcome } from '../judge';
import { attackHeight, laneFor, SETTER_SPOT } from '../plays';
import { kbd } from '../../core/kbd';
import type { MachineMark } from './markers';
import { Mode } from './mode';

type Feed = 'set' | 'free' | 'serve' | 'attack';
const FEEDS: Feed[] = ['set', 'free', 'serve', 'attack'];
const FEED_LABEL: Record<Feed, string> = {
  set: 'Set to you',
  free: 'Free ball',
  serve: 'Float serve',
  attack: 'Hard attack',
};

/** a ball machine: base, drum and barrel that aims where it shoots */
/**
 * Free play: a machine feeds the ball type you choose (1-4); everything else
 * is up to you: spike, pass, block, set, or toss one up yourself (Q). Serving has its own
 * drill (serveDrill.ts).
 */
export class FreePlay extends Mode {
  readonly id = 'free' as const;
  private feed: Feed = 'set';
  private auto = true;
  private wait: number = FREE_PLAY.timing.first;
  private machine!: MachineMark;
  /** where the machine stands */
  private machineAt = { x: 0, z: 0 };
  private lastWasMachine = false;
  private requested = false;

  setup(): void {
    const g = this.g;
    const lane = laneFor(this.position, 1);
    g.placeUser(lane.sx, lane.sz, 0);
    this.machine = g.markers.machine();
    this.placeMachine();
    g.hud.setTitle('Free Play');
    this.updateScore();
    g.hud.message('1-4 choose the feed · F feed now · T auto-feed · Q serve yourself', FREE_PLAY.say.intro, true);
  }

  private placeMachine(): void {
    const at = this.machineAt;
    const M = FREE_PLAY.machine;
    switch (this.feed) {
      case 'set':
        at.x = SETTER_SPOT.x;
        at.z = SETTER_SPOT.z + M.set.behind;
        break;
      case 'free':
        at.x = M.free.x;
        at.z = M.free.z;
        break;
      case 'serve':
        at.x = M.serve.x;
        at.z = M.serve.z;
        break;
      case 'attack':
        at.x = M.attack.x;
        at.z = M.attack.z;
        break;
    }
    this.machine.place(at.x, at.z, this.feed === 'attack' ? M.tall : 1);
  }

  private updateScore(): void {
    this.g.hud.setScore(`Feed: ${FEED_LABEL[this.feed]} · auto ${this.auto ? 'on' : 'off'} · ${this.score} pts`);
  }

  hint(): string {
    return `${kbd('1')}-${kbd('4')} feed type · ${kbd('F')} feed · ${kbd('T')} auto · ${kbd('Q')} serve toss · hold/release ${kbd('LMB')} hit · ${kbd('E')} pass · ${kbd('RMB')} block/set`;
  }

  canServe(): boolean {
    const b = this.g.ball;
    return !b.active || b.state.rest || this.lastWasMachine;
  }

  frame(_dt: number): void {
    for (let i = 0; i < FEEDS.length; i++) {
      if (this.g.keyPressed('Digit' + (i + 1))) {
        this.feed = FEEDS[i];
        this.placeMachine();
        this.updateScore();
        this.wait = FREE_PLAY.timing.picked;
        this.requested = !this.auto;
      }
    }
    if (this.g.keyPressed('KeyF')) this.requested = true;
    if (this.g.keyPressed('KeyT')) {
      this.auto = !this.auto;
      this.updateScore();
    }
  }

  restartRep(): void {
    this.g.ball.hide();
    this.wait = FREE_PLAY.timing.restart;
  }

  step(dt: number): void {
    const g = this.g;
    const b = g.ball;
    const idle = !b.active || b.state.rest;
    // the lamp shows when the machine is about to fire
    const L = FREE_PLAY.machine.lamp;
    const lamp = idle && this.wait < L.before ? L.soon : L.idle;
    this.machine.lamp(lamp[0], lamp[1], lamp[2]);
    if (!idle) return;
    const act = g.me.action?.kind;
    if (act === 'toss' || (act === 'windup' && g.contact.serving === g.me)) return; // the user is serving
    this.wait -= dt;
    if ((this.auto && this.wait <= 0) || this.requested) {
      this.fire();
      this.requested = false;
      this.wait = FREE_PLAY.timing.between;
    }
  }

  private fire(): void {
    const g = this.g;
    const me = g.me;
    const m = this.machineAt;
    const F = FREE_PLAY.feed;
    const from: { x: number; y: number; z: number } = {
      x: m.x,
      y: this.feed === 'attack' ? F.attack.fromY : F.free.fromY,
      z: m.z - (this.feed === 'set' ? 0 : -FREE_PLAY.machine.mouth),
    };
    const v = { x: 0, y: 0, z: 0 };
    let w = { x: 0, y: 0, z: 0 };
    let knuckle = 0;
    switch (this.feed) {
      case 'set': {
        const lane = laneFor(this.position, 1);
        const y = attackHeight(me);
        from.y = F.set.fromY;
        solveApex(from, { x: lane.x, y, z: lane.z }, y + lane.apexAbove, w, v);
        break;
      }
      case 'free': {
        const tgt = { x: me.pos.x + g.rng.gauss() * F.free.spreadX, y: F.free.toY, z: me.pos.z + g.rng.gauss() * F.free.spreadZ };
        solveApex(from, tgt, F.free.apex + g.rng.next(), w, v);
        break;
      }
      case 'serve': {
        const land = { x: 0, y: 0, z: 0 };
        const tx = me.pos.x + g.rng.gauss() * F.serve.spreadX;
        const tz = me.pos.z + g.rng.gauss() * F.serve.spreadZ;
        from.y = F.serve.fromY;
        solveSpeedToFloor(
          from,
          tx,
          tz,
          F.serve.speed + g.rng.next() * F.serve.speedRange,
          0,
          v,
          w,
          land,
          F.serve.angleMin,
          F.serve.angleMax,
        );
        w = { x: 0, y: 0, z: 0 };
        knuckle = CONTACT.floatClean[2];
        break;
      }
      case 'attack': {
        const land = { x: 0, y: 0, z: 0 };
        const tx = me.pos.x + g.rng.gauss() * F.attack.spreadX;
        const tz = me.pos.z + g.rng.gauss() * F.attack.spreadZ;
        solveSpeedToFloor(from, tx, tz, F.attack.speed + g.rng.next() * F.attack.speedRange, F.attack.spin, v, w, land);
        break;
      }
    }
    // aim the barrel
    const yaw = Math.atan2(-v.x, -v.z);
    this.machine.aim(Math.atan2(v.y, Math.hypot(v.x, v.z)), yaw);
    // (the 1000 spreads the dice into a seed for the ball's float: not a number to tune)
    g.ball.launch(from, v, w, knuckle, g.simTime, g.rng.next() * 1000);
    g.ball.lastTouch = { athlete: null, kind: this.feed === 'set' ? 'set' : 'feed', t: g.simTime, side: this.feed === 'set' ? 1 : -1 };
    // a machine ball is always a new ball: nothing the last one did (N on a ball out wide) carries over
    g.judge.disarm();
    g.judge.arm(g.ball);
    this.lastWasMachine = true;
  }

  onContact(ev: ContactEvent): void {
    if (ev.athlete !== this.g.me) return;
    this.lastWasMachine = false;
    const P = FREE_PLAY.points;
    const pts = ev.grade === 'Perfect' ? P.perfect : ev.grade === 'Good' ? P.good : ev.grade === 'Miss' ? 0 : P.other;
    this.score += pts;
    this.bumpStreak(ev.grade === 'Perfect' || ev.grade === 'Good');
    this.updateScore();
  }

  onOutcome(o: Outcome): void {
    const lt = this.g.ball.lastTouch;
    if (lt?.athlete === this.g.me && o.kind === 'in' && o.side === -1) {
      this.g.hud.showBanner('IN!', 'good');
      this.g.crowd(FREE_PLAY.crowd.in);
    } else if (lt?.athlete === this.g.me && o.kind !== 'in') this.g.hud.showBanner('OUT', 'bad');
    this.wait = Math.min(this.wait, FREE_PLAY.timing.afterOutcome);
  }
}
