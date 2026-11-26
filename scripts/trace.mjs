// The trace: does this checkout give the same play every run, and does a refactor play exactly like
// the code it started from?
//
//   npm run trace                    play this checkout twice and check that both runs are the same
//   npm run trace:compare            compare this checkout with the commit it branched from on origin/main
//   npm run trace:compare -- <ref>   compare this checkout with another commit or branch
//
// A seeded autopilot plays every drill on the manual clock, through the real input path, in a
// production build in headless Chromium. After every frame the whole simulation state (clock,
// ball, every athlete, score, the random stream, every contact and outcome) is folded into a hash,
// and four times a simulated second the hash and the state are written down. Two builds that play
// the same give the same hashes. Where they do not, the first difference is printed: the drill,
// the moment and the values.
//
// Then the same drills are played again frame by frame with the animation on (nothing is painted)
// and what is drawn and shown is compared: every call the HUD gets, the camera, and where the ball,
// the athletes (every joint) and the drill's floor markers are. Not screenshots: the data the
// picture is made from. The four lessons are taken the same way, with scripted hands (an autopilot
// does not take a lesson), down to what the lesson stores in the browser.
//
// Then the runs with a person's keys (`KEY_RUNS`). An autopilot says where its feet go outright and
// is never late, so what the game does for a person never runs in a drill it plays: the last steps
// onto a set, the jump set, the walk back between reps when the player jumps, takes the stick or
// is not back in time. These runs have no autopilot. Real keys are pressed in `Input`, and the
// mouse moved there, by habits (what a player does about what is on the screen: two runs look away
// before a walk back runs out of time, so where it leaves them looking is held), scripts and dice
// of the run's own, in the
// Setter Drill, the Mini Rally, the other drills and the four lessons, and the start screen's demo
// is played from the moment its page loads. They share a page of their own, and after every frame
// the simulation, the player's move command, the walk back, the camera and every call the HUD gets
// go into its hash. Each run also counts what it reached (a screen dip, a step with no key down),
// and fails when it no longer reaches what it is in the list for.
//
// Last, for this checkout: every drill is played again from the hands the game logged the first
// time (`Game.handsLog`: one intent a frame), with no autopilot and no key pressed, and has to give
// the same play. That is the promise a second player rests on (docs/adr/0011): the play is decided
// by where it starts and what the players' hands ask, and by nothing else.
//
// And one frame is painted, for this checkout: the Spike Drill with a double block on is stopped
// three seconds in, with their block's shadow on the floor, and that one frame is painted eight
// times in a page of its own. Nothing moves between the paints, so it has to be one picture. More
// than one means the GPU decided something the game did not. The outline of the block's shadow did
// that: it was a line that asked for a polygon offset, and it got a different depth on every paint
// (#108). Everything before this passes on that build, and this does not.
//
// What it does not cover: the menus, touch input, effects and sound, and of the rules for a person
// the two no key can reach (docs/verification.md names them). First person is never played: every
// pass sets the camera to third person, so what a placement does to the first-person view (where a
// walk back out of time leaves the eye) is not held. Of the picture itself it sees
// that one frame of one drill, and only whether it is the same every time it is painted: not
// whether it is the right picture, not any other drill or moment, and not whether two pages, two
// machines or two builds paint the same one. Two pages do not: the sparks are placed by
// `Math.random`, on purpose.
//
// Nothing is stored in the repo. A feature that changes the play on purpose has nothing to
// re-record: CI plays every pull request twice (`npm run trace`), and compares with main only a
// `refactor`, which must change nothing (docs/adr/0010).
//
// TRACE_SECONDS sets the simulated seconds per drill (60), TRACE_DISPLAY_SECONDS those watched for the
// display (30), TRACE_LESSON_SECONDS those of each lesson (75), TRACE_KEYS_SECONDS those of each run
// with a person's keys (45). Output: scripts/out/trace/. Exit code 1 on a difference.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out', 'trace');
const SECONDS = Number(process.env.TRACE_SECONDS ?? 60);
/** the random seed every drill starts from (the same one the end-to-end run uses) */
const SEED = 2024;
/** how long a fresh page may take to come up on a software GPU */
const PAGE_MS = 300000;

/** every drill, and the Mini Rally from each position: `good` autopilots miss now and then, so more of the code runs */
const RUNS = [
  { mode: 'free', pos: 'OH', bot: 'good' },
  { mode: 'spike', pos: 'OH', bot: 'perfect' },
  { mode: 'spike', pos: 'MB', bot: 'good' },
  { mode: 'spike', pos: 'OPP', bot: 'sloppy' },
  // the slow-mo assist bends the clock: the same reps must take the same frames
  { mode: 'spike', pos: 'OH', bot: 'good', slowmo: true },
  // their block on (B pressed twice: a double): two blockers in the play, and the block's shadow among the floor markers
  { mode: 'spike', pos: 'OH', bot: 'good', block: 2 },
  { mode: 'block', pos: 'MB', bot: 'good' },
  { mode: 'receive', pos: 'L', bot: 'good' },
  { mode: 'setter', pos: 'S', bot: 'good' },
  { mode: 'serve', pos: 'OH', bot: 'good' },
  { mode: 'rally', pos: 'OH', bot: 'good' },
  { mode: 'rally', pos: 'OPP', bot: 'good' },
  { mode: 'rally', pos: 'MB', bot: 'good' },
  { mode: 'rally', pos: 'S', bot: 'good' },
  { mode: 'rally', pos: 'L', bot: 'good' },
];

/**
 * The lessons: the spike and the three serves. A lesson waits for the player at each step and the
 * autopilots do not take one, so each is taken with scripted hands (`LESSON_KEYS`):
 * the same keys on the same frames, over and over. They are not good hands, and need not be: the
 * spike and the float lesson run to the end with them, the two jump serves to their last rep.
 */
const LESSON_SECONDS = Number(process.env.TRACE_LESSON_SECONDS ?? 75);
const LESSONS = ['spike', 'float', 'jumpFloat', 'jump'].map((lesson) => ({ lesson, seconds: LESSON_SECONDS }));
/**
 * A lesson's hands, a cycle of five seconds: [frame of the cycle, key, down]. A tap for the coach's
 * words, then toss, run, jump, draw and swing.
 */
const LESSON_KEYS = [
  [2, 'Enter', true],
  [4, 'Enter', false],
  [10, 'KeyQ', true],
  [40, 'KeyQ', false],
  [45, 'ShiftLeft', true],
  [45, 'KeyW', true],
  [120, 'Space', true],
  [135, 'Space', false],
  [140, 'Mouse0', true],
  [185, 'Mouse0', false],
  [200, 'KeyW', false],
  [200, 'ShiftLeft', false],
];

/**
 * A person's keys. An autopilot says where its feet go outright, so it takes no help with its steps
 * (`Intent.helped` is false), and it is never late, never in the air at the wrong time and never
 * takes the stick back: the rules that are there for a person do not run in a drill it plays. These
 * runs have no autopilot. Real keys go down and come up in `Input`, as a keyboard's do, and three
 * things press them (`keysOne`):
 *   `habits`  what a player does about what is on the screen: runs off their spot, keeps jumping
 *             while they are walked back, looks away (the one habit that moves the mouse), runs
 *             under a ball that is theirs and sets it. A habit gets to the rule it is there for
 *             however the drill's timing changes.
 *   `script`  keys on fixed frames, in parts played one after the other: a lesson is taken this way.
 *   `keys`    dice of the run's own (never the simulation's), for the keys nobody thought of:
 *             [key, the chance a frame that it goes down, the chance a frame that it comes up].
 * The same run presses the same keys on the same frames, so it has to give the same play.
 *
 * `whole`: the run is played a whole frame of the game at a time, camera and animation too. That is
 * for the runs where what is shown is part of the rule: the demo, the walk backs that end with the
 * camera put on a spot and a dip of the screen, the lessons. The others are played with the keys
 * and the simulation only, as the autopilots' drills are in the first pass: the last steps onto a
 * set and the jump set are in the feet, and a frame with no animation costs a fifteenth.
 *
 * `reach`: what the run is in the list for, counted from outside as it plays (`keysOne`), and the
 * least it has to count. 0 means none at all: with Set aim assist at 0 no step is taken for the
 * player. A run that stops getting there fails the trace by itself (`reachMissing`), on any pull
 * request, refactor or not.
 */
