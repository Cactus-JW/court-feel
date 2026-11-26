// The verification map is complete, and everything it names exists (docs/verification.md).
//
// `tests/verification.map.json` says, for each thing a player can choose (a drill and the position
// it is played as, a serve, a lesson, a setting, a graphics level, a venue) and for each section of
// config, what holds it: unit test files, runs of the trace, checks of the end-to-end run. Or
// `manual`, with why no check can and what a person looks for. A gap that is written down can be
// counted, and the list of what still needs a person is read off the map and not remembered.
//
// This test is what makes the map true to the code. It fails when
//   - something that exists has no entry (a new setting cannot arrive without saying what holds it),
//   - an entry is for something that no longer exists,
//   - an entry names a test file, a trace run, an end-to-end check or a feature file that is not there,
//   - an entry names no check and gives no reason.
//
// What exists is read from the code and not from a second list:
//   - the drills, positions, serves, settings, graphics levels, venues and config's sections from
//     what `src/config` and the drill registry export, through the one door other tests use, so a
//     config that is one file or a folder of them reads the same;
//   - the trace's runs and the end-to-end run's checks from the text of the two scripts. Neither
//     can be imported (each plays the game when it is loaded), so their lists are cut out of the
//     text and worked out here, with the scripts' own way of naming a run;
//   - the unit test files and the verify-court-feel feature files from the folders they are in.
import { describe, expect, it } from 'vitest';
import * as config from '../src/config';
import { MODE_INFO } from '../src/game/modes/mode';
import type { Lesson } from '../src/game/tutorial';
import e2eScript from '../scripts/e2e.mjs?raw';
import traceScript from '../scripts/trace.mjs?raw';
import written from './verification.map.json';

// ---- the shape of the map

/** what holds one thing */
interface Entry {
  /** unit test files, by name: `gameplay` is tests/gameplay.test.ts */
  unit?: string[];
  /** runs of the trace, by the name the trace prints: `spike/OH/perfect`, `keys/setter/S/hands off` */
  trace?: string[];
  /** checks of the end-to-end run: one of its drill runs (`serve_OH_call2`) or one of its phases (`touch`) */
  e2e?: string[];
  /** verify-court-feel feature files, by name: a recipe an agent drives by hand. It is not a check */
  skill?: string[];
  /** what no check holds: why not, and what a person looks for */
  manual?: string;
  /** anything a reader should know about the checks named */
  note?: string;
}
/** the kinds of thing the map has an entry for, and how a sentence names one of them */
const KINDS = {
  drill: 'drill',
  drillAs: 'drill and position',
  serve: 'serve',
  lesson: 'lesson',
  setting: 'setting',
  graphics: 'graphics level',
  venue: 'venue',
  config: 'section of config',
} as const;
type Kind = keyof typeof KINDS;
type VerificationMap = Partial<Record<Kind, Record<string, Entry>>>;

/** the kinds of check an entry can name, and where each lives */
const CHECKS = {
  unit: { a: 'unit test', where: (name: string) => `there is no tests/${name}.test.ts` },
  trace: { a: 'trace run', where: () => 'scripts/trace.mjs plays no run of that name (RUNS, LESSONS, KEY_RUNS)' },
  e2e: { a: 'end-to-end check', where: () => 'scripts/e2e.mjs has no drill run and no phase of that name' },
  skill: { a: 'feature file', where: (name: string) => `there is no .agents/skills/verify-court-feel/features/${name}.md` },
} as const;
type Check = keyof typeof CHECKS;
/** the ones that hold something by themselves: a feature file is a recipe, run by hand */
const HOLDS: readonly Check[] = ['unit', 'trace', 'e2e'];

const MAP = 'tests/verification.map.json';

// ---- what exists

/** the text of one top-level `const` of a script: its first line, and the lines after it that are part of it */
function declared(source: string, name: string): string {
  const lines = source.split('\n');
  const at = lines.findIndex((line) => line.startsWith(`const ${name} = `));
  if (at < 0)
    throw new Error(
      `The script no longer has a top-level \`const ${name}\`: ${MAP.replace('.json', '.test.ts')} reads its list from there, so say there where the list is now.`,
    );
  let end = at + 1;
  while (end < lines.length && (lines[end] === '' || /^[\s\]})]/.test(lines[end]))) end++;
  return lines
    .slice(at, end)
    .join('\n')
    .trim()
    .replace(/^const \w+ = /, '')
    .replace(/;$/, '');
}

