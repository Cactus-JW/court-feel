// The pull request a check is judging, and how a check says that it fails.
//
// The title and the description come from, in this order: what the caller was given on the command
// line; in CI, the pull request as it is now (so a title or a description edited after the run
// started counts when the job is run again), or as it was when the run started if GitHub cannot be
// reached; `gh pr view` for this branch. An edit of either starts no run, which is why a check
// reads them when it runs and not when the run began.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The pull request's number, title and description, and where they were read (`from`). Null when
 * there is none to read: nothing was given, this is not CI, and the branch has no pull request.
 * `title`, `bodyFile`: given on the command line.
 */
export async function pullRequest({ title, bodyFile } = {}) {
  if (title !== undefined)
    return { number: undefined, title, body: bodyFile ? fs.readFileSync(bodyFile, 'utf8') : '', from: 'the command line' };
  const event = process.env.GITHUB_EVENT_PATH && JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request;
  if (event) {
    try {
      const response = await fetch(
        `${process.env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${process.env.GITHUB_REPOSITORY}/pulls/${event.number}`,
        {
          headers: {
            accept: 'application/vnd.github+json',
            ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
          },
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const now = await response.json();
      return { number: event.number, title: now.title, body: now.body, from: `#${event.number} as it is now` };
    } catch (error) {
      return {
        number: event.number,
        title: event.title,
        body: event.body,
        from: `#${event.number} as it was when this run started (GitHub did not answer: ${error.message})`,
      };
    }
  }
  try {
    const mine = JSON.parse(
      execFileSync('gh', ['pr', 'view', '--json', 'number,title,body'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
    return { number: mine.number, title: mine.title, body: mine.body, from: `#${mine.number}, this branch's pull request` };
  } catch {
    return null;
  }
}

/** takes `--name value` out of a list of arguments and gives the value */
export function flag(args, name) {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args.splice(at, 2)[1];
}

/**
 * Says why a rule fails: each failure on its own line in the log, as an annotation on the pull
 * request's checks page and in the job summary. `rule`: the rule's name, with no comma in it (the
 * runner cuts an annotation's title at one).
 */
export function fails(rule, failures) {
  console.error(`\nIt fails, for ${failures.length === 1 ? 'one reason' : `${failures.length} reasons`}:\n`);
  for (const failure of failures) {
    console.error(`  - ${failure}\n`);
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=${rule}::${failure.replace(/%/g, '%25').replace(/\n/g, '%0A')}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${rule}\n\n${failures.map((failure) => `- ${failure}`).join('\n')}\n`);
}
