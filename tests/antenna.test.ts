import { describe, expect, it } from 'vitest';
import { COURT, SIM } from '../src/config';
import { antennaShape, makeBall, makeRodPoints, R, stepBall, type BallState, type CollisionEvent } from '../src/physics/ball';

// The antennae (BALL.antenna): 10 mm fibreglass rods strapped to the net's sides, 0.8 m free above
// it. The rod bends out of the ball's way and shakes, the net's side moves with it, and the ball is
// turned by where and how it met the rod.

const DT = 1 / SIM.hz;
const top = COURT.netHeightMen;
const env = { netTop: top };
const KMH = 1 / 3.6;

/** a ball flying along -z at the antenna at +x, `off` m inside its line, `above` m over the net's top */
function atRod(kmh: number, above: number, off: number, topspin = 0): BallState {
  const b = makeBall();
  b.p = { x: COURT.antennaX - off, y: top + above, z: 0.6 };
  b.v = { x: 0, y: 0, z: -kmh * KMH };
  b.w = { x: -topspin, y: 0, z: 0 };
  return b;
}

function run(b: BallState, secs: number): CollisionEvent[] {
  const events: CollisionEvent[] = [];
  for (let t = 0; t < secs; t += DT) stepBall(b, DT, env, events);
  return events;
}

/** how many of the touches across the rod's width and height a ball at `kmh` comes back from */
function sentBack(kmh: number): number {
  let touched = 0;
  let back = 0;
  for (const above of [0.12, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.78])
    for (let off = -0.1; off <= 0.1001; off += 0.01) {
      const b = atRod(kmh, above, off);
      if (!run(b, 0.25).some((e) => e.kind === 'antenna')) continue;
      touched++;
      if (b.v.z > 0) back++;
    }
  return back / touched;
}

const turned = (b: BallState) => Math.atan2(Math.abs(b.v.x), -b.v.z);

describe('the antennae', () => {
  it('a 100 km/h spike that catches the antenna goes on into their court, turned and slowed a little', () => {
    const b = atRod(100, 0.4, 0.06);
    const events = run(b, 0.3);
    expect(events.filter((e) => e.kind === 'antenna')).toHaveLength(1);
    expect(b.v.z).toBeLessThan(0);
    expect(b.p.z).toBeLessThan(-3);
    expect(Math.hypot(b.v.x, b.v.y, b.v.z)).toBeGreaterThan(100 * KMH * 0.6);
    expect(turned(b)).toBeGreaterThan(0.05);
    expect(turned(b)).toBeLessThan(0.35);
  });

  it('the harder the ball, the less often the antenna sends it back: it pushes the rod out of its way', () => {
    const slow = sentBack(30);
    const fast = sentBack(100);
    expect(fast).toBeLessThan(slow);
    expect(fast).toBeLessThan(0.2);
  });

  it('a ball is turned to the side of the rod its centre passes', () => {
    const inside = atRod(60, 0.3, 0.05);
    const outside = atRod(60, 0.3, -0.05);
    run(inside, 0.2);
    run(outside, 0.2);
    expect(inside.v.x).toBeLessThan(0);
    expect(outside.v.x).toBeGreaterThan(0);
  });

  it('low down, where the rod is held, it turns a ball more than near its tip, where it gives', () => {
    const low = atRod(100, 0.15, 0.05);
    const high = atRod(100, 0.7, 0.05);
    run(low, 0.2);
    run(high, 0.2);
    expect(turned(low)).toBeGreaterThan(turned(high));
  });

  it('a slow ball into the rod is pushed back by it springing back, slower than it came', () => {
    const b = atRod(10, 0.6, 0);
    b.p.z = 0.2;
    run(b, 0.4);
    expect(b.v.z).toBeGreaterThan(0);
    expect(Math.hypot(b.v.x, b.v.z)).toBeLessThan(10 * KMH);
  });

  it('the rod is driven away from the ball, its tip further than where it was hit, and it shakes for a second', () => {
    const b = atRod(60, 0.3, 0.03);
    const rod = makeRodPoints();
    let tip = 0;
    let atHit = 0;
    for (let t = 0; t < 0.15; t += DT) {
      stepBall(b, DT, env);
      antennaShape(b, 1, top, rod);
      tip = Math.min(tip, rod.z[rod.z.length - 1]);
      atHit = Math.min(atHit, rod.z[Math.round((rod.z.length - 1) * (0.3 / COURT.antennaAboveNet))]);
    }
    expect(tip).toBeLessThan(atHit);
    expect(atHit).toBeLessThan(-0.01);
    // fibreglass hardly damps: still shaking a second on, straight within a couple of millimetres by
    // three, and at rest in the end
    run(b, 1);
    antennaShape(b, 1, top, rod);
    expect(Math.abs(rod.z[rod.z.length - 1])).toBeGreaterThan(0.002);
    run(b, 2);
    antennaShape(b, 1, top, rod);
    expect(Math.abs(rod.z[rod.z.length - 1])).toBeLessThan(0.002);
    run(b, 10);
    expect(b.ant.every((v) => v === 0)).toBe(true);
  });

  it('the rod does not stretch: bent far, its tip comes down', () => {
    const b = atRod(100, 0.5, 0);
    const rod = makeRodPoints();
    let lowest = Infinity;
    for (let t = 0; t < 0.1; t += DT) {
      stepBall(b, DT, env);
      antennaShape(b, 1, top, rod);
      const n = rod.y.length - 1;
      let len = 0;
      for (let i = 1; i <= n; i++) len += Math.hypot(rod.x[i] - rod.x[i - 1], rod.y[i] - rod.y[i - 1], rod.z[i] - rod.z[i - 1]);
      expect(len).toBeCloseTo(COURT.antennaAboveNet, 6);
      lowest = Math.min(lowest, rod.y[n]);
    }
    expect(lowest).toBeLessThan(top + COURT.antennaAboveNet - 0.02);
  });

  it('a hit on the antenna moves the net it is strapped to, away from the ball, more for a harder ball', () => {
    const side = (kmh: number) => {
      const b = atRod(kmh, 0.15, 0.03);
      let most = 0;
      const rod = makeRodPoints();
      for (let t = 0; t < 0.3; t += DT) {
        stepBall(b, DT, env);
        antennaShape(b, 1, top, rod);
        most = Math.min(most, rod.z[0]);
      }
      return most;
    };
    expect(side(30)).toBeLessThan(0);
    expect(side(100)).toBeLessThan(side(30));
  });

  it('every antenna call is a real touch: a ball passing a few millimetres clear of the rod is not touched', () => {
    for (const above of [-0.3, 0.2, 0.7]) {
      const b = makeBall();
      b.p = { x: COURT.antennaX - R - COURT.antennaRadius - 0.003, y: top + above, z: 2 };
      b.v = { x: 0, y: 0, z: -18 };
      expect(run(b, 0.25).some((e) => e.kind === 'antenna')).toBe(false);
    }
  });

  it('a ball that only brushes the rod is still called, once', () => {
    const b = atRod(80, 0.5, R + COURT.antennaRadius - 0.004);
    expect(run(b, 0.25).filter((e) => e.kind === 'antenna')).toHaveLength(1);
  });
});
