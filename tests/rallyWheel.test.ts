import { describe, expect, it } from 'vitest';
import { MiniRally } from '../src/game/modes/miniRally';
import { SetterCalls } from '../src/game/setterCalls';

/** the Mini Rally's own rules for the play wheel, you the setter, in `phase` */
function asSetter(phase: 'dead' | 'prepare' | 'serve' | 'live') {
  const m = Object.create(MiniRally.prototype) as MiniRally;
  const calls = new SetterCalls();
  Object.assign(m, { g: { autoUser: false, settings: { keepSetPick: false } }, position: 'S', setterCalls: calls, phase });
  return { m, calls };
}

describe('the setter calls the next play from the end of a point until our pass (Mini Rally)', () => {
  it('the wheel opens while the banner shows, before the serve, while the server serves, and in the rally', () => {
    for (const phase of ['dead', 'prepare', 'serve', 'live'] as const) expect(asSetter(phase).m.playCalls(), phase).not.toBeNull();
  });

  it('once our pass is played the calls are locked and the wheel closes, until the next ball', () => {
    const { m, calls } = asSetter('live');
    calls.lock();
    expect(m.playCalls()).toBeNull();
    calls.nextBall();
    expect(m.playCalls()).not.toBeNull();
  });

  it('the game never slows for the wheel: before the serve the server waits, in a rally only your set slows it', () => {
    expect(asSetter('live').m.wheelSlows()).toBe(false);
  });

  it('a hitter has no wheel (their C is the route panel)', () => {
    const { m } = asSetter('prepare');
    Object.assign(m, { position: 'OH' });
    expect(m.playCalls()).toBeNull();
  });
});
