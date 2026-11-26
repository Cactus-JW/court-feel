// How long the gate waits for a changed test on the base branch's code (scripts/red-on-base.mjs).
//
// A fix for a loop that never ends comes with the test that states it, and on the base that test
// never ends either. Vitest's own time limit cannot stop a loop that never gives way, so the run is
// given a limit from outside: at the limit it is stopped, with every process it started, and the
// file is reported as one that did not end there. That is red: it ends here, so it shows the change.
import { describe, expect, it } from 'vitest';
import { MOST_NOT_ENDED, RUN_LIMIT_MS, TEST_LIMIT_MS, eachFile, reportOf, runNode, type OnBase } from '../scripts/red-on-base.mjs';

const BASE = '62f0cd9f7a';
/** a file's entry when it ran to its end: green, or red with one failing test */
const ran = (file: string, red = false): OnBase => ({
  file,
  red,
  failed: red ? 1 : 0,
  total: 3,
  first: red ? '"a fact": expected 1 to be 2' : '',
});

describe('a run that never ends is stopped at the limit', () => {
  it('a child that never ends is stopped within the limit, with the processes it started, and comes back as not ended', async () => {
    const LIMIT = 1000;
    // what Vitest with a test in a loop is: a child that starts a child of its own, and neither ever ends
    const child = `const mine = require('node:child_process').spawn(process.execPath, ['-e', 'for (;;) {}'], { stdio: 'inherit' }); console.log(mine.pid); for (;;) {}`;
    const started = Date.now();
    const run = await runNode(['-e', child], { limitMs: LIMIT });
    const waited = Date.now() - started;
    expect(run.ended).toBe(false);
    expect(waited).toBeGreaterThanOrEqual(LIMIT - 20);
    expect(waited).toBeLessThan(LIMIT + 5000);

    // the child's own child is gone too (a stopped process that nobody has collected yet counts as gone)
    const pid = Number(run.stdout.trim());
    expect(pid).toBeGreaterThan(0);
    const look =
      `const gone = () => { try { process.kill(${pid}, 0); } catch { return true; } ` +
      `try { return require('node:fs').readFileSync('/proc/${pid}/stat', 'utf8').split(') ')[1][0] === 'Z'; } catch { return false; } }; ` +
      `const until = Date.now() + 5000; (function again() { if (gone()) console.log('gone'); else if (Date.now() > until) console.log('alive'); else setTimeout(again, 50); })();`;
    expect((await runNode(['-e', look], { limitMs: 10000 })).stdout.trim()).toBe('gone');
  }, 30000);

  it('a child that ends is left to end, and what it printed comes back', async () => {
    const run = await runNode(['-e', 'console.log("done"); process.exitCode = 3'], { limitMs: 10000 });
    expect(run).toMatchObject({ ended: true, status: 3 });
    expect(run.stdout.trim()).toBe('done');
  });

  it('one test is failed by Vitest well before the whole run is stopped, so a slow test is named and not called a run that never ended', () => {
    expect(TEST_LIMIT_MS * 2).toBeLessThanOrEqual(RUN_LIMIT_MS);
  });
});

