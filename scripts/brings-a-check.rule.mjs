// A change to the play brings a check, or says why not: the rule itself (docs/verification.md).
//
// Pure: no git, no network, no file is read. scripts/brings-a-check.mjs asks git and GitHub what a
// pull request is, and this file decides. So the decision can be tested case by case
// (tests/bringsACheck.test.ts), and the tables below are the one place that says which file is what.
//
// The rule, for a pull request whose title starts with `feat` or `fix`:
//   - its description has the sections "How it is held" and "What no check holds", each with more
//     in it than the template's comment;
//   - it touches the play: a changed test that fails on the base branch's code, or a change to the
//     trace's runs, or a line `Unchecked: <reason>` under "What no check holds";
//   - it touches only what is shown and heard: a changed test, end-to-end check or
//     verify-court-feel feature file (or a trace run), or the same line.
// Any other title is asked nothing here.

// What a title's type is, and how a failure says to run the run again, are the same for every rule
// that reads a pull request (scripts/pull-request.rule.mjs, as pure as this file).
import { rerunAfter, typeOf } from './pull-request.rule.mjs';

/** the titles the gate reads: a change the player notices (AGENTS.md, Git) */
export const GATED = ['feat', 'fix'];

/** the sections a gated description must have, as headings (.github/pull_request_template.md) */
export const SECTIONS = ['How it is held', 'What no check holds'];
const HELD = SECTIONS[0];
const NOT_HELD = SECTIONS[1];

/**
 * The files of config that are what is shown and heard: the display's two and the app's
 * (`src/config/index.ts` says which file is whose). Every other file of `src/config/` is the play,
 * by the last line of `TIERS`, so a new file is held to the stricter rule until it is listed here.
 * So is the index.
 */
export const CONFIG_SHOWN = ['src/config/display.ts', 'src/config/venues.ts', 'src/config/app.ts'];

/**
 * Which tier a changed path is in. The first match wins. `play`: what happens on the court.
 * `shown`: what the player sees and hears of it. `null`: neither, and so is a path no line matches
 * (tests, scripts, docs, the agent files).
 *
 * A pattern that ends in `/` is a folder, `*` stands for anything, and anything else is one file.
 * `file#SECTION` is one top-level declaration of a file that is judged by section (the trace tool).
 */
export const TIERS = [
  // the autopilots stand in for a player: a change there changes what the trace plays, not the game
  ['src/app/bot.ts', null],
  ['src/env.d.ts', null],

  // the rest of config is the play: the last line of this table takes it
  ...CONFIG_SHOWN.map((path) => [path, 'shown']),

  ['src/physics/', 'play'],
  ['src/game/', 'play'],
  ['src/ai/', 'play'],
  ['src/core/input.ts', 'play'],
  ['src/core/touchPad.ts', 'play'],
  // the slow motion bends the clock the play runs on
  ['src/app/pace.ts', 'play'],

  ['src/ui/', 'shown'],
  ['src/fx/', 'shown'],
  ['src/audio/', 'shown'],
  ['src/camera/', 'shown'],
  ['src/world/', 'shown'],
  ['src/character/', 'shown'],
  ['src/app/', 'shown'],
  ['src/main.ts', 'shown'],
  ['index.html', 'shown'],
  ['public/', 'shown'],
  // the build's name, the error reporter and the key caps the menus draw
  ['src/core/build.ts', 'shown'],
  ['src/core/errors.ts', 'shown'],
  ['src/core/kbd.ts', 'shown'],

  // whatever else is under src/, a new folder too, is the play until it has a line of its own
  ['src/', 'play'],
];

/**
 * What counts as a check, by kind. A deleted file is never one.
 * The trace's runs are three lists in the trace tool today. When they become a file of their own
 * (`scripts/trace.runs.json`), that file's name goes here in their place.
 */
export const CHECKS = {
  test: ['tests/*.test.ts'],
  trace: ['scripts/trace.mjs#RUNS', 'scripts/trace.mjs#LESSONS', 'scripts/trace.mjs#KEY_RUNS'],
  e2e: ['scripts/e2e.mjs'],
  feature: ['.agents/skills/verify-court-feel/features/'],
};

/** the files that are judged by section: a changed one is given to the gate as `path#SECTION` */
export const SECTIONED = [
  ...new Set(
    [...TIERS.map(([pattern]) => pattern), ...Object.values(CHECKS).flat()]
      .filter((pattern) => pattern.includes('#'))
      .map((pattern) => pattern.split('#')[0]),
  ),
];