/**
 * What an expression cut out of a script comes to. Every name it uses and does not define (another
 * list of the script, a count of seconds) stands for nothing: only the names of the runs are wanted,
 * and those are written out in the list itself.
 */
function valueOf(expression: string): any {
  const nothing: any = new Proxy(function () {}, {
    get: (_, key) => (key === Symbol.toPrimitive ? () => '' : nothing),
    apply: () => nothing,
  });
  const scope = new Proxy(
    {},
    {
      has: (_, key) => typeof key === 'string' && !(key in globalThis),
      get: (_, key) => (key === Symbol.unscopables ? undefined : nothing),
    },
  );
  return new Function('scope', `with (scope) { return (${expression}); }`)(scope);
}

/** every run of the trace, by the name the trace gives it */
function traceRuns(script: string): string[] {
  const nameOf = valueOf(declared(script, 'nameOf'));
  const drills = [...valueOf(declared(script, 'RUNS')), ...valueOf(declared(script, 'LESSONS'))].map(
    (run: unknown) => nameOf(run) as string,
  );
  return [...drills, ...valueOf(declared(script, 'KEY_RUNS')).map((run: { name: string }) => run.name)];
}

/** every check of the end-to-end run that has a name: its drill runs (`spike_OH_call2`) and its phases (`touch`) */
function e2eChecks(script: string): string[] {
  const keyOf = valueOf(`(mode, pos, call) => ${/^ *const key = (call \? .*);$/m.exec(script)?.[1] ?? 'undefined'}`);
  const runs = valueOf(declared(script, 'runs')).map(
    ([mode, pos, call = 0]: [string, string, number?]) => keyOf(mode, pos, call) as string,
  );
  const phases = [...script.matchAll(/^phase\('(\w+)'\);/gm)].map((m) => m[1]).filter((phase) => phase !== 'done');
  return [...new Set([...runs, ...phases])];
}

/** `./gameplay.test.ts` and `../.agents/.../features/serve-drill.md` as the map names them */
const named = (paths: string[], ending: string) => paths.map((path) => path.slice(path.lastIndexOf('/') + 1, -ending.length));

/**
 * The lessons. The game has no list of them to read, only the type, so they are written here once
 * and the compiler holds the list to the type: a lesson that is added, or one that is gone, fails
 * the typecheck on this line until it is brought in step.
 */
const LESSONS: Record<Lesson, true> = { spike: true, float: true, jumpFloat: true, jump: true };

interface Exists {
  things: Record<Kind, string[]>;
  checks: Record<Check, string[]>;
}

const DRILLS = Object.keys(MODE_INFO);
const POSITIONS = Object.keys(config.POSITIONS);
const exists: Exists = {
  things: {
    drill: DRILLS,
    // every drill can be played as every position: the start screen offers all five for each
    drillAs: DRILLS.flatMap((drill) => POSITIONS.map((position) => `${drill}/${position}`)),
    serve: [...config.SERVE_KINDS],
    lesson: Object.keys(LESSONS),
    setting: Object.keys(config.DEFAULT_SETTINGS),
    graphics: [...config.GRAPHICS_LEVEL_IDS],
    venue: [...config.VENUE_IDS],
    // a section is an export of config that is a table of values: not a list of ids, not a function
    config: Object.entries(config)
      .filter(([, value]) => typeof value === 'object' && value !== null && !Array.isArray(value))
      .map(([name]) => name),
  },
  checks: {
    unit: named(Object.keys(import.meta.glob('./*.test.ts')), '.test.ts'),
    trace: traceRuns(traceScript),
    e2e: e2eChecks(e2eScript),
    skill: named(Object.keys(import.meta.glob('../.agents/skills/verify-court-feel/features/*.md')), '.md').filter(
      (name) => name !== 'README',
    ),
  },
};

// ---- the check

/** where a new entry goes, in words */
const WHAT_AN_ENTRY_SAYS = `the unit tests ("unit"), trace runs ("trace") and end-to-end checks ("e2e") that hold it, or "manual" with why no check can and what a person looks for`;

