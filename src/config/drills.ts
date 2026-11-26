// Each drill's own numbers, and the lessons'. Owner: the drills.
//
// What each section controls:
//
// `BLOCK_DRILL`, `FREE_PLAY`, `MINI_RALLY`, `RECEIVE_DRILL`, `SERVE_DRILL`, `SETTER_DRILL`,
// `SPIKE_DRILL`: Each drill's own numbers, under the same keys where a drill has them: who is on
// court and where (`cast`), the ball the drill sends (`feed`), how long each part of a rep lasts
// (`timing`), what a rep scores (`points`), how much each result lifts the crowd (`crowd`), how
// long the drill's lines stay up (`say`) and how far off the start spot you may end a rep before
// you are walked back (`slack`). `COACH_TOSS`: the coach's toss to the setter, one toss for the
// Spike, Block and Receive drills. `RUN_UP_GO`: how fast the run-up guide's GO pulse dies away
// (Spike and Serve drills). `SET_PICK`: the ring at the spot your set goes to and the line for a
// call that comes too late (Setter drill and Mini Rally)
//
// `TUTORIAL`: The first-run lesson and the serve lessons: their speeds (together, slow motion), how
// early cues show, how long the coach's lines stay, tries per rep, where the coach aims a serve and
// when a float's draw cue comes

/**
 * The Serve drill (src/game/modes/serveDrill.ts). The server starts `x` m right of the middle of
 * the end line (servers come from right back) and is walked back there between reps when more
 * than `startSlack` m off. A serve nobody has played or called `flightMax` s after the hit is
 * out. The rep ends when the serve is rated (their pass, an ace or a fault): the ball is dead and
 * the next rep starts `result` s later, long enough to see the pass leave the passer's arms and
 * read the rating (the Spike Drill's next set comes `SPIKE_DRILL.timing.result` s after a rep). It used to wait for the
 * receiving team to play the pass out to their attack; that made a rep twice as long, for what the
 * rating already says. Owner's call, after playing it.
 * A third-person camera starts the drill looking `lookDepth` m into their court, where a serve
 * goes: a full-power jump serve aimed shorter than about 7 m is in the net (the start screen
 * leaves the camera on mid-court, a spike's aim). In first person you look up at your toss, which
 * aims deep by itself.
 * The grade of a serve is shown to one side of the flight, not over it: from behind the server the
 * ball is 15 m away and a few pixels wide, and the grade text sat exactly on its path. (Tried
 * and taken out for now: narrowing the third-person view to half its field of view while the serve
 * is in the air, so a float's break could be seen from the end line.)
 * The three receivers' kit seeds count up from `cast.seed`. The crowd lifts by `crowd.ace` for an
 * ace (a serve rated 4) and `crowd.rated3` for a serve rated 3 (an overpass, or a pass out of
 * system), and not at all below that. `say` (s) is how long the opening line and the line naming
 * the serve you picked stay up. These five were tuned by play and first seen in the drill's first
 * commit (40cb538, 2026-11-14).
 * The serve's rating itself (0 to 4, the scale coaches chart serves on) is not a number to tune and
 * stays in the drill, as does the conversion from m/s to km/h.
 */
export const SERVE_DRILL = {
  x: 2,
  lookDepth: 7.8,
  startSlack: 0.5,
  flightMax: 6,
  result: 1.5,
  cast: { seed: 70 },
  crowd: { ace: 0.8, rated3: 0.4 },
  say: { intro: 3.5, pick: 1.6 },
} as const;

/**
 * Every drill has a section of its own here, as the Serve drill has above, so a drill's feel is
 * tuned in this file and a difficulty can override it by name (docs/adr/0012). Where a drill has
 * them, the keys come in this order:
 * - `cast`: who is on court. `seed` is the look of each athlete's kit (`addAthlete`), and a spot
 *   is in metres on the court (the net is z = 0, the home team plays on +z).
 * - `feed`: the ball the drill sends.
 * - `timing` (s): how long each part of a rep lasts.
 * - `points`: what a rep scores.
 * - `crowd`: how much each result lifts the crowd (the amount handed to `DrillHost.crowd`).
 * - `say` (s): how long each of the drill's lines stays on the HUD.
 * - `slack` (m): how far off the start spot the player may end a rep before they are walked back.
 *
 * Where no reason is written for a number, none was recorded when it went in: it was tuned by
 * play, and the comment names the commit it was first seen in (`git log -S`).
 */

