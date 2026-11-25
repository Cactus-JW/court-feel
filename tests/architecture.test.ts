import { describe, expect, it } from 'vitest';
import { KNOWN_CLOCK, KNOWN_DOM, KNOWN_FAKE_GAME, KNOWN_IMPORTS, KNOWN_SCENE } from './architecture.known';
import {
  clocksAndDiceIn,
  DETERMINISTIC,
  filesUnder,
  importCircles,
  importsOf,
  layerOf,
  MAY_IMPORT,
  read,
  sceneClassesIn,
  SIMULATION,
  touchesDom,
  type Layer,
} from './architecture.scan';

// The shape of the code (docs/adr/0010): the simulation runs on its own, and every import points
// down. The code is on its way there. What still breaks the rule is listed by name in
// architecture.known.ts, and these tests hold both sides: nothing new may break it, and an entry
// that has been fixed must leave the list.

const SRC = filesUnder('src');
const layered = SRC.map((file) => ({ file, layer: layerOf(file) }));
const inSimulation = layered.filter((f) => f.layer && SIMULATION.includes(f.layer)).map((f) => f.file);

/** what is in `actual` but not in `known`, and the other way round, as a message that says what to do */
function drift(actual: readonly string[], known: readonly string[], rule: string): string[] {
  const a = new Set(actual);
  const k = new Set(known);
  return [
    ...actual.filter((x) => !k.has(x)).map((x) => `new: ${x} (${rule}). Fix it, do not list it.`),
    ...known.filter((x) => !a.has(x)).map((x) => `fixed: ${x}. Take it out of tests/architecture.known.ts.`),
  ];
}

describe('architecture: every file has a layer', () => {
  it('a new folder under src/ is given a layer before code goes in it', () => {
    expect(layered.filter((f) => !f.layer).map((f) => f.file)).toEqual([]);
  });
});

describe('architecture: every import points down', () => {
  const upward: string[] = [];
  for (const { file, layer } of layered) {
    if (!layer) continue;
    for (const target of importsOf(file).files) {
      const to: Layer | null = layerOf(target);
      if (to && to !== layer && !MAY_IMPORT[layer].includes(to)) upward.push(`${file} -> ${target}`);
    }
  }

  it('no file imports from a layer above its own, apart from the ones already known', () => {
    expect(drift(upward, KNOWN_IMPORTS, 'that layer may not import this one')).toEqual([]);
  });

  it('physics is pure: it imports config and itself, and no package', () => {
    for (const file of SRC.filter((f) => layerOf(f) === 'physics')) {
      const { files, packages } = importsOf(file);
      expect(packages, `${file} imports a package`).toEqual([]);
      expect(
        files.filter((f) => layerOf(f) !== 'physics' && layerOf(f) !== 'config'),
        `${file} imports outside physics and config`,
      ).toEqual([]);
      expect(touchesDom(file), `${file} touches the DOM`).toBe(false);
    }
  });

  it('a brain knows the game only as AiHost: nothing under src/ai imports the Game', () => {
    // The layer rule above says the same, but an entry in the known list can excuse it there. Not
    // here. The file is named, so its name is checked first: were `Game` to move, a stale name
    // would pass whatever the brains import.
    const game = 'src/app/game.ts';
    const declaresGame = SRC.includes(game) && /^export class Game\b/m.test(read(game));
    expect(declaresGame, `${game} does not declare the Game: name the file that does`).toBe(true);
    for (const file of SRC.filter((f) => layerOf(f) === 'ai')) {
      expect(importsOf(file).files, `${file} imports the Game`).not.toContain(game);
    }
  });

  it('config imports nothing', () => {
    const { files, packages } = importsOf('src/config.ts');
    expect([...files, ...packages]).toEqual([]);
  });

  it('no two files import each other in a circle, however long the way round', () => {
    // type-only imports do not count: they are gone at run time
    expect(importCircles(SRC)).toEqual([]);
  });

  it('the known list is sorted and has no entry twice', () => {
    for (const list of [KNOWN_IMPORTS, KNOWN_DOM, KNOWN_SCENE, KNOWN_FAKE_GAME, KNOWN_CLOCK]) {
      expect([...list]).toEqual([...new Set(list)].sort());
    }
  });
});

describe('architecture: the simulation runs with no page and no renderer', () => {
  it('no simulation file touches the DOM, apart from the ones already known', () => {
    expect(drift(inSimulation.filter(touchesDom), KNOWN_DOM, 'the simulation has no DOM')).toEqual([]);
  });

  it('no simulation file builds scene objects, apart from the ones already known: three.js is maths there', () => {
    const building = inSimulation.filter((f) => sceneClassesIn(f).length > 0);
    expect(drift(building, KNOWN_SCENE, 'the simulation uses three.js for maths only')).toEqual([]);
  });
});

describe('architecture: the same start gives the same play', () => {
  it('physics, the simulation, the brains and the drills read no clock and roll no dice of their own', () => {
    // time comes from the simulation's clock and chance from its one seeded stream: anything else
    // makes two runs differ, which breaks the trace comparison, a replay and a second player
    const repeatable = layered.filter((f) => f.layer && DETERMINISTIC.includes(f.layer)).map((f) => f.file);
    const reaching = repeatable.filter((f) => clocksAndDiceIn(f).length > 0);
    expect(drift(reaching, KNOWN_CLOCK, 'use the simulation clock and its random stream')).toEqual([]);
  });
});

describe('architecture: tests build the real thing', () => {
  it('no test fakes the game with a cast, apart from the ones already known', () => {
    // a fake is a hand-made object cast to the game, or to the part of it the brains see
    const faking = filesUnder('tests').filter((f) => f !== 'tests/architecture.test.ts' && /as unknown as (Game|AiHost)\b/.test(read(f)));
    expect(drift(faking, KNOWN_FAKE_GAME, 'build what the code under test needs, not a cast')).toEqual([]);
  });
});
