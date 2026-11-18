// A change is judged by rules it did not write: `node scripts/rules-from-base.mjs <ref>`.
//
// CI runs this on every pull request with the branch it is going into. It does two things:
//   1. runs the architecture test as it is on <ref> (its rules, its scan, its layer table) against
//      this checkout's code. A pull request that loosens the test still has to pass the old one.
//      (`npm test` runs this checkout's own version too, so a new rule applies as well.)
//   2. compares the known lists (tests/architecture.known.ts) with <ref>'s. A list with an entry
//      that is new here fails, unless the list ends up shorter than it was: a refactor that moves
//      a breach nearer to where it ends (22 imports by one file become 8 files importing that
//      file) puts new entries in and takes more out. ALLOW_KNOWN_GROWTH=1 lets any growth through
//      (CI sets it from the `known-list-may-grow` label, for a pull request that was open before
//      a rule existed). A list <ref> does not have yet belongs to a rule that is new here.
//
// The files are swapped in place and always put back, so it can be run locally. Exit code 1 on a
// failed rule or a grown list.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.argv[2];
if (!ref) {
  console.error('usage: node scripts/rules-from-base.mjs <ref>   (for example origin/main)');
  process.exit(2);
}

/** the rules: everything the architecture test is made of, except the known lists */
const RULES = ['tests/architecture.test.ts', 'tests/architecture.scan.ts', 'tests/architecture.layers.json'];
const KNOWN = 'tests/architecture.known.ts';

/** a file as it is on <ref>, or null when <ref> does not have it */
function atRef(file) {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/** the entries of every `KNOWN_*` list in the text of a known-list file */
function lists(text) {
  const out = new Map();
  for (const m of text.matchAll(/export const (KNOWN_[A-Z_]+)[^=]*=\s*\[([\s\S]*?)\];/g)) {
    out.set(m[1], new Set([...m[2].matchAll(/'([^']+)'/g)].map((e) => e[1])));
  }
  return out;
}

let failed = false;

// ---- 1. the rules as they are on <ref>
const base = RULES.map((file) => [file, atRef(file)]);
if (base.every(([, text]) => text === null)) {
  console.log(`${ref} has no architecture test yet: nothing to run`);
} else {
  const mine = RULES.map((file) => [file, fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : null]);
  const put = (files) => {
    for (const [file, text] of files) {
      if (text === null) fs.rmSync(path.join(root, file), { force: true });
      else fs.writeFileSync(path.join(root, file), text);
    }
  };
  try {
    put(base);
    console.log(`the architecture rules as they are on ${ref}, against this checkout's code:`);
    const run = spawnSync('npx', ['vitest', 'run', 'tests/architecture.test.ts'], { cwd: root, stdio: 'inherit' });
    if (run.status !== 0) failed = true;
  } finally {
    put(mine);
  }
}

// ---- 2. the known lists only get shorter
const before = atRef(KNOWN);
if (before !== null) {
  const was = lists(before);
  const now = lists(fs.readFileSync(path.join(root, KNOWN), 'utf8'));
  const grown = [];
  for (const [name, entries] of now) {
    const old = was.get(name);
    if (!old) continue;
    const added = [...entries].filter((e) => !old.has(e));
    if (added.length === 0) continue;
    if (entries.size < old.size) {
      console.log(
        `${name} has ${added.length} new entries and is shorter all the same (${old.size} to ${entries.size}): a breach moved\n  ${added.join('\n  ')}`,
      );
      continue;
    }
    for (const e of added) grown.push(`${name}: ${e}`);
  }
  if (grown.length === 0) console.log(`no known list is longer than on ${ref}`);
  else if (process.env.ALLOW_KNOWN_GROWTH === '1')
    console.log(`the known lists grew by ${grown.length}, allowed for this pull request:\n  ${grown.join('\n  ')}`);
  else {
    console.error(
      `the known lists grew by ${grown.length}:\n  ${grown.join('\n  ')}\n` +
        'Fix the code instead of listing it. A pull request that was open before the rule existed takes the `known-list-may-grow` label.',
    );
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
