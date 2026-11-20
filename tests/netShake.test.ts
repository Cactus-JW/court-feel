import { describe, expect, it } from 'vitest';
import { ARENA, COURT } from '../src/config';
import { NetShake } from '../src/world/netShake';

const NET = COURT.netHeightMen;
const FRAME = 1 / 60;

describe("the net's top shakes when the ball hits it (looks only)", () => {
  it('a ball into the tape pushes the top away from it, most where it hit, not at the posts, and it settles', () => {
    const s = new NetShake();
    s.hit({ kind: 'tape', x: 1, y: NET, z: 0.1, impact: 10 });
    let atHit = 0;
    let away = 0;
    for (let t = 0; t < 0.1; t += FRAME) {
      s.step(FRAME);
      if (Math.abs(s.top(1)) > Math.abs(atHit)) atHit = s.top(1);
      away = Math.max(away, Math.abs(s.top(4)));
    }
    expect(atHit).toBeLessThan(0);
    expect(away).toBeLessThan(Math.abs(atHit));
    expect(Math.abs(s.top(COURT.postX))).toBe(0);
    for (let t = 0; t < ARENA.netTop.life; t += FRAME) s.step(FRAME);
    expect(s.top(1)).toBe(0);
    expect(s.moving).toBe(false);
  });

  it('a ball into the mesh moves the top less than one into the tape; the floor does not move it', () => {
    const peak = (kind: string): number => {
      const s = new NetShake();
      s.hit({ kind, x: 0, y: NET - 0.5, z: 0.1, impact: 8 });
      let m = 0;
      for (let t = 0; t < 0.2; t += FRAME) {
        s.step(FRAME);
        m = Math.max(m, Math.abs(s.top(0)));
      }
      return m;
    };
    expect(peak('net')).toBeLessThan(peak('tape'));
    expect(peak('net')).toBeGreaterThan(0);
    expect(peak('floor')).toBe(0);
  });

  it("where an antenna's side is pushed, the top goes with it, straight back to each post", () => {
    const s = new NetShake();
    s.sides[1] = -0.05;
    expect(s.top(COURT.antennaX)).toBeCloseTo(-0.05, 9);
    expect(Math.abs(s.top(COURT.postX))).toBe(0);
    expect(Math.abs(s.top(-COURT.postX))).toBe(0);
    // halfway to the far post, half as far
    expect(s.top((COURT.antennaX - COURT.postX) / 2)).toBeCloseTo(-0.025, 9);
    expect(s.moving).toBe(true);
  });
});
