import { CONTACT } from '../../config';
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
  private wait = 1.5;
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
    g.hud.message('1-4 choose the feed · F feed now · T auto-feed · Q serve yourself', 3.5);
  }

  private placeMachine(): void {
    const at = this.machineAt;
    switch (this.feed) {
      case 'set':
        at.x = SETTER_SPOT.x;
        at.z = SETTER_SPOT.z + 0.2;
        break;
      case 'free':
        at.x = 0;
        at.z = -6.5;
        break;
      case 'serve':
        at.x = 1.5;
        at.z = -10.2;
        break;
      case 'attack':
        at.x = -0.5;
        at.z = -2.2;
        break;
    }
    this.machine.place(at.x, at.z, this.feed === 'attack' ? 1.6 : 1);
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
        this.wait = 0.8;
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
    this.wait = 0.4;
  }

  step(dt: number): void {
    const g = this.g;
    const b = g.ball;
    const idle = !b.active || b.state.rest;
    // the lamp shows when the machine is about to fire
    this.machine.lamp(idle && this.wait < 0.6 ? 2.5 : 0.3, idle && this.wait < 0.6 ? 2.2 : 1.6, 0.4);
    if (!idle) return;
    const act = g.me.action?.kind;
    if (act === 'toss' || (act === 'windup' && g.contact.serving === g.me)) return; // the user is serving
    this.wait -= dt;
    if ((this.auto && this.wait <= 0) || this.requested) {
      this.fire();
      this.requested = false;
      this.wait = 2.2;
    }
  }

  private fire(): void {
    const g = this.g;
    const me = g.me;
    const m = this.machineAt;
    const from = { x: m.x, y: this.feed === 'attack' ? 2.85 : 1.2, z: m.z - (this.feed === 'set' ? 0 : -0.3) };
    const v = { x: 0, y: 0, z: 0 };
    let w = { x: 0, y: 0, z: 0 };
    let knuckle = 0;
    switch (this.feed) {
      case 'set': {
        const lane = laneFor(this.position, 1);
        const y = attackHeight(me);
        from.y = 2.3;
        solveApex(from, { x: lane.x, y, z: lane.z }, y + lane.apexAbove, w, v);
        break;
      }
      case 'free': {
        const tgt = { x: me.pos.x + g.rng.gauss() * 1.2, y: 1.0, z: me.pos.z + g.rng.gauss() * 1.0 };
        solveApex(from, tgt, 5.5 + g.rng.next(), w, v);
        break;
      }
      case 'serve': {
        const land = { x: 0, y: 0, z: 0 };
        const tx = me.pos.x + g.rng.gauss() * 1.0;
        const tz = me.pos.z + g.rng.gauss() * 1.0;
        from.y = 2.9;
        solveSpeedToFloor(from, tx, tz, 16 + g.rng.next() * 2, 0, v, w, land, -0.4, 0.6);
        w = { x: 0, y: 0, z: 0 };
        knuckle = CONTACT.floatClean[2];
        break;
      }
      case 'attack': {
        const land = { x: 0, y: 0, z: 0 };
        const tx = me.pos.x + g.rng.gauss() * 0.9;
        const tz = me.pos.z + g.rng.gauss() * 0.8;
        solveSpeedToFloor(from, tx, tz, 19 + g.rng.next() * 5, 45, v, w, land);
        break;
      }
    }
    // aim the barrel
    const yaw = Math.atan2(-v.x, -v.z);
    this.machine.aim(Math.atan2(v.y, Math.hypot(v.x, v.z)), yaw);
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
    const pts = ev.grade === 'Perfect' ? 30 : ev.grade === 'Good' ? 15 : ev.grade === 'Miss' ? 0 : 5;
    this.score += pts;
    this.bumpStreak(ev.grade === 'Perfect' || ev.grade === 'Good');
    this.updateScore();
  }

  onOutcome(o: Outcome): void {
    const lt = this.g.ball.lastTouch;
    if (lt?.athlete === this.g.me && o.kind === 'in' && o.side === -1) {
      this.g.hud.showBanner('IN!', 'good');
      this.g.crowd(0.4);
    } else if (lt?.athlete === this.g.me && o.kind !== 'in') this.g.hud.showBanner('OUT', 'bad');
    this.wait = Math.min(this.wait, 1.8);
  }
}
