// The types of scripts/red-on-base.mjs, for the unit test that holds how it waits
// (tests/redOnBase.test.ts). The script is plain JavaScript so that CI can run it with node alone.

/** what one changed test file did on the base branch's code */
export interface OnBase {
  file: string;
  /** it fails there, cannot run there or did not end there: it shows the change */
  red: boolean;
  /** how many of its tests fail there, of how many */
  failed: number;
  total: number;
  /** the first failure, in a line */
  first: string;
  /** false: it had not ended at the limit, and was stopped */
  ended?: boolean;
  /** false: it was not run, because `MOST_NOT_ENDED` files before it did not end */
  tried?: boolean;
  /** how long it was waited for, when it did not end or was not tried */
  limitMs?: number;
}

/** how long a run of the changed tests may take on the base before it is stopped */
export const RUN_LIMIT_MS: number;
/** how long one test may take there before Vitest fails it */
export const TEST_LIMIT_MS: number;
/** after this many files that did not end, the rest are not tried */
export const MOST_NOT_ENDED: number;

/**
 * Runs node with these arguments and waits no longer than `limitMs`. When the time is up, the
 * child and every process it started are stopped, and `ended` is false.
 */
export function runNode(
  args: readonly string[],
  options: { limitMs: number; cwd?: string },
): Promise<{ ended: boolean; status: number | null; stdout: string; stderr: string }>;

/**
 * The verdict on each file, from a way to run some of them together: `run` gives one entry a
 * file, or null when the run did not end. All of them are run together first. If that does not
 * end, each is run alone, to find the one that does not.
 */
export function eachFile(
  files: readonly string[],
  run: (files: readonly string[]) => Promise<OnBase[] | null>,
  limitMs: number,
): Promise<OnBase[]>;

/** one line a file, as a reader says it */
export function reportOf(results: readonly OnBase[], base: string): string[];
