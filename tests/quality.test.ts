import { describe, expect, it } from 'vitest';
import { QUALITY } from '../src/config';
import { QualityGovernor } from '../src/app/quality';

// The picture gets cheaper when the machine cannot keep up, so the play never does: a slow frame
// costs timing, a soft edge does not.

/** run `seconds` of frames at `fps` and return every level the governor asked for */
function run(g: QualityGovernor, fps: number, seconds: number): number[] {
  const asked: number[] = [];
  for (let i = 0; i < Math.round(fps * seconds); i++) {
    const next = g.frame(1 / fps);
    if (next !== null) {
      asked.push(next);
      g.set(next);
    }
  }
  return asked;
}

describe('the quality governor', () => {
  it('leaves a machine that holds 60 fps at full quality', () => {
    const g = new QualityGovernor();
    expect(run(g, 60, 60)).toEqual([]);
    expect(g.level).toBe(0);
  });

  it('steps down one level after two slow windows in a row', () => {
    const g = new QualityGovernor();
    // the first windows fall in the start-up cooldown (loading costs frames): they do not count
    const asked = run(g, 30, QUALITY.startCooldown + QUALITY.window * (QUALITY.slowWindows + 1));
    expect(asked).toEqual([1]);
  });

  it('starts the count again when a fast window comes between two slow ones', () => {
    const g = new QualityGovernor();
    // whole windows, so each window below is all slow or all fast (a window is judged by its average)
    run(g, 60, QUALITY.window * Math.ceil(QUALITY.startCooldown / QUALITY.window));
    for (let i = 0; i < 4; i++) {
      expect(run(g, 30, QUALITY.window)).toEqual([]);
      expect(run(g, 60, QUALITY.window)).toEqual([]);
    }
    expect(g.level).toBe(0);
  });

  it('leaves a level alone right after a change: the change itself costs frames', () => {
    const g = new QualityGovernor();
    run(g, 60, QUALITY.startCooldown + QUALITY.window);
    g.set(1);
    // slow for less than the cooldown and the windows it then needs: no second step
    expect(run(g, 30, QUALITY.changeCooldown)).toEqual([]);
    expect(g.level).toBe(1);
  });

  it('keeps stepping down on a machine that stays slow, and stops at the lowest level', () => {
    const g = new QualityGovernor();
    expect(run(g, 20, 120)).toEqual([1, 2]);
    expect(g.level).toBe(QUALITY.lowest);
    expect(run(g, 20, 60)).toEqual([]);
  });

  it('never holds a level outside the ones there are', () => {
    const g = new QualityGovernor();
    g.set(9);
    expect(g.level).toBe(QUALITY.lowest);
    g.set(-3);
    expect(g.level).toBe(0);
  });
});
