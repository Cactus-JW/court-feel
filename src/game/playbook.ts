import { PLAYBOOK } from '../config';
import { comboPlay, COMBOS, type Combo } from './combos';
import { SETTER_PLAYS, SETTER_TARGET, type SetPlay } from './plays';
import { SETTER_KEYS, type SetterKey } from './setterCalls';

/**
 * Your own plays (start screen, Plays). A play gives every hitter one of their sets (the same
 * ones their key steps through on court: where they run from, where they hit and how fast the
 * set is all come with the set). A saved play takes a place on the play wheel instead of the
 * built-in one there. Two front-row hitters can't be sent to the same spot at the net: they
 * would run into each other.
 */
export interface SavedPlay {
  name: string;
  /** each hitter's set, by its short name (SETTER_PLAYS) */
  calls: Record<SetterKey, string>;
}

/** one entry per place on the wheel: your play there, or null for the built-in one */
export type Playbook = (SavedPlay | null)[];

/** the hitters who meet the ball at the net (the pipe is hit 2 m off it, behind them) */
const FRONT: readonly SetterKey[] = ['OH', 'MB', 'OPP'];

/** where along the net a set is hit (a quick: `inFront` of where the setter takes the pass) */
export function hitX(play: SetPlay): number {
  return play.inFront !== undefined ? SETTER_TARGET.x - play.inFront : play.lane.x;
}

/**
 * Would `k` hitting `short` end up on the same spot as another front-row hitter in `calls`
 * (within PLAYBOOK.minGap m along the net)? Returns that hitter, or null when there is room.
 */
export function clashWith(calls: Record<SetterKey, string>, k: SetterKey, short: string): SetterKey | null {
  const mine = SETTER_PLAYS[k].find((p) => p.short === short);
  if (!mine || !FRONT.includes(k)) return null;
  for (const o of FRONT) {
    const theirs = o === k ? undefined : SETTER_PLAYS[o].find((p) => p.short === calls[o]);
    if (theirs && Math.abs(hitX(mine) - hitX(theirs)) < PLAYBOOK.minGap) return o;
  }
  return null;
}

/** do two hitters in these calls hit from the same spot? */
export function clashes(calls: Record<SetterKey, string>): boolean {
  return FRONT.some((k) => clashWith(calls, k, calls[k]) !== null);
}

/** every hitter's set in a play on the wheel (to start a new play from it) */
export function callsOf(c: Combo): Record<SetterKey, string> {
  const out = {} as Record<SetterKey, string>;
  for (const k of SETTER_KEYS) out[k] = (comboPlay(c, k) ?? SETTER_PLAYS[k][0]).short;
  return out;
}

/** a saved play as the wheel calls it */
export function toCombo(p: SavedPlay): Combo {
  return { name: p.name, idea: 'Your play', calls: { ...p.calls } };
}

/** a play's name as typed: trimmed, one line, at most PLAYBOOK.nameMax characters ('' when nothing is left) */
export function cleanName(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, PLAYBOOK.nameMax) : '';
}

function sanitizePlay(raw: unknown): SavedPlay | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as { name?: unknown; calls?: Record<string, unknown> };
  const name = cleanName(src.name);
  const from = src.calls;
  if (!name || !from || typeof from !== 'object') return null;
  const calls = {} as Record<SetterKey, string>;
  // a set the hitter does not have (another build's): their first one
  for (const k of SETTER_KEYS) calls[k] = (SETTER_PLAYS[k].find((p) => p.short === from[k]) ?? SETTER_PLAYS[k][0]).short;
  return clashes(calls) ? null : { name, calls };
}

/**
 * Stored plays are untrusted (another build, or storage edited by hand): one entry per place on
 * the wheel; a play with no name, or with two hitters on the same spot, is dropped.
 */
export function sanitizePlaybook(raw: unknown): Playbook {
  const src = Array.isArray(raw) ? raw : [];
  return COMBOS.map((_, i) => sanitizePlay(src[i]));
}

const KEY = 'courtfeel.plays.v1';
let book: Playbook | null = null;
let wheel: readonly Combo[] | null = null;

/** your saved plays, by place on the wheel */
export function playbook(): Playbook {
  if (book) return book;
  try {
    const raw = localStorage.getItem(KEY);
    book = sanitizePlaybook(raw ? JSON.parse(raw) : null);
  } catch {
    /* private mode / blocked storage / unparseable JSON: no saved plays */
    book = sanitizePlaybook(null);
  }
  return book;
}

/** save `play` to a place on the wheel (null: the built-in play is back). False: it is not a play that can be saved. */
export function savePlay(slot: number, play: SavedPlay | null): boolean {
  const b = playbook();
  const clean = play && sanitizePlay(play);
  if (slot < 0 || slot >= b.length || (play && !clean)) return false;
  b[slot] = clean;
  wheel = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* ignore: the play stays for this visit */
  }
  return true;
}

/** the plays on the wheel, clockwise from the top: yours where you saved one, else the built-in ones */
export function wheelPlays(): readonly Combo[] {
  return (wheel ??= playbook().map((p, i) => (p ? toCombo(p) : COMBOS[i])));
}
