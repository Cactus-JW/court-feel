import { describe, expect, it } from 'vitest';
import { ASSIST, PLAYER, SIM } from '../src/config';
import { Athlete } from '../src/game/athlete';
import { idleIntent, type Intent } from '../src/game/intent';
import { SETTER_SPOT } from '../src/game/plays';
import { Simulation } from '../src/game/simulation';
import { solveApex } from '../src/physics/solve';
import { NO_HOOKS } from './simHooks';

// What the game does for a player, as their seat does it (src/game/seat.ts): these are rules of the
// play, so a seat in a bare simulation has them, with no app, no settings screen and no camera.

const STEP = 1 / SIM.hz;
const FRAME = 1 / 60;
const STEPS_A_FRAME = Math.round(FRAME / STEP);
/** a setter faces down the net, towards their outside hitter */
const DOWN_THE_NET = Math.PI / 2;

/**
 * A setter with a seat, and a pass on its way to the setter's spot. The setter stands `off` m short
 * of where their feet have to be for it. `setAssist` is the Set aim assist setting, `theirs`
 * whether the drill says the ball is theirs to set, `autoJumpSet` the Auto jump set setting (a
 * host with no answer when not given).
 */
function aSetterAndAPass(o: { off: number; setAssist: number; theirs?: boolean; autoJumpSet?: boolean }) {
  const sim = new Simulation({ ...NO_HOOKS, setAssist: () => o.setAssist });
  const setter = new Athlete('S', 1);
  setter.place(SETTER_SPOT.x, SETTER_SPOT.z, DOWN_THE_NET);
  sim.athletes.push(setter);
  const seat = sim.addSeat(setter, o.autoJumpSet === undefined ? {} : { autoJumpSet: () => o.autoJumpSet! });
  sim.drill = { step: () => {}, onOutcome: () => {}, userSetsNext: () => o.theirs ?? true };
  const from = { x: -3, y: 1, z: 6 };
  const v = { x: 0, y: 0, z: 0 };
  solveApex(from, { x: SETTER_SPOT.x, y: 2.4, z: SETTER_SPOT.z + 0.3 }, 5, { x: 0, y: 0, z: 0 }, v);
  sim.ball.launch(from, v);
  sim.ball.lastTouch = { athlete: null, kind: 'pass', t: 0, side: 1 };
  // where the feet have to be, and when the ball comes down onto the hands there
  const spot = { ...sim.contact.setSpot(setter, { x: 0, y: 0, z: 0 })! };
  const arrives = sim.contact.setCatch(setter)!.t;
  setter.place(spot.x - o.off, spot.z, DOWN_THE_NET);
  const fromSpot = (): number => Math.hypot(setter.pos.x - spot.x, setter.pos.z - spot.z);
  /** play until the ball reaches the hands, the seat hearing `hands` every frame. Returns how high the feet got (m) */
  const untilTheBallArrives = (hands: () => Intent): number => {
    let peak = 0;
    while (sim.simTime < arrives - STEP / 2) {
      seat.hear(FRAME, hands());
      for (let i = 0; i < STEPS_A_FRAME; i++) {
        sim.step(STEP);
        peak = Math.max(peak, setter.pos.y);
      }
    }
    return peak;
  };
  return { sim, setter, seat, fromSpot, untilTheBallArrives };
}

/** nothing held, looking down the net */
function handsOff(): Intent {
  const intent = idleIntent();
  intent.yaw = DOWN_THE_NET;
  return intent;
}

describe('the set-step assist is the seat’s', () => {
  // A setter gets near the ball with their own feet and the last steps look after themselves: their
  // eyes are on the ball. The assist takes those last steps, and it helps the body, never the ball.
  it('hands off the stick, half a metre from the spot, the setter’s feet are on it when the ball arrives', () => {
    const { setter, fromSpot, untilTheBallArrives } = aSetterAndAPass({ off: 0.5, setAssist: ASSIST.aim });
    expect(fromSpot()).toBeCloseTo(0.5, 6);
    untilTheBallArrives(handsOff);
    expect(fromSpot()).toBeLessThan(0.06);
    // and still, for the touch
    expect(setter.speed).toBeLessThan(0.3);
  });

  it('an autopilot’s feet are not helped: it says where it goes outright, and the help would fight it', () => {
    const { fromSpot, untilTheBallArrives } = aSetterAndAPass({ off: 0.5, setAssist: ASSIST.aim });
    untilTheBallArrives(() => ({ ...handsOff(), helped: false }));
    expect(fromSpot()).toBeCloseTo(0.5, 6);
  });

  it('at 0 it is off', () => {
    const { fromSpot, untilTheBallArrives } = aSetterAndAPass({ off: 0.5, setAssist: 0 });
    untilTheBallArrives(handsOff);
    expect(fromSpot()).toBeCloseTo(0.5, 6);
  });

  it('a ball that is not theirs to set moves nobody', () => {
    const { fromSpot, untilTheBallArrives } = aSetterAndAPass({ off: 0.5, setAssist: ASSIST.aim, theirs: false });
    untilTheBallArrives(handsOff);
    expect(fromSpot()).toBeCloseTo(0.5, 6);
  });

  it('getting near is the player’s: from further out than the assist reaches, nothing moves them', () => {
    const out = ASSIST.setStep.radius * ASSIST.aim + 0.3;
    const { fromSpot, untilTheBallArrives } = aSetterAndAPass({ off: out, setAssist: ASSIST.aim });
    untilTheBallArrives(handsOff);
    expect(fromSpot()).toBeCloseTo(out, 6);
  });
});