/**
 * The coach's toss to the setter starts a rep in the Spike drill, and in the Block and Receive
 * drills on the far side (mirrored there). The ball leaves `hand.x` m to the side of the coach's
 * feet and `hand.z` m nearer the net, `hand.y` m up. It is solved to come down through `targetY` m
 * over the setter's target (`SETTER_TARGET`, src/game/plays.ts) and to top out `apexAbove` m over
 * that target's height, rolling forward at `spin` rad/s. The same six numbers were written into
 * each of the three drills; they have one name so the three stay one toss. Tuned by play: first
 * seen in the Spike drill (8c7183c, 2026-11-02), then copied to the Block drill (0e1afe2) and the
 * Receive drill (9dee160).
 */
export const COACH_TOSS = {
  hand: { x: 0.1, y: 1.35, z: 0.3 },
  targetY: 2.1,
  apexAbove: 0.4,
  spin: 3,
} as const;

/**
 * The GO of the run-up guide, in the Spike drill and under the toss of the Serve drill's two jump
 * serves: at the moment a full run-up would start, the guide at your plant spot pulses, and the
 * pulse dies away at `fade` a second (it is gone in 0.4 s). Tuned by play: first seen in the Spike
 * drill (659dff6, 2026-11-02) and written again for the Serve drill (40cb538, 2026-11-14).
 */
export const RUN_UP_GO = { fade: 2.5 } as const;

/**
 * Your pick as the setter, in the Setter drill and in the Mini Rally (as its setter, or as the
 * libero backing up). A hitter's ring on the floor is drawn `ring.back` m further from the net
 * than their spot, and the ring your set goes to is lit to `ring.lit` (0..1). When you ask a
 * hitter for their fast set too late, the line that says they are committed stays up `late` s.
 * Both drills held the same three numbers; they have one name so the setter sees one thing in
 * both. Tuned by play: the ring was first seen in 050f289 (2026-11-07) and the line in 449976b
 * (2026-11-14).
 */
export const SET_PICK = { ring: { back: 0.15, lit: 0.95 }, late: 1.2 } as const;

/**
 * The Block drill (src/game/modes/blockDrill.ts): their coach tosses (`COACH_TOSS`), their setter
 * sets one of three hitters, and you block. Its numbers were tuned by play and first seen in the
 * drill's first commit (0e1afe2, 2026-11-02), apart from the two said otherwise.
 * - `cast`: you start `baseZ` m off the net (along the net: in front of their middle, where their
 *   quick is hit). Their setter's kit seed is `seed.setter`, the three hitters count up from
 *   `seed.hitters`, and their coach, at `coach` in their back court, has `seed.coach`.
 * - `feed.mine`: the share of sets that go to the hitter your position blocks in a match. The
 *   rest go to any of the three.
 * - `timing`: the first rep starts `intro` s after the drill does. In each rep the coach's arm
 *   starts `toss` s in and the ball leaves the hand at `release`. A rep nobody ended is over
 *   `liveMax` s after the toss, and the result stays up `result` s.
 * - `points`: `stuff` for a Perfect block that lands on their floor and `block` for any other that
 *   does, `soft` for a touch that stays in play or lands on yours, `tooled` when the ball goes out
 *   off your hands, `hitterError` when they hit it out untouched.
 * - `crowd`: for a stuff, a block point and a soft block.
 * - `say.intro`: the opening line (142263c, 2026-11-02).
 * - `slack`: small, so you are walked back to the same spot after nearly every rep and every read
 *   starts from the same place (8259b6b, 2026-11-03: it was 0.8 m).
 */
