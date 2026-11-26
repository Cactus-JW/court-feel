// A change to the play brings a check, or says why not (docs/verification.md).
//
// The gate CI runs on a pull request (scripts/brings-a-check.mjs) asks git and GitHub four things,
// and its decision is a pure function of them: the title, the paths that changed, which of the
// changed tests are red on the base branch's code, and the description. These tests hold that
// function (scripts/brings-a-check.rule.mjs): what it asks of whom, what satisfies it, and that
// every failure says what to do next.
import { describe, expect, it } from 'vitest';
import template from '../.github/pull_request_template.md?raw';
import { changedSections, decide, tierOf } from '../scripts/brings-a-check.rule.mjs';

/** a description with both sections filled in, and whatever is put under "What no check holds" */
const described = (unchecked = 'Nothing: the test above holds it.') =>
  [
    '## What changes for the player',
    'The block reads the hands.',
    '## How it is held',
    '<!-- each behaviour and the check that holds it -->',
    'The ball leaves the hands the way it met them: tests/block.test.ts.',
    '## What no check holds',
    '<!-- a line that starts `Unchecked:` when a change to the play brings no check -->',
    unchecked,
  ].join('\r\n');

const PLAY = 'src/game/contact.ts';
const SHOWN = 'src/ui/hud.ts';
const TEST = 'tests/block.test.ts';

/** the gate's verdict on a `feat` with a filled-in description */
const feat = (paths: string[], more: { redOnBase?: string[]; removed?: string[]; body?: string } = {}) =>
  decide({ title: 'feat(block): the ball comes off the hands the way it met them', paths, body: described(), ...more });

describe('the tiers: which files are the play, and which are what is shown and heard', () => {
  it('physics, the simulation, the brains, the drills and the input door are the play', () => {
    for (const path of [
      'src/physics/ball.ts',
      'src/game/contact.ts',
      'src/game/modes/spike.ts',
      'src/ai/blocker.ts',
      'src/core/input.ts',
      'src/core/touchPad.ts',
      'src/app/pace.ts',
    ])
      expect(tierOf(path), path).toBe('play');
  });

  it('the HUD, the effects, the sound, the camera, the world and the app are what is shown and heard', () => {
    for (const path of [
      'src/ui/hud.ts',
      'src/ui/styles.css',
      'src/fx/effects.ts',
      'src/audio/audio.ts',
      'src/camera/cameraRig.ts',
      'src/world/arena.ts',
      'src/character/rig.ts',
      'src/app/game.ts',
      'src/main.ts',
      'index.html',
    ])
      expect(tierOf(path), path).toBe('shown');
  });

  it('tests, scripts, docs and the agent files are neither', () => {
    for (const path of [
      'tests/block.test.ts',
      'scripts/e2e.mjs',
      'docs/verification.md',
      '.github/workflows/ci.yml',
      'README.md',
      'package.json',
    ])
      expect(tierOf(path), path).toBe(null);
  });

  it('the autopilots are neither: they change what the trace plays, not the game', () => {
    expect(tierOf('src/app/bot.ts')).toBe(null);
  });

  it('a section of config is the play, unless it is listed as shown and heard', () => {
    for (const section of ['COURT', 'BALL', 'TIMING', 'CONTACT', 'ASSIST', 'AI', 'TOUCH', 'SERVE_DRILL'])
      expect(tierOf(`src/config.ts#${section}`), section).toBe('play');
    for (const section of ['CAMERA', 'ARENA', 'VENUES', 'CHARACTER', 'FX', 'AUDIO', 'QUALITY', 'DEFAULT_SETTINGS'])
      expect(tierOf(`src/config.ts#${section}`), section).toBe('shown');
  });

  it('a section or a file nobody has listed yet is the play: a new one cannot slip past by being new', () => {
    expect(tierOf('src/config.ts#BLOCK_DRILL')).toBe('play');
    expect(tierOf('src/config/ai.ts')).toBe('play');
    expect(tierOf('src/replays/store.ts')).toBe('play');
  });
});

