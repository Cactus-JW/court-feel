import { describe, expect, it } from 'vitest';
import { AI } from '../src/config';
import type { Athlete } from '../src/game/athlete';
import { laneFor, SETTER_TARGET } from '../src/game/plays';
import { HitterBrain } from '../src/ai/hitter';
import { scene, type Scene } from './scene';

/** shots an outside hitter (home side) picks over a sweep of the dice, against blockers at `blockersAt` along the net */
function shots(inSystem: boolean, blockersAt: number[]) {
  let r = 0;
  // fixed dice: each roll is the next even step through 0..1 and the aim has no spread, so the sweep sees every shot the hitter can pick
  const s = scene({ dice: { roll: () => r } });
  const a = s.athlete('OH', 1, { x: -4.0, z: 1.0 });
  const brain = new HitterBrain(a, laneFor('OH', 1));
  const blockers = blockersAt.map((x) => blocker(s, x));
  brain.inSystem = () => inSystem;
  brain.blockers = () => blockers;
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    r = (i + 0.5) / 200;
    brain.chooseAim(s.sim, -4.0);
    seen.add(brain.lastShot);
  }
  return seen;
}

/** a blocker on the far side at the net, x along it */
function blocker(s: Scene, x: number) {
  return s.athlete('MB', -1, { x, z: -0.4 });
}

/** our libero's pass, on its way up to our setter */
function passUp(s: Scene) {
  const passer = s.athlete('L', 1, { x: 0, z: 6 });
  s.send(
    { from: { x: 0, y: 0.6, z: 6 }, to: { x: SETTER_TARGET.x, y: 2.5, z: SETTER_TARGET.z }, time: 0.9 },
    { athlete: passer, kind: 'pass', side: 1 },
  );
}

describe('attack shot choice (Mini Rally AI)', () => {
  it('off a bad pass, with a block up, the hitter uses it: off the hands or rolled over', () => {
    // one blocker on the line: the cross is still open
    const seen = shots(false, [-4.2]);
    expect(seen.has('tool')).toBe(true);
    expect(seen.has('roll')).toBe(true);
  });

  it('in system, with the cross open, the hitter just hits round the single block', () => {
    const seen = shots(true, [-4.2]);
    expect(seen.has('tool')).toBe(false);
    expect(seen.has('roll')).toBe(false);
  });

  it('a hitter under the ball never takes a weak swing at the deep court: it wipes it off the block, tips it or rolls it', () => {
    let r = 0;
    // fixed dice: each roll is the next even step through 0..1, so the sweep sees every off-speed shot the hitter can pick
    const s = scene({ dice: { roll: () => r } });
    const a = s.athlete('OH', 1, { x: -4.0, z: 1.0 });
    const brain = new HitterBrain(a, laneFor('OH', 1));
    // their back row deep, nobody in the middle of the court
    const deep = [-3, 0, 3].map((x) => s.athlete('L', -1, { x, z: -7.5 }));
    brain.defenders = () => deep;
    const sweep = (blockers: Athlete[]) => {
      brain.blockers = () => blockers;
      const seen = new Map<string, { x: number; z: number }>();
      for (let i = 0; i < 100; i++) {
        r = (i + 0.5) / 100;
        const aim = brain.offSpeedAim(s.sim, -4.0);
        seen.set(brain.lastShot, { x: aim.x, z: aim.z });
      }
      return seen;
    };
    // a block in front: off its outside hand (out past it, at the net), a tip, or a roll
    const blocked = sweep([blocker(s, -4.2)]);
    expect([...blocked.keys()].sort()).toEqual(['roll', 'tip', 'wipe']);
    expect(blocked.get('wipe')!.x).toBeLessThan(-4.2);
    expect(Math.abs(blocked.get('wipe')!.z)).toBeLessThan(0.5);
    // the roll goes where they aren't: short of the deep back row, never at the end line
    expect(Math.abs(blocked.get('roll')!.z)).toBeLessThan(6);
    // nobody up: nothing to wipe it off
    expect([...sweep([]).keys()].sort()).toEqual(['roll', 'tip']);
  });

  it('on a good pass a pin hitter can run a fast set: already running when the setter touches it, met about 1 s later', () => {
    // fixed dice: the roll for a fast set comes up low, so this pin hitter runs one
    const s = scene({ dice: { roll: 0 } });
    const lane = laneFor('OH', 1);
    const a = s.athlete('OH', 1, { x: lane.sx, z: lane.sz });
    const brain = new HitterBrain(a, lane);
    s.sim.setBrain(a, brain);
    // the pass reaches the setter's hands 0.9 s from now
    passUp(s);
    brain.passToSetter = () => ({ t: 0.9, x: 1.0 });
    s.step();
    expect(brain.phase).toBe('approach');
    const f = brain.tempoBall!;
    expect(f).not.toBeNull();
    expect(f.t - 0.9).toBeCloseTo(AI.tempo.flight, 2);
    // met at the pin, inside the antenna
    expect(Math.abs(f.contact.x - lane.x)).toBeLessThan(0.3);
    // the run starts before the setter's touch: a fast set leaves no time to start after it
    expect(brain.plan!.tStart).toBeLessThan(0.9);
  });

  it('a pin hitter does not run a fast set every time: the rest wait for a high ball', () => {
    // fixed dice: the roll for a fast set comes up just over its share, so this pin hitter waits
    const s = scene({ dice: { roll: AI.tempo.share + 0.01 } });
    const lane = laneFor('OPP', 1);
    const a = s.athlete('OPP', 1, { x: lane.sx, z: lane.sz });
    const brain = new HitterBrain(a, lane);
    s.sim.setBrain(a, brain);
    passUp(s);
    brain.passToSetter = () => ({ t: 0.9, x: 1.0 });
    s.step();
    expect(brain.phase).toBe('ready');
    expect(brain.tempoBall).toBeNull();
  });
});