const matches = (pattern, path) => {
  if (pattern.endsWith('/')) return path.startsWith(pattern);
  if (!pattern.includes('*')) return path === pattern;
  const literal = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${literal.join('.*')}$`).test(path);
};

export function tierOf(path) {
  return TIERS.find(([pattern]) => matches(pattern, path))?.[1] ?? null;
}

const isCheck = (kind, path) => CHECKS[kind].some((pattern) => matches(pattern, path));

/** the changed test files among these paths, the ones red-on-base is asked about */
export function changedTests(paths, removed = []) {
  return paths.filter((path) => isCheck('test', path) && !removed.includes(path));
}

// ---- a file that is judged by section

const DECLARATION =
  /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;
const COMMENT = /^\s*(?:\/\/|\/\*|\*)/;

/** the text of each top-level declaration of a file, with the comment that stands over it; `(top)` is what comes before the first */
function sections(text) {
  const out = new Map();
  if (text === null) return out;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const starts = [];
  lines.forEach((line, i) => {
    const name = DECLARATION.exec(line)?.[1];
    if (!name) return;
    let start = i;
    while (start > 0 && COMMENT.test(lines[start - 1])) start--;
    starts.push([name, start]);
  });
  const add = (name, from, to) => {
    const part = lines.slice(from, to).join('\n').trimEnd();
    if (part.trim() !== '') out.set(name, out.has(name) ? `${out.get(name)}\n${part}` : part);
  };
  add('(top)', 0, starts[0]?.[1] ?? lines.length);
  starts.forEach(([name, from], k) => add(name, from, starts[k + 1]?.[1] ?? lines.length));
  return out;
}

/** the names of the sections whose text differs between two versions of a file (null: no such file) */
export function changedSections(before, after) {
  const was = sections(before);
  const now = sections(after);
  return [...new Set([...now.keys(), ...was.keys()])].filter((name) => was.get(name) !== now.get(name));
}

// ---- the description

const UNCHECKED = /^\s*(?:[-*+]\s+)?[*_]*Unchecked:[*_]*\s*(.*?)\s*$/i;

/**
 * The description's sections by heading (lower case), with the comments taken out, and its
 * `Unchecked:` lines. A section runs to the next heading of its own level or a higher one, so what
 * stands under a subheading is in the section too ("## How it is held", then "### Unit tests").
 */
function described(body) {
  const text = (body ?? '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const held = new Map();
  /** reasons given under "What no check holds" */
  const unchecked = [];
  /** whether an `Unchecked:` line with a reason stands anywhere else */
  let stray = false;
  /** the headings a line stands under, outermost first: `[level, name]` */
  let open = [];
  for (const line of text.split('\n')) {
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      const name = h[2].toLowerCase();
      // a heading ends every section of its own level or lower
      open = [...open.filter(([above]) => above < level), [level, name]];
      if (!held.has(name)) held.set(name, '');
      continue;
    }
    for (const [, name] of open) held.set(name, `${held.get(name)}${line}\n`);
    const reason = UNCHECKED.exec(line)?.[1];
    // `Unchecked: <reason>` is the template's own placeholder, not a reason
    if (!reason || /^<[^>]*>$/.test(reason)) continue;
    if (open.some(([, name]) => name === NOT_HELD.toLowerCase())) unchecked.push(reason);
    else stray = true;
  }
  return { held, unchecked, stray };
}

// ---- the decision

/**
 * How a failure ends: with the way to have the gate look again, which depends on what mends it.
 * A new test or trace run is a commit, and the push runs every job again. An edit to the description
 * starts no run (the workflow does not listen for one), so the run has to be run again by hand: the
 * command is given, with the id of the run the failure is printed in when there is one. It is the
 * command for the whole run, because whoever retitles the pull request on the way needs every job
 * to read the new title (scripts/pull-request.rule.mjs, `rerunAfter`).
 */
const AFTER_PUSH = 'then push the commit: that runs this again';
const afterEdit = (runId) => rerunAfter(runId, 'a description');
const SAY_WHY = `write a line "Unchecked: <why no check can hold it>" under "## ${NOT_HELD}" in the description`;
const sentence = (text) => `${text[0].toUpperCase()}${text.slice(1)}.`;

/** `scripts/trace.mjs#RUNS` as a reader says it */
const said = (path) => path.replace(/#(.*)$/, ' ($1)');
const listed = (paths, most = 4) =>
  paths.slice(0, most).map(said).join(', ') + (paths.length > most ? ` and ${paths.length - most} more` : '');
/** where a kind of check lives, in words: "RUNS, LESSONS or KEY_RUNS in scripts/trace.mjs" */
function where(kind) {
  const byFile = new Map();
  for (const pattern of CHECKS[kind]) {
    const [file, section] = pattern.split('#');
    byFile.set(file, [...(byFile.get(file) ?? []), ...(section ? [section] : [])]);
  }
  return [...byFile]
    .map(([file, names]) => (names.length ? `${names.join(', ').replace(/, ([^,]*)$/, ' or $1')} in ${file}` : file))
    .join(', ');
}

const SECTION_ASKS = {
  [HELD]: 'say, for each behaviour this change adds or alters, which check holds it',
  [NOT_HELD]: 'list what a person has to try, one line each, or write "Nothing" when every behaviour is held',
};

/** whether the verdict on this change depends on which of its tests are red on the base */
export function asksRedOnBase({ title, paths, removed = [] }) {
  return GATED.includes(typeOf(title)) && paths.some((path) => tierOf(path) === 'play') && changedTests(paths, removed).length > 0;
}

export function decide({ title, paths, removed = [], redOnBase = [], body, runId }) {
  const verdict = { gated: false, tier: null, touched: [], heldBy: [], unchecked: [], notes: [], failures: [] };
  const type = typeOf(title);
  if (!GATED.includes(type)) {
    verdict.notes.push(
      type
        ? `Its title is a \`${type}\`: this rule reads a feat and a fix, and asks nothing of it.`
        : `The title does not start with feat or fix (nor with another type AGENTS.md lists), so nothing is asked of it here. If it changes or adds something a player can feel, it is a feat or a fix.`,
    );
    return verdict;
  }
  verdict.gated = true;
  const { held, unchecked, stray } = described(body);
  verdict.unchecked = unchecked;
  /** the ending of a failure that only an edit to the description mends */
  const rerun = sentence(afterEdit(runId));

  // ---- the description says how the change is held
  for (const section of SECTIONS) {
    const text = held.get(section.toLowerCase());
    if (text === undefined)
      verdict.failures.push(
        `The description has no "## ${section}" section. Add it from .github/pull_request_template.md and ${SECTION_ASKS[section]}. ${rerun}`,
      );
    else if (text.trim() === '')
      verdict.failures.push(`"## ${section}" still holds only its placeholder comment. In its place, ${SECTION_ASKS[section]}. ${rerun}`);
  }

  // ---- the change brings a check, or says why not
  const play = paths.filter((path) => tierOf(path) === 'play');
  const shown = paths.filter((path) => tierOf(path) === 'shown');
  verdict.tier = play.length ? 'play' : shown.length ? 'shown' : null;
  if (verdict.tier === null) {
    verdict.notes.push('It touches neither the play nor what is shown and heard, so it is asked for no check.');
    return verdict;
  }
  verdict.touched = verdict.tier === 'play' ? play : shown;

  const present = paths.filter((path) => !removed.includes(path));
  const tests = changedTests(paths, removed);
  const red = tests.filter((path) => redOnBase.includes(path));
  const runs = present.filter((path) => isCheck('trace', path));
  if (verdict.tier === 'play') {
    // red: it fails there, cannot run there or does not end there (scripts/red-on-base.mjs says which)
    if (red.length) verdict.heldBy.push(`${listed(red)} ${red.length > 1 ? 'are' : 'is'} red on the base branch's code`);
  } else {
    const checks = [...tests, ...present.filter((path) => isCheck('e2e', path) || isCheck('feature', path))];
    if (checks.length) verdict.heldBy.push(`a check changed with it: ${listed(checks)}`);
  }
  if (runs.length) verdict.heldBy.push(`the trace's runs changed: ${listed(runs)}`);
  if (unchecked.length)
    verdict.heldBy.push(`the description says why no check holds it: ${unchecked.map((reason) => `"${reason}"`).join(', ')}`);
  if (verdict.heldBy.length) return verdict;

  const moveIt = `There is an "Unchecked:" line in the description, but not where it is looked for: move it under "## ${NOT_HELD}".`;
  /** the way out that is a commit, and then the one that is a line in the description: each ends with how the gate looks again */
  const ways = (commit) => `${sentence(`${commit}, ${AFTER_PUSH}`)} ${sentence(`or ${SAY_WHY}, ${afterEdit(runId)}`)}`;
  if (verdict.tier === 'play') {
    const what = `This ${type} changes the play (${listed(play)})`;
    const orARun = `or add a run to the trace (${where('trace')})`;
    verdict.failures.push(
      stray
        ? `${what} and brings no check. ${moveIt} ${rerun}`
        : tests.length
          ? `${what} and its changed tests (${listed(tests)}) pass on the base branch's code too, so none of them shows the change. ` +
            ways(
              `make one state the new fact so that it fails there (\`node scripts/red-on-base.mjs origin/main\` says which do), ${orARun}`,
            )
          : `${what} and brings no check. ${ways(`add or change a test in tests/ that fails on the base branch's code, ${orARun}`)}`,
    );
  } else {
    const what = `This ${type} changes what the player sees and hears (${listed(shown)}) and brings no check.`;
    verdict.failures.push(
      stray
        ? `${what} ${moveIt} ${rerun}`
        : `${what} ${ways(`add or change a test in tests/, a check in ${where('e2e')} or a feature file in ${where('feature')}`)}`,
    );
  }
  return verdict;
}