describe('the sections of a file that is judged by section (config, the trace)', () => {
  const before = [
    '// the head of the file',
    '',
    '/** the court */',
    'export const COURT = { length: 18 };',
    '',
    'export const AI = {',
    '  wait: 0.3,',
    '};',
    '',
  ].join('\n');

  it('names the section whose number changed, and no other', () => {
    expect(changedSections(before, before.replace('0.3', '0.35'))).toEqual(['AI']);
  });

  it('a doc comment belongs to the section it stands over', () => {
    expect(changedSections(before, before.replace('the court', 'the court, in metres'))).toEqual(['COURT']);
  });

  it('a section that is new, or gone, has changed', () => {
    const after = `${before}\nexport const FX = { sparks: 12 };\n`;
    expect(changedSections(before, after)).toEqual(['FX']);
    expect(changedSections(after, before)).toEqual(['FX']);
  });

  it('a file that is new or gone has changed in every section it has', () => {
    expect(changedSections(null, before)).toEqual(['(top)', 'COURT', 'AI']);
  });

  it('the same text has no changed section', () => {
    expect(changedSections(before, before)).toEqual([]);
  });
});

describe('the gate reads a feat and a fix, and nothing else', () => {
  it.each([
    'refactor: the play rules leave Game',
    'test: the fake-game tests play on a real simulation',
    'docs: the readme',
    'chore: housework',
    'perf: fewer draws',
    'ci: a gate',
  ])('asks nothing of "%s", whatever it touches and whatever its description says', (title) => {
    const verdict = decide({ title, paths: [PLAY, SHOWN], body: '' });
    expect(verdict.gated).toBe(false);
    expect(verdict.failures).toEqual([]);
  });

  it('reads "feat", "feat(area)", "fix" and "fix(area)"', () => {
    for (const title of ['feat: a new serve', 'feat(rally): the setter calls the pass', 'fix: the whistle', 'fix(block)!: the hands'])
      expect(decide({ title, paths: [], body: described() }).gated, title).toBe(true);
  });

  it('asks nothing of a title with no type, and says that it did not', () => {
    const verdict = decide({ title: 'Block: the ball comes off the hands the way it met them', paths: [PLAY], body: '' });
    expect(verdict.failures).toEqual([]);
    expect(verdict.notes.join(' ')).toMatch(/does not start with feat or fix/);
  });
});

