import * as THREE from 'three';
import { COURT, SERVE, SIM, type ServeKind } from '../src/config';
import type { ContactEvent } from '../src/game/contact';
import { ServerBrain } from '../src/ai/server';
import { scene } from './scene';

export interface ServeRunOptions {
  /** which serve (the toss, the start, the run-up) */
  kind?: ServeKind;
  /** the server's timing error, in standard deviations of the brain's error for that serve */
  sd?: number;
  /** where it is aimed (the floor of the far court) */
  aim?: THREE.Vector3;
  /** meet a standing serve's toss off a jump on the spot, or hit a jump serve's spin with the feet on the floor */
  jump?: boolean;
  /** the toss, when it is not the serve's own */
  toss?: { toss: number; tossHigh: number };
  /**
   * The player serves: they can fault (the AI never misses a serve), and they toss the serve's own
   * toss from a standing start `back` m behind the end line (the Serve drill stands them at `SERVE[kind].back`).
   */
  user?: { back: number };
  role?: 'OH' | 'OPP' | 'MB' | 'S' | 'L';
  /** the rolls of the simulation's dice (0.5 every time unless given: no spread on the aim, the same float every serve) */
  rand?: () => number;
  /** a float's draw, in place of the one the contact made: which way it breaks, and when */
  seed?: number;
  /** how much the served ball floats, in place of what the contact gave it (0: the flight it was aimed with) */
  knuckle?: number;
}

/**
 * A serve from the home end line in a real simulation: the server brain's toss, run-up and swing,
 * then the served ball's flight to the floor.
 */
export function serveRun(o: ServeRunOptions = {}) {
  const { kind = 'jump', sd = 0, aim = new THREE.Vector3(-3.5, 0, -7.5), user, role = 'OH', jump, toss, rand } = o;
  let touched = false;
  const s = scene({
    // fixed dice: the server's timing is off by exactly `sd` and a mistimed aim has no spread, so a serve is its toss, its run-up and its swing alone
    dice: { roll: rand ?? 0.5, noise: sd },
    hooks: {
      aimTargetFor: (who, out) => out.copy(who.aiAim),
      // a float's draw and how much it floats, when the test gives them, are the ball's from the hand: before it flies a step
      contact: () => {
        if (touched) return;
        touched = true;
        if (o.seed !== undefined) s.sim.ball.state.seed = o.seed;
        if (o.knuckle !== undefined) s.sim.ball.state.knuckle = o.knuckle;
      },
    },
  });
  const { sim, touches } = s;
  const ball = sim.ball;
  const a = s.athlete(role, 1, { x: 0, z: 0, yaw: 0 }, { user: !!user });
  const brain = new ServerBrain(a);
  brain.serve(aim, -2.5, kind);
  if (user) {
    brain.back = user.back;
    brain.walkIn = 0;
    brain.toss = SERVE[kind];
  }
  if (jump !== undefined) brain.jump = jump;
  if (toss) brain.toss = toss;
  a.place(brain.spot.x, brain.spot.z, 0);
  sim.setBrain(a, brain);
  const r = {
    tossT: NaN,
    hitT: NaN,
    tossApex: 0,
    takeoffZ: NaN,
    landZ: NaN,
    jumpH: 0,
    contactY: NaN,
    contactZ: NaN,
    apex: 0,
    /** the served ball as it left the hand: its spin (rad/s) and its knuckle (0: none) */
    spin: NaN,
    knuckle: NaN,
    overTape: NaN,
    /** the run-up: when it starts and when the plant starts, s after the toss (NaN: a standing serve) */
    runAt: NaN,
    plantAt: NaN,
    /** the server's speed at the plant, as a share of their approach speed */
    run: NaN,
    /** time from the hit to the ball being down at passing height on the far side (s) */
    flight: NaN,
    e: null as ContactEvent | null,
    ball: { x: NaN, z: NaN },
    /** the ball came down on the far side, inside the lines */
    in: false,
  };
  for (let i = 0; i < SIM.hz * 8; i++) {
    const z0 = ball.pos.z;
    s.step();
    const now = sim.simTime;
    if (Number.isNaN(r.tossT) && ball.lastTouch?.kind === 'feed') r.tossT = now;
    // the run-up as the server's body shows it (the brain's plan is its own): the step they break into the run, and the step they plant
    if (Number.isNaN(r.runAt) && !Number.isNaN(r.tossT) && a.cmd.sprint) r.runAt = now - r.tossT;
    if (Number.isNaN(r.plantAt) && !Number.isNaN(r.tossT) && a.state === 'load') r.plantAt = now - r.tossT;
    if (a.state === 'load' && Number.isNaN(r.run)) r.run = a.loadApproach / a.stats.approachSpeed;
    if (!r.e && touches.length) {
      r.e = touches[0].ev;
      r.hitT = now;
      r.contactY = ball.pos.y;
      r.contactZ = ball.pos.z;
      r.jumpH = a.state === 'air' ? a.jumpH : 0;
      const w = ball.state.w;
      r.spin = Math.hypot(w.x, w.y, w.z);
      r.knuckle = ball.state.knuckle;
    }
    if (!r.e && ball.lastTouch?.kind === 'feed') r.tossApex = Math.max(r.tossApex, ball.pos.y);
    if (a.state === 'air' && Number.isNaN(r.takeoffZ)) r.takeoffZ = a.pos.z;
    if (Number.isNaN(r.landZ) && !Number.isNaN(r.takeoffZ) && a.state === 'land') r.landZ = a.pos.z;
    if (r.e) {
      r.apex = Math.max(r.apex, ball.pos.y);
      if (z0 > 0 && ball.pos.z <= 0) r.overTape = ball.pos.y - COURT.netHeightMen;
      if (Number.isNaN(r.flight) && ball.pos.z < 0 && ball.pos.y < 0.75) r.flight = now - r.hitT;
      if (ball.pos.y < 0.3) {
        r.ball = { x: ball.pos.x, z: ball.pos.z };
        r.in = ball.pos.z < 0 && ball.pos.z > -COURT.halfLength && Math.abs(ball.pos.x) < COURT.halfWidth;
        break;
      }
    }
  }
  return r;
}