export const BLOCK_DRILL = {
  cast: {
    baseZ: 0.5,
    seed: { setter: 21, hitters: 22, coach: 4 },
    coach: { x: -3.4, z: -6.6 },
  },
  feed: { mine: 0.45 },
  timing: { intro: 1.2, toss: 0.3, release: 0.57, liveMax: 8, result: 2 },
  points: { stuff: 150, block: 100, soft: 60, tooled: 20, hitterError: 10 },
  crowd: { stuff: 1.2, block: 0.8, soft: 0.3 },
  say: { intro: 3.6 },
  slack: 0.15,
} as const;

/**
 * Free Play (src/game/modes/freePlay.ts): a ball machine sends the feed you chose (keys 1-4: a
 * set to you, a free ball, a float serve, a hard attack) and everything else is up to you. Its
 * numbers were tuned by play and first seen in the drill's first commit (9dee160, 2026-11-02).
 * - `machine`: where it stands for each feed: `set.behind` m behind the setter's spot
 *   (`SETTER_SPOT`) for a set, and a spot in their court for the others. For the attack it is drawn
 *   `tall` times its size. Every ball but a set leaves `mouth` m in front of it, toward the net.
 *   Its lamp is `lamp.soon` (red, green, blue; over 1 glows) from `lamp.before` s before a ball
 *   comes, and `lamp.idle` otherwise.
 * - `feed`: each ball leaves `fromY` m up. A free ball, a serve and an attack are aimed at you, off
 *   by a gaussian `spreadX` and `spreadZ` m. The free ball comes down to `toY` m and tops out
 *   between `apex` and `apex` + 1 m. The serve is a float at `speed` to `speed` + `speedRange` m/s,
 *   leaving between `angleMin` and `angleMax` rad of elevation. The attack is hit at `speed` to
 *   `speed` + `speedRange` m/s with `spin` rad/s of topspin.
 * - `timing`, with auto-feed on: the waits before a ball comes. A wait only runs down while no ball
 *   is in play (the last one is gone or lying still) and you are not serving one yourself. It is
 *   `first` s when the drill starts, `picked` s after you pick a feed and `restart` s after N.
 *   When a ball leaves the machine the wait is set to `between` s, and when that ball is called
 *   (in or out) it is cut to `afterOutcome` s: so the next ball comes `afterOutcome` s after a
 *   called ball has stopped, and `between` s after one that stopped without a call.
 * - `points`: for each of your touches, by its grade (a Miss scores nothing).
 * - `crowd.in`: your ball lands in their court.
 * - `say.intro`: the opening line.
 * One number stays in the drill: the 1000 that spreads the dice into a seed for the ball's float.
 */
export const FREE_PLAY = {
  machine: {
    set: { behind: 0.2 },
    free: { x: 0, z: -6.5 },
    serve: { x: 1.5, z: -10.2 },
    attack: { x: -0.5, z: -2.2 },
    tall: 1.6,
    mouth: 0.3,
    lamp: { soon: [2.5, 2.2, 0.4], idle: [0.3, 1.6, 0.4], before: 0.6 },
  },
  feed: {
    set: { fromY: 2.3 },
    free: { fromY: 1.2, spreadX: 1.2, spreadZ: 1, toY: 1, apex: 5.5 },
    serve: { fromY: 2.9, spreadX: 1, spreadZ: 1, speed: 16, speedRange: 2, angleMin: -0.4, angleMax: 0.6 },
    attack: { fromY: 2.85, spreadX: 0.9, spreadZ: 0.8, speed: 19, speedRange: 5, spin: 45 },
  },
  timing: { first: 1.5, picked: 0.8, restart: 0.4, between: 2.2, afterOutcome: 1.8 },
  points: { perfect: 30, good: 15, other: 5 },
  crowd: { in: 0.4 },
  say: { intro: 3.5 },
} as const;

