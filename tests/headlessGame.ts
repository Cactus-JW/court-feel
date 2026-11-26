import * as THREE from 'three';
import { DEFAULT_SETTINGS, type PositionId, type ServeKind, type Settings } from '../src/config';
import type { ContactEvent } from '../src/game/contact';
import { takeKey } from '../src/game/intent';
import { NO_MARKERS } from '../src/game/modes/markers';
import type { DrillHost, DrillHud, ModeId } from '../src/game/modes/mode';
import { createMode } from '../src/game/modes/registry';
import { scene } from './scene';

/** a HUD nobody reads: every line a drill writes is kept, so a test can ask what was said */
function silentHud(said: string[]): DrillHud {
  const say =
    (what: string) =>
    (...args: unknown[]): void => {
      said.push(`${what} ${args.filter((a) => typeof a === 'string' || typeof a === 'number').join(' ')}`.trim());
    };
  return {
    gradeAside: false,
    setTitle: say('title'),
    setScore: say('score'),
    setStreak: say('streak'),
    setCallSheet: () => {},
    showBanner: say('banner'),
    message: say('message'),
    go: say('go'),
    call: say('call'),
    clearCall: () => {},
    topCall: (text: string | null) => said.push(text ? `topCall ${text}` : 'topCall off'),
  };
}

/** no lesson is being taken */
const NO_LESSON: DrillHost['tutorial'] = {
  active: false,
  serving: false,
  lesson: 'spike',
  holdingFeed: () => false,
  holdingResult: () => false,
  showPath: () => false,
  urgeRun: () => false,
  noteFeed: () => {},
  noteContact: () => {},
  noteRepEnd: () => {},
};

/**
 * A whole game with nobody watching: a real simulation, a real drill and one player in seat 0,
 * with no renderer, no DOM, no HUD and no camera. It is what `Game` is to a drill (`DrillHost`),
 * cut down to what the play needs. The player has the settings a new player has (`settings`: the
 * assists are on), and their hands do nothing: the seat plays the intent it holds every frame, which
 * is nothing held and a look that stays where the drill last turned it. A test that wants hands
 * changes what the seat holds (`seat.intent`).
 */
export function headlessGame(id: ModeId, pos: PositionId, seed = 2024) {
  const said: string[] = [];
  const touches: string[] = [];
  const outcomes: string[] = [];

  const settings: Settings = { ...DEFAULT_SETTINGS };
  const s = scene({
    seed,
    hooks: {
      aimAssist: () => settings.aimAssist,
      setAssist: () => settings.setAimAssist,
      aimTargetFor: (a, out) => (a.isUser ? out.set(a.pos.x, 0, -a.side * 6) : out.copy(a.aiAim)),
      contact: (ev: ContactEvent) =>
        touches.push(`${sim.simTime.toFixed(4)} ${ev.athlete.role}${ev.athlete.side === 1 ? 'H' : 'A'} ${ev.kind} ${ev.grade}`),
      aiContact: (a, kind) => touches.push(`${sim.simTime.toFixed(4)} ${a.role}${a.side === 1 ? 'H' : 'A'} ${kind} ai`),
      outcome: (o) => outcomes.push(`${sim.simTime.toFixed(4)} ${o.kind} ${o.side}`),
    },
  });
  const { sim } = s;
  const me = s.athlete(pos, 1, { x: -3.2, z: 4.5, yaw: 0 }, { user: { autoJumpSet: () => settings.autoJumpSet } });
  const seat = sim.seatOf(me)!;

  const host: DrillHost = {
    get simTime() {
      return sim.simTime;
    },
    rng: sim.rng,
    ball: sim.ball,
    env: sim.env,
    contact: sim.contact,
    get athletes() {
      return sim.athletes;
    },
    get ballLive() {
      return sim.ballLive;
    },
    set ballLive(live: boolean) {
      sim.ballLive = live;
    },
    setBrain: (a, b) => sim.setBrain(a, b),
    onAiContact: (a, kind, speed) => sim.onAiContact(a, kind, speed),
    brains: sim.brains,
    clearBrains: () => sim.clearBrains(),
    judge: sim.judge,
    addAthlete: (a) => {
      if (!sim.athletes.includes(a)) sim.athletes.push(a);
    },
    removeAthlete: (a) => {
      sim.athletes = sim.athletes.filter((x) => x !== a);
      sim.brains.delete(a);
    },
    get me() {
      return seat.athlete;
    },
    keyPressed: (code) => takeKey(seat.intent, code),
    settings,
    get serveKind(): ServeKind {
      return seat.serveKind;
    },
    set serveKind(kind: ServeKind) {
      seat.serveKind = kind;
    },
    autoUser: false,
    placeUser: (x, z, yaw) => seat.place(x, z, yaw),
    returnUser: (x, z, yaw, maxT) => seat.walkTo(x, z, yaw, maxT),
    get userReturning() {
      return seat.walking;
    },
    wheelOpen: false,
    tutorial: NO_LESSON,
    events: { emit: () => {} },
    hud: silentHud(said),
    crowd: () => {},
    markers: NO_MARKERS,
    rig: { mode: 'tp', pitch: 0 },
    views: { get: () => undefined },
    fx: { replay: { contact: new THREE.Vector3() } },
  };

  // a real drill plays here: it takes the scene's place as the simulation's drill
  const mode = createMode(id, host, pos);
  sim.drill = mode;
  mode.setup();

  return {
    sim,
    seat,
    mode,
    host,
    said,
    touches,
    outcomes,
    /** play one frame: the seat plays the intent it holds (and walks its player back between reps), the simulation steps twice (120 Hz under 60 fps) and the drill's frame runs */
    frame(): void {
      seat.frame(1 / 60);
      s.step(2);
      mode.frame(1 / 60);
    },
  };
}
