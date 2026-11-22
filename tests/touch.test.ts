import { describe, expect, it } from 'vitest';
import { CAMERA, PLAYER, POSITIONS, SIM, TOUCH } from '../src/config';
import { CameraRig } from '../src/camera/cameraRig';
import type { Stick } from '../src/core/input';
import { TouchPad, type PadButton, type PadInput } from '../src/core/touchPad';
import { Athlete } from '../src/game/athlete';
import { readIntent } from '../src/game/intent';
import { UserController } from '../src/game/userController';
import { Hud } from '../src/ui/hud';
import { WheelFingers, type WheelHost } from '../src/ui/touchControls';

const DT = 1 / SIM.hz;

/** the slice of Input the pad and the controller use, without a DOM */
class FakeInput implements PadInput {
  held = new Set<string>();
  pressed = new Set<string>();
  released = new Set<string>();
  log: string[] = [];
  mouseDX = 0;
  mouseDY = 0;
  readonly stick: Stick = { active: false, x: 0, y: 0, sprint: false };
  down(c: string): void {
    if (this.held.has(c)) return;
    this.held.add(c);
    this.pressed.add(c);
    this.log.push('+' + c);
  }
  up(c: string): void {
    if (!this.held.has(c)) return;
    this.held.delete(c);
    this.released.add(c);
    this.log.push('-' + c);
  }
  isDown(c: string): boolean {
    return this.held.has(c);
  }
  consumePress(c: string): boolean {
    return this.pressed.delete(c);
  }
  consumeRelease(c: string): boolean {
    return this.released.delete(c);
  }
  peekPress(c: string): boolean {
    return this.pressed.has(c);
  }
  clearEdges(): void {
    this.pressed.clear();
    this.released.clear();
  }
}

/** a phone held sideways: buttons on the right, the stick on the left */
const W = 844;
const H = 390;
const BUTTONS: Record<string, { x: number; y: number; r: number }> = {
  hit: { x: W - 74, y: H - 74, r: 46 },
  jump: { x: W - 176, y: H - 76, r: 40 },
  block: { x: W - 75, y: H - 173, r: 35 },
  pass: { x: W - 160, y: H - 166, r: 32 },
};

function rig(opts: { airborne?: () => boolean; wantsSet?: () => boolean } = {}) {
  const input = new FakeInput();
  const pad = new TouchPad(input, {
    airborne: opts.airborne ?? (() => false),
    wantsSet: opts.wantsSet ?? (() => false),
    lookSens: () => 1,
    width: () => W,
    buttonAt: (x, y) => {
      for (const [id, b] of Object.entries(BUTTONS)) if (Math.hypot(x - b.x, y - b.y) <= b.r) return id as PadButton;
      return null;
    },
  });
  return { input, pad };
}