/**
 * The Setter drill (src/game/modes/setterDrill.ts): a passer in the back court passes to you, you
 * set one of your four hitters and they finish against their six. Its pace is `TIMING.setterDrill`
 * (it had a name before the drills had sections). The rest was tuned by play and first seen in the
 * drill's first commit (9dee160, 2026-11-02), apart from the ones said otherwise.
 * - `cast`: you start `behind` m behind the setter's spot (`SETTER_SPOT`) with the camera pitched
 *   `lookPitch` rad. Your hitters' kit seeds count up from `seed.hitters` and their six from
 *   `seed.defence` (449976b, 2026-11-14); the passer, at `passer`, has `seed.passer`. `hitterSkill`
 *   is your hitters' skill, in place of `AI.hitterSkill`: the nearer 1, the smaller the error in
 *   the timing of their swing.
 * - `rings`: the size of the ring on the floor at each hitter's spot (`hitter`) and of the one
 *   where your dump lands (`dump`, 449976b). The ring your set goes to is lit (`SET_PICK.ring`),
 *   the others to `dim` (0..1).
 * - `feed`: every `wideEvery`th pass is off the net: its target is spread by `wide` m, the others
 *   by `tight` m. That spread is a gaussian away from the net, and `alongNet` of it along the net.
 *   The pass leaves the passer's arms `fromY` m up and `fromAhead` m in front of their feet, comes
 *   down to `toY` m at the setter's target (`SETTER_TARGET`) and tops out between `apex` and
 *   `apex` + `apexRange` m, with `spin` rad/s on it.
 * - `points`: for your set, by its grade (`perfect`, `good`, `other`), and `kill` more when your
 *   hitter puts it down.
 * - `crowd.kill`: your hitter's kill.
 * - `say`: the opening line, the line when you change row (449976b) and the line for a pass off
 *   the net (449976b). The line for a call that comes too late is `SET_PICK.late`.
 * - `slack` (142263c, 2026-11-02: it was 2.2 m in the first commit).
 */
export const SETTER_DRILL = {
  cast: {
    behind: 0.3,
    lookPitch: 0.25,
    seed: { hitters: 41, passer: 6, defence: 47 },
    passer: { x: -1, z: 6.8 },
    hitterSkill: 0.82,
  },
  rings: { hitter: 1, dump: 0.9, dim: 0.25 },
  feed: {
    wideEvery: 4,
    wide: 1.6,
    tight: 0.6,
    alongNet: 0.6,
    fromY: 0.85,
    fromAhead: 0.4,
    toY: 2.35,
    apex: 4.2,
    apexRange: 0.6,
    spin: 2,
  },
  points: { perfect: 100, good: 60, other: 25, kill: 50 },
  crowd: { kill: 0.7 },
  say: { intro: 3.2, row: 2.2, offNet: 2 },
  slack: 1,
} as const;

/**
 * The Serve Receive drill (src/game/modes/receiveDrill.ts): float serves, and every
 * `feed.attackEvery`th ball an attack off their coach's toss (`COACH_TOSS`). You pass to the
 * setter's target, and your setter and a hitter finish a good pass. Tuned by play and first seen
 * in the drill's first commit (9dee160, 2026-11-02), apart from `slack`.
 * - `cast`: where you receive from, by position (`spot`), where their server and their coach
 *   stand, and the kit seeds.
 * - `target`: a pass is aimed, and read, where it comes down through `y` m over the setter's
 *   target (`SETTER_TARGET`), and it tops out at `apex` m. The ring on the floor there has
 *   colour `ring` and size `ringSize`, and the halo at `y` turns at `haloTurn` rad/s.
 * - `rate`: how a pass is rated 0 to 3, here and in the Serve drill (which rates a serve by the
 *   pass it forces). Within `three` m of the target is a 3 and within `two` m a 2. Further off it
 *   is a 1 while a team-mate could still play it: no more than `playable.side` m from the middle
 *   of the court (the sideline is at 4.5), `playable.past` m past the net and `playable.deep` m
 *   from it (the end line is at 9). Anything else, and a pass that goes over the net, is a 0. The
 *   scale itself (the 3 of a perfect pass) stays in the drill.
 * - `attack`: their hitter in the dig rep. They aim at you, off by a gaussian `spreadX` and
 *   `spreadZ` m, tip `tipChance` of the time and swing with `skill` (`HitterBrain`).
 * - `feed`: a serve is aimed at you, off by a gaussian `spreadX` and `spreadZ` m, from up to
 *   `serveFrom` m either side of the middle of their end line.
 * - `timing`: the first rep starts after `intro` s. In a dig rep the coach tosses `toss` s in and
 *   their arm comes down `arm` s later. A rep is over after `liveMax` s, or as soon as the ball
 *   lies still and the rep is more than `rest` s old, and the result stays up `result` s.
 * - `points`: by the pass's rating, 0 to 3.
 * - `crowd`: `good` for a pass rated 2 or 3, `other` for any other pass.
 * - `say`: the opening line, the line that names the feed and the points.
 * - `slack` (142263c, 2026-11-02).
 */
