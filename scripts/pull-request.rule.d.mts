// The types of scripts/pull-request.rule.mjs, for the unit test that holds it
// (tests/pullRequest.test.ts). The script is plain JavaScript so that CI can run it with node alone.

/** the types a title may start with (AGENTS.md, Git) */
export const TYPES: readonly string[];
/** the types that may play differently from the branch they go into: a change the player notices */
export const MAY_DIFFER: readonly string[];
/** what the trace tool prints that says two builds differ, and that this checkout is not sound by itself */
export const PHRASES: { readonly differs: readonly string[]; readonly notSound: readonly string[] };

/** the type a title starts with, or null: "feat(rally): the setter calls the pass" is `feat` */
export function typeOf(title: string): string | null;
/** how a failure that an edit on GitHub mends ends: the command that runs the failed job again */
export function rerunAfter(runId: string | undefined, edited: string): string;

/** what the two rules are told about a pull request */
export interface Asked {
  title: string;
  /** the pull request's number, for the command that retitles it */
  number?: number;
  /** the id of the CI run this is decided in (`GITHUB_RUN_ID`) */
  runId?: string;
}

/** the title check: `failures` is empty when the title starts with a known type */
export function titled(asked: Asked): { type: string | null; failures: string[] };

/** how the comparison with the base ended: the same play, a difference, or no verdict (an error) */
export type Outcome = 'same' | 'differs' | 'unfinished';
/** reads the outcome off the trace tool's exit code and what it printed */
export function outcomeOf(run: { status: number | null; output: string }): Outcome;

export interface Compared {
  type: string | null;
  /** said after the tool's own output, when it passes */
  note: string;
  /** why it fails: each says what to do next. Empty means it passes */
  failures: string[];
}
/** who may differ: `base` is how the commit it was compared with is named */
export function compared(asked: Asked & { outcome: Outcome; base: string }): Compared;