/** what is wrong with a map, given what exists: one sentence each, that says what to do */
function problems(map: VerificationMap, there: Exists): string[] {
  const out: string[] = [];
  for (const kind of Object.keys(KINDS) as Kind[]) {
    const entries = map[kind] ?? {};
    const a = `the ${KINDS[kind]} "`;
    for (const name of there.things[kind])
      if (!(name in entries)) out.push(`${MAP} has no entry for ${a}${name}". Add "${name}" under "${kind}", with ${WHAT_AN_ENTRY_SAYS}.`);
    for (const [name, entry] of Object.entries(entries)) {
      if (!there.things[kind].includes(name)) {
        out.push(
          `${MAP} has an entry for ${a}${name}", and the game has no such ${KINDS[kind]} any more. Take "${name}" out from under "${kind}".`,
        );
        continue;
      }
      for (const check of Object.keys(CHECKS) as Check[]) {
        const names = entry[check] ?? [];
        if (!Array.isArray(names)) {
          out.push(`In ${MAP}, "${check}" of ${a}${name}" is not a list. Write it as a list of names, "${check}": ["..."].`);
          continue;
        }
        for (const checkName of names)
          if (!there.checks[check].includes(checkName))
            out.push(
              `In ${MAP}, ${a}${name}" names the ${CHECKS[check].a} "${checkName}", and ${CHECKS[check].where(checkName)}. ` +
                (check === 'skill'
                  ? `Name a feature file that exists, or take the name out.`
                  : `If it was renamed, name it as it is now. If it is gone, so is what held this: name another check that does, or say "manual" and why.`),
            );
      }
      const held = HOLDS.some((check) => Array.isArray(entry[check]) && entry[check]!.length > 0);
      if (!held && !(typeof entry.manual === 'string' && entry.manual.trim() !== ''))
        out.push(
          `In ${MAP}, ${a}${name}" names no check and gives no reason. Name what holds it ("unit", "trace", "e2e"), or write "manual": why no check can, and what a person looks for.`,
        );
      for (const key of Object.keys(entry))
        if (!(key in CHECKS) && key !== 'manual' && key !== 'note')
          out.push(
            `In ${MAP}, ${a}${name}" has "${key}", which is not something an entry says. An entry has "unit", "trace", "e2e", "skill", "manual" and "note".`,
          );
    }
  }
  for (const key of Object.keys(map))
    if (!(key in KINDS) && key !== 'about')
      out.push(`${MAP} has "${key}" at the top, which is not a kind of thing it maps. The kinds are ${Object.keys(KINDS).join(', ')}.`);
  return out;
}

describe('the verification map (tests/verification.map.json)', () => {
  it('has an entry for everything that exists, names only checks that exist, and leaves nothing without a check or a reason', () => {
    expect(problems(written as VerificationMap, exists)).toEqual([]);
  });

  it('reads what exists from the code: the numbers of today, so that a reading that came back empty is seen', () => {
    // the drills and what a player can choose
    expect(exists.things.drill).toEqual(['free', 'spike', 'block', 'receive', 'setter', 'serve', 'rally']);
    expect(exists.things.drillAs).toHaveLength(35);
    expect(exists.things.serve).toEqual(['float', 'jumpFloat', 'jump']);
    expect(exists.things.setting).toContain('aimAssist');
    expect(exists.things.setting.length).toBeGreaterThan(10);
    expect(exists.things.config).toContain('CONTACT');
    expect(exists.things.config).not.toContain('SERVE_KINDS');
    // the scripts' lists, by the scripts' own names
    expect(exists.checks.trace).toContain('spike/OH/good/double block');
    expect(exists.checks.trace).toContain('lesson/jumpFloat');
    expect(exists.checks.trace).toContain('keys/setter/S/hands off/set aim assist 0');
    // more than a handful: a run taken out is the map's to notice (an entry names it), not this line's
    expect(exists.checks.trace.length).toBeGreaterThan(10);
    expect(exists.checks.e2e).toContain('serve_OH_call3');
    expect(exists.checks.e2e).toContain('touch');
    expect(exists.checks.unit).toContain('gameplay');
    expect(exists.checks.skill).toContain('serve-drill');
  });
});

