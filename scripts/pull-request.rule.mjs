// What a pull request's title says, and what it is held to: the rules themselves (docs/verification.md).
//
// Pure: no git, no network, no file is read. scripts/title-has-a-type.mjs and
// scripts/same-play-as-base.mjs ask GitHub for the title and the trace tool for the comparison,
// and this file decides, so the decisions can be tested case by case (tests/pullRequest.test.ts).
//
// Two rules:
//   - A title starts with a known type (AGENTS.md, Git): `type: what changes` or
//     `type(area): what changes`. Every check that treats one kind of change differently from
//     another reads the type off the title, so a title with none is asked nothing by all of them.
//   - Every pull request is compared with the branch it goes into (`npm run trace:compare`), and
//     only a feat or a fix may play differently. Every other type says of itself that nothing
//     changes for the player, and has to print `same play`.

/** the types a title may start with, and what AGENTS.md says each is */
export const TYPES = ['feat', 'fix', 'perf', 'refactor', 'test', 'docs', 'ci', 'chore'];
/** the types that may play differently from the branch they go into: a change the player notices */
export const MAY_DIFFER = ['feat', 'fix'];

const TITLE = new RegExp(`^(${TYPES.join('|')})(\\([^()\\s][^()]*\\))?!?: \\S`);

/** the type a title starts with, or null: "feat(rally): the setter calls the pass" is `feat` */
export function typeOf(title) {
  return TITLE.exec(title)?.[1] ?? null;
}

const either = (words) => words.join(', ').replace(/, ([^,]*)$/, ' or $1');

/**
 * How a failure that an edit on GitHub mends ends: with the command that runs the failed job
 * again. An edit of a title or a description starts no run (the workflow does not listen for one),
 * and the checks read both as they are when the job runs. `runId`: the run the failure is printed
 * in (`GITHUB_RUN_ID`), when there is one.
 */
export const rerunAfter = (runId, edited) => `then run \`gh run rerun ${runId || '<run id>'} --failed\`: editing ${edited} starts no run`;
/** how a failure that a commit mends ends: a push runs every job again */
const AFTER_PUSH = 'then push the commit: that runs this again';

/** a title as a shell reads it between double quotes */
const quoted = (title) => `"${title.replace(/[\\"$`]/g, '\\$&')}"`;
const edit = (number, title) => `\`gh pr edit ${number ?? '<number>'} --title ${quoted(title)}\``;

/**
 * The title with a type where one belongs. What stood before a colon becomes the area
 * ("Mini Rally: levels of play" is `<type>(mini-rally): levels of play`), unless it is a type
 * written wrong ("Feat: a new serve" is `feat: a new serve`). `type`: the type to give it, when
 * the reader is not left to choose.
 */
function retitled(title, type = '<type>') {
  const known = typeOf(title);
  if (known) return title.replace(known, type);
  const lead = /^([A-Za-z][A-Za-z0-9 ]{0,30}?)\s*:\s+(\S.*)$/.exec(title.trim());
  if (!lead) return `${type}: ${title.trim()}`;
  const area = lead[1].toLowerCase().replace(/\s+/g, '-');
  return TYPES.includes(area) ? `${type === '<type>' ? area : type}: ${lead[2]}` : `${type}(${area}): ${lead[2]}`;
}

/** the title check: `failures` is empty when the title starts with a known type */
export function titled({ title, number, runId }) {
  const type = typeOf(title);
  if (type) return { type, failures: [] };
  return {
    type,
    failures: [
      `The title "${title}" does not start with a type. ` +
        `Start it with one of ${either(TYPES)} (AGENTS.md, Git, says which is which), as in ${edit(number, retitled(title))}, ` +
        `${rerunAfter(runId, 'a title')}.`,
    ],
  };
}

/**
 * What the trace tool prints when it compares two builds (scripts/trace.mjs), as far as this file
 * reads it. The exit code alone says whether the play is the same. These only tell a difference
 * from an error, for the wording of what is said next. tests/pullRequest.test.ts fails when the
 * tool no longer prints one of them.
 */
export const PHRASES = {
  /** the first line of a difference between the two builds: in the play, in what is drawn, in what the HUD is told */
  differs: [
    ': differs by frame ',
    ': the simulation is the same, but what is drawn or shown differs',
    ': the play is the same, but the HUD is told something else',
  ],
  /** this checkout is not sound by itself: no verdict on the comparison (`npm run trace` fails on the same) */
  notSound: ['the same hands did not give the same play:', "a run with a person's keys no longer reaches what it is there to check:"],
};

/** how the comparison with the base ended: the same play, a difference, or no verdict (an error) */
export function outcomeOf({ status, output }) {
  if (status === 0) return 'same';
  const has = (phrases) => phrases.some((phrase) => output.includes(phrase));
  return has(PHRASES.differs) && !has(PHRASES.notSound) ? 'differs' : 'unfinished';
}

/**
 * Who may differ. A feat and a fix may, and nothing the comparison says fails them: what this
 * checkout has to be by itself (the same play twice, every run reaching what it is there for) is
 * `npm run trace`, which runs first. Every other type has to print `same play`.
 */
export function compared({ title, outcome, base, number, runId }) {
  const type = typeOf(title);
  const verdict = { type, note: '', failures: [] };
  const mayDiffer = MAY_DIFFER.includes(type);
  const noVerdict = `The comparison with ${base} ended without a verdict (what it printed is above)`;
  /** what the title says the change is: only a feat or a fix says the play may change */
  const says = type ? `Its title says ${type}` : 'Its title says neither feat nor fix';

  if (outcome === 'same') {
    verdict.note = mayDiffer
      ? `same play as ${base}: if it changes the play, no run of the trace reaches the change, and a run that does is the check to bring (docs/verification.md).`
      : `same play as ${base}: nothing a run of the trace plays is changed for the player.`;
  } else if (mayDiffer) {
    verdict.note =
      outcome === 'differs'
        ? `This ${type} does not play like ${base}, as a ${type} may: read the difference above against what the pull request says it changes.`
        : `${noVerdict}. A ${type} may differ from it, so this does not fail, but nothing was compared: unless the error is about something ${base} does not have yet, read it.`;
  } else if (outcome === 'unfinished') {
    verdict.failures.push(
      `${noVerdict}. ${says}, so it has to be shown to change nothing for the player, and it was not. ` +
        `Run \`npm run trace:compare\` to see it here, mend what it says, ${AFTER_PUSH}.`,
    );
  } else {
    verdict.failures.push(
      `${says}, so it is meant to change nothing for the player, and it does not play like ${base}: the first difference is printed above. ` +
        `Find what changed the play and take it out, so that this prints \`same play\`, ${AFTER_PUSH}. ` +
        `Or, if the play is meant to change, it is a feat or a fix: retitle it with ${edit(number, retitled(title, 'feat'))} (or \`fix\`), ` +
        `bring the check the check job then asks for, and ${rerunAfter(runId, 'a title')}.`,
    );
  }
  return verdict;
}
