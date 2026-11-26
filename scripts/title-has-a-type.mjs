// A pull request's title starts with its type: `node scripts/title-has-a-type.mjs [--title "<title>"]`.
//
// CI runs this on every pull request (docs/verification.md). The checks that treat one kind of
// change differently from another read the kind off the title: a feat or a fix brings a check
// (scripts/brings-a-check.mjs), and every other type has to play like the branch it goes into
// (scripts/same-play-as-base.mjs). A title with no type would be asked nothing by the first and
// held to the wrong thing by the second, so it fails here, with the command that retitles it.
// The rule and its message are in scripts/pull-request.rule.mjs. Exit code 1 when it fails.
import { fails, flag, pullRequest } from './pull-request.mjs';
import { titled } from './pull-request.rule.mjs';

const args = process.argv.slice(2);
const pr = await pullRequest({ title: flag(args, '--title') });
if (!pr) {
  console.error('This branch has no pull request to read a title from. Give one: node scripts/title-has-a-type.mjs --title "<title>"');
  process.exit(2);
}

console.log("A pull request's title starts with its type (docs/verification.md).");
console.log(`  the pull request: ${pr.title}   (${pr.from})`);
const { type, failures } = titled({ title: pr.title, number: pr.number, runId: process.env.GITHUB_RUN_ID });
if (failures.length === 0) {
  console.log(`It is a \`${type}\`.`);
  process.exit(0);
}
fails("A pull request's title starts with its type", failures);
process.exit(1);