describe('a feat or a fix that touches the play brings a check that is red on the base, or says why not', () => {
  it('fails with no check at all, and says the three ways to pass', () => {
    const { failures, tier } = feat([PLAY]);
    expect(tier).toBe('play');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/src\/game\/contact\.ts/);
    expect(failures[0]).toMatch(/a test in tests\/ that fails on the base branch's code/);
    expect(failures[0]).toMatch(/scripts\/trace\.mjs/);
    expect(failures[0]).toMatch(/Unchecked: <why no check can hold it>/);
  });

  it('passes with a changed test that is red on the base', () => {
    const verdict = feat([PLAY, TEST], { redOnBase: [TEST] });
    expect(verdict.failures).toEqual([]);
    expect(verdict.heldBy.join(' ')).toMatch(/tests\/block\.test\.ts/);
  });

  it('fails when every changed test passes on the base too: none of them shows the change', () => {
    const { failures } = feat([PLAY, TEST, 'tests/serve.test.ts'], { redOnBase: [] });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/tests\/block\.test\.ts, tests\/serve\.test\.ts/);
    expect(failures[0]).toMatch(/pass on the base branch's code too/);
    expect(failures[0]).toMatch(/node scripts\/red-on-base\.mjs/);
  });

  it("passes with a change to the trace's runs", () => {
    expect(feat([PLAY, 'scripts/trace.mjs#RUNS']).failures).toEqual([]);
    expect(feat([PLAY, 'scripts/trace.mjs#KEY_RUNS']).failures).toEqual([]);
    expect(feat([PLAY, 'scripts/trace.mjs#LESSONS']).failures).toEqual([]);
  });

  it('a change to the trace tool that leaves its runs alone is not a check', () => {
    expect(feat([PLAY, 'scripts/trace.mjs#playOne']).failures).toHaveLength(1);
  });

  it("the trace's list of runs taken out altogether is not a check", () => {
    expect(feat([PLAY, 'scripts/trace.mjs#RUNS'], { removed: ['scripts/trace.mjs#RUNS'] }).failures).toHaveLength(1);
  });

  it('passes with a line "Unchecked: <reason>" under "What no check holds"', () => {
    const verdict = feat([PLAY], { body: described('Unchecked: the feel of the new window, to be played on the preview.') });
    expect(verdict.failures).toEqual([]);
    expect(verdict.unchecked).toEqual(['the feel of the new window, to be played on the preview.']);
  });

  it('"Unchecked: no time" passes, on purpose: the reason is then written where the owner sees it', () => {
    const verdict = feat([PLAY], { body: described('- Unchecked: no time') });
    expect(verdict.failures).toEqual([]);
    expect(verdict.unchecked).toEqual(['no time']);
  });

  it('an "Unchecked:" with no reason, or with the placeholder for one, does not pass', () => {
    expect(feat([PLAY], { body: described('Unchecked:') }).failures).toHaveLength(1);
    expect(feat([PLAY], { body: described('Unchecked: <reason>') }).failures).toHaveLength(1);
  });

  it("the template's own comment does not pass for the line it describes", () => {
    const body = described('Nothing.').replace('<!-- a line that starts `Unchecked:`', '<!-- write\nUnchecked: <reason>\n');
    expect(feat([PLAY], { body }).failures).toHaveLength(1);
  });

  it('an "Unchecked:" line under a subheading of "What no check holds" passes: it is in that section', () => {
    const body = [
      '## How it is held',
      'By nothing yet.',
      '## What no check holds',
      '### On a phone',
      '- Unchecked: the feel of the new window, with thumbs.',
    ].join('\n');
    const verdict = feat([PLAY], { body });
    expect(verdict.failures).toEqual([]);
    expect(verdict.unchecked).toEqual(['the feel of the new window, with thumbs.']);
  });

  it('an "Unchecked:" line after the section has ended, under the next heading of its level or higher, does not pass', () => {
    const lines = ['## How it is held', 'By nothing yet.', '## What no check holds', '### On a phone', 'Nothing.'];
    for (const next of ['## Checklist', '# Notes']) {
      const { failures } = feat([PLAY], { body: [...lines, next, 'Unchecked: the feel.'].join('\n') });
      expect(failures, next).toHaveLength(1);
      expect(failures[0], next).toMatch(/move it under "## What no check holds"/);
    }
  });

  it('an "Unchecked:" line under another heading does not pass, and the failure says to move it', () => {
    const body = described('Nothing.').replace('The block reads the hands.', 'Unchecked: the feel.');
    const { failures } = feat([PLAY], { body });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/move it under "## What no check holds"/);
  });

  it('an end-to-end check or a feature file alone does not hold a change to the play', () => {
    expect(feat([PLAY, 'scripts/e2e.mjs']).failures).toHaveLength(1);
    expect(feat([PLAY, '.agents/skills/verify-court-feel/features/spike-drill.md']).failures).toHaveLength(1);
  });

  it('a deleted file of the play is a change to the play', () => {
    expect(feat([PLAY], { removed: [PLAY] }).failures).toHaveLength(1);
  });

  it('a deleted test is not a check, even if it would be red', () => {
    expect(feat([PLAY, TEST], { removed: [TEST], redOnBase: [TEST] }).failures).toHaveLength(1);
  });

  it('a tuned number in a gameplay section of config is a change to the play', () => {
    expect(feat(['src/config.ts#TIMING']).tier).toBe('play');
    expect(feat(['src/config.ts#TIMING']).failures).toHaveLength(1);
  });

  it('a change that touches both tiers is held to the play: a test that passes on the base is not enough', () => {
    const verdict = feat([PLAY, SHOWN, TEST], { redOnBase: [] });
    expect(verdict.tier).toBe('play');
    expect(verdict.failures).toHaveLength(1);
  });
});