export const RECEIVE_DRILL = {
  cast: {
    spot: {
      OH: { x: -2.4, z: 6.4 },
      L: { x: 0, z: 6.6 },
      OPP: { x: 2.4, z: 6.4 },
      MB: { x: -0.8, z: 5.6 },
      S: { x: 1.6, z: 6.2 },
    },
    server: { x: 0, z: -10 },
    coach: { x: -3.2, z: -6.8 },
    seed: { server: 31, theirSetter: 32, theirHitter: 33, coach: 5, setter: 34, hitter: 35 },
  },
  target: { y: 2.35, apex: 4, ring: 0x7dff9b, ringSize: 1.8, haloTurn: 1.2 },
  rate: { three: 0.9, two: 1.9, playable: { side: 5.5, past: 0.2, deep: 9.5 } },
  attack: { spreadX: 0.9, spreadZ: 0.8, tipChance: 0.05, skill: 0.85 },
  feed: { attackEvery: 3, spreadX: 1, spreadZ: 0.9, serveFrom: 3 },
  timing: { intro: 1.2, toss: 0.6, arm: 0.4, liveMax: 11, rest: 2, result: 2.4 },
  points: [0, 20, 60, 100],
  crowd: { good: 0.35, other: 0.05 },
  say: { intro: 3, feed: 1, points: 1.2 },
  slack: 1.2,
} as const;

/**
 * The Spike drill (src/game/modes/spikeDrill.ts): the coach tosses to your setter (`COACH_TOSS`),
 * the setter sets your lane and you attack a target zone. Tuned by play and first seen in the
 * drill's first commit (8c7183c, 2026-11-02), apart from the ones said otherwise.
 * - `cast`: your setter's and the coach's kit seeds, and where the coach stands on your court,
 *   turned `coach.yaw` rad when placed.
 * - `zones`: the target zones on their court, each a rectangle from `x0` to `x1` and `z0` to `z1`.
 *   `pin` is for a left-side attacker and is mirrored for the opposite and the setter. A middle
 *   hits zone 1 or zone 5 (`middle`, 729d7bb, 2026-11-02).
 * - `block` (ce94650, 2026-11-03): key B puts up a pin blocker fronting your lane (`pin`) and then
 *   a middle closing next to them (`middle`). Each may shuffle `range` m along the net from home,
 *   and the middle closes `closeInside` m inside the attack point. They stand at z = `homeZ`, and
 *   one that is off is parked at `park` in their free zone (mirrored for the first). The shadow on
 *   their floor is drawn for hands reaching `handsAboveNet` m over the tape.
 * - `feed.setterApexAbove`: as the setter you attack the coach's toss, which tops out this much
 *   higher than a set to that lane would.
 * - `guide`: a set that tops out less than `fastSetApex` m over your contact needs the run to
 *   start before the set, so its run is planned from the pass (729d7bb, 2026-11-02, with the set
 *   calls). GO is given only for a run that ends within `goError` m of the spot (659dff6,
 *   2026-11-02); its pulse is `RUN_UP_GO`.
 * - `timing`: the first rep starts `intro` s after the drill does (`lessonIntro` in the first-run
 *   lesson, 1dd9e8a, 2026-11-04). The coach's arm starts `toss` s into a rep and the ball leaves
 *   at `release`. A rep nobody ended is over `liveMax` s after the toss and the result
 *   stays up `result` s.
 * - `points`: by the grade of your contact (`perfect`, `good`, `other`), one for every km/h over
 *   `speedOver`, `kill` when it lands in their court and `onTarget` more inside the zone. A ball
 *   tooled off their block scores the grade plus `tooled` (ce94650).
 * - `crowd`: `perfect` for a good kill off a full Perfect (`ContactEvent.perfect`: a Perfect that
 *   is not a tip and was at least half charged), `good` for any other good kill, and `other` for
 *   everything else.
 * - `say`: the opening line (729d7bb), the line when you change the block (ce94650) and when you
 *   call a set (729d7bb).
 * - `slack` (142263c, 2026-11-02, and the same from 729d7bb when you call another set).
 * Two numbers stay in the drill: the 3 block levels B cycles through and the conversion from m/s
 * to km/h.
 */
