// A change to the play brings a check, or says why not:
//   node scripts/brings-a-check.mjs <ref> [--title "<title>"] [--body-file <file>]
//
// CI runs this on every pull request with the commit it is going into (docs/verification.md). It
// asks git what the pull request changed and GitHub what it is called and says of itself, runs the
// changed tests against the base branch's code when the verdict depends on it
// (scripts/red-on-base.mjs), and hands all of that to the rule (scripts/brings-a-check.rule.mjs).
// The rule, its tiers of paths and every message are in that file. Exit code 1 when it fails.
//
// The title and the description come from, in this order: the two flags; in CI, the pull request
// as it is now, or as it was when the run started if GitHub cannot be reached; `gh pr view` for
// this branch (scripts/pull-request.mjs).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTIONED, asksRedOnBase, changedSections, changedTests, decide } from './brings-a-check.rule.mjs';
import { flag, pullRequest } from './pull-request.mjs';
import { baseOf, changedSince, redOnBase, reportOf } from './red-on-base.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node scripts/brings-a-check.mjs <ref> [--title "<title>"] [--body-file <file>]   (for example origin/main)';

const args = process.argv.slice(2);
const title = flag(args, '--title');
const bodyFile = flag(args, '--body-file');
const ref = args[0];
if (!ref) {
  console.error(USAGE);
  process.exit(2);
}

/** a file as it is on a commit, or null when the commit does not have it */
function at(commit, file) {
  try {
    return execFileSync('git', ['show', `${commit}:${file}`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

const pr = await pullRequest({ title, bodyFile });
if (!pr) {
  console.error(`This branch has no pull request to read a title and a description from. Give them: ${USAGE}`);
  process.exit(2);
}
const base = baseOf(ref);
const changed = changedSince(base);

// a file that is judged by section is given once for each section that changed
const paths = [];
const removed = [...changed.removed];
for (const file of changed.paths) {
  if (!SECTIONED.includes(file)) {
    paths.push(file);
    continue;
  }
  const before = at(base, file);
  const after = fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : null;
  const names = changedSections(before, after);
  if (names.length === 0) paths.push(file);
  /** the sections the file has here */
  const here = changedSections(null, after);
  for (const name of names) {
    paths.push(`${file}#${name}`);
    // a section that is gone still touches its tier, and is no check
    if (!here.includes(name)) removed.push(`${file}#${name}`);
  }
}

console.log('A change to the play brings a check, or says why not (docs/verification.md).');
console.log(`  the pull request: ${pr.title}   (${pr.from})`);
console.log(`  against: ${base.slice(0, 7)}, ${changed.paths.length} changed files`);

let red = [];
if (asksRedOnBase({ title: pr.title, paths, removed })) {
  const results = await redOnBase(base, changedTests(paths, removed));
  red = results.filter((r) => r.red).map((r) => r.file);
  console.log(`  its changed tests, against src/ as it is on ${base.slice(0, 7)}:`);
  console.log(
    reportOf(results, base)
      .map((line) => `  ${line}`)
      .join('\n'),
  );
}

// in CI a failure names this run in the command that runs it again
const verdict = decide({ title: pr.title, paths, removed, redOnBase: red, body: pr.body, runId: process.env.GITHUB_RUN_ID });
/** `scripts/trace.mjs#RUNS` as a reader says it, and a long list cut short */
const said = (files, most = 12) =>
  files
    .slice(0, most)
    .map((file) => file.replace(/#(.*)$/, ' ($1)'))
    .join(', ') + (files.length > most ? ` and ${files.length - most} more` : '');
if (verdict.tier)
  console.log(
    `  it touches ${verdict.tier === 'play' ? 'the play' : 'what is shown and heard, and not the play'}: ${said(verdict.touched)}`,
  );
for (const note of verdict.notes) console.log(`  ${note}`);
for (const held of verdict.heldBy) console.log(`  held: ${held}`);
for (const reason of verdict.unchecked) console.log(`  for a person to try (Unchecked): ${reason}`);

const summary = process.env.GITHUB_STEP_SUMMARY;
if (verdict.failures.length === 0) {
  console.log(verdict.gated ? 'It passes.' : 'Nothing is asked of it.');
  if (summary && verdict.unchecked.length)
    fs.appendFileSync(summary, `### What no check holds\n\n${verdict.unchecked.map((reason) => `- Unchecked: ${reason}`).join('\n')}\n`);
  process.exit(0);
}
console.error(`\nIt fails, for ${verdict.failures.length === 1 ? 'one reason' : `${verdict.failures.length} reasons`}:\n`);
for (const failure of verdict.failures) {
  console.error(`  - ${failure}\n`);
  // the same sentence on the pull request's checks page
  if (process.env.GITHUB_ACTIONS)
    console.log(
      `::error title=A change to the play brings a check, or says why not::${failure.replace(/%/g, '%25').replace(/\n/g, '%0A')}`,
    );
}
if (summary)
  fs.appendFileSync(
    summary,
    `### A change to the play brings a check, or says why not\n\n${verdict.failures.map((failure) => `- ${failure}`).join('\n')}\n`,
  );
process.exit(1);