const KEYS_SECONDS = Number(process.env.TRACE_KEYS_SECONDS ?? 45);
/** now and then a step, a set button, a jump */
const LIGHT = [
  ['KeyW', 0.004, 0.06],
  ['KeyS', 0.004, 0.06],
  ['KeyA', 0.004, 0.06],
  ['KeyD', 0.004, 0.06],
  ['Mouse2', 0.02, 0.08],
  ['Space', 0.003, 0.1],
];
/** every key a player has, most of the time */
const BUSY = [
  ['KeyW', 0.02, 0.03],
  ['KeyS', 0.012, 0.04],
  ['KeyA', 0.012, 0.04],
  ['KeyD', 0.012, 0.04],
  ['ShiftLeft', 0.01, 0.02],
  ['Space', 0.01, 0.1],
  ['Mouse0', 0.02, 0.08],
  ['Mouse2', 0.015, 0.08],
  ['KeyE', 0.015, 0.08],
  ['KeyQ', 0.01, 0.05],
];
/** a lesson's hands (`LESSON_KEYS`), with the rep started again (N) part-way through the rep the coach leads */
const lessonHands = (restart) => [
  { frames: 470, every: 300, keys: LESSON_KEYS },
  { frames: 330, every: 1000, keys: restart },
  { every: 300, keys: LESSON_KEYS },
];
/** N, and nothing held: the walk back that follows is the game's */
const RESTART = [
  [0, 'KeyN', true],
  [2, 'KeyN', false],
];
/** N, then two move keys that cancel out: the player is steering and going nowhere, so the walk back waits for them until it gives up */
const RESTART_AND_HOLD = [...RESTART, [4, 'KeyW', true], [4, 'KeyS', true]];
const KEY_RUNS = [
  // ---- the start screen's demo, from the moment the page loads: nothing is started, set or reseeded
  { name: 'the start screen from page load', demo: true, whole: true, reach: { 'frames of a walk back': 1, 'contacts and outcomes': 1 } },
  // ---- the last steps onto a set, and the jump set (Setter Drill, and the Mini Rally as setter)
  {
    name: 'setter/S/hands off',
    mode: 'setter',
    pos: 'S',
    reach: {
      'frames the feet stepped to a set with no move key down': 1,
      'frames off the floor with the ball theirs to set': 1,
      'jump sets the body took by itself': 1,
    },
  },
  {
    name: 'setter/S/hands off/auto jump set off',
    mode: 'setter',
    pos: 'S',
    settings: { autoJumpSet: false },
    reach: {
      'frames the feet stepped to a set with no move key down': 1,
      'frames off the floor with the ball theirs to set': 0,
      'frames in the air': 0,
    },
  },
  {
    name: 'setter/S/hands off/set aim assist 0',
    mode: 'setter',
    pos: 'S',
    settings: { setAimAssist: 0 },
    reach: { 'frames the feet stepped to a set with no move key down': 0 },
  },
  {
    name: 'setter/S/steps off as the ball arrives and sets it/auto jump set off',
    mode: 'setter',
    pos: 'S',
    settings: { autoJumpSet: false },
    habits: ['steps off as the ball arrives', 'sets the ball'],
    reach: { 'sets by the player': 1, 'frames the ball loaded in their hands on the floor': 1, 'frames in the air': 0 },
  },
  {
    name: 'setter/S/runs in late and sets the ball',
    mode: 'setter',
    pos: 'S',
    habits: ['runs in late', 'sets the ball'],
    reach: { 'sets by the player': 1, 'jump sets the body took by itself': 1, 'frames the feet stepped to a set with no move key down': 1 },
  },
  { name: 'setter/S/light keys/paused for a while', mode: 'setter', pos: 'S', keys: LIGHT, pause: [600, 700] },
  {
    name: 'rally/S/runs under the ball and sets it',
    mode: 'rally',
    pos: 'S',
    habits: ['runs under the ball', 'sets the ball'],
    reach: { 'sets by the player': 1, 'jump sets the body took by itself': 1, 'frames the feet stepped to a set with no move key down': 1 },
  },
  // ---- the walk back between reps
  {
    name: 'spike/OH/runs off and keeps jumping when walked back',
    whole: true,
    mode: 'spike',
    pos: 'OH',
    habits: ['runs off', 'keeps jumping when walked back'],
    reach: { 'frames of a walk back off the floor': 1, 'walk backs that ended with the screen dipping': 1 },
  },
  {
    name: 'spike/OH/runs off and takes the stick when walked back',
    whole: true,
    mode: 'spike',
    pos: 'OH',
    habits: ['runs off', 'takes the stick when walked back'],
    reach: { 'walk backs the game let go of with the player steering': 1, 'walk backs that ended with the screen dipping': 0 },
  },
  {
    name: 'spike/MB/runs off, takes the stick and keeps jumping when walked back',
    whole: true,
    mode: 'spike',
    pos: 'MB',
    habits: ['runs off', 'takes the stick when walked back', 'keeps jumping when walked back'],
    reach: {
      'frames of a walk back off the floor': 1,
      'frames of a walk back with a move key down': 1,
      'walk backs that ended with the screen dipping': 0,
    },
  },
  {
    name: 'rally/L/runs off and keeps jumping when walked back',
    mode: 'rally',
    pos: 'L',
    habits: ['runs off', 'keeps jumping when walked back'],
    reach: { 'walk backs that ended with the screen dipping': 1 },
  },
  // ---- every key, in the drills the runs above do not play
  { name: 'receive/L/busy keys', mode: 'receive', pos: 'L', keys: BUSY },
  { name: 'serve/OH/busy keys', mode: 'serve', pos: 'OH', keys: BUSY },
  { name: 'block/MB/busy keys', mode: 'block', pos: 'MB', keys: BUSY },
  // ---- the lessons, with a walk back while the coach holds the player's line
  {
    name: 'lesson/spike/the rep started again, and the stick held',
    whole: true,
    lesson: 'spike',
    script: lessonHands(RESTART_AND_HOLD),
    seconds: LESSON_SECONDS,
    reach: { 'frames of a walk back in the rep the coach leads': 1, 'frames the lesson held the line': 1 },
  },
  {
    name: 'lesson/float',
    whole: true,
    lesson: 'float',
    script: lessonHands(RESTART),
    seconds: LESSON_SECONDS,
    reach: { 'frames of a walk back in a lesson': 1 },
  },
  {
    name: 'lesson/jumpFloat/the rep started again',
    whole: true,
    lesson: 'jumpFloat',
    script: lessonHands(RESTART),
    seconds: LESSON_SECONDS,
    reach: {
      'frames of a walk back in the rep the coach leads': 1,
      'frames of a walk back with the lesson slowing or holding the clock': 1,
    },
  },
  {
    name: 'lesson/jump/the rep started again',
    whole: true,
    lesson: 'jump',
    script: lessonHands(RESTART),
    seconds: LESSON_SECONDS,
    reach: {
      'frames of a walk back in the rep the coach leads': 1,
      'frames of a walk back with the lesson slowing or holding the clock': 1,
    },
  },
  // ---- where a walk back that runs out of time leaves the player looking: on the spot's facing, wherever they had turned
  {
    name: 'spike/OH/runs off, keeps jumping and looks away when walked back',
    whole: true,
    mode: 'spike',
    pos: 'OH',
    habits: ['runs off', 'keeps jumping when walked back', 'looks away when walked back'],
    reach: { 'walk backs out of time that turned the look back from where the player had turned it': 1 },
  },
  // the Setter Drill's spot is the one that does not face down the court (the setter stands side on to the net)
  {
    name: 'setter/S/runs off, keeps jumping and looks away when walked back',
    whole: true,
    mode: 'setter',
    pos: 'S',
    habits: ['runs off', 'keeps jumping when walked back', 'looks away when walked back'],
    reach: {
      'walk backs out of time that turned the look back from where the player had turned it': 1,
      'walk backs out of time that left the player looking across the court': 1,
    },
  },
].map((run) => ({ seconds: KEYS_SECONDS, seed: SEED, reach: {}, ...run, name: `keys/${run.name}` }));
/** simulated seconds of each drill that are watched for the display (the animation makes this pass the slow one) */
const DISPLAY_SECONDS = Number(process.env.TRACE_DISPLAY_SECONDS ?? 30);
/**
 * The frame that is painted: the Spike Drill with a double block on, this many simulated seconds in.
 * By then the first ball is up, their block's shadow is on the floor and the home setter stands
 * between the camera and the shadow, which is where #108 showed. `paints`: how many times it is
 * painted. Before #108, 8 paints of this frame gave 6 or 7 pictures, so 8 does not miss it.
 */