describe('touch pad: joystick', () => {
  it('floats under the thumb; deflection is analog and camera-relative forward is screen up', () => {
    const { input, pad } = rig();
    pad.begin(1, 200, 300, 0);
    expect(input.stick.active).toBe(true);
    expect(input.stick.x).toBe(0);
    expect(input.stick.y).toBe(0);
    // half a radius up: forward at about half speed (past the dead zone)
    pad.move(1, 200, 300 - TOUCH.stickRadius * 0.5);
    expect(input.stick.y).toBeGreaterThan(0.35);
    expect(input.stick.y).toBeLessThan(0.5);
    expect(Math.abs(input.stick.x)).toBeLessThan(1e-9);
    expect(input.stick.sprint).toBe(false);
    // way past the ring: clamped to full deflection, and that is the approach (sprint)
    pad.move(1, 200, 300 - TOUCH.stickRadius * 2);
    expect(input.stick.y).toBeCloseTo(1, 6);
    expect(input.stick.sprint).toBe(true);
    expect(pad.stickView.deflect).toBe(1);
    // hysteresis: easing back a little keeps running, coming well in stops it
    pad.move(1, 200, 300 - TOUCH.stickRadius * (TOUCH.sprintOn - 0.05));
    expect(input.stick.sprint).toBe(true);
    pad.move(1, 200, 300 - TOUCH.stickRadius * (TOUCH.sprintOff - 0.05));
    expect(input.stick.sprint).toBe(false);
    pad.end(1);
    expect(input.stick.active).toBe(false);
    expect(input.stick.y).toBe(0);
  });

  it('a touch on the right half is not a stick, and only one stick at a time', () => {
    const { input, pad } = rig();
    const look = pad.begin(1, 600, 300, 0);
    expect(look.kind).toBe('look');
    expect(input.stick.active).toBe(false);
    const stick = pad.begin(2, 150, 300, 0);
    expect(stick.kind).toBe('stick');
    const second = pad.begin(3, 300, 250, 0);
    expect(second.kind).toBe('look');
  });

  it('drives the athlete through the controller: push the stick out and the approach runs', () => {
    const { input, pad } = rig();
    const cam = new CameraRig(16 / 9);
    cam.yaw = 0;
    const uc = new UserController();
    const a = new Athlete('OH', 1);
    a.place(0, 8, 0);
    uc.athlete = a;
    pad.begin(1, 150, 300, 0);
    pad.move(1, 150, 300 - TOUCH.stickRadius * 0.5);
    let t = 0;
    for (let i = 0; i < SIM.hz; i++) {
      uc.frame(DT, readIntent(input, cam));
      a.step(DT, (t += DT));
    }
    expect(a.cmd.moveZ).toBeLessThan(0); // forward = towards the net (-z) with yaw 0
    expect(a.cmd.sprint).toBe(false);
    const shuffle = a.speed;
    expect(shuffle).toBeGreaterThan(1);
    expect(shuffle).toBeLessThan(POSITIONS.OH.shuffleSpeed);
    pad.move(1, 150, 300 - TOUCH.stickRadius * 1.5);
    for (let i = 0; i < SIM.hz; i++) {
      uc.frame(DT, readIntent(input, cam));
      a.step(DT, (t += DT));
    }
    expect(a.cmd.sprint).toBe(true);
    expect(a.speed).toBeCloseTo(POSITIONS.OH.approachSpeed, 1);
  });
});