export const SPIKE_DRILL = {
  cast: {
    seed: { setter: 11, coach: 3 },
    coach: { x: 3.6, z: 6.4, yaw: 0.35 },
  },
  zones: {
    pin: [
      { name: 'Deep line', x0: -4.5, x1: -1.8, z0: -9, z1: -6 },
      { name: 'Deep cross', x0: 1.8, x1: 4.5, z0: -9, z1: -6 },
      { name: 'Seam', x0: -1.5, x1: 1.5, z0: -7.5, z1: -4.5 },
      { name: 'Sharp cut', x0: 1.5, x1: 4.5, z0: -4.2, z1: -1.5 },
      { name: 'Line short', x0: -4.5, x1: -2, z0: -4.5, z1: -2 },
    ],
    middle: [
      { name: 'Zone 1 (deep left)', x0: -4.5, x1: -1.5, z0: -9, z1: -5.6 },
      { name: 'Zone 5 (deep right)', x0: 1.5, x1: 4.5, z0: -9, z1: -5.6 },
    ],
  },
  block: {
    pin: { range: 1.5, closeInside: 0, seed: 47 },
    middle: { range: 4.6, closeInside: 0.95, seed: 48 },
    homeZ: -0.5,
    park: { x: 6.3, z: -2.5 },
    handsAboveNet: 0.35,
  },
  feed: { setterApexAbove: 0.6 },
  guide: { fastSetApex: 1, goError: 0.6 },
  timing: { intro: 1.2, lessonIntro: 0.45, toss: 0.35, release: 0.62, liveMax: 7, result: 1.9 },
  points: { perfect: 100, good: 60, other: 30, tooled: 50, speedOver: 70, kill: 50, onTarget: 100 },
  crowd: { perfect: 1, good: 0.6, other: 0.1 },
  say: { intro: 3.6, block: 1.8, call: 1.6 },
  slack: 0.6,
} as const;

/**
 * The Mini Rally (src/game/modes/miniRally.ts): six against six, with you in your position.
 * Tuned by play and first seen in the drill's first commit (9472bd3, 2026-11-02), apart from the
 * ones said otherwise. How the two teams play is `AI`, not here.
 * - `cast.seed`: the kit seeds of your five team-mates, then of their six, count up from here.
 * - `maxTouches`: a rule of the sport, not a number to tune: a team has at most three hits to
 *   return the ball, and a fourth is the fault FOUR HITS (FIVB rule 9.1).
 * - `freeOver`: a third ball sent over without an attack, by you or by an AI player who is diving
 *   or on the run (one standing aims it: `AI.freeOver`), is aimed `depth` m into their court,
 *   anywhere across `width` m of it, to come down to `y` m after topping out at `apex` m.
 * - `ring`: the ring at the spot you are setting to: its first colour (the hitter's colour
 *   replaces it) and its size. Where it lies and how it is lit is `SET_PICK.ring`, as in the Setter
 *   drill.
 * - `marker`: the colour of the ball's landing marker (red, green, blue): green when the ball is
 *   yours, and the marker's own cyan otherwise (the cyan: 0ef3e42, 2026-11-03).
 * - `netHint`: within this distance (m) of the net the hint line is the blocker's.
 * - `timing`: the serve comes `prepare` s after the teams are set. A serve not hit `serveMax` s
 *   later is taken again. A ball lying on the floor ends the point once the rally is `rest` s old,
 *   and the next point is set up `dead` s after one ends.
 * - `crowd`: for your own kill, any other point of yours, and a point of theirs.
 * - `say`: the opening line, the line when you call a set (f234f1e, 2026-11-03), "Your ball!" and
 *   the libero's MINE! (6ff2d88, 2026-11-14). The line for a call that comes too late is
 *   `SET_PICK.late`.
 * - `slack`, and `walkBackMax`: the walk back to your spot is given this long (s), in place of
 *   `PLAYER.walkBack.maxT` (142263c, 2026-11-02).
 * One number stays in the drill, written three times: the 0.42 m a call's bubble sits over the
 * head of whoever calls. It is inside a callback handed to the HUD, and the trace compares the
 * text of that callback (scripts/trace.mjs), so giving it a name reads as a change to what is
 * shown, although the bubble is where it was. It gets its name in a change that is not a
 * `refactor`, or once the trace reads where the callback puts the bubble.
 */
