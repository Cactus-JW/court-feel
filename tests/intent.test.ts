import { describe, expect, it } from 'vitest';
import { SIM } from '../src/config';
import { Athlete } from '../src/game/athlete';
import { copyIntent, readIntent, type Hands, type Intent, type Look } from '../src/game/intent';
import { UserController } from '../src/game/userController';

// A player's hands reach the simulation as an intent: plain data, one a frame. What is tested
// here is that it says everything the keys said, so a recording of it plays the same athlete.

const DT = 1 / SIM.hz;
/** keys with no page behind them: pressed with down() and up(), as the touch pad and the autopilots press them */
class Keys implements Hands {
  private held = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  readonly stick = { active: false, x: 0, y: 0, sprint: false };
  down(c: string): void {
    if (this.held.has(c)) return;
    this.held.add(c);
    this.pressed.add(c);
  }
  up(c: string): void {
    if (!this.held.delete(c)) return;
    this.released.add(c);
  }
  isDown = (c: string): boolean => this.held.has(c);
  consumePress = (c: string): boolean => this.pressed.delete(c);
  consumeRelease = (c: string): boolean => this.released.delete(c);
}
const hands = (): Keys => new Keys();
const look = (yaw: number, pitch = 0, mode = 'tp'): Look => ({ yaw, pitch, mode });

describe("a player's intent", () => {
  it('moves forward to where the player looks: W towards the net at yaw 0, along -x after a quarter turn left', () => {
    const input = hands();
    input.down('KeyW');
    const ahead = readIntent(input, look(0));
    expect(ahead.moveZ).toBeCloseTo(-1, 12);
    expect(ahead.moveX).toBeCloseTo(0, 12);
    const turned = readIntent(input, look(Math.PI / 2));
    expect(turned.moveX).toBeCloseTo(-1, 12);
    expect(turned.moveZ).toBeCloseTo(0, 12);
  });

  it('is no faster on a diagonal than straight', () => {
    const input = hands();
    input.down('KeyW');
    input.down('KeyD');
    const i = readIntent(input, look(0.3));
    expect(Math.hypot(i.moveX, i.moveZ)).toBeCloseTo(1, 12);
  });

  it('says the player is steering while a move key is down, even when two of them cancel out', () => {
    const input = hands();
    expect(readIntent(input, look(0)).steering).toBe(false);
    input.down('KeyW');
    input.down('KeyS');
    const i = readIntent(input, look(0));
    expect(Math.hypot(i.moveX, i.moveZ)).toBe(0);
    expect(i.steering).toBe(true);
  });

  it('lets the game help a person’s feet onto a set: only an autopilot says otherwise', () => {
    expect(readIntent(hands(), look(0)).helped).toBe(true);
  });

  it('sees a press once, a hold for as long as it lasts, and a release once', () => {
    const input = hands();
    input.down('Mouse0');
    const first = readIntent(input, look(0));
    expect(first.pressed).toEqual(['attack']);
    expect(first.held).toEqual(['attack']);
    const second = readIntent(input, look(0));
    expect(second.pressed).toEqual([]);
    expect(second.held).toEqual(['attack']);
    input.up('Mouse0');
    const third = readIntent(input, look(0));
    expect(third.released).toEqual(['attack']);
    expect(third.held).toEqual([]);
    expect(readIntent(input, look(0)).released).toEqual([]);
  });

  it('holds block and set on the one button: the ball decides which it is', () => {
    const input = hands();
    input.down('Mouse2');
    const i = readIntent(input, look(0));
    expect(i.pressed).toEqual(['block']);
    expect(i.held).toEqual(['block', 'set']);
  });

  it('carries where the player looks, and whether it is through the athlete’s own eyes', () => {
    const i = readIntent(hands(), look(0.4, -0.2, 'fp'));
    expect(i.yaw).toBe(0.4);
    expect(i.pitch).toBe(-0.2);
    expect(i.firstPerson).toBe(true);
    expect(readIntent(hands(), look(0.4, -0.2, 'tp')).firstPerson).toBe(false);
  });

  it('is all the controller needs: a recording of it plays the same athlete as the live keys did', () => {
    const live = new Athlete('OH', 1);
    live.place(0, 8, 0);
    const input = hands();
    const controller = new UserController();
    controller.athlete = live;
    controller.handlers.jump = () => live.jumpPress();
    controller.releaseHandlers.jump = () => live.jumpRelease();
    const log: Intent[] = [];
    const path: number[] = [];
    let t = 0;
    for (let f = 0; f < SIM.hz * 3; f++) {
      // an approach: run in, then jump, turning a little the whole way
      if (f === 10) input.down('KeyW');
      if (f === 20) input.down('ShiftLeft');
      if (f === 150) input.down('Space');
      if (f === 190) input.up('Space');
      if (f === 200) input.up('KeyW');
      const intent = readIntent(input, look(0.002 * f));
      log.push(copyIntent(intent));
      controller.frame(DT, intent);
      live.step(DT, (t += DT));
      path.push(live.pos.x, live.pos.y, live.pos.z);
    }
    expect(Math.max(...path.filter((_, i) => i % 3 === 1))).toBeGreaterThan(0.3); // it did jump

    const replayed = new Athlete('OH', 1);
    replayed.place(0, 8, 0);
    const playback = new UserController();
    playback.athlete = replayed;
    playback.handlers.jump = () => replayed.jumpPress();
    playback.releaseHandlers.jump = () => replayed.jumpRelease();
    const again: number[] = [];
    t = 0;
    for (const intent of log) {
      playback.frame(DT, intent);
      replayed.step(DT, (t += DT));
      again.push(replayed.pos.x, replayed.pos.y, replayed.pos.z);
    }
    expect(again).toEqual(path);
  });
});