describe('touch pad: hold buttons', () => {
  it('JUMP is Space: hold loads, release takes off', () => {
    const { input, pad } = rig();
    const cam = new CameraRig(16 / 9);
    const uc = new UserController();
    const a = new Athlete('OH', 1);
    a.place(0, 8, 0);
    uc.athlete = a;
    uc.handlers.jump = () => a.jumpPress();
    uc.releaseHandlers.jump = () => a.jumpRelease();
    const b = BUTTONS.jump;
    pad.begin(1, b.x, b.y, 0);
    expect(input.isDown('Space')).toBe(true);
    let t = 0;
    const run = (n: number) => {
      for (let i = 0; i < n; i++) {
        uc.frame(DT, readIntent(input, cam));
        a.step(DT, (t += DT));
      }
    };
    run(1);
    expect(a.state).toBe('load');
    run(Math.round(PLAYER.loadMin * SIM.hz) + 2);
    expect(a.state).toBe('load');
    pad.end(1);
    expect(input.isDown('Space')).toBe(false);
    run(2);
    expect(a.state).toBe('air');
  });

  it('HIT is the left mouse button; a held button aims once the thumb leaves the dead zone', () => {
    const { input, pad } = rig();
    const b = BUTTONS.hit;
    pad.begin(1, b.x, b.y, 0);
    expect(input.isDown('Mouse0')).toBe(true);
    // a wobble inside the dead zone does not move the camera
    pad.move(1, b.x + 2, b.y + 1);
    expect(input.mouseDX).toBe(0);
    pad.move(1, b.x + TOUCH.lookDeadZone + 1, b.y);
    expect(input.mouseDX).toBeCloseTo(1 * TOUCH.lookScale, 6); // the dead-zone travel itself is swallowed
    pad.move(1, b.x + TOUCH.lookDeadZone + 21, b.y + 10);
    expect(input.mouseDX).toBeCloseTo(21 * TOUCH.lookScale, 6);
    expect(input.mouseDY).toBeCloseTo(10 * TOUCH.lookScale, 6);
    pad.end(1);
    expect(input.isDown('Mouse0')).toBe(false);
    expect(input.log).toEqual(['+Mouse0', '-Mouse0']);
  });

  it('a drag on empty right-half space is pure aim, and a thumb drag turns faster than the mouse', () => {
    const { input, pad } = rig();
    pad.begin(1, 600, 200, 0);
    pad.move(1, 700, 200);
    expect(input.held.size).toBe(0);
    // 100 px of thumb = CAMERA.sensitivity * lookScale * 100 rad, about a quarter turn at the default
    const rad = input.mouseDX * CAMERA.sensitivity;
    expect(rad).toBeGreaterThan(0.4);
    expect(rad).toBeLessThan(0.8);
  });

  it('in the air the whole right half is HIT (JUMP included), the left half still steers', () => {
    let air = false;
    const { input, pad } = rig({ airborne: () => air });
    air = true;
    const p = pad.begin(1, 650, 150, 0);
    expect(p.button).toBe('hit');
    expect(input.isDown('Mouse0')).toBe(true);
    pad.end(1);
    const j = pad.begin(2, BUTTONS.jump.x, BUTTONS.jump.y, 0);
    expect(j.button).toBe('hit');
    expect(input.isDown('Space')).toBe(false);
    pad.end(2);
    const s = pad.begin(3, 150, 300, 0);
    expect(s.kind).toBe('stick');
    // BLOCK still blocks in the air
    const bl = pad.begin(4, BUTTONS.block.x, BUTTONS.block.y, 0);
    expect(bl.button).toBe('block');
    expect(input.isDown('Mouse2')).toBe(true);
    expect(input.isDown('Space')).toBe(false);
  });

  it('rolling the thumb from JUMP onto HIT takes off and winds up, then aims; lifting swings', () => {
    const { input, pad } = rig();
    const j = BUTTONS.jump;
    const h = BUTTONS.hit;
    pad.begin(1, j.x, j.y, 0);
    expect(input.isDown('Space')).toBe(true);
    // the roll must not turn the camera
    pad.move(1, j.x + 30, j.y);
    expect(input.mouseDX).toBe(0);
    pad.move(1, h.x - h.r + 2, h.y);
    expect(input.isDown('Space')).toBe(false);
    expect(input.isDown('Mouse0')).toBe(true);
    // now the drag aims
    pad.move(1, h.x - h.r + 12, h.y);
    expect(input.mouseDX).toBeCloseTo(10 * TOUCH.lookScale, 6);
    pad.end(1);
    expect(input.isDown('Mouse0')).toBe(false);
    expect(input.log).toEqual(['+Space', '-Space', '+Mouse0', '-Mouse0']);
  });

  it('BLOCK puts the hands up and loads a jump; the hands stay up through the air and come down on landing', () => {
    let air = false;
    const { input, pad } = rig({ airborne: () => air });
    const b = BUTTONS.block;
    pad.begin(1, b.x, b.y, 0);
    expect(input.isDown('Mouse2')).toBe(true);
    expect(input.isDown('Space')).toBe(true);
    air = true; // the load started
    pad.end(1);
    expect(input.isDown('Space')).toBe(false);
    expect(input.isDown('Mouse2')).toBe(true);
    pad.frame();
    expect(input.isDown('Mouse2')).toBe(true);
    air = false; // landed
    pad.frame();
    expect(input.isDown('Mouse2')).toBe(false);
  });

  it('BLOCK sets instead (no jump) when the ball is dropping onto you', () => {
    const { input, pad } = rig({ wantsSet: () => true });
    const b = BUTTONS.block;
    pad.begin(1, b.x, b.y, 0);
    expect(input.isDown('Mouse2')).toBe(true);
    expect(input.isDown('Space')).toBe(false);
    pad.end(1);
    expect(input.isDown('Mouse2')).toBe(false);
  });

  it('letting go of SET in a jump set releases the ball in the air (it is not held until the landing)', () => {
    let air = false;
    const { input, pad } = rig({ wantsSet: () => true, airborne: () => air });
    const b = BUTTONS.block;
    pad.begin(1, b.x, b.y, 0);
    air = true; // the auto jump set took off
    pad.end(1);
    expect(input.isDown('Mouse2')).toBe(false);
    expect(pad.isHeld('block')).toBe(false);
  });

  it('PASS is E, held; releaseAll lets go of everything', () => {
    const { input, pad } = rig();
    const b = BUTTONS.pass;
    pad.begin(1, b.x, b.y, 0);
    pad.begin(2, 150, 300, 0);
    pad.move(2, 150, 200);
    expect(input.isDown('KeyE')).toBe(true);
    expect(input.stick.active).toBe(true);
    pad.releaseAll();
    expect(input.held.size).toBe(0);
    expect(input.stick.active).toBe(false);
    expect(pad.pointers.size).toBe(0);
  });
});