export const MINI_RALLY = {
  cast: { seed: 50 },
  maxTouches: 3,
  freeOver: { width: 5, depth: 6.5, y: 0.5, apex: 5.2 },
  ring: { colour: 0xffffff, size: 1 },
  marker: { yours: [0.35, 1, 0.45], other: [0.3, 0.85, 1] },
  netHint: 1.4,
  timing: { prepare: 1.6, serveMax: 6, rest: 1, dead: 2.6 },
  crowd: { yourKill: 1.2, yours: 0.7, theirs: 0.25 },
  say: { intro: 2.5, call: 1.6, yours: 0.9, mine: 1 },
  slack: 0.6,
  walkBackMax: 1.5,
} as const;

/**
 * The first-run lesson (game/tutorial.ts). Three reps of the Outside high ball, with less help
 * each time: together (the ball waits for you), slow motion (you drive, nothing waits), full
 * speed. Speeds are fractions of real time. None of this touches the grading windows.
 */
export const TUTORIAL = {
  /** how fast the lesson's clock eases to the speed a moment asks for (1/s). A moment the ball waits at is taken at once. Tuned by play */
  clockEase: 10,
  /** the welcome line, before the first toss (s, real time; any key moves on) */
  welcome: 2.2,
  /** the coach's line after a rep (s, real time; any key moves on after `resultMin`) */
  result: 3.6,
  resultMin: 1,
  /** together: the set in flight before your run, your run, the plant, and in the air */
  watchScale: 0.6,
  runScale: 0.7,
  plantScale: 0.5,
  airScale: 0.35,
  /** together: time eases down over this long (s, game time) into a moment you have not acted on yet, to no slower than `crawl` of the speed */
  easeLead: 0.16,
  crawl: 0.25,
  /** a cue shows this long (s, game time) before its moment */
  cueLead: 0.45,
  /** when you drive, a cue shows a reaction time (s, game time) before its moment, so acting on it is on time */
  reactLead: 0.12,
  /** together: you rise this long (s, game time) before the arm cue */
  drawDelay: 0.07,
  /** together: the ball is held this late (s) in the Perfect window for your release */
  sweetErr: 0.015,
  /** together: the coach aims your swing this deep (m) into their court, straight down your line */
  aimDepth: 6.5,
  /**
   * The serve lessons (one per serve, on the Serve Drill: toss, then the spike's run, jump, draw
   * and hit). Together, the coach aims the serve `serveAimDepth` m deep (a full-power jump serve
   * aimed shorter than about 7 m is in the net), and a standing float's draw cue comes
   * `floatDraw` s before its best contact: time to draw the arm all the way (`TIMING.chargeFull`)
   * and a reaction time more.
   */
  serveAimDepth: 7.8,
  floatDraw: 0.55,
  /** slow motion rep: the speed from the set to your landing */
  slowScale: 0.6,
  /** tries at the together rep, the slow rep and the full-speed rep before the lesson moves on anyway */
  tries: 2,
  /** back from a pause, a release of the attack button within this long (s, real time) is the click that took the pointer back, not a swing */
  resumeGrace: 0.4,
  /** nothing pressed for this long (s, real time) while the ball waits: the cue pulses harder and Skip lights up */
  nudge: 6,
  /** a rep where you moved less than this (m) from the start never ran */
  ranDist: 1,
};
