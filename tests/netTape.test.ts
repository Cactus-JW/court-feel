import { describe, expect, it } from 'vitest';
import { BALL, COURT, SIM } from '../src/config';
import { makeBall, R, stepBall, type BallState, type CollisionEvent } from '../src/physics/ball';

// The top of the net (BALL.tape; the antennae are in antenna.test.ts). The tape is a band hanging from a
// cable, and the net it belongs to moves: a ball that meets it is not bounced off a post. What it does
// depends on how it comes in: how high on the tape, how fast, at what angle and with what spin.

const DT = 1 / SIM.hz;
const top = COURT.netHeightMen;
const env = { netTop: top };

/** a ball from the home side (+z) that reaches the net's plane `off` m over the net's top, at `speed` m/s and `deg` (down is -) */
function toNet(off: number, speed: number, deg: number, topspinRps = 0): BallState {
  const a = (deg * Math.PI) / 180;
  const vz = -speed * Math.cos(a);
  const t = 0.3 / speed;
  const b = makeBall();
  b.p = { x: 0.5, y: top + off - speed * Math.sin(a) * t + 0.5 * 9.81 * t * t, z: -vz * t };
  b.v = { x: 0, y: speed * Math.sin(a) + 9.81 * t, z: vz };
  b.w = { x: -topspinRps * 2 * Math.PI, y: 0, z: 0 };
  return b;
}

/** fly it to the floor: did it touch the tape, how high it rose over the net after, where it came down */
function fly(b: BallState) {
  const events: CollisionEvent[] = [];
  let touched = false;
  let rise = -Infinity;
  for (let i = 0; i < 6 * SIM.hz; i++) {
    const from = events.length;
    stepBall(b, DT, env, events);
    const now = events.slice(from);
    if (now.some((e) => e.kind === 'tape' || e.kind === 'net')) touched = true;
    if (touched) rise = Math.max(rise, b.p.y - top);
    if (now.some((e) => e.kind === 'floor')) break;
  }
  return { touched, rise, land: b.p.z, events };
}

describe('the top of the net', () => {
  it('a flat serve that clips the tape goes over slowed and comes down in their court', () => {
    for (const off of [0.02, 0.04]) {
      const b = toNet(off, 22, 0);
      const r = fly(b);
      expect(r.touched).toBe(true);
      expect(r.land).toBeLessThan(0);
      expect(r.land).toBeGreaterThan(-COURT.halfLength);
      // it popped up a little, not a set's height (the rigid tape sent this one 7 m up)
      expect(r.rise).toBeLessThan(2);
    }
  });

  it('a serve that meets the top of the tape square dies there and drops within a couple of metres of the net', () => {
    for (const speed of [16, 22]) {
      const r = fly(toNet(0, speed, -5));
      expect(r.touched).toBe(true);
      expect(Math.abs(r.land)).toBeLessThan(2);
      expect(r.rise).toBeLessThan(0.5);
    }
  });

  it('a serve into the band under the cable stays on the server side', () => {
    const r = fly(toNet(-0.04, 22, 0));
    expect(r.touched).toBe(true);
    expect(r.land).toBeGreaterThan(0);
    expect(r.land).toBeLessThan(1.5);
  });

  it('a ball dropped onto the tape bounces a little and falls the way it was drifting', () => {
    for (const drift of [-0.3, 0.3]) {
      const b = makeBall();
      // it comes down a few centimetres to that side of the cable
      b.p = { x: 0.5, y: top + 1.06, z: 0.05 * Math.sign(drift) - drift * 0.44 };
      b.v = { x: 0, y: 0, z: drift };
      const r = fly(b);
      expect(r.touched).toBe(true);
      expect(r.rise).toBeLessThan(0.25);
      expect(Math.sign(r.land)).toBe(Math.sign(drift));
    }
  });

  it('topspin rolls a ball on over the tape; backspin checks it and it drops shorter', () => {
    const top8 = fly(toNet(0.03, 8, 0, 5));
    const back8 = fly(toNet(0.03, 8, 0, -3));
    expect(top8.land).toBeLessThan(back8.land);
  });

  it('how high on the tape a serve meets it decides what it does, not one bounce for all', () => {
    const lands = [-0.04, 0, 0.02, 0.04, 0.08].map((off) => fly(toNet(off, 22, 0)).land);
    // from staying on the server side, to dropping at the net, to well into their court
    expect(Math.max(...lands) - Math.min(...lands)).toBeGreaterThan(8);
    expect(lands[0]).toBeGreaterThan(0);
    expect(lands[4]).toBeLessThan(lands[2]);
  });

  it('a ball resting or rolling on the tape never gains speed: the band only ever holds it back', () => {
    // laid on top of the cable, rolling along it
    const laid = makeBall();
    laid.p = { x: 0.5, y: top + R, z: 0 };
    laid.v = { x: 0.5, y: 0, z: 0 };
    for (let i = 0; i < 1.5 * SIM.hz && laid.p.y > top; i++) {
      stepBall(laid, DT, env);
      expect(Math.abs(laid.v.x)).toBeLessThanOrEqual(0.5);
    }
    // dropped dead on it from a metre, drifting along it: it never comes back up to where it fell from
    const dropped = makeBall();
    dropped.p = { x: 0.5, y: top + 1, z: 0 };
    dropped.v = { x: 0.3, y: 0, z: 0 };
    const fall = Math.sqrt(2 * BALL.gravity * 1);
    for (let i = 0; i < 3 * SIM.hz; i++) {
      stepBall(dropped, DT, env);
      if (i > SIM.hz / 2) expect(dropped.p.y).toBeLessThan(top + 0.5);
      expect(Math.hypot(dropped.v.x, dropped.v.y, dropped.v.z)).toBeLessThan(fall + 0.5);
    }
  });

  it('a ball dropped on the tape is heard once as it lands, not as a buzz while it sits there', () => {
    for (const z of [0.005, 0.02, 0.05]) {
      const b = makeBall();
      b.p = { x: 0.5, y: top + 1, z };
      const r = fly(b);
      const tape = r.events.filter((e) => e.kind === 'tape');
      expect(tape.length).toBeGreaterThanOrEqual(1);
      expect(tape[0].impact).toBeGreaterThan(3);
      // the landing, and at most the little bounce it makes after
      expect(tape.length).toBeLessThanOrEqual(3);
    }
  });
});