/** a player on the home side with a seat, a spot `off` m behind them to go back to, and what their host was told */
function aPlayerOffTheirSpot(off: number) {
  const sim = new Simulation(NO_HOOKS);
  const spot = { x: -3, z: 7, yaw: 0 };
  const player = new Athlete('OH', 1);
  player.place(spot.x, spot.z - off, 0);
  sim.athletes.push(player);
  const placed: { yaw: number; snapped: boolean }[] = [];
  const seat = sim.addSeat(player, { placed: (yaw, snapped) => placed.push({ yaw, snapped }) });
  const fromSpot = (): number => Math.hypot(player.pos.x - spot.x, player.pos.z - spot.z);
  /** play `seconds`, the seat hearing `hands` every frame, or until `until` is true. Returns the seconds played */
  const play = (seconds: number, hands: () => Intent = idleIntent, until: () => boolean = () => false): number => {
    let t = 0;
    for (; t < seconds - FRAME / 2 && !until(); t += FRAME) {
      for (const s of sim.seats) s.hear(FRAME, s === seat ? hands() : idleIntent());
      for (let i = 0; i < STEPS_A_FRAME; i++) sim.step(STEP);
    }
    return t;
  };
  return { sim, spot, player, seat, placed, fromSpot, play };
}

describe('the walk back between reps is the seat’s', () => {
  // Between reps a player walks back to where the next ball starts: nobody is picked up and put
  // there. The game jogs them back when they leave the stick alone, and lets them walk themselves.
  const W = PLAYER.walkBack;

  it('a player off their spot is jogged back and is on it within the time allowed', () => {
    const { spot, seat, placed, fromSpot, play } = aPlayerOffTheirSpot(3);
    seat.walkTo(spot.x, spot.z, spot.yaw);
    expect(seat.walking).toBe(true);
    // a jog: a frame at a time, never a jump
    let last = fromSpot();
    let longest = 0;
    const took = play(W.maxT, idleIntent, () => {
      longest = Math.max(longest, last - fromSpot());
      last = fromSpot();
      return !seat.walking;
    });
    expect(seat.walking).toBe(false);
    expect(took).toBeLessThan(W.maxT);
    expect(fromSpot()).toBeLessThan(W.near);
    expect(longest).toBeLessThan(0.2);
    // they walked: nobody put them there
    expect(placed).toEqual([]);
  });

  it('one who takes the stick walks themselves and the game lets go inside 0.9 m', () => {
    const { spot, seat, player, placed, fromSpot, play } = aPlayerOffTheirSpot(3);
    seat.walkTo(spot.x, spot.z, spot.yaw);
    // they walk back towards the spot themselves (facing the net, so backwards), at a walk
    const walking = (): Intent => ({ ...idleIntent(), moveZ: 0.6, steering: true });
    play(W.maxT, walking, () => !seat.walking);
    expect(seat.walking).toBe(false);
    expect(fromSpot()).toBeLessThan(W.nearSteered);
    expect(fromSpot()).toBeGreaterThan(W.near);
    // the walk was theirs: the game never broke into a sprint for them, and never put them anywhere
    expect(player.cmd.sprint).toBe(false);
    expect(placed).toEqual([]);
  });

  it('one who is not back in time is put there, and the host is told it was a snap', () => {
    const { spot, seat, player, placed, fromSpot, play } = aPlayerOffTheirSpot(3);
    // half a second is not enough to jog 3 m
    seat.walkTo(spot.x, spot.z, 0.4, 0.5);
    // hands off, the look staying where it is (a camera turns with the body it follows)
    const handsOffLooking = (): Intent => ({ ...idleIntent(), yaw: seat.intent.yaw });
    play(0.5, handsOffLooking);
    expect(seat.walking).toBe(true);
    expect(fromSpot()).toBeGreaterThan(0.5);
    play(2 * FRAME, handsOffLooking);
    expect(seat.walking).toBe(false);
    expect(fromSpot()).toBeLessThan(1e-9);
    expect(placed).toEqual([{ yaw: 0.4, snapped: true }]);
    // the player's look turns with their body, and the body stays facing that way
    expect(seat.intent.yaw).toBeCloseTo(0.4, 9);
    play(0.25, handsOffLooking);
    expect(player.yaw).toBeCloseTo(0.4, 2);
    expect(fromSpot()).toBeLessThan(1e-9);
  });

  it('one who took the stick and wandered off is never put there: the game stops waiting where they stand', () => {
    const { spot, seat, placed, fromSpot, play } = aPlayerOffTheirSpot(3);
    seat.walkTo(spot.x, spot.z, spot.yaw, 0.5);
    // a hand on the stick that goes nowhere
    const holding = (): Intent => ({ ...idleIntent(), steering: true });
    play(0.5 + W.giveUp - 2 * FRAME, holding);
    expect(seat.walking).toBe(true);
    play(4 * FRAME, holding);
    expect(seat.walking).toBe(false);
    expect(fromSpot()).toBeCloseTo(3, 6);
    expect(placed).toEqual([]);
  });

  it('putting a player on a spot ends their walk back, and the host is told it was no snap', () => {
    const { spot, seat, placed, fromSpot, play } = aPlayerOffTheirSpot(3);
    seat.walkTo(spot.x, spot.z, spot.yaw);
    play(0.2);
    seat.place(spot.x, spot.z, 0.2);
    expect(seat.walking).toBe(false);
    expect(fromSpot()).toBeLessThan(1e-9);
    expect(placed).toEqual([{ yaw: 0.2, snapped: false }]);
  });

  it('one seat’s walk back never moves another seat’s athlete', () => {
    const { sim, spot, seat, fromSpot, play } = aPlayerOffTheirSpot(3);
    const other = new Athlete('L', -1);
    other.place(2, -6, Math.PI);
    sim.athletes.push(other);
    const otherSeat = sim.addSeat(other);
    seat.walkTo(spot.x, spot.z, spot.yaw);
    play(W.maxT, idleIntent, () => !seat.walking);
    expect(fromSpot()).toBeLessThan(W.near);
    expect(otherSeat.walking).toBe(false);
    expect(other.pos.x).toBeCloseTo(2, 9);
    expect(other.pos.z).toBeCloseTo(-6, 9);
    // and the other way round: the second seat walks back, the first stays on its spot
    const at = { x: seat.athlete.pos.x, z: seat.athlete.pos.z };
    otherSeat.walkTo(2, -8, Math.PI);
    play(W.maxT, idleIntent, () => !otherSeat.walking);
    expect(Math.hypot(other.pos.x - 2, other.pos.z + 8)).toBeLessThan(W.near);
    expect(seat.athlete.pos.x).toBeCloseTo(at.x, 9);
    expect(seat.athlete.pos.z).toBeCloseTo(at.z, 9);
  });
});

