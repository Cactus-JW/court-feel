import { describe, expect, it } from 'vitest';
import { ARENA, COURT } from '../src/config';
import { NetShake } from '../src/world/netShake';

const NET = COURT.netHeightMen;
const FRAME = 1 / 60;

/** the largest the tip of the antenna at +x bends over `secs`, and whether it is still moving after */
function whip(y: number, impact: number, secs = 1): { most: number; first: { x: number; z: number }; moving: boolean } {
  const s = new NetShake();
  // the ball comes from the +z side and touches the rod's side nearest it
  s.hit({ kind: 'antenna', x: COURT.antennaX, y, z: 0.12, impact }, NET);
  s.step(FRAME);
  const first = { x: s.tips[1].x, z: s.tips[1].z };
  let most = 0;
  for (let t = 0; t < secs; t += FRAME) {
    s.step(FRAME);
    most = Math.max(most, Math.hypot(s.tips[1].x, s.tips[1].z));
  }
  return { most, first, moving: s.moving };
}

describe('the antennae and the net shake when the ball hits them (looks only)', () => {
  it('an antenna hit sends its tip away from the ball, and only that antenna', () => {
    const s = new NetShake();
    s.hit({ kind: 'antenna', x: COURT.antennaX, y: NET + 0.4, z: 0.12, impact: 8 }, NET);
    s.step(FRAME);
    expect(s.tips[1].z).toBeLessThan(0);
    expect(s.tips[0]).toEqual({ x: 0, z: 0, vx: 0, vz: 0 });
  });

  it('a harder ball bends it further, and it is straight again within two seconds', () => {
    const soft = whip(NET + 0.4, 3);
    const hard = whip(NET + 0.4, 10);
    expect(hard.most).toBeGreaterThan(soft.most);
    expect(hard.most).toBeLessThanOrEqual(ARENA.antenna.max + 1e-9);
    expect(whip(NET + 0.4, 10, 2).moving).toBe(false);
  });

  it('a ball at the tip bends it more than one low down near the tape, where the rod is held', () => {
    expect(whip(NET + 0.75, 5).most).toBeGreaterThan(whip(NET + 0.1, 5).most);
    expect(whip(NET + 0.1, 5).most).toBeGreaterThan(0);
  });

  it('a ball into the tape pushes the top away from it, most where it hit, not at the posts, and it settles', () => {
    const s = new NetShake();
    s.hit({ kind: 'tape', x: 1, y: NET, z: 0.1, impact: 10 }, NET);
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
      s.hit({ kind, x: 0, y: NET - 0.5, z: 0.1, impact: 8 }, NET);
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
});
