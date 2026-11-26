// Every pull request is compared with the branch it goes into, and only a feat or a fix may differ
// (docs/verification.md).
//
// Two rules that read a pull request's title, as pure functions (scripts/pull-request.rule.mjs):
// the title starts with a known type, and a type that is meant to change nothing for the player
// has to play exactly like its base. CI asks GitHub for the title and the trace tool for the
// comparison (scripts/title-has-a-type.mjs, scripts/same-play-as-base.mjs), and these decide.
import { describe, expect, it } from 'vitest';
import trace from '../scripts/trace.mjs?raw';
import { MAY_DIFFER, PHRASES, TYPES, compared, outcomeOf, titled, typeOf } from '../scripts/pull-request.rule.mjs';

/** the id of the CI run a failure is printed in, and the pull request's number */
const IN_CI = { runId: '45871704444', number: 144 };
const RERUN = /run `gh run rerun 45871704444 --failed`: editing a title starts no run\.$/;

describe('the type a title starts with', () => {
  it('is one of the eight AGENTS.md lists, before a colon, with or without an area', () => {
    expect(TYPES).toEqual(['feat', 'fix', 'perf', 'refactor', 'test', 'docs', 'ci', 'chore']);
    for (const type of TYPES) {
      expect(typeOf(`${type}: what changes`)).toBe(type);
      expect(typeOf(`${type}(rally): what changes`)).toBe(type);
    }
    expect(typeOf('fix(block)!: the hands')).toBe('fix');
  });

  it.each([
    'Block: the ball comes off the hands the way it met them',
    'Mini Rally: levels of play (Rec, Club, National, Pro) for both teams',
    'Fixture cleanup',
    'fix typo in README',
    'Feat: a new serve',
    'feat : a new serve',
    'feat(): a new serve',
    'feature: a new serve',
    'Circle the block',
    'Revert "feat(rally): the setter calls the pass"',
    '[feat] a new serve',
    'WIP: feat: a new serve',
    'feat:',
    '',
  ])('"%s" starts with no type', (title) => {
    expect(typeOf(title)).toBe(null);
  });
});

describe('a title starts with a known type', () => {
  it('passes a title that does', () => {
    expect(titled({ title: 'feat(rally): the setter calls the pass (HIGH! when out of system)', ...IN_CI }).failures).toEqual([]);
    expect(titled({ title: 'ci: every pull request is compared with main', ...IN_CI })).toEqual({ type: 'ci', failures: [] });
  });

  it('fails one that does not: it names the types, gives the command that retitles it, and ends with the command that runs the job again', () => {
    const { failures, type } = titled({ title: 'Block: the ball comes off the hands the way it met them', ...IN_CI });
    expect(type).toBe(null);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^The title "Block: the ball comes off the hands the way it met them" does not start with a type\./);
    expect(failures[0]).toMatch(/one of feat, fix, perf, refactor, test, docs, ci or chore/);
    expect(failures[0]).toMatch(/`gh pr edit 144 --title "<type>\(block\): the ball comes off the hands the way it met them"`/);
    expect(failures[0]).toMatch(RERUN);
  });

  it('what stood where the type goes becomes the area, in the words the convention uses', () => {
    const retitle = (title: string) => /--title "(.*)"`/.exec(titled({ title, ...IN_CI }).failures[0])?.[1];
    expect(retitle('Mini Rally: levels of play for both teams')).toBe('<type>(mini-rally): levels of play for both teams');
    // a type that is only written wrong is put right, with no area made of it
    expect(retitle('Feat: a new serve')).toBe('feat: a new serve');
    expect(retitle('fix typo in README')).toBe('<type>: fix typo in README');
    // what a shell would read inside double quotes is escaped
    expect(retitle('Revert "feat(rally): the `HIGH!` call"')).toBe('<type>: Revert \\"feat(rally): the \\`HIGH!\\` call\\"');
  });

  it('outside CI the commands show where the number and the run id go', () => {
    const [failure] = titled({ title: 'Circle the block' }).failures;
    expect(failure).toMatch(/`gh pr edit <number> --title /);
    expect(failure).toMatch(/`gh run rerun <run id> --failed`/);
  });
});

describe('how the comparison ended, read off what the trace tool printed', () => {
  const SAME =
    'comparing this checkout (4aff8c3) with HEAD^1 (0696e3a)\nsame play: every drill gives the same states, contacts and outcomes as 0696e3a, and is drawn and shown the same';
  const PLAY =
    "spike/OH/perfect: differs by frame 15 (0.25 s into the drill)\n    ball.vy: 3.1 (0696e3a) and 3.4 (this checkout)\n    first different contact or outcome: 'x' (0696e3a) and 'y' (this checkout)";
  const DRAWN =
    "rally/OH/good: the simulation is the same, but what is drawn or shown differs\n    first different thing the HUD is told: 'a' (0696e3a) and 'b' (this checkout)";
  const TOLD = 'setter/S/keys: the play is the same, but the HUD is told something else';

  it('exit code 0 is the same play', () => {
    expect(outcomeOf({ status: 0, output: SAME })).toBe('same');
  });

  it('a first difference in the play, in what is drawn or in what the HUD is told is a difference', () => {
    for (const output of [PLAY, DRAWN, TOLD]) expect(outcomeOf({ status: 1, output }), output).toBe('differs');
  });

  it('a checkout that is not sound by itself is no verdict on the comparison, though it prints a difference of its own', () => {
    expect(outcomeOf({ status: 1, output: `the same hands did not give the same play:\n${PLAY}` })).toBe('unfinished');
    expect(
      outcomeOf({
        status: 1,
        output: "a run with a person's keys no longer reaches what it is there to check:\n    setter/S/keys: steps: 0",
      }),
    ).toBe('unfinished');
  });

  it('an error, or a run that was stopped, is no verdict', () => {
    expect(outcomeOf({ status: 1, output: 'Error: spike/OH/good threw in the page: TypeError' })).toBe('unfinished');
    expect(outcomeOf({ status: null, output: '' })).toBe('unfinished');
  });

  it('every phrase it looks for is one the trace tool prints: a reworded tool fails here, not in a pull request months later', () => {
    for (const phrase of [...PHRASES.differs, ...PHRASES.notSound]) expect(trace, phrase).toContain(phrase);
    expect(PHRASES.differs).toHaveLength(3);
    expect(PHRASES.notSound.length).toBeGreaterThanOrEqual(2);
  });
});