describe('which file did not end', () => {
  /** a way to run files in which these never end */
  const neverEnding = (hung: string[]) => {
    const asked: string[][] = [];
    const run = async (files: readonly string[]) => {
      asked.push([...files]);
      return files.some((file) => hung.includes(file)) ? null : files.map((file) => ran(file, file === 'tests/red.test.ts'));
    };
    return { asked, run };
  };

  it('when the files end together, they are run once and each keeps its verdict', async () => {
    const { asked, run } = neverEnding([]);
    const results = await eachFile(['tests/a.test.ts', 'tests/red.test.ts'], run, 500);
    expect(asked).toEqual([['tests/a.test.ts', 'tests/red.test.ts']]);
    expect(results.map((r) => [r.file, r.red])).toEqual([
      ['tests/a.test.ts', false],
      ['tests/red.test.ts', true],
    ]);
  });

  it('when the run does not end, each file is run alone: the one that does not end is red, and the others keep their verdict', async () => {
    const { asked, run } = neverEnding(['tests/loop.test.ts']);
    const results = await eachFile(['tests/a.test.ts', 'tests/loop.test.ts', 'tests/red.test.ts'], run, 500);
    expect(asked.slice(1)).toEqual([['tests/a.test.ts'], ['tests/loop.test.ts'], ['tests/red.test.ts']]);
    expect(results).toEqual([
      ran('tests/a.test.ts'),
      { file: 'tests/loop.test.ts', red: true, failed: 0, total: 0, first: '', ended: false, limitMs: 500 },
      ran('tests/red.test.ts', true),
    ]);
  });

  it('a file that is the only one is not waited for twice', async () => {
    const { asked, run } = neverEnding(['tests/loop.test.ts']);
    const results = await eachFile(['tests/loop.test.ts'], run, 500);
    expect(asked).toHaveLength(1);
    expect(results).toMatchObject([{ file: 'tests/loop.test.ts', red: true, ended: false }]);
  });

  it('after two files that did not end, the rest are not waited for, and are not called red', async () => {
    const files = ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts', 'tests/d.test.ts'];
    const { asked, run } = neverEnding(files);
    const results = await eachFile(files, run, 500);
    expect(MOST_NOT_ENDED).toBe(2);
    // all together, then the first two alone: three waits, and no more
    expect(asked).toHaveLength(3);
    expect(results.map((r) => [r.red, r.ended, r.tried])).toEqual([
      [true, false, undefined],
      [true, false, undefined],
      [false, undefined, false],
      [false, undefined, false],
    ]);
  });
});

describe('what the report says of a file', () => {
  it('a file that did not end: which file, how long it was waited for, that it counts as red, and what to do if it should have ended', () => {
    const [line] = reportOf(
      [{ file: 'tests/loop.test.ts', red: true, failed: 0, total: 0, first: '', ended: false, limitMs: 120000 }],
      BASE,
    );
    expect(line).toMatch(/^\s+red\s+tests\/loop\.test\.ts: it did not end on the code of 62f0cd9 and was stopped after 120 s\./);
    expect(line).toMatch(/That is red: it ends here, so it shows the change\./);
    expect(line).toMatch(/If it should end there too, give the loop it waits in a limit, so that it fails there and says why\.$/);
  });

  it('a file that was not tried: which file, why, and the command that tries it alone', () => {
    const [line] = reportOf([{ file: 'tests/d.test.ts', red: false, failed: 0, total: 0, first: '', tried: false, limitMs: 120000 }], BASE);
    expect(line).toMatch(
      /^\s+untried\s+tests\/d\.test\.ts: it was not run on the code of 62f0cd9, because 2 files before it did not end there/,
    );
    expect(line).toMatch(/`node scripts\/red-on-base\.mjs 62f0cd9 tests\/d\.test\.ts` tries it alone\.$/);
  });

  it('a file that fails, one that cannot run and one that passes read as before', () => {
    const lines = reportOf(
      [
        ran('tests/red.test.ts', true),
        { file: 'tests/new.test.ts', red: true, failed: 0, total: 0, first: 'Cannot find module' },
        ran('tests/a.test.ts'),
      ],
      BASE,
    );
    expect(lines[0]).toMatch(/red\s+tests\/red\.test\.ts: 1 of 3 tests fail on the code of 62f0cd9 \("a fact": expected 1 to be 2\)/);
    expect(lines[1]).toMatch(/red\s+tests\/new\.test\.ts: it cannot run on the code of 62f0cd9 \(Cannot find module\)/);
    expect(lines[2]).toMatch(/green\s+tests\/a\.test\.ts: all 3 tests pass on the code of 62f0cd9 too/);
  });
});
