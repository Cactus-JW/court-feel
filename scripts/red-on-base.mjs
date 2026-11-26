// Does a changed test show the change? `node scripts/red-on-base.mjs <ref> [test files]`.
//
// The other way round from scripts/rules-from-base.mjs: this checkout's tests, against the code as
// it is on <ref>. A test that states a new fact fails there and passes here. One that passes in both
// places holds nothing this change made: it would have been green whatever the change did.
//
// It builds a copy of this checkout under scripts/out/red-on-base/ with `src/` as it is on the
// commit this branch left <ref> at, and runs there the test files this branch added or changed
// (or the ones named). A test of a function the base does not have cannot run there: that is red
// too. Nothing in the checkout itself is touched, and the copy is removed afterwards.
//
// A test that never ends there is red as well: a fix for a loop that never ends comes with the test
// that states it. The run is stopped at a limit (`RUN_LIMIT_MS`, or RED_ON_BASE_LIMIT_MS in the
// environment), each file is then run alone to find the one that did not end, and the report names it.
//
// It reports, and the exit code is 0 either way: scripts/brings-a-check.mjs is what decides whether
// a pull request needed a red test.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { changedTests } from './brings-a-check.rule.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, 'scripts', 'out', 'red-on-base');
/**
 * How long a run of the changed tests may take there before it is stopped: two minutes.
 * Vitest's own limit cannot stop a test in a loop that never gives way, so without this one such a
 * test holds the job until CI cancels it, with nothing said. Two minutes is ten times what the
 * whole unit suite takes in CI (12 s), and the largest set of changed tests seen so far (16 files)
 * took under 8 s, so a run that is only slow is not stopped. And three waits of it (`MOST_NOT_ENDED`)
 * fit inside the check job's fifteen minutes.
 */
export const RUN_LIMIT_MS = 120000;
/**
 * How long one test may take there before Vitest fails it, by name: six times the 5 s it has here,
 * for a loaded machine. Well under the run's limit, so a test that waits for something that never
 * comes is a failed test with a name, and only a loop that never gives way reaches the run's limit.
 */
export const TEST_LIMIT_MS = 30000;
/**
 * After this many files that did not end, the rest are not tried: one helper with a loop in it can
 * hang every file that uses it. So the gate waits three times the limit at most (all the files
 * together, then two alone): six minutes.
 */
export const MOST_NOT_ENDED = 2;

const git = (args, options = {}) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'], ...options });

/** the commit this branch left <ref> at (in CI's shallow clone of the merge commit, <ref> itself) */
export function baseOf(ref) {
  try {
    return git(['merge-base', ref, 'HEAD']).trim();
  } catch {
    return git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  }
}

/**
 * What this checkout changes against a commit, uncommitted and new files too.
 * `paths`: every changed path. `removed`: the ones of them that are gone here.
 */
export function changedSince(base) {
  const paths = [];
  const removed = [];
  // -z gives "status\0path\0status\0path": no quoting, whatever a file is called
  const fields = git(['diff', '--name-status', '--no-renames', '-z', base]).split('\0').filter(Boolean);
  for (let i = 0; i + 1 < fields.length; i += 2) {
    paths.push(fields[i + 1]);
    if (fields[i] === 'D') removed.push(fields[i + 1]);
  }
  for (const file of git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) paths.push(file);
  return { paths, removed };
}

/**
 * Runs node with these arguments and waits no longer than `limitMs`. When the time is up, the
 * child and every process it started are stopped, and `ended` is false.
 *
 * The child is the leader of a process group of its own, and it is the group that is stopped:
 * Vitest runs each test file in a process it starts, and stopping Vitest alone would leave a test
 * that is in a loop running for good. For the same reason the group is stopped when this script is
 * interrupted (Ctrl+C would not reach it by itself).
 */
export function runNode(args, { limitMs, cwd }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let ended = true;
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => (stdout += data));
    child.stderr.on('data', (data) => (stderr += data));
    const stop = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // every process of the group has ended already
      }
    };
    const timer = setTimeout(() => {
      ended = false;
      stop();
    }, limitMs);
    const interrupted = (signal) => {
      stop();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    };
    process.once('SIGINT', interrupted);
    process.once('SIGTERM', interrupted);
    const done = (status) => {
      clearTimeout(timer);
      process.off('SIGINT', interrupted);
      process.off('SIGTERM', interrupted);
      resolve({ ended, status, stdout, stderr });
    };
    child.on('error', (error) => {
      stderr += String(error);
      done(null);
    });
    child.on('close', done);
  });
}

/**
 * The verdict on each file, from a way to run some of them together: `run` gives one entry a
 * file, or null when the run did not end. All of them are run together first, which is the quick
 * way and the usual one. If that does not end, each is run alone, to find the one that does not.
 */
export async function eachFile(files, run, limitMs) {
  const notEnded = (file) => ({ file, red: true, failed: 0, total: 0, first: '', ended: false, limitMs });
  const together = await run(files);
  if (together) return together;
  if (files.length === 1) return [notEnded(files[0])];
  const out = [];
  let waited = 0;
  for (const file of files) {
    if (waited >= MOST_NOT_ENDED) {
      out.push({ file, red: false, failed: 0, total: 0, first: '', tried: false, limitMs });
      continue;
    }
    const alone = await run([file]);
    if (alone) out.push(alone[0]);
    else {
      waited++;
      out.push(notEnded(file));
    }
  }
  return out;
}

