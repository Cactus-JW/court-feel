import { describe, expect, it } from 'vitest';
import { SIM } from '../src/config';
import { freeBallToATeam } from './simScenes';

// The simulation runs on its own (docs/adr/0010): these tests build a real one, with real brains,
// a real ball and the real contact system, in Node. There is no page, no canvas and no renderer.

const DT = 1 / SIM.hz;

function play(seed: number, seconds: number) {
  const r = freeBallToATeam(seed);
  const path: number[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    r.sim.step(DT);
    const p = r.sim.ball.state.p;
    path.push(p.x, p.y, p.z);
    for (const a of r.sim.athletes) path.push(a.pos.x, a.pos.y, a.pos.z);
  }
  return { ...r, path };
}

describe('the simulation runs on its own', () => {
  it('is built and stepped with no page and no renderer: the clock moves one fixed step at a time', () => {
    const { sim } = freeBallToATeam(1);
    for (let i = 0; i < 120; i++) sim.step(DT);
    expect(sim.simTime).toBeCloseTo(1, 9);
    expect(sim.ball.active).toBe(true);
  });

  it('brains running in it play a free ball: someone gets under it and the team touches it before it lands', () => {
    const { log, sim } = play(1, 6);
    const touches = log.filter((l) => !l.includes(' ball '));
    expect(touches.length, log.join('\n')).toBeGreaterThan(0);
    const firstTouch = Number(touches[0].split(' ')[0]);
    const firstBounce = log.find((l) => l.includes('ball floor'));
    if (firstBounce) expect(firstTouch).toBeLessThan(Number(firstBounce.split(' ')[0]));
    expect(sim.simTime).toBeCloseTo(6, 6);
  });

  it('the same start gives the same play, step for step: every position of the ball and of every athlete', () => {
    const a = play(7, 6);
    const b = play(7, 6);
    expect(a.log).toEqual(b.log);
    expect(a.path).toEqual(b.path);
  });

  it('a different random seed gives a different play: the brains draw their reads from the simulation’s own stream', () => {
    const a = play(7, 6);
    const b = play(8, 6);
    expect(a.path).not.toEqual(b.path);
  });
});