describe('the check itself, on a small map', () => {
  const there: Exists = {
    things: {
      drill: ['spike'],
      drillAs: [],
      serve: [],
      lesson: [],
      setting: ['volume', 'aimAssist'],
      graphics: [],
      venue: [],
      config: ['BALL'],
    },
    checks: { unit: ['gameplay'], trace: ['spike/OH/perfect'], e2e: ['spike_OH', 'touch'], skill: ['spike-drill'] },
  };
  const whole: VerificationMap = {
    drill: { spike: { unit: ['gameplay'], trace: ['spike/OH/perfect'], e2e: ['spike_OH'], skill: ['spike-drill'] } },
    setting: { volume: { manual: 'sound: nobody can hear it in CI' }, aimAssist: { unit: ['gameplay'] } },
    config: { BALL: { trace: ['spike/OH/perfect'] } },
  };
  const without = (kind: Kind, name: string): VerificationMap => ({
    ...whole,
    [kind]: Object.fromEntries(Object.entries(whole[kind]!).filter(([key]) => key !== name)),
  });
  const withEntry = (kind: Kind, name: string, entry: Entry): VerificationMap => ({ ...whole, [kind]: { ...whole[kind], [name]: entry } });

  it('a whole map has nothing wrong with it: a check, or a reason with no check, is enough', () => {
    expect(problems(whole, there)).toEqual([]);
  });

  it('something that exists and has no entry: the sentence says what to add and where', () => {
    expect(problems(without('setting', 'aimAssist'), there)).toEqual([
      'tests/verification.map.json has no entry for the setting "aimAssist". Add "aimAssist" under "setting", with the unit tests ("unit"), trace runs ("trace") and end-to-end checks ("e2e") that hold it, or "manual" with why no check can and what a person looks for.',
    ]);
    expect(problems(without('config', 'BALL'), there)[0]).toMatch(/no entry for the section of config "BALL"\. Add "BALL" under "config"/);
  });

  it('an entry for something that is gone', () => {
    expect(problems(withEntry('setting', 'showHints', { manual: 'a hint' }), there)).toEqual([
      'tests/verification.map.json has an entry for the setting "showHints", and the game has no such setting any more. Take "showHints" out from under "setting".',
    ]);
  });

  it('a unit test, a trace run, an end-to-end check or a feature file that is not there', () => {
    const [unit] = problems(withEntry('setting', 'aimAssist', { unit: ['gameplayy'] }), there);
    expect(unit).toMatch(/the setting "aimAssist" names the unit test "gameplayy", and there is no tests\/gameplayy\.test\.ts\./);
    const [trace] = problems(withEntry('config', 'BALL', { trace: ['spike/OH/good'] }), there);
    expect(trace).toMatch(
      /the section of config "BALL" names the trace run "spike\/OH\/good", and scripts\/trace\.mjs plays no run of that name/,
    );
    expect(trace).toMatch(/If it is gone, so is what held this: name another check that does, or say "manual" and why\.$/);
    const [e2e] = problems(withEntry('drill', 'spike', { e2e: ['spike_L'] }), there);
    expect(e2e).toMatch(/names the end-to-end check "spike_L", and scripts\/e2e\.mjs has no drill run and no phase of that name/);
    const [skill] = problems(withEntry('drill', 'spike', { unit: ['gameplay'], skill: ['block-drill'] }), there);
    expect(skill).toMatch(
      /names the feature file "block-drill", and there is no \.agents\/skills\/verify-court-feel\/features\/block-drill\.md/,
    );
  });

  it('an entry with no check and no reason, and a feature file is not a check', () => {
    const none =
      /the setting "volume" names no check and gives no reason\. Name what holds it \("unit", "trace", "e2e"\), or write "manual"/;
    expect(problems(withEntry('setting', 'volume', {}), there)[0]).toMatch(none);
    expect(problems(withEntry('setting', 'volume', { unit: [], manual: ' ' }), there)[0]).toMatch(none);
    expect(problems(withEntry('setting', 'volume', { skill: ['spike-drill'] }), there)[0]).toMatch(none);
  });

  it('a word an entry does not have, and a kind the map does not have', () => {
    expect(problems(withEntry('setting', 'volume', { manual: 'sound', units: ['gameplay'] } as Entry), there)[0]).toMatch(
      /has "units", which is not something an entry says/,
    );
    expect(problems({ ...whole, settings: {} } as VerificationMap, there)[0]).toMatch(
      /has "settings" at the top, which is not a kind of thing it maps/,
    );
  });
});
