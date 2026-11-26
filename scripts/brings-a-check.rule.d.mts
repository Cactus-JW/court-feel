// The types of scripts/brings-a-check.rule.mjs, for the unit test that holds it
// (tests/bringsACheck.test.ts). The script is plain JavaScript so that CI can run it with node alone.

/** `play`: what happens on the court. `shown`: what the player sees and hears of it. `null`: neither. */
export type Tier = 'play' | 'shown' | null;

/** what the gate is told about a pull request */
export interface Change {
  /** the pull request's title */
  title: string;
  /**
   * Every path that changed, added and deleted ones too. A file that is judged by section
   * (`SECTIONED`) is given once for each section that changed, as `src/config.ts#AI`.
   */
  paths: readonly string[];
  /** the ones of `paths` that the change deletes: they still touch a tier, and are no check */
  removed?: readonly string[];
  /** the changed test files that fail on the base branch's code (scripts/red-on-base.mjs) */
  redOnBase?: readonly string[];
  /** the pull request's description, as written (markdown) */
  body: string | null;
}

export interface Verdict {
  /** whether the gate reads this title: a feat or a fix */
  gated: boolean;
  /** the stricter tier the change touches */
  tier: Tier;
  /** the changed paths in that tier */
  touched: string[];
  /** what satisfied the rule, when something did */
  heldBy: string[];
  /** the reasons given on `Unchecked:` lines under "What no check holds" */
  unchecked: string[];
  /** said, and not failed */
  notes: string[];
  /** why it fails: each says what to do next. Empty means it passes */
  failures: string[];
}

export const GATED: readonly string[];
export const SECTIONS: readonly string[];
export const CONFIG_SHOWN: readonly string[];
export const TIERS: readonly (readonly [string, Tier])[];
export const CHECKS: Readonly<Record<'test' | 'trace' | 'e2e' | 'feature', readonly string[]>>;
/** the files that are judged by section: a changed one is given to the gate as `path#SECTION` */
export const SECTIONED: readonly string[];

export function tierOf(path: string): Tier;
/** the names of the sections whose text differs between two versions of a file (null: no such file) */
export function changedSections(before: string | null, after: string | null): string[];
/** the changed test files among these paths, the ones red-on-base is asked about */
export function changedTests(paths: readonly string[], removed?: readonly string[]): string[];
/** whether the verdict on this change depends on which of its tests are red on the base */
export function asksRedOnBase(change: Pick<Change, 'title' | 'paths' | 'removed'>): boolean;
export function decide(change: Change): Verdict;
