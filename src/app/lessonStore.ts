import type { TutorialStorage } from '../game/tutorial';

/** where the lessons remember how far a visitor has got: the browser's storage, or nowhere when it is blocked */
export function lessonStore(): TutorialStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}
