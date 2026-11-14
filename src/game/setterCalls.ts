import { SET_PLAYS, type SetPlay } from './plays';

/** the hitters a setter can pick, in key order: 1 outside, 2 middle, 3 opposite, 4 pipe */
export type SetterKey = 'OH' | 'MB' | 'OPP' | 'PIPE';
export const SETTER_KEYS: readonly SetterKey[] = ['OH', 'MB', 'OPP', 'PIPE'];
type CallKey = 'OH' | 'MB' | 'OPP';

/** with no key pressed the set goes to the outside: the ball every setter gives when nothing else is on */
export const DEFAULT_PICK: SetterKey = 'OH';

/**
 * The user setter's picks and calls (keys, through Input like every other control).
 * - 1-4 pick the hitter you set; no key, it is the outside (never where you look: a setter
 *   watches the ball).
 * - Pressing the picked hitter again steps to their next set. Before the pass that is their next
 *   call (the same SET_PLAYS hitters call for themselves): tempo is agreed before the pass
 *   because the hitter's run depends on it. Once the pass is played the calls are locked, and
 *   the only late change a hitter can still take is a higher ball: the press asks for a high
 *   ball (again: back to the call).
 */
export class SetterCalls {
  pick: SetterKey | null = null;
  /** the pass is on its way: tempos are locked */
  locked = false;
  /** the hitters run your calls (false for a backup's set: every ball goes up high, the keys only pick) */
  canCall = true;
  private call: Record<CallKey, number> = { OH: 0, MB: 0, OPP: 0 };
  private high = new Set<SetterKey>();

  press(k: SetterKey): void {
    if (this.pick !== k) {
      this.pick = k;
      return;
    }
    if (!this.locked && this.canCall && k !== 'PIPE') {
      this.call[k] = (this.call[k] + 1) % (SET_PLAYS[k]?.length ?? 1);
      return;
    }
    if (this.high.has(k)) this.high.delete(k);
    else this.high.add(k);
  }

  /** keys pressed since the last step: Digit1 outside ... Digit4 pipe */
  readKeys(input: { consumePress(code: string): boolean }): void {
    SETTER_KEYS.forEach((k, i) => {
      if (input.consumePress('Digit' + (i + 1))) this.press(k);
    });
  }

  /** the pass is played: lock the tempos */
  lock(): void {
    this.locked = true;
  }

  /** after the set (or a new rep): a fresh pick, unlocked; the calls stay until you change them */
  nextBall(): void {
    this.pick = null;
    this.locked = false;
    this.high.clear();
  }

  /** the hitter the set goes to: your pick, else the outside */
  target(): SetterKey {
    return this.pick ?? DEFAULT_PICK;
  }

  /** the call a hitter runs */
  play(k: CallKey): SetPlay {
    const plays = SET_PLAYS[k]!;
    return plays[this.call[k] % plays.length];
  }

  /** which of a hitter's calls is on, and how many they have (the pipe has the one) */
  step(k: SetterKey): { i: number; n: number } {
    return k === 'PIPE' ? { i: 0, n: 1 } : { i: this.call[k], n: SET_PLAYS[k]!.length };
  }

  /** asked for a high ball */
  isHigh(k: SetterKey): boolean {
    return this.high.has(k);
  }

  /** the call as shown on screen: "Go", "1", "Back", "Pipe" (or "High" when asked for one) */
  label(k: SetterKey): string {
    if (this.high.has(k)) return 'High';
    return k === 'PIPE' ? 'Pipe' : this.play(k).short;
  }
}