const FROZEN = { mode: 'spike', pos: 'OH', bot: 'good', block: 2, seconds: 3, paints: 8 };
/** the software GPU every page of the trace runs on, the one CI has */
const GPU = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** build a checkout for production into `dist` */
function build(cwd, dist) {
  fs.rmSync(dist, { recursive: true, force: true });
  execFileSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], {
    cwd,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** serve a built app from a loopback port of its own */
function serve(dist) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(dist, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(dist) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })),
  );
}

/**
 * Runs in the page before its scripts: the game is on the manual clock from the moment it exists.
 * Left alone, the start screen's autopilot plays until the trace takes over, for as long as the
 * machine took to get here, and every run would start from a different moment.
 */
function holdTheClock() {
  let game;
  Object.defineProperty(window, '__court', {
    configurable: true,
    get: () => game,
    set: (g) => {
      game = g;
      g.manual = true;
      g.holdRender = true;
      // a page that loses its graphics context pauses the game (main.ts): `lostContext` says so
      g.renderer.domElement.addEventListener('webglcontextlost', () => (window.__lostContext = true));
    },
  });
}

/**
 * Runs in the page: play one drill and write the state down. It reads the game through
 * `window.__court` only, so the same reader works on both builds of a comparison. When a refactor
 * moves one of these fields, this function is where both shapes are read.
 */