describe('a feat or a fix that touches only what is shown and heard brings a check of any kind, or says why not', () => {
  it('fails with no check at all, and says the ways to pass', () => {
    const { failures, tier } = feat([SHOWN]);
    expect(tier).toBe('shown');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/src\/ui\/hud\.ts/);
    expect(failures[0]).toMatch(/a test in tests\//);
    expect(failures[0]).toMatch(/scripts\/e2e\.mjs/);
    expect(failures[0]).toMatch(/\.agents\/skills\/verify-court-feel\/features\//);
    expect(failures[0]).toMatch(/Unchecked: <why no check can hold it>/);
  });

  it('passes with a changed test, red on the base or not', () => {
    expect(feat([SHOWN, 'tests/menu.test.ts'], { redOnBase: [] }).failures).toEqual([]);
  });

  it('passes with a changed end-to-end check, a changed feature file or a changed trace run', () => {
    expect(feat([SHOWN, 'scripts/e2e.mjs']).failures).toEqual([]);
    expect(feat([SHOWN, '.agents/skills/verify-court-feel/features/pause-settings.md']).failures).toEqual([]);
    expect(feat([SHOWN, 'scripts/trace.mjs#RUNS']).failures).toEqual([]);
  });

  it('passes with the "Unchecked:" line', () => {
    expect(feat([SHOWN], { body: described('Unchecked: whether the crowd sounds right, nobody can hear it in CI.') }).failures).toEqual([]);
  });

  it('a deleted test is not a check', () => {
    expect(feat([SHOWN, 'tests/menu.test.ts'], { removed: ['tests/menu.test.ts'] }).failures).toHaveLength(1);
  });

  it('a look or sound section of config is what is shown and heard', () => {
    expect(feat(['src/config.ts#AUDIO']).tier).toBe('shown');
  });
});

describe('a feat or a fix that touches neither tier is asked for no check', () => {
  it('passes on tests, scripts, docs and the autopilots alone', () => {
    const verdict = feat(['tests/block.test.ts', 'scripts/shot.mjs', 'docs/adr/0012.md', 'src/app/bot.ts']);
    expect(verdict.tier).toBe(null);
    expect(verdict.failures).toEqual([]);
  });
});

describe('a feat or a fix says how it is held and what no check holds', () => {
  const held = (body: string) => decide({ title: 'fix(hud): the grade is the one that was earned', paths: [], body });

  it('passes when both sections say something', () => {
    expect(held(described()).failures).toEqual([]);
  });

  it('fails for each section that is missing, and says to add it from the template', () => {
    const { failures } = held('## What changes for the player\nThe grade is right.\n');
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatch(/no "## How it is held" section/);
    expect(failures[1]).toMatch(/no "## What no check holds" section/);
    for (const failure of failures) expect(failure).toMatch(/\.github\/pull_request_template\.md/);
  });

  it('fails for a section that still holds only its placeholder comment', () => {
    const body = [
      '## How it is held',
      '<!-- each behaviour and',
      'the check that holds it -->',
      '',
      '## What no check holds',
      'Nothing.',
    ].join('\n');
    const { failures } = held(body);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/"## How it is held" still holds only its placeholder comment/);
  });

  it("fails on the repository's own template, left as it is: both sections are there, and neither is filled in", () => {
    const { failures } = held(template);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatch(/"## How it is held" still holds only its placeholder comment/);
    expect(failures[1]).toMatch(/"## What no check holds" still holds only its placeholder comment/);
  });

  it("the template's comments do not pass a change to the play that brings no check", () => {
    const filled = template.replace(/(## How it is held\n)/, '$1By nothing yet.\n').replace(/(## What no check holds\n)/, '$1Nothing.\n');
    const { failures } = decide({ title: 'feat: a new serve', paths: [PLAY], body: filled });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/brings no check/);
  });

  it('fails on a description that is empty or was never written', () => {
    expect(held('').failures).toHaveLength(2);
    expect(decide({ title: 'fix: the whistle', paths: [], body: null }).failures).toHaveLength(2);
  });

  it('a section runs on through its subheadings: what stands under one is in the section', () => {
    const body = [
      '## How it is held',
      '### Unit tests',
      '- tests/a.test.ts holds the angle',
      '## What no check holds',
      '#### On a phone',
      'The feel, with thumbs.',
    ].join('\n');
    expect(held(body).failures).toEqual([]);
  });

  it('a section ends at the next heading of its own level or higher: what stands under that one is not in it', () => {
    const { failures } = held(
      ['### How it is held', '## Why', 'It was wrong.', '### What no check holds', '### Checklist', '- done'].join('\n'),
    );
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatch(/"## How it is held" still holds only its placeholder comment/);
    expect(failures[1]).toMatch(/"## What no check holds" still holds only its placeholder comment/);
  });

  it('a heading is found whatever its level or case', () => {
    expect(held('### how it is held\nBy a test.\n# What No Check Holds\nNothing.').failures).toEqual([]);
  });
});

describe('every failure ends with how to have the gate look again', () => {
  /** the id of the CI run a failure is printed in (`GITHUB_RUN_ID`) */
  const RUN = '45871704444';
  const RERUN =
    /run the whole run again, `gh run rerun 45871704444`, or push a commit: editing a description starts no run, and every job has to read it as it is now, not only the one that failed\.$/;
  const inCi = (paths: string[], more: { body?: string | null; title?: string } = {}) =>
    decide({ title: 'feat(block): the ball comes off the hands the way it met them', paths, body: described(), runId: RUN, ...more });

  /** the failures only an edit to the description mends: two sections missing, one empty, an `Unchecked:` line in the wrong place */
  const ofTheDescription = () => [
    ...inCi([], { title: 'fix: the whistle', body: '' }).failures,
    ...inCi([], { title: 'fix: the whistle', body: '## How it is held\n## What no check holds\nNothing.' }).failures,
    ...inCi([PLAY], { body: described('Nothing.').replace('The block reads the hands.', 'Unchecked: the feel.') }).failures,
  ];
  /** the failures a new test or trace run mends: the play with no check, the play with tests that are green on the base, the shown tier with no check */
  const ofTheChecks = () => [...inCi([PLAY]).failures, ...inCi([PLAY, TEST]).failures, ...inCi([SHOWN]).failures];

  it('a failure only the description can mend ends with the command that runs the whole run again, with the id of the run it failed in', () => {
    const failures = ofTheDescription();
    expect(failures).toHaveLength(4);
    for (const failure of failures) {
      expect(failure).toMatch(RERUN);
      // nothing here needs a commit of its own: the push is for someone who may not run a workflow again
      expect(failure).not.toMatch(/then push the commit: that runs this again/);
    }
  });

  it('a failure a new test or trace run mends says that pushing the commit runs it again, and keeps the command for the way out through the description', () => {
    const failures = ofTheChecks();
    expect(failures).toHaveLength(3);
    for (const failure of failures) {
      expect(failure).toMatch(/, then push the commit: that runs this again\. Or write a line "Unchecked: <why no check can hold it>"/);
      expect(failure).toMatch(RERUN);
    }
  });

  it('outside CI there is no run to name, and the command shows where its id goes', () => {
    for (const failure of [...feat([PLAY]).failures, ...decide({ title: 'fix: x', paths: [], body: '' }).failures])
      expect(failure).toMatch(/`gh run rerun <run id>`/);
  });

  it('a fix that is retitled docs after the gate fails it: the command the gate gave runs the whole run, so the comparison reads the docs too', () => {
    // the comparison passed it as a fix; run again alone, the gate would ask nothing of a docs and that pass would stand
    const failures = [
      ...inCi([PLAY], { title: 'fix(block): the hands' }).failures,
      ...inCi([], { title: 'fix: the whistle', body: '' }).failures,
    ];
    expect(failures).toHaveLength(3);
    for (const failure of failures) {
      expect(failure).toMatch(/run the whole run again, `gh run rerun 45871704444`, or push a commit/);
      expect(failure).not.toMatch(/--failed/);
    }
  });

  it('no failure says "run this job again" without saying how', () => {
    for (const failure of [...ofTheDescription(), ...ofTheChecks()]) expect(failure).not.toMatch(/run this job again/i);
  });

  it('every failure says what is wrong, then one or two sentences to act on', () => {
    for (const failure of [...ofTheDescription(), ...ofTheChecks()]) {
      const sentences = failure.split(/\. (?=[A-Z])/);
      expect(sentences.length, failure).toBeGreaterThanOrEqual(2);
      expect(sentences.length, failure).toBeLessThanOrEqual(3);
    }
  });
});