describe('only a feat or a fix may play differently from the branch it goes into', () => {
  const BASE = '0696e3a';
  const of = (title: string, outcome: 'same' | 'differs' | 'unfinished') =>
    compared({ title, outcome, base: BASE, runId: '45871704444', number: 153 });

  it('a feat and a fix are the two that may', () => {
    expect(MAY_DIFFER).toEqual(['feat', 'fix']);
  });

  it.each(TYPES)('a %s that plays the same passes', (type) => {
    const verdict = of(`${type}: what changes`, 'same');
    expect(verdict.failures).toEqual([]);
    expect(verdict.note).toMatch(/same play as 0696e3a/);
  });

  it.each(['feat(block): the ball comes off the hands the way it met them', 'fix: the whistle'])(
    '"%s" that differs passes, and is told to read the difference',
    (title) => {
      const verdict = of(title, 'differs');
      expect(verdict.failures).toEqual([]);
      expect(verdict.note).toMatch(/does not play like 0696e3a, as a (feat|fix) may/);
      expect(verdict.note).toMatch(/read the difference above against what the pull request says it changes/);
    },
  );

  it.each(['refactor', 'perf', 'test', 'docs', 'ci', 'chore'])(
    'a %s that differs fails: it was meant to change nothing, and the failure says the two ways out',
    (type) => {
      const { failures } = of(`${type}(sim): the numbers have names`, 'differs');
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatch(
        new RegExp(
          `^Its title says ${type}, so it is meant to change nothing for the player, and it does not play like 0696e3a: the first difference is printed above\\.`,
        ),
      );
      // the way out that is a commit, with how the job runs again after it
      expect(failures[0]).toMatch(/so that this prints `same play`, then push the commit: that runs this again\./);
      // and the one that is a title, with the command for each step
      expect(failures[0]).toMatch(/it is a feat or a fix: retitle it with `gh pr edit 153 --title "feat\(sim\): the numbers have names"`/);
      expect(failures[0]).toMatch(/bring the check the check job then asks for/);
      expect(failures[0]).toMatch(RERUN);
    },
  );

  it('a title with no type that differs fails too: nothing says it may', () => {
    const { failures, type } = of('Block: the ball comes off the hands the way it met them', 'differs');
    expect(type).toBe(null);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(
      /^Its title says neither feat nor fix, so it is meant to change nothing for the player, and it does not play like 0696e3a/,
    );
    expect(failures[0]).toMatch(/`gh pr edit 153 --title "feat\(block\): the ball comes off the hands the way it met them"`/);
  });

  it('a comparison with no verdict fails a type that must be the same: it is not shown to change nothing', () => {
    const { failures } = of('chore: three 0.188', 'unfinished');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(
      /^The comparison with 0696e3a ended without a verdict \(what it printed is above\)\. Its title says chore, so it has to be shown to change nothing for the player, and it was not\./,
    );
    expect(failures[0]).toMatch(/Run `npm run trace:compare` to see it here, mend what it says/);
    expect(failures[0]).toMatch(/then push the commit: that runs this again\.$/);
  });

  it('a comparison with no verdict does not fail a feat or a fix, and says that nothing was compared', () => {
    const verdict = of('feat(drill): a new drill, with a run of the trace that plays it', 'unfinished');
    expect(verdict.failures).toEqual([]);
    expect(verdict.note).toMatch(/ended without a verdict/);
    expect(verdict.note).toMatch(/nothing was compared/);
  });

  it('a feat or a fix that plays the same is told that no run reaches a change to the play', () => {
    expect(of('fix(rally): a long rally no longer ends as a point', 'same').note).toMatch(
      /if it changes the play, no run of the trace reaches the change/,
    );
    expect(of('docs: the readme', 'same').note).not.toMatch(/no run of the trace reaches/);
  });

  it('every failure says what is wrong, then one or two sentences to act on', () => {
    const failures = [
      ...of('docs: the readme', 'differs').failures,
      ...of('Block: the hands', 'differs').failures,
      ...of('ci: a gate', 'unfinished').failures,
      ...titled({ title: 'Block: the hands', ...IN_CI }).failures,
    ];
    expect(failures).toHaveLength(4);
    for (const failure of failures) {
      const sentences = failure.split(/\. (?=[A-Z])/);
      expect(sentences.length, failure).toBeGreaterThanOrEqual(2);
      expect(sentences.length, failure).toBeLessThanOrEqual(3);
    }
  });
});
