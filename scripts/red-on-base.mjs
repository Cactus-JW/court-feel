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
// It reports, and the exit code is 0 either way: scripts/brings-a-check.mjs is what decides whether
// a pull request needed a red test.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { changedTests } from './brings-a-check.rule.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, 'scripts', 'out', 'red-on-base');
/** a test that only passes there for want of time is not red: a loaded machine gets this long for each */
const TEST_TIMEOUT_MS = 120000;

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
 * Runs these test files of this checkout against `src/` as it is on `base`.
 * Gives one entry a file: whether it is red there, how many of its tests fail, and the first failure.
 */
export function redOnBase(base, files) {
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

    // vitest is this checkout's: the copy has no node_modules, and node looks for one upwards
    const report = path.join(scratch, 'red-on-base.json');
    const run = spawnSync(
      process.execPath,
      [
        path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
        'run',
        ...files,
        '--reporter=json',
        `--outputFile=${report}`,
        `--testTimeout=${TEST_TIMEOUT_MS}`,
      ],
      { cwd: scratch, encoding: 'utf8', maxBuffer: 1 << 28 },
    );
    if (!fs.existsSync(report)) {
      throw new Error(
        `vitest gave no report for ${files.join(', ')} on the code of ${base.slice(0, 7)}:\n${(run.stderr || run.stdout || String(run.error)).trim()}\n` +
          'Run `npx vitest run` on those files here first: they have to be able to start.',
      );
    }
    const results = JSON.parse(fs.readFileSync(report, 'utf8')).testResults;
    return files.map((file) => {
      const result = results.find((r) => path.relative(scratch, r.name).split(path.sep).join('/') === file);
      // a file vitest did not report on could not be found or loaded there
      if (!result) return { file, red: true, failed: 0, total: 0, first: 'the file could not be run there' };
      const tests = result.assertionResults ?? [];
      const failing = tests.filter((t) => t.status === 'failed');
      const first = failing[0] ? `"${failing[0].fullName}": ${firstLine(failing[0].failureMessages?.[0])}` : firstLine(result.message);
      return { file, red: result.status === 'failed', failed: failing.length, total: tests.length, first };
    });
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
  return results.map((r) =>
    r.red
      ? `  red    ${r.file}: ${r.total ? `${r.failed} of ${r.total} tests fail` : 'it cannot run'} on the code of ${at}${r.first ? ` (${r.first})` : ''}`
      : `  green  ${r.file}: all ${r.total} tests pass on the code of ${at} too, so none of them shows this change`,
  );
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
    console.log(reportOf(redOnBase(base, files), base).join('\n'));
  }
}
