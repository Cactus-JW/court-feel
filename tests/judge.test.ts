import { describe, expect, it } from 'vitest';
import { COURT } from '../src/config';
import { Judge, outcomeLabel, type Outcome } from '../src/game/judge';
import { R, type CollisionEvent } from '../src/physics/ball';

// The line judge on a ball that goes outside the antennae (FIVB 8.4, 10.1). A ball that crosses the
// net's plane outside the crossing space is not dead there: the team that sent it may chase it into
// the other team's free zone and play it back outside the antenna on the same side (10.1.2). It is
// called when it can no longer be saved: where it lands, when the other team plays it, or when it comes
// back between the antennae. An antenna is only ever called when the ball touched one.

type Side = 1 | -1;
const TOP = COURT.netHeightMen;

/** a ball the judge watches, moved by hand */
function watch(x: number, y: number, z: number, side: Side) {
  const j = new Judge();
  const ball = { pos: { x, y, z }, active: true, lastTouch: { side, t: 0, kind: 'pass' } } as any;
  j.arm(ball);
  let t = 0;
  return {
    j,
    ball,
    /** move the ball there; the judge's call, if it made one */
    to(nx: number, ny: number, nz: number, events: CollisionEvent[] = []): Outcome | null {
      ball.pos = { x: nx, y: ny, z: nz };
      t += 1 / 120;
      return j.step(ball, events, TOP);
    },
    /** a player of `by` plays it where it is (the game arms the judge on every clean touch) */
    touch(by: Side): void {
      ball.lastTouch = { side: by, t: t, kind: 'dig' };
      j.arm(ball);
    },
    land(): Outcome | null {
      const p = ball.pos;
      return this.to(p.x, R, p.z, [{ kind: 'floor', x: p.x, y: R, z: p.z, impact: 6 }]);
    },
  };
}

describe('the line judge, outside the antennae', () => {
  it('a pass shanked metres wide of the antenna is called out where it lands, not antenna', () => {
    const b = watch(6.5, 2.0, 0.4, 1);
    // it crosses the net's line 2.5 m outside the antenna, still in the air
    expect(b.to(7.0, 1.9, -0.4)).toBeNull();
    expect(b.to(8.0, 1.0, -2.0)).toBeNull();
    const o = b.land()!;
    expect(o.kind).toBe('out');
    expect(o.winner).toBe(-1);
    expect(outcomeLabel(o, 1)).toBe('OUT');
  });

  it('a ball sent over the antenna that comes down in the other court is out: it crossed outside the antenna', () => {
    const b = watch(4.6, 3.6, 0.3, 1);
    expect(b.to(4.6, 3.6, -0.3)).toBeNull();
    b.to(3.8, 1.2, -4.0);
    const o = b.land()!;
    expect(o.kind).toBe('outside-antenna');
    expect(o.winner).toBe(-1);
  });

  it('the team that sent it can chase it into the free zone and play it back outside the same antenna', () => {
    const b = watch(5.5, 2.0, 0.5, 1);
    expect(b.to(5.8, 2.0, -0.5)).toBeNull();
    expect(b.to(6.5, 1.0, -3.0)).toBeNull();
    // their libero runs round the post and digs it back, outside the antenna on the same side
    b.touch(1);
    expect(b.to(6.2, 2.0, -0.5)).toBeNull();
    expect(b.to(6.0, 2.2, 0.5)).toBeNull();
    // back on their side it is an ordinary ball: it comes down in their own court
    b.to(3.0, 1.0, 4.0);
    const o = b.land()!;
    expect(o.kind).toBe('in');
    expect(o.side).toBe(1);
  });

  it('played back between the antennae it is out', () => {
    const b = watch(5.5, 2.0, 0.5, 1);
    b.to(5.8, 2.0, -0.5);
    b.to(6.5, 1.0, -3.0);
    b.touch(1);
    const o = b.to(3.0, 2.5, 0.4) ?? b.to(3.0, 2.5, 0.6);
    expect(o).not.toBeNull();
    expect(o!.kind).toBe('outside-antenna');
    expect(o!.winner).toBe(-1);
  });

  it('the other team playing a ball that crossed outside the antenna does not save it', () => {
    const b = watch(4.8, 3.0, 0.4, 1);
    b.to(4.8, 3.0, -0.4);
    b.to(4.2, 2.0, -2.5);
    b.touch(-1);
    const o = b.to(4.1, 2.1, -2.6)!;
    expect(o.kind).toBe('outside-antenna');
    expect(o.winner).toBe(-1);
  });

  it('a ball crossing between the antennae is not out, however close to one', () => {
    const b = watch(COURT.antennaX - R, 3.5, 0.3, 1);
    expect(b.to(COURT.antennaX - R, 3.5, -0.3)).toBeNull();
    b.to(3.5, 1.0, -5.0);
    expect(b.land()!.kind).toBe('in');
  });

  it('a low ball that crosses beyond the end of the net is not "under the net"', () => {
    const b = watch(6.8, 0.9, 0.4, 1);
    expect(b.to(6.9, 0.8, -0.4)).toBeNull();
    const o = b.land()!;
    expect(o.kind).toBe('out');
  });

  it('a ball that touches an antenna is called antenna at once', () => {
    const b = watch(COURT.antennaX - 0.1, TOP + 0.4, 0.2, -1);
    const o = b.to(COURT.antennaX - 0.1, TOP + 0.4, 0.05, [
      { kind: 'antenna', x: COURT.antennaX - 0.1, y: TOP + 0.4, z: 0.05, impact: 4 },
    ])!;
    expect(o.kind).toBe('antenna');
    expect(o.winner).toBe(1);
    expect(outcomeLabel(o, 1)).toBe('ANTENNA');
  });
});