function playOne({ mode, pos, bot, slowmo = false, block = 0, seconds, seed, replay = null }) {
  const g = window.__court;
  // a replay stops the clock until someone watches it: there is no one here
  g.settings.replays = false;
  g.settings.firstPerson = false;
  g.settings.slowmoAssist = slowmo;
  g.rng.reseed(seed);
  g.startMode(mode, pos);
  window.__menu.showStart(false);
  // the hands: an autopilot's, logged as they play (where the build can), or that log played back
  const canLog = 'handsLog' in g;
  if (replay) {
    let next = 0;
    g.handsFrom = () => replay[Math.min(next++, replay.length - 1)];
  } else {
    g.enableBot(bot);
    if (canLog) g.handsLog = [];
  }

  const events = [];
  const who = (a) => (a.isUser ? 'me' : `${a.role}${a.side === 1 ? 'H' : 'A'}`);
  const offs = [
    g.events.on('contact', (e) => events.push(`${g.simTime.toFixed(4)} ${who(e.athlete)} ${e.kind} ${e.grade} ${e.speed}`)),
    g.events.on('aiContact', (e) => events.push(`${g.simTime.toFixed(4)} ${who(e.athlete)} ${e.kind} ai ${e.speed}`)),
    g.events.on('outcome', (o) => events.push(`${g.simTime.toFixed(4)} outcome ${o.kind} ${o.side}`)),
  ];

  /** the state as labelled values: numbers as they are, anything else as text */
  const read = () => {
    const s = [];
    const put = (label, v) => s.push([label, typeof v === 'boolean' ? Number(v) : (v ?? 'none')]);
    const v3 = (label, v) => {
      put(`${label}.x`, v.x);
      put(`${label}.y`, v.y);
      put(`${label}.z`, v.z);
    };
    put('simTime', g.simTime);
    put('ballLive', g.ballLive);
    put('rng', g.rng.s);
    put('ball.active', g.ball.active);
    put('ball.rest', g.ball.state.rest);
    v3('ball.p', g.ball.state.p);
    v3('ball.v', g.ball.state.v);
    v3('ball.w', g.ball.state.w);
    put('ball.knuckle', g.ball.state.knuckle);
    put('ball.kt', g.ball.state.kt);
    put('ball.lastTouch', g.ball.lastTouch ? `${g.ball.lastTouch.kind} ${g.ball.lastTouch.side}` : 'none');
    g.athletes.forEach((a, i) => {
      const name = `athlete[${i} ${who(a)}]`;
      v3(`${name}.pos`, a.pos);
      v3(`${name}.vel`, a.vel);
      put(`${name}.yaw`, a.yaw);
      put(`${name}.state`, a.state);
      put(`${name}.action`, a.action ? a.action.kind : 'none');
    });
    put('mode.score', g.mode.score);
    put('mode.streak', g.mode.streak);
    put('mode.reps', g.mode.reps);
    put('events', events.length);
    return s;
  };

  // FNV-1a over the exact bits of every number and the characters of every text
  const f64 = new Float64Array(1);
  const bytes = new Uint8Array(f64.buffer);
  let hash = 0x811c9dc5;
  const mix = (byte) => {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  const fold = (state) => {
    for (const [, v] of state) {
      if (typeof v === 'number') {
        f64[0] = v;
        for (let i = 0; i < 8; i++) mix(bytes[i]);
      } else for (const ch of String(v)) mix(ch.charCodeAt(0) & 0xff);
    }
  };

  const samples = [];
  const frames = Math.round(seconds * 60);
  let folded = 0;
  for (let f = 1; f <= frames; f++) {
    if (f <= block) {
      // Their block is asked for as a player asks: B, once a frame, on a whole frame of the game
      // (`play`): a drill acts on its command keys there, and `simulate` leaves that part of a frame
      // out. Played back, nothing is pressed: the B is in the logged hands.
      if (!replay) g.input.down('KeyB');
      g.play(1 / 60);
      g.input.up('KeyB');
      // a run that says it has a block and plays without one would pass for the wrong reason
      if (f === block && g.mode.blockLevel !== block) throw new Error(`their block did not come on: it is at level ${g.mode.blockLevel}`);
    } else g.simulate(1 / 60);
    const state = read();
    fold(state);
    for (; folded < events.length; folded++) for (const ch of events[folded]) mix(ch.charCodeAt(0) & 0xff);
    if (f % 15 === 0) samples.push({ frame: f, t: g.simTime, hash: hash.toString(16).padStart(8, '0'), state });
  }
  offs.forEach((off) => off());
  g.bot = null;
  const hands = replay ? null : canLog ? g.handsLog : null;
  g.handsFrom = null;
  if (canLog) g.handsLog = null;
  return { samples, events, simTime: g.simTime, hands };
}

/**
 * Runs in the page: play one drill frame by frame with the animation on (nothing is painted) and
 * write down what is shown: every call the HUD gets, where the camera is, where the ball, the
 * athletes and the drill's floor markers are drawn. Not screenshots: the data the picture is made
 * from, which is the same on every machine. Like `playOne`, it reads the game through
 * `window.__court` only, and is where both shapes are read when a refactor moves something.
 */
function watchOne({ mode, pos, bot, slowmo = false, block = 0, lesson = null, lessonKeys = [], seconds, seed }) {
  const g = window.__court;
  g.settings.replays = false;
  g.settings.firstPerson = false;
  g.settings.slowmoAssist = slowmo;
  g.rng.reseed(seed);
  const f64 = new Float64Array(1);
  const bytes = new Uint8Array(f64.buffer);
  let hash = 0x811c9dc5;
  const mix = (byte) => {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  const num = (v) => {
    f64[0] = v;
    for (let i = 0; i < 8; i++) mix(bytes[i]);
  };
  const text = (t) => {
    for (const ch of t) mix(ch.charCodeAt(0) & 0xff);
  };

  // what the HUD is told: every call, by name and arguments
  const hud = g.hud;
  const proto = Object.getPrototypeOf(hud);
  const calls = [];
  const counts = {};
  const wrapped = [];
  const say = (v) => {
    if (typeof v !== 'object' || v === null) return String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return '[object]';
    }
  };
  for (const name of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (name === 'constructor' || name === 'update' || typeof d.value !== 'function') continue;
    wrapped.push(name);
    hud[name] = (...args) => {
      const line = `${name}(${args.map(say).join(', ')})`;
      text(line);
      counts[name] = (counts[name] ?? 0) + 1;
      calls.push([name, `${g.simTime.toFixed(4)} ${line}`]);
      return d.value.apply(hud, args);
    };
  }

  // the HUD is listened to from before the drill or the lesson starts: its title and the coach's first words are part of what is shown
  if (lesson) g.beginTutorial({ lesson, replay: true });
  else g.startMode(mode, pos);
  window.__menu.showStart(false);
  if (!lesson) g.enableBot(bot);
  // a lesson's hands: `LESSON_KEYS`, over and over
  const lessonHands = (f) => {
    for (const [at, code, down] of lessonKeys) {
      if (f % 300 !== at) continue;
      if (down) g.input.down(code);
      else g.input.up(code);
    }
  };

  const ballMesh = () => (g.ballView ?? g.ball).mesh;
  const pose = (o) => {
    num(o.position.x);
    num(o.position.y);
    num(o.position.z);
    num(o.quaternion.x);
    num(o.quaternion.y);
    num(o.quaternion.z);
    num(o.quaternion.w);
  };
  const who = (a) => (a.isUser ? 'me' : `${a.role}${a.side === 1 ? 'H' : 'A'}`);
  const samples = [];
  const frames = Math.round(seconds * 60);
  for (let f = 1; f <= frames; f++) {
    if (lesson) lessonHands(f - 1);
    if (f <= block) g.input.down('KeyB');
    g.play(1 / 60);
    if (f <= block) g.input.up('KeyB');
    if (f === block && g.mode.blockLevel !== block) throw new Error(`their block did not come on: it is at level ${g.mode.blockLevel}`);
    pose(g.rig.camera);
    const ball = ballMesh();
    num(Number(ball.visible));
    pose(ball);
    for (const a of g.athletes) {
      const v = g.views.get(a);
      if (!v) continue;
      pose(v.root);
      // the whole body, every fourth frame: every joint and every part
      if (f % 4 === 0) v.root.traverse((o) => pose(o));
    }
    // the drill's own markers on the floor
    for (const o of g.mode?.objects ?? []) {
      num(Number(o.visible));
      pose(o);
      num(o.scale.x);
      num(o.scale.z);
    }
    num(Number(g.tutorial.active));
    if (f % 15 === 0) {
      const state = [];
      const put = (label, v) => state.push([label, typeof v === 'boolean' ? Number(v) : v]);
      const v3 = (label, v) => {
        put(`${label}.x`, v.x);
        put(`${label}.y`, v.y);
        put(`${label}.z`, v.z);
      };
      v3('camera', g.rig.camera.position);
      put('ball.shown', ball.visible);
      v3('ball drawn at', ball.position);
      g.athletes.forEach((a, i) => {
        const v = g.views.get(a);
        if (v) v3(`athlete[${i} ${who(a)}] drawn at`, v.root.position);
      });
      put('markers', (g.mode?.objects ?? []).filter((o) => o.visible).length);
      put('lesson', g.tutorial.active ? `step ${g.tutorial.step}` : 'off');
      put('hud calls', calls.length);
      samples.push({ frame: f, hash: hash.toString(16).padStart(8, '0'), state });
    }
  }
  for (const name of wrapped) delete hud[name];
  g.bot = null;
  if (lesson) {
    // what the lesson left in the browser, and how far it got: both are part of what it did
    calls.push(['lesson', `reached step ${g.tutorial.step}`]);
    for (const key of Object.keys(localStorage).sort())
      if (/tutorial|lesson/i.test(key)) calls.push(['stored', `stored ${key} = ${localStorage.getItem(key)}`]);
    for (const [, code] of lessonKeys) g.input.up(code);
    g.stopMode();
  }
  // a call made on most frames (the crosshair, the load bar) is in the hash; the list keeps the ones a player would read
  const shown = calls.filter(([name]) => counts[name] < frames / 2).map(([, line]) => line);
  return { samples, calls: shown };
}

/**
 * Runs in the page: play one run with a person's keys and no autopilot, a frame at a time. `whole`:
 * a whole frame of the game (`play`: the keys are read, the simulation steps, the drill and the
 * camera take their frame, every athlete is posed, nothing is painted). Otherwise the keys and the
 * simulation only (`simulate`), which is where the rules for a person's feet are, at a fifteenth of
 * the cost: posing twelve athletes is most of a frame.
 * After every frame it folds into one hash what the simulation holds and what the rules for a
 * person leave behind: every athlete, what their arms are ready for and whether their body takes
 * its own jump set, the player's move command, whether they are being walked back, whether the
 * judge is armed, the camera, every call the HUD gets and every contact and outcome. Like `playOne`
 * it reads the game through `window.__court` only, and is where both shapes are read when a
 * refactor moves something.
 *
 * It also counts what the run reached (`reach`), from outside: frames of a walk back, frames the
 * body stepped with no move key down, times the screen dipped. A run is in the list for what it
 * reaches, so it says so, and the count is checked (`reachMissing`).
 */
function keysOne({
  mode,
  pos,
  lesson = null,
  demo = false,
  autoUser = false,
  keys = null,
  script = null,
  habits = null,
  whole = false,
  settings = null,
  pause = null,
  seconds,
  seed,
}) {
  const g = window.__court;
  const f64 = new Float64Array(1);
  const bytes = new Uint8Array(f64.buffer);
  let hash = 0x811c9dc5;
  const mix = (byte) => {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  const text = (t) => {
    for (const ch of String(t)) mix(ch.charCodeAt(0) & 0xff);
  };

  // what the HUD is told: every call, by name and arguments
  const hud = g.hud;
  const proto = Object.getPrototypeOf(hud);
  const calls = [];
  const counts = {};
  const wrapped = [];
  const say = (v) => {
    if (typeof v !== 'object' || v === null) return String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return '[object]';
    }
  };
  for (const name of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (name === 'constructor' || name === 'update' || typeof d.value !== 'function') continue;
    wrapped.push(name);
    hud[name] = (...args) => {
      const line = `${name}(${args.map(say).join(', ')})`;
      text(line);
      counts[name] = (counts[name] ?? 0) + 1;
      calls.push([name, `${g.simTime.toFixed(4)} ${line}`]);
      return d.value.apply(hud, args);
    };
  }

  // the start screen's demo is played as the page left it: nothing is started, set or reseeded
  const kept = { ...g.settings };
  if (!demo) {
    g.settings.replays = false;
    g.settings.firstPerson = false;
    Object.assign(g.settings, settings ?? {});
    g.rng.reseed(seed);
    g.autoUser = autoUser;
    if (lesson) g.beginTutorial({ lesson, replay: true });
    else g.startMode(mode, pos);
    window.__menu.showStart(false);
  }

  const events = [];
  const who = (a) => (a.isUser ? 'me' : `${a.role}${a.side === 1 ? 'H' : 'A'}`);
  const offs = [
    g.events.on('contact', (e) => events.push(`${g.simTime.toFixed(4)} ${who(e.athlete)} ${e.kind} ${e.grade} ${e.speed}`)),
    g.events.on('aiContact', (e) => events.push(`${g.simTime.toFixed(4)} ${who(e.athlete)} ${e.kind} ai ${e.speed}`)),
    g.events.on('outcome', (o) => events.push(`${g.simTime.toFixed(4)} outcome ${o.kind} ${o.side}`)),
  ];

  const read = () => {
    const s = [];
    const put = (label, v) => s.push([label, typeof v === 'boolean' ? Number(v) : (v ?? 'none')]);
    const v3 = (label, v) => {
      put(`${label}.x`, v.x);
      put(`${label}.y`, v.y);
      put(`${label}.z`, v.z);
    };
    const me = g.me;
    put('simTime', g.simTime);
    put('ballLive', g.ballLive);
    put('rng', g.rng.s);
    put('judge armed', g.judge?.armed);
    put('ball.active', g.ball.active);
    put('ball.rest', g.ball.state.rest);
    v3('ball.p', g.ball.state.p);
    v3('ball.v', g.ball.state.v);
    v3('ball.w', g.ball.state.w);
    put('ball.lastTouch', g.ball.lastTouch ? `${g.ball.lastTouch.kind} ${g.ball.lastTouch.side}` : 'none');
    g.athletes.forEach((a, i) => {
      const name = `athlete[${i} ${who(a)}]`;
      v3(`${name}.pos`, a.pos);
      v3(`${name}.vel`, a.vel);
      put(`${name}.yaw`, a.yaw);
      put(`${name}.state`, a.state);
      put(`${name}.action`, a.action ? a.action.kind : 'none');
      put(`${name}.arms ready for`, a.airIntent);
      put(`${name}.takes its own jump set`, a.jumpSets);
    });
    put('my move command.x', me.cmd.moveX);
    put('my move command.z', me.cmd.moveZ);
    put('my move command.sprint', me.cmd.sprint);
    put('my move command.facing', me.cmd.faceYaw);
    put('being walked back', g.userReturning);
    put('my look', g.user?.intent.yaw);
    put('camera.yaw', g.rig.yaw);
    v3('camera', g.rig.camera.position);
    put('lesson', g.tutorial.active ? `step ${g.tutorial.step}` : 'off');
    put('drill', g.modeId);
    put('mode.score', g.mode?.score);
    put('mode.streak', g.mode?.streak);
    put('mode.reps', g.mode?.reps);
    put('events', events.length);
    put('hud calls', calls.length);
    return s;
  };
  const fold = (state) => {
    for (const [, v] of state) {
      if (typeof v === 'number') {
        f64[0] = v;
        for (let i = 0; i < 8; i++) mix(bytes[i]);
      } else text(v);
    }
  };

  // ---- the hands. Three things press the keys, and a key is down while any of them holds it:
  // the dice (`keys`), a script (`script`) and the habits (`habits`).
  let dice = (seed * 2654435761) >>> 0;
  const roll = () => {
    dice = (Math.imul(dice, 1664525) + 1013904223) >>> 0;
    return dice / 4294967296;
  };
  /** the keys the dice hold, the keys the script holds, and what `Input` has been told is down */
  const rolled = new Set();
  const scripted = new Set();
  const down = new Set();
  /** the part of the script being played: where it started, and which it is */
  let part = 0;
  let partFrom = 0;
  /**
   * What a player sees on the screen, as of the frame just played: the habits act on it. `walked`:
   * frames of the walk back they are in. `mine`: the ball is theirs to set. `left`: seconds until it
   * comes down to their hands, as they would judge it (a ball in free fall). `loading`: frames it has
   * been in their hands. `setFor`: frames they have held the set button for this ball.
   */
  const sees = { walked: 0, mine: false, left: Infinity, loading: 0, setFor: 0 };
  const look = () => {
    const me = g.me;
    sees.walked = g.userReturning ? sees.walked + 1 : 0;
    sees.mine = !!g.mode?.userSetsNext?.();
    const b = g.ball.state;
    const above = b.p.y - (me.pos.y + me.height + 0.17);
    const root = b.v.y * b.v.y + 2 * 9.81 * above;
    sees.left = g.ball.active && root >= 0 ? (b.v.y + Math.sqrt(root)) / 9.81 : Infinity;
    sees.loading = me.action?.kind === 'set' && me.action.absorbing ? sees.loading + 1 : 0;
    if (!sees.mine && !sees.loading) sees.setFor = 0;
  };
  /** hold the move keys that run towards a floor point: a keyboard has eight directions, from where the camera looks */
  const runTo = (hold, x, z) => {
    const me = g.me;
    const dx = x - me.pos.x;
    const dz = z - me.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const yaw = g.rig.yaw;
    const ahead = (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / d;
    const right = (Math.cos(yaw) * dx - Math.sin(yaw) * dz) / d;
    if (ahead > 0.38) hold('KeyW');
    if (ahead < -0.38) hold('KeyS');
    if (right > 0.38) hold('KeyD');
    if (right < -0.38) hold('KeyA');
  };
  const HABITS = {
    // every ten seconds a second's run where they look, then nothing: off their spot when the rep ends
    'runs off': (hold, f) => {
      if (f % 600 < 30 || f % 600 >= 90) return;
      hold('KeyW');
      hold('ShiftLeft');
    },
    // walked back, they keep jumping: a body off the floor is not jogged, so the walk back runs out of time
    'keeps jumping when walked back': (hold, f) => {
      if (sees.walked && f % 4 < 2) hold('Space');
    },
    // walked back, they look away to their right: the mouse moves, as it does under a hand (`Input.mouseDX`),
    // for most of a second. The camera is no longer where the spot faces when the walk back runs out
    'looks away when walked back': (_hold, _f, mouse) => {
      if (sees.walked >= 5 && sees.walked < 45) mouse(12);
    },
    // walked back, they take the stick for a moment: from then on the walk back is theirs
    'takes the stick when walked back': (hold) => {
      if (sees.walked >= 20 && sees.walked < 30) hold('KeyA');
    },
    // the ball theirs to set, they press as it reaches their hands, hold while it loads and let go
    'sets the ball': (hold) => {
      if (sees.setFor ? sees.loading < 9 && sees.setFor < 40 : sees.mine && sees.left < 0.12) {
        hold('Mouse2');
        sees.setFor++;
      }
    },
    // they step off the spot in the last quarter second, and catch the ball where they are
    'steps off as the ball arrives': (hold) => {
      if (sees.mine && !sees.loading && sees.left < 0.28) hold('KeyA');
    },
    // the ball theirs to set, they run under it and let go of the stick near the spot: the last steps are the assist's
    'runs under the ball': (hold) => {
      if (!sees.mine || sees.loading || g.me.state !== 'ground' || sees.left < 0.3 || sees.left > 5) return;
      const b = g.ball.state;
      const x = b.p.x + b.v.x * sees.left;
      const z = b.p.z + b.v.z * sees.left;
      const d = Math.hypot(x - g.me.pos.x, z - g.me.pos.z);
      if (d < 0.4) return;
      runTo(hold, x, z);
      if (d > 2) hold('ShiftLeft');
    },
    // they wait back from the net as the pass goes up, and run at the ball late with the stick held all the way
    'runs in late': (hold) => {
      if (!sees.mine || sees.loading || g.me.state !== 'ground') return;
      const b = g.ball.state;
      if (sees.left > 1.1) hold('KeyA');
      else if (sees.left < 0.75) runTo(hold, b.p.x + b.v.x * sees.left, b.p.z + b.v.z * sees.left);
    },
  };
  for (const h of habits ?? []) if (!HABITS[h]) throw new Error(`no habit called '${h}'`);

  const MOVE = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  const reach = {
    'frames of a walk back': 0,
    'frames of a walk back off the floor': 0,
    'frames of a walk back with a move key down': 0,
    'walk backs the game let go of with the player steering': 0,
    'walk backs that ended with the screen dipping': 0,
    'walk backs out of time that turned the look back from where the player had turned it': 0,
    'walk backs out of time that left the player looking across the court': 0,
    'frames the feet stepped to a set with no move key down': 0,
    'frames off the floor with the ball theirs to set': 0,
    'jump sets the body took by itself': 0,
    'sets by the player': 0,
    'frames the ball loaded in their hands on the floor': 0,
    'frames in the air': 0,
    'frames of a walk back in a lesson': 0,
    'frames of a walk back in the rep the coach leads': 0,
    'frames of a walk back with the lesson slowing or holding the clock': 0,
    'frames the lesson held the line': 0,
    'contacts and outcomes': 0,
  };
  /** a look this far (rad) from another is somewhere else: the mouse moves it a tenth of that a frame */
  const LOOK_TURNED = 0.2;
  /** the walk back in progress: was a move key down in it, and how many dips there were when it began */
  let walk = null;
  let spaceAt = -1e9;
  const samples = [];
  const frames = Math.round(seconds * 60);
  let folded = 0;
  look();
  for (let f = 1; f <= frames; f++) {
    for (const [code, goesDown, comesUp] of keys ?? []) {
      if (rolled.has(code)) {
        if (roll() < comesUp) rolled.delete(code);
      } else if (roll() < goesDown) rolled.add(code);
    }
    // the script: parts played one after the other, each a cycle of [frame of the cycle, key, down]
    const now = script?.[part];
    if (now) {
      for (const [at, code, goesDown] of now.keys) {
        if ((f - 1 - partFrom) % now.every !== at) continue;
        if (goesDown) scripted.add(code);
        else scripted.delete(code);
      }
      if (now.frames && f - partFrom >= now.frames) {
        part++;
        partFrom = f;
        scripted.clear();
      }
    }
    const want = new Set([...rolled, ...scripted]);
    for (const h of habits ?? [])
      HABITS[h](
        (code) => want.add(code),
        f,
        (dx) => (g.input.mouseDX += dx),
      );
    for (const code of [...down]) {
      if (want.has(code)) continue;
      g.input.up(code);
      down.delete(code);
    }
    for (const code of want) {
      if (down.has(code)) continue;
      g.input.down(code);
      down.add(code);
    }
    if (pause && f === pause[0]) g.paused = true;
    if (pause && f === pause[1]) g.paused = false;
    if (down.has('Space')) spaceAt = f;
    const me0 = g.me;
    const was = me0.state;
    const t0 = g.simTime;
    const looked = g.rig.yaw;
    if (whole) g.play(1 / 60);
    else g.simulate(1 / 60);

    look();
    const me = g.me;
    const steering = MOVE.some((k) => down.has(k));
    const pushed = Math.hypot(me.cmd.moveX, me.cmd.moveZ) > 1e-6;
    const sets = sees.mine;
    const inLesson = g.tutorial.active;
    if (g.userReturning) {
      walk ??= { steered: false, dips: counts.dip ?? 0 };
      if (steering) walk.steered = true;
      reach['frames of a walk back']++;
      if (me.state !== 'ground') reach['frames of a walk back off the floor']++;
      if (steering) reach['frames of a walk back with a move key down']++;
      if (inLesson) reach['frames of a walk back in a lesson']++;
      if (inLesson && g.tutorial.step === 1) reach['frames of a walk back in the rep the coach leads']++;
      if (inLesson && g.simTime - t0 < 1 / 60 - 1e-9) reach['frames of a walk back with the lesson slowing or holding the clock']++;
    } else if (walk) {
      if ((counts.dip ?? 0) > walk.dips) {
        reach['walk backs that ended with the screen dipping']++;
        // the camera is put where the spot faces: was that a turn, and is it a facing other than down the court (0)?
        if (Math.abs(g.rig.yaw - looked) > LOOK_TURNED)
          reach['walk backs out of time that turned the look back from where the player had turned it']++;
        if (Math.abs(Math.sin(g.rig.yaw)) > Math.sin(LOOK_TURNED))
          reach['walk backs out of time that left the player looking across the court']++;
      } else if (walk.steered) reach['walk backs the game let go of with the player steering']++;
      walk = null;
    }
    if (!g.userReturning && !steering && pushed) {
      if (inLesson) reach['frames the lesson held the line']++;
      else if (sets && me.state === 'ground') reach['frames the feet stepped to a set with no move key down']++;
    }
    if (sets && me.state !== 'ground') reach['frames off the floor with the ball theirs to set']++;
    if (me === me0 && was === 'ground' && me.state === 'load' && me.jumpSets && f - spaceAt > 30)
      reach['jump sets the body took by itself']++;
    if (me.state === 'air') reach['frames in the air']++;
    if (sees.loading && me.state === 'ground') reach['frames the ball loaded in their hands on the floor']++;

    const state = read();
    fold(state);
    for (; folded < events.length; folded++) text(events[folded]);
    if (f % 15 === 0) samples.push({ frame: f, t: g.simTime, hash: hash.toString(16).padStart(8, '0'), state });
  }
  reach['sets by the player'] = events.filter((e) => / me set /.test(e)).length;
  reach['contacts and outcomes'] = events.length;
  // a call made on most frames (the crosshair, the load bar) is in the hash; the list keeps the ones a player would read
  const shown = calls.filter(([name]) => counts[name] < frames / 2).map(([, line]) => line);
  // the page is the next run's: every key up, the HUD and the settings as they were, no lesson, no pause
  for (const code of down) g.input.up(code);
  offs.forEach((off) => off());
  for (const name of wrapped) delete hud[name];
  Object.assign(g.settings, kept);
  if (lesson) g.stopMode();
  g.paused = false;
  // as one text: the browser hands a text over at once, and a megabyte of nested lists a value at a time
  return JSON.stringify({ samples, events, calls: shown, simTime: g.simTime, reach });
}

/**
 * Runs in the page: play one drill to a moment, stop there and paint that one frame several times.
 * Nothing is simulated or animated between the paints (`renderNow(0)`: no time passes), so every
 * paint is handed the same scene. It returns the different pictures, as PNGs, and which paint gave
 * which. One picture is the only right answer.
 */
function paintOne({ mode, pos, bot, block = 0, seconds, paints, seed }) {
  const g = window.__court;
  g.settings.replays = false;
  g.settings.firstPerson = false;
  g.settings.slowmoAssist = false;
  g.rng.reseed(seed);
  g.startMode(mode, pos);
  window.__menu.showStart(false);
  g.enableBot(bot);
  const frames = Math.round(seconds * 60);
  for (let f = 1; f <= frames; f++) {
    if (f <= block) g.input.down('KeyB');
    g.play(1 / 60);
    if (f <= block) g.input.up('KeyB');
    if (f === block && g.mode.blockLevel !== block) throw new Error(`their block did not come on: it is at level ${g.mode.blockLevel}`);
  }
  const canvas = g.renderer.domElement;
  const paint = () => {
    g.renderNow(0);
    // read in the same task as the paint: the browser has not taken the frame away yet
    return canvas.toDataURL('image/png');
  };
  const pictures = [];
  const gave = [];
  for (let k = 0; k < paints; k++) {
    const png = paint();
    let at = pictures.indexOf(png);
    if (at < 0) at = pictures.push(png) - 1;
    gave.push(at + 1);
  }
  // Is their block's shadow in the picture at all? A frame without it, or a canvas that reads back
  // blank, is one picture every time and would pass for the wrong reason. The shadow's patch and
  // its outline are the floor markers with a draw range of their own: with them hidden, the frame
  // has to be another picture.
  const shadow = (g.mode.objects ?? []).filter((o) => o.visible && o.geometry && Number.isFinite(o.geometry.drawRange.count));
  if (!shadow.length || shadow.some((o) => !o.geometry.drawRange.count))
    throw new Error("their block's shadow is not on the floor at this frame");
  for (const o of shadow) o.visible = false;
  const without = paint();
  for (const o of shadow) o.visible = true;
  if (pictures.includes(without)) throw new Error("their block's shadow is not in the picture: the frame is the same with it hidden");
  return { pictures, gave };
}

/** a fresh page of a built app, on the manual clock, in a browser context of its own (nothing stored) */
async function openPage(browser, url, label) {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const page = await context.newPage();
  const errors = [];
  // an app that throws while it starts never comes up: say why at once, not after the whole wait
  let starting = true;
  let failStart = () => {};
  const threw = new Promise((_, reject) => (failStart = reject));
  threw.catch(() => {});
  page.on('pageerror', (e) => {
    errors.push(String(e));
    if (starting) failStart(new Error(`${label}: the app threw while it was starting: ${e.message}`));
  });
  await page.addInitScript(holdTheClock);
  await page.goto(url, { timeout: PAGE_MS });
  const up = page.waitForFunction(() => window.__court && window.__menu, null, { timeout: PAGE_MS, polling: 250 });
  up.catch(() => {});
  await Promise.race([up, threw]);
  starting = false;
  return { page, errors, close: () => context.close() };
}

const nameOf = (run) =>
  run.lesson
    ? `lesson/${run.lesson}`
    : `${run.mode}/${run.pos}/${run.bot}${run.slowmo ? '/slow-mo assist' : ''}${run.block ? `/${['single', 'double'][run.block - 1]} block` : ''}`;

/** play every drill in a built app and return the traces. `replayHands`: also play each again from its logged hands */
async function record(dist, label, replayHands = false) {
  const server = await serve(dist);
  const browser = await chromium.launch({ args: GPU });
  const t0 = Date.now();
  try {
    const { page, errors, close } = await openPage(browser, server.url, label);
    const runs = [];
    const logs = new Map();
    for (const run of RUNS) {
      const name = nameOf(run);
      const { hands, ...r } = await page.evaluate(playOne, { ...run, seconds: SECONDS, seed: SEED });
      if (errors.length) throw new Error(`${label}: ${name} threw in the page: ${errors[0]}`);
      if (hands) logs.set(name, hands);
      runs.push({ name, ...r });
    }
    // a second pass over the same drills, and the lessons, for what is drawn and shown
    for (const run of [...RUNS, ...LESSONS]) {
      const name = nameOf(run);
      const d = await page.evaluate(watchOne, { seconds: DISPLAY_SECONDS, ...run, lessonKeys: LESSON_KEYS, seed: SEED });
      if (errors.length) throw new Error(`${label}: ${name} threw in the page while it was watched: ${errors[0]}`);
      const sim = runs.find((r) => r.name === name);
      if (sim) sim.display = d;
      else runs.push({ name, samples: [], events: [], simTime: 0, display: d });
    }
    await stillPlaying(page, label);
    await close();
    // last: every drill again from the hands that were logged, with no autopilot and no key pressed.
    // In a page of its own, in the same order, so each drill starts at the moment it started live.
    if (replayHands && logs.size === RUNS.length) {
      const again = await openPage(browser, server.url, `${label}, hands played back`);
      for (const run of RUNS) {
        const name = nameOf(run);
        const r = await again.page.evaluate(playOne, { ...run, seconds: SECONDS, seed: SEED, replay: logs.get(name) });
        if (again.errors.length)
          throw new Error(`${label}: ${name} threw in the page while its hands were played back: ${again.errors[0]}`);
        runs.find((x) => x.name === name).replayed = { samples: r.samples, events: r.events };
      }
      await stillPlaying(again.page, `${label}, hands played back`);
      await again.close();
    }
    const drills = runs.filter((r) => r.samples.length);
    const t1 = Date.now();
    const byKeys = await playKeys(browser, server.url, label);
    console.log(
      `${label}: ${drills.length} drills, ${SECONDS} s each, ${runs.reduce((n, r) => n + r.events.length, 0)} contacts and outcomes, and ${runs.length - drills.length} lessons, in ${((t1 - t0) / 1000).toFixed(0)} s; ${byKeys.length} runs with a person's keys, ${KEY_RUNS.reduce((n, r) => n + r.seconds, 0)} s in all, in ${((Date.now() - t1) / 1000).toFixed(0)} s`,
    );
    return [...runs, ...byKeys];
  } finally {
    await browser.close();
    server.close();
  }
}

/**
 * A page that loses its graphics context pauses the game (main.ts), and nothing it plays after that
 * moves: it would be compared as a play that differs. It is the machine's doing (a software GPU
 * starved of time), so the trace stops and says so.
 */
async function stillPlaying(page, label) {
  const stopped = await page.evaluate(() => !!window.__lostContext || window.__court.renderer.getContext().isContextLost());
  if (stopped)
    throw new Error(
      `${label}: the page lost its graphics context and the game paused itself: the machine's doing, not the play's. Run it again`,
    );
}

/**
 * Play every run of `KEY_RUNS` in a built app, one after the other in a page of their own. The
 * first is the start screen's demo, so it is played from the moment the page loads, before
 * anything is started. The runs share the page and its clock, as the drills do: a run can differ
 * only because one before it did.
 */
async function playKeys(browser, url, label) {
  const { page, errors, close } = await openPage(browser, url, `${label}, a person's keys`);
  const runs = [];
  for (const { name, reach: _, ...run } of KEY_RUNS) {
    const r = JSON.parse(await page.evaluate(keysOne, run));
    if (errors.length) throw new Error(`${label}: ${name} threw in the page: ${errors[0]}`);
    await stillPlaying(page, `${label}, ${name}`);
    runs.push({ name, byKeys: true, ...r });
  }
  await close();
  return runs;
}

const show = (v) => (typeof v === 'number' ? String(v) : `'${v}'`);

/** do two recordings of one run differ: a state after some frame, or the contacts and outcomes */
const playDiffers = (ra, rb) => ra.samples.some((s, k) => s.hash !== rb.samples[k]?.hash) || ra.events.length !== rb.events.length;

/** where two recordings of one run first differ, as lines to print: the moment, the values, the contact or outcome */
function explain(ra, rb, nameA, nameB) {
  const k = Math.max(
    ra.samples.findIndex((s, i) => s.hash !== rb.samples[i]?.hash),
    0,
  );
  const sa = ra.samples[k];
  const sb = rb.samples[k];
  const lines = [`${ra.name}: differs by frame ${sa.frame} (${(sa.frame / 60).toFixed(2)} s into the drill)`];
  const fields = sa.state.filter(([label, v], i) => sb.state[i]?.[0] !== label || sb.state[i][1] !== v);
  for (const [label, v] of fields.slice(0, 8)) {
    const other = sb.state.find(([l]) => l === label);
    lines.push(`    ${label}: ${show(v)} (${nameA}) and ${other ? show(other[1]) : 'nothing'} (${nameB})`);
  }
  if (fields.length > 8) lines.push(`    and ${fields.length - 8} more values`);
  if (!fields.length) lines.push('    the states match again at this moment: they differed in the quarter second before it');
  const e = ra.events.findIndex((x, i) => x !== rb.events[i]);
  if (e >= 0 || ra.events.length !== rb.events.length) {
    const first = e >= 0 ? e : Math.min(ra.events.length, rb.events.length);
    lines.push(
      `    first different contact or outcome: '${ra.events[first] ?? 'nothing'}' (${nameA}) and '${rb.events[first] ?? 'nothing'}' (${nameB})`,
    );
  }
  return lines;
}

/**
 * The first difference between two traces, as lines to print (none when they are the same). The
 * drills share one page and one clock, so only the first drill that differs is explained: the
 * ones after it may only differ because it did.
 */
function difference(a, b, nameA, nameB) {
  const at = a.findIndex((ra, i) => playDiffers(ra, b[i]));
  if (at < 0) return displayDifference(a, b, nameA, nameB);
  const lines = explain(a[at], b[at], nameA, nameB);
  const later = a.filter((r, i) => i > at && playDiffers(r, b[i])).map((r) => r.name);
  if (later.length) lines.push(`also different, perhaps only because of it: ${later.join(', ')}`);
  return lines;
}

/**
 * The same for the runs with a person's keys, which share a page of their own: the first that
 * differs is explained, by the play and by what the HUD is told, and the ones after it are named.
 */
function keysDifference(a, b, nameA, nameB) {
  const told = (ra, rb) => ra.calls.join('\n') !== rb.calls.join('\n');
  const differs = (ra, rb) => playDiffers(ra, rb) || told(ra, rb);
  const at = a.findIndex((ra, i) => differs(ra, b[i]));
  if (at < 0) return [];
  const ra = a[at];
  const rb = b[at];
  const lines = playDiffers(ra, rb)
    ? explain(ra, rb, nameA, nameB)
    : [`${ra.name}: the play is the same, but the HUD is told something else`];
  const c = ra.calls.findIndex((x, i) => x !== rb.calls[i]);
  if (c >= 0 || ra.calls.length !== rb.calls.length) {
    const first = c >= 0 ? c : Math.min(ra.calls.length, rb.calls.length);
    lines.push(
      `    first different thing the HUD is told: '${ra.calls[first] ?? 'nothing'}' (${nameA}) and '${rb.calls[first] ?? 'nothing'}' (${nameB})`,
    );
  }
  const later = a.filter((r, i) => i > at && differs(r, b[i])).map((r) => r.name);
  if (later.length) lines.push(`also different, perhaps only because of it: ${later.join(', ')}`);
  return lines;
}

/**
 * Does every run with a person's keys still reach what it is in the list for (`reach` in
 * `KEY_RUNS`)? A run that no longer gets there would be the same on two builds for the wrong
 * reason: nothing it was there to see would have run.
 */
function reachMissing(runs) {
  const lines = [];
  for (const { name, reach } of KEY_RUNS) {
    const got = runs.find((r) => r.name === name)?.reach ?? {};
    for (const [what, atLeast] of Object.entries(reach)) {
      const n = got[what] ?? 0;
      if (atLeast === 0 ? n !== 0 : n < atLeast)
        lines.push(`${name}: ${what}: ${n}, and this run is here for ${atLeast === 0 ? 'none' : `at least ${atLeast}`}`);
    }
  }
  return lines.length ? ["a run with a person's keys no longer reaches what it is there to check:", ...lines.map((l) => `    ${l}`)] : [];
}

/**
 * The simulation is the same: is what is drawn and shown the same too? The first drill whose
 * display differs is explained, by what the HUD was told and by where things are drawn.
 */
function displayDifference(a, b, nameA, nameB) {
  const differs = (ra, rb) =>
    !!ra.display &&
    !!rb.display &&
    (ra.display.samples.some((s, k) => s.hash !== rb.display.samples[k]?.hash) ||
      ra.display.calls.join('\n') !== rb.display.calls.join('\n'));
  const at = a.findIndex((ra, i) => differs(ra, b[i]));
  if (at < 0) return [];
  const da = a[at].display;
  const db = b[at].display;
  const lines = [`${a[at].name}: the simulation is the same, but what is drawn or shown differs`];
  const c = da.calls.findIndex((x, i) => x !== db.calls[i]);
  if (c >= 0 || da.calls.length !== db.calls.length) {
    const first = c >= 0 ? c : Math.min(da.calls.length, db.calls.length);
    lines.push(
      `    first different thing the HUD is told: '${da.calls[first] ?? 'nothing'}' (${nameA}) and '${db.calls[first] ?? 'nothing'}' (${nameB})`,
    );
  }
  const k = da.samples.findIndex((s, i) => s.hash !== db.samples[i]?.hash);
  if (k >= 0) {
    const sa = da.samples[k];
    const sb = db.samples[k];
    lines.push(`    drawn differently by frame ${sa.frame} (${(sa.frame / 60).toFixed(2)} s into the drill)`);
    const fields = sa.state.filter(([label, v], i) => sb.state[i]?.[0] !== label || sb.state[i][1] !== v);
    for (const [label, v] of fields.slice(0, 8)) {
      const other = sb.state.find(([l]) => l === label);
      lines.push(`    ${label}: ${show(v)} (${nameA}) and ${other ? show(other[1]) : 'nothing'} (${nameB})`);
    }
    if (fields.length > 8) lines.push(`    and ${fields.length - 8} more values`);
    if (!fields.length)
      lines.push('    the difference is in a pose, a marker or a HUD value that changes every frame, not in where things stand');
  }
  const later = a.filter((r, i) => i > at && differs(r, b[i])).map((r) => r.name);
  if (later.length) lines.push(`also different, perhaps only because of it: ${later.join(', ')}`);
  return lines;
}

/**
 * Does every drill of one recording give the same play when its logged hands are played back? The
 * first that does not is explained, as a difference between two builds is.
 */
function replayDifference(runs) {
  const replayed = runs.filter((r) => r.replayed);
  if (!replayed.length) return [];
  const lines = difference(
    replayed,
    replayed.map((r) => ({ name: r.name, ...r.replayed })),
    'the autopilot playing',
    'its hands played back',
  );
  return lines.length ? ['the same hands did not give the same play:', ...lines] : [];
}

/** the end of the last line: how many drills were played back from their hands */
const replayNote = (runs) => {
  const n = runs.filter((r) => r.replayed).length;
  return n
    ? `; ${n} drills give the same play again from their logged hands alone`
    : '; this build does not log hands, so none were played back';
};

/** the part of the last line about the runs with a person's keys. `like`: what they were the same as */
const keysNote = (like) => `; ${KEY_RUNS.length} runs with a person's keys play the same ${like}, and each reaches what it is there for`;

/** a run played with a person's keys (`KEY_RUNS`), and the others: the drills and the lessons */
const byKeys = (r) => !!r.byKeys;
const drill = (r) => !r.byKeys;

const save = (name, runs) => fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(runs));

/**
 * Paint one frozen frame of a built app several times (`FROZEN`) and return what is wrong as lines
 * to print: none when every paint gave the same picture. It has a browser and a page of its own, so
 * nothing it does (the first paint compiles every shader) reaches the runs before it. When the
 * pictures differ they are written to scripts/out/trace/ to be looked at.
 */
async function frozenFrame(dist) {
  const name = nameOf(FROZEN);
  for (const f of fs.readdirSync(out)) if (/^frozen-frame-\d+\.png$/.test(f)) fs.rmSync(path.join(out, f));
  const server = await serve(dist);
  const browser = await chromium.launch({ args: GPU });
  const t0 = Date.now();
  try {
    const { page, errors } = await openPage(browser, server.url, 'the frozen frame');
    const { pictures, gave } = await page.evaluate(paintOne, { ...FROZEN, seed: SEED });
    if (errors.length) throw new Error(`${name} threw in the page while its frame was painted: ${errors[0]}`);
    const n = pictures.length;
    console.log(
      `frozen frame: ${name}, ${FROZEN.seconds} s in, painted ${FROZEN.paints} times: ${n} ${n === 1 ? 'picture' : 'pictures'}, in ${((Date.now() - t0) / 1000).toFixed(0)} s`,
    );
    if (n === 1) return [];
    pictures.forEach((png, i) => fs.writeFileSync(path.join(out, `frozen-frame-${i + 1}.png`), Buffer.from(png.split(',')[1], 'base64')));
    return [
      `${name}: one frozen frame, ${FROZEN.seconds} s into the drill, painted ${FROZEN.paints} times in one page, gave ${n} different pictures`,
      '    nothing moved between the paints, so the GPU decided something the game did not: look for a depth, an order or an offset that is left open',
      `    paint by paint, the pictures were ${gave.join(', ')}: scripts/out/trace/frozen-frame-1.png to frozen-frame-${n}.png`,
    ];
  } finally {
    await browser.close();
    server.close();
  }
}

/** the end of the last line, after the frozen frame came out as one picture */
const FROZEN_NOTE = `; one frozen frame of ${nameOf(FROZEN)}, painted ${FROZEN.paints} times, is one picture`;

/** check out a commit beside this one and build it. It uses this checkout's node_modules when the lockfile is the same. */
function buildRef(ref) {
  const dir = path.join(out, 'base');
  try {
    git(['worktree', 'remove', '--force', dir]);
  } catch {
    // no such worktree yet
  }
  git(['worktree', 'add', '--detach', dir, ref]);
  const sameLock =
    fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8') === fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
  if (sameLock) fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  else execFileSync('npm', ['ci'], { cwd: dir, stdio: ['ignore', 'inherit', 'inherit'] });
  const dist = path.join(out, 'base-dist');
  build(dir, dist);
  git(['worktree', 'remove', '--force', dir]);
  return dist;
}

fs.mkdirSync(out, { recursive: true });
const [command = 'self', arg] = process.argv.slice(2);
const headDist = path.join(out, 'head-dist');
build(root, headDist);
let lines;
if (command === 'compare') {
  const ref = arg ?? git(['merge-base', 'HEAD', 'origin/main']);
  const sha = git(['rev-parse', '--short=7', ref]);
  console.log(
    `comparing this checkout (${git(['rev-parse', '--short=7', 'HEAD'])}${git(['status', '--porcelain']) ? ' with local changes' : ''}) with ${arg ?? 'where it left origin/main'} (${sha})`,
  );
  const base = await record(buildRef(ref), sha);
  const head = await record(headDist, 'this checkout', true);
  save('base', base);
  save('head', head);
  lines = difference(base.filter(drill), head.filter(drill), sha, 'this checkout');
  if (!lines.length) lines = keysDifference(base.filter(byKeys), head.filter(byKeys), sha, 'this checkout');
  if (!lines.length) lines = reachMissing(head);
  if (!lines.length) lines = replayDifference(head);
  if (!lines.length) lines = await frozenFrame(headDist);
  if (!lines.length)
    console.log(
      `same play: every drill gives the same states, contacts and outcomes as ${sha}, and is drawn and shown the same${keysNote(`as on ${sha}`)}${replayNote(head)}${FROZEN_NOTE}`,
    );
} else if (command === 'self') {
  const first = await record(headDist, 'first run', true);
  const second = await record(headDist, 'second run');
  save('head', first);
  lines = difference(first.filter(drill), second.filter(drill), 'first run', 'second run');
  if (!lines.length) lines = keysDifference(first.filter(byKeys), second.filter(byKeys), 'first run', 'second run');
  if (!lines.length) lines = reachMissing(first);
  if (!lines.length) lines = replayDifference(first);
  if (!lines.length) lines = await frozenFrame(headDist);
  if (!lines.length)
    console.log(
      `repeatable: two runs of this checkout give the same states, contacts and outcomes, and are drawn and shown the same${keysNote('both times')}${replayNote(first)}${FROZEN_NOTE}`,
    );
} else {
  console.error(`unknown command '${command}': use 'self' or 'compare [ref]'`);
  process.exit(2);
}
if (lines.length) {
  console.error(lines.join('\n'));
  process.exit(1);
}