describe('touch: a drill says buttons, not keys', () => {
  it("a hitter's intro names the route chips and ROUTES, not the keys 1-5 and C", () => {
    const spike = 'Approach: Shift + W · plant: Space · hold LMB, release to hit · 1-5 call your route · C see them';
    expect(Hud.translateText(spike)).toBe(
      'Approach: the stick out · plant: JUMP · hold HIT, release to hit · the chips call your route · ROUTES see them',
    );
    expect(Hud.translateText('Play your position · win the point · 1-4 call your route · C see them')).toBe(
      'Play your position · win the point · the chips call your route · ROUTES see them',
    );
  });
});

/** a wheel 200 px across around (400, 200), slices by direction like the real one (0 up, 1 right, 2 down, 3 left) */
function wheelHost(): WheelHost & { sel: number } {
  const h = {
    sel: -1,
    wheelAt: (x: number, y: number) => Math.hypot(x - 400, y - 200) <= 100,
    pointWheel(x: number, y: number) {
      const dx = x - 400;
      const dy = y - 200;
      if (Math.hypot(dx, dy) < 30) return (h.sel = -1);
      const turn = Math.atan2(dx, -dy) / (2 * Math.PI);
      return (h.sel = ((Math.round(turn * 4) % 4) + 4) % 4);
    },
    unpointWheel() {
      h.sel = -1;
    },
  };
  return h;
}

describe('touch: pointing at a play on the wheel', () => {
  it('a PLAY tap that wobbles a pixel or two points at nothing (the wheel stays open for the second touch)', () => {
    const h = wheelHost();
    const f = new WheelFingers(h);
    // the PLAY chip is in the top bar, up and left of the wheel
    f.holdPlay(1, 250, 14);
    f.move(1, 252, 15);
    f.move(1, 251, 13);
    expect(f.up(1, 251, 13, false)).toBe(-1);
    expect(h.sel).toBe(-1);
  });

  it('a PLAY finger that slides onto the wheel points at the play under it, and keeps pointing past the edge', () => {
    const h = wheelHost();
    const f = new WheelFingers(h);
    f.holdPlay(1, 250, 14);
    f.move(1, 300, 120); // still off the wheel
    expect(h.sel).toBe(-1);
    f.move(1, 470, 200); // on the right slice
    expect(h.sel).toBe(1);
    f.move(1, 400, 330); // slid off the bottom edge: still pointing, down
    expect(h.sel).toBe(2);
  });

  it('a finger that comes down on the open wheel points, and lifting it calls the play under it', () => {
    const h = wheelHost();
    const f = new WheelFingers(h);
    expect(f.down(2, 400, 120)).toBe(true);
    expect(f.move(2, 330, 200)).toBe(true);
    expect(f.up(2, 330, 200, false)).toBe(3);
    // off the wheel: not the wheel's
    expect(f.down(3, 40, 300)).toBe(false);
  });

  it('a touch the phone cancels calls nothing and leaves nothing pointed at', () => {
    const h = wheelHost();
    const f = new WheelFingers(h);
    f.down(2, 400, 120);
    expect(f.up(2, 400, 120, true)).toBe(-1);
    expect(h.sel).toBe(-1);
    f.holdPlay(1, 250, 14);
    f.move(1, 470, 200);
    expect(h.sel).toBe(1);
    f.up(1, 470, 200, true);
    expect(h.sel).toBe(-1);
  });
});