/**
 * Runs these test files of this checkout against `src/` as it is on `base`.
 * Gives one entry a file: whether it is red there, how many of its tests fail, and the first failure.
 * Red is a file that fails there, one that cannot run there and one that does not end there within
 * `limitMs`: each of them passes here, so each shows the change.
 */
export async function redOnBase(base, files, { limitMs = Number(process.env.RED_ON_BASE_LIMIT_MS) || RUN_LIMIT_MS } = {}) {
  if (files.length === 0) return [];
  fs.rmSync(scratch, { recursive: true, force: true });
  try {
    // this checkout, without its src/ ...
    const mine = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
    for (const file of mine) {
      if (file.startsWith('src/') || !fs.lstatSync(path.join(root, file), { throwIfNoEntry: false })) continue;
      fs.mkdirSync(path.dirname(path.join(scratch, file)), { recursive: true });
      // a link is copied as a link (.claude/skills points at a folder)
      if (fs.lstatSync(path.join(root, file)).isSymbolicLink())
        fs.symlinkSync(fs.readlinkSync(path.join(root, file)), path.join(scratch, file));
      else fs.copyFileSync(path.join(root, file), path.join(scratch, file));
    }
    // ... and with the base's
    const archive = execFileSync('git', ['archive', '--format=tar', base, 'src'], {
      cwd: root,
      maxBuffer: 1 << 30,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    execFileSync('tar', ['-x', '-C', scratch], { input: archive });

    const report = path.join(scratch, 'red-on-base.json');
    /** these files in one run of Vitest there: one entry a file, or null when the run did not end */
    const run = async (some) => {
      fs.rmSync(report, { force: true });
      // vitest is this checkout's: the copy has no node_modules, and node looks for one upwards
      const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
      const child = await runNode([vitest, 'run', ...some, '--reporter=json', `--outputFile=${report}`, `--testTimeout=${TEST_LIMIT_MS}`], {
        cwd: scratch,
        limitMs,
      });
      if (!child.ended) return null;
      if (!fs.existsSync(report)) {
        throw new Error(
          `vitest gave no report for ${some.join(', ')} on the code of ${base.slice(0, 7)}:\n${(child.stderr || child.stdout).trim()}\n` +
            'Run `npx vitest run` on those files here first: they have to be able to start.',
        );
      }
      const results = JSON.parse(fs.readFileSync(report, 'utf8')).testResults;
      return some.map((file) => {
        const result = results.find((r) => path.relative(scratch, r.name).split(path.sep).join('/') === file);
        // a file vitest did not report on could not be found or loaded there
        if (!result) return { file, red: true, failed: 0, total: 0, first: 'the file could not be run there' };
        const tests = result.assertionResults ?? [];
        const failing = tests.filter((t) => t.status === 'failed');
        const first = failing[0] ? `"${failing[0].fullName}": ${firstLine(failing[0].failureMessages?.[0])}` : firstLine(result.message);
        return { file, red: result.status === 'failed', failed: failing.length, total: tests.length, first };
      });
    };
    return await eachFile(files, run, limitMs);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** the first line of a failure, with the copy's own path taken out of it */
const firstLine = (message) =>
  String(message ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
    ?.replaceAll(`${scratch}${path.sep}`, '') ?? '';

/** one line a file, as a reader says it */
export function reportOf(results, base) {
  const at = base.slice(0, 7);
  return results.map((r) => {
    const limit = `${r.limitMs / 1000} s`;
    if (r.ended === false)
      return (
        `  red    ${r.file}: it did not end on the code of ${at} and was stopped after ${limit}. That is red: it ends here, so it shows the change. ` +
        'If it should end there too, give the loop it waits in a limit, so that it fails there and says why.'
      );
    if (r.tried === false)
      return (
        `  untried  ${r.file}: it was not run on the code of ${at}, because ${MOST_NOT_ENDED} files before it did not end there and each was waited for ${limit}. ` +
        `\`node scripts/red-on-base.mjs ${at} ${r.file}\` tries it alone.`
      );
    return r.red
      ? `  red    ${r.file}: ${r.total ? `${r.failed} of ${r.total} tests fail` : 'it cannot run'} on the code of ${at}${r.first ? ` (${r.first})` : ''}`
      : `  green  ${r.file}: all ${r.total} tests pass on the code of ${at} too, so none of them shows this change`;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [ref, ...named] = process.argv.slice(2);
  if (!ref) {
    console.error('usage: node scripts/red-on-base.mjs <ref> [test files]   (for example origin/main)');
    process.exit(2);
  }
  const base = baseOf(ref);
  const { paths, removed } = changedSince(base);
  const files = named.length ? named : changedTests(paths, removed);
  if (files.length === 0) console.log(`no test file is added or changed since ${base.slice(0, 7)}: nothing to run`);
  else {
    console.log(`this checkout's changed tests, against src/ as it is on ${base.slice(0, 7)}:`);
    console.log(reportOf(await redOnBase(base, files), base).join('\n'));
  }
}
