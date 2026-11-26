// Every pull request is compared with the branch it goes into, and only a feat or a fix may differ:
//   node scripts/same-play-as-base.mjs [ref] [--title "<title>"]
//
// CI runs this on every pull request, with the commit it is going into (docs/verification.md). It
// runs the comparison (`node scripts/trace.mjs compare [ref]`, which is `npm run trace:compare`),
// lets through everything that prints, and then reads the pull request's title:
//   - a feat or a fix may play differently, and nothing the comparison says fails it. What was
//     printed is the difference a reader holds against what the pull request says it changes;
//   - every other type says of itself that nothing changes for the player, and fails unless the
//     comparison printed `same play`.
// The rule and every message are in scripts/pull-request.rule.mjs. Exit code 1 when it fails.
//
// Without a ref the comparison is with the commit this branch left origin/main at.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fails, flag, pullRequest } from './pull-request.mjs';
import { compared, outcomeOf } from './pull-request.rule.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const pr = await pullRequest({ title: flag(args, '--title') });
const [ref] = args;
if (!pr) {
  console.error(
    'This branch has no pull request to read a title from. Give one: node scripts/same-play-as-base.mjs [ref] --title "<title>"',
  );
  process.exit(2);
}

const git = (...words) => execFileSync('git', words, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
/** the commit it is compared with, as the trace tool names it */
let base = ref ?? 'the commit it left origin/main at';
try {
  base = git('rev-parse', '--short=7', ref ?? git('merge-base', 'HEAD', 'origin/main'));
} catch {
  // the tool will say what is wrong with the ref
}

console.log('Every pull request is compared with the branch it goes into, and only a feat or a fix may differ (docs/verification.md).');
console.log(`  the pull request: ${pr.title}   (${pr.from})\n`);

/** the comparison, with everything it prints let through as it comes and kept */
const run = await new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'trace.mjs'), 'compare', ...(ref ? [ref] : [])], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  /** what it printed as its verdict: the lines it wrote to the error stream */
  let said = '';
  child.stdout.on('data', (data) => {
    output += data;
    process.stdout.write(data);
  });
  child.stderr.on('data', (data) => {
    output += data;
    said += data;
    process.stderr.write(data);
  });
  child.on('error', (error) => resolve({ status: null, output: `${output}${error}`, said: String(error) }));
  child.on('close', (status) => resolve({ status, output, said }));
});

const outcome = outcomeOf(run);
const verdict = compared({ title: pr.title, outcome, base, number: pr.number, runId: process.env.GITHUB_RUN_ID });
const summary = process.env.GITHUB_STEP_SUMMARY;
if (verdict.failures.length === 0) {
  console.log(`\n${verdict.note}`);
  // a difference that is allowed is still the thing to read: it goes on the run's summary page too
  if (summary && outcome !== 'same')
    fs.appendFileSync(summary, `### Compared with ${base}\n\n${verdict.note}\n\n\`\`\`\n${run.said.trim().slice(0, 6000)}\n\`\`\`\n`);
  process.exit(0);
}
fails('Only a feat or a fix may play differently from the branch it goes into', verdict.failures);
process.exit(1);