describe('the auto jump set is the seat’s', () => {
  // A setter meets a pass in system at the top of a small jump: higher and sooner than off the
  // floor. With Auto jump set on the body goes up for it by itself and the hands stay the player's.
  it('with Auto jump set on, a setter on the spot leaves the floor for a pass in system, hands off', () => {
    const { setter, untilTheBallArrives } = aSetterAndAPass({ off: 0, setAssist: ASSIST.aim, autoJumpSet: true });
    const peak = untilTheBallArrives(handsOff);
    expect(peak).toBeGreaterThan(0.1);
    // the arms went up for a set, not a swing
    expect(setter.airIntent).toBe('set');
  });

  it('with it off they stay on the floor, and so does a seat whose host has no answer', () => {
    const off = aSetterAndAPass({ off: 0, setAssist: ASSIST.aim, autoJumpSet: false });
    expect(off.untilTheBallArrives(handsOff)).toBe(0);
    const unasked = aSetterAndAPass({ off: 0, setAssist: ASSIST.aim });
    expect(unasked.untilTheBallArrives(handsOff)).toBe(0);
    // the arms are ready for the set all the same: a jump of their own (Space) would be a jump set
    expect(off.setter.airIntent).toBe('set');
  });

  it('a ball that is not theirs to set leaves them down, their arms ready to attack', () => {
    const { setter, untilTheBallArrives } = aSetterAndAPass({ off: 0, setAssist: ASSIST.aim, autoJumpSet: true, theirs: false });
    expect(untilTheBallArrives(handsOff)).toBe(0);
    expect(setter.airIntent).toBe('attack');
  });
});
