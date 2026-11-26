// The ball in the air and against the floor, the net, the tape and the antennae. Owner: physics.
//
// What each section controls:
//
// `BALL`: Drag, Magnus scale, restitution and friction for the floor; the net's top (`tape`: its
// mass and spring each way, grip, the band) and the antenna rod (`antenna`: the fibreglass, its
// bends and how fast they die, how hard the ball's skin presses on it, the grip, the side of the
// net it is strapped to); the float (`float`: how hard a no-spin ball breaks, how long it flies
// true between breaks and how long a break lasts, how often it breaks downward, the critical speed
// under which it dies, and how old everyone's read of a floating ball is); the soft net (`netGive`,
// `netStiffness`, `netDampingRatio`, `netReturn`, `netRestitution`, `netGrip`)

export const BALL = {
  radius: 0.105,
  mass: 0.27,
  gravity: 9.81,
  airDensity: 1.2,
  /** drag coefficient. Real volleyballs sit ~0.2-0.3 at spike Reynolds numbers: they are past the drag crisis, so not the 0.47 of a smooth sphere */
  dragCoefficient: 0.26,
  /** multiplier on the physically derived Magnus force (1 = Cl ~ r*w/v) */
  magnusScale: 1.0,
  /** spin decays with this time constant */
  spinDecayTime: 3.0,
  floorRestitution: 0.66,
  floorFriction: 0.32,
  /** The net is a soft mesh: the ball sinks into it, dies and drops down the net, as a ball
   * driven into a real net does (it comes out within about a metre of it, not bounced back off a
   * wall). The give is kept within the ball's radius; the drawn mesh goes in with the ball
   * (`ARENA.net`). */
  netGive: 0.08,
  /** the mesh's spring (rad/s) and its damping ratio (> 1: it eases the ball back out, no bounce) */
  netStiffness: 35,
  netDampingRatio: 1.5,
  /** ...and only part of that damping (this share) as it pushes the ball back out, so a hard ball pops
   * out a little (about half a metre) while a soft one drops down the net */
  netReturn: 0.3,
  /** what is left of the ball's speed into the net once the mesh is taut */
  netRestitution: 0.1,
  /** the mesh grips the ball: its sideways and upward speed die at this rate (1/s) while it is in */
  netGrip: 18,
  /**
   * The top of the net: a 7 cm band (FIVB 2.3) hanging from a cable in its top hem. A ball whose
   * centre is above the cable meets the net's top, which is not a fixed rod: the ball pushes a mass
   * (the cable with the net hanging on it) that springs back, so how much of its speed it keeps
   * depends on how squarely it meets it and how hard. The top is light and soft along the court
   * (the whole net swings back with the ball) and heavier and firmer pressed down (the net's height
   * is held by its tension), and it grips the ball's cover, so the way in, the speed and the spin
   * decide what happens: a serve that clips it carries on over, slowed, and the thinner the clip the
   * further it goes; one that meets it square dies and drops close to the net; a ball dropped on it
   * hardly bounces and rolls off the way it was going; topspin carries it on over, backspin checks
   * it. A ball sitting low on the cable has its lower part in the band, which grips it like the mesh
   * (`netGrip`, `band` times over with its centre level with the cable); one whose centre is under
   * the cable is in the band and the mesh (`netGive`) and drops on its own side.
   *
   * - `cable`: radius of the cable in its hem (m); its centre is this far under the net's top
   * - `mass`, `swing`: the top's mass (kg) and spring (rad/s) along the court; `massUp`, `swingUp`:
   *   pressed down; `damping`: its damping ratio both ways
   * - `restitution`: what is left of the speed into it after the push (between the ball and the top)
   * - `grip`: friction on the ball's cover (of the push); `band`: how much harder than the mesh the
   *   band grips a ball sitting low on the cable
   *
   * Bent, and why: no measurement of a net's top was found, so these are set by what a ball does on a
   * real net (tests/netTape.test.ts): a ball dropped on the tape from a metre bounces about 10 cm; an
   * 80 km/h serve that clips it 2 cm over the cable lands about 3.5 m in (4 cm: about 7 m) and goes
   * no higher than 2 m over it; one that meets it square drops within a metre; a spike into the top
   * of it goes on down into their court. The rigid 7 cm rod this replaced sent the clipped serve up
   * 7 m and sent every ball off the same way up.
   */
  tape: { cable: 0.01, mass: 0.5, swing: 40, massUp: 1.0, swingUp: 60, damping: 0.4, restitution: 0.33, grip: 0.3, band: 3 },
  /**
   * The antennae: 10 mm fibreglass rods (FIVB 2.5), 1.8 m long, strapped to the outer edge of each
   * side band with 0.8 m standing free above the net. The free rod bends as a clamped rod does, in
   * its first `modes` bends (10, 63 and 176 Hz for these numbers), and it does not stretch: bent
   * far, its tip comes down. The net's side it is strapped to moves along z on the net's tension, so
   * a hit on the rod moves the net, and the net carries the rod. The ball is soft against a 1 cm rod:
   * it wraps around it, and it is pushed off along the line from the rod to its centre. So where and
   * how it meets the rod decide what happens: a fast ball pushes the light rod out of its way and
   * goes on, turned more the lower it met it and the further off its middle; a slow one is pushed
   * back as the rod springs back; one met dead on low down, where the rod is held, bounces off it.
   *
   * - `modulus` (Pa), `density` (kg/m^3): a glass-fibre rod, about 40 GPa and 1.9 g/cm^3, solid
   * - `damping`: each bend's damping ratio; fibreglass hardly damps, so it shakes for a second
   * - `samples`: points along the free rod where its shape is kept; `still`: under this (m, m/s)
   *   the rod has stopped
   * - `pressure` (Pa over the air outside, FIVB 3.3: 0.30 to 0.325 kg/cm^2): the ball's skin is
   *   pulled tight by it, and pressed by a rod it pulls on both sides of it along all it touches: a
   *   push that soon stops growing (a 1 cm rod sinks deep into a ball) until the rod nears the ball's
   *   centre, past `wrapMax` of the way it cannot go
   * - `restitution`: what the ball gives back of its speed into the rod; `friction`: the cover on it
   * - `step` (s): the ball and the rod are stepped this finely while they are close
   * - `net`: the net's side where the rod is strapped: the net's `tension` (N) holds it from both
   *   posts; `mass` (kg: the rod's strapped metre, the side band and the net near it) moves with it;
   *   `damping` as the mesh does (`netDampingRatio`): the net does not ring, so a ball cannot be
   *   thrown back off it
   *
   * Bent, and why: no measurement of a ball hitting an antenna was found. The rod and the ball are
   * the rules'; the net's tension (about 1.5 kN for a taut competition net) and the mass that moves
   * with its side are estimates. Measured over balls across the rod's width and height, flat and
   * with topspin: at 100 km/h 13% come back (2% faster than a quarter of their speed, all met dead
   * on low down) and the rest keep 0.7 of their speed, turned 15 degrees on average; at 30 km/h 30%
   * come back. The rigid rod this replaced sent 56% back, whatever the speed. The facts are in
   * tests/antenna.test.ts.
   *
   * Known edge: the bends are a straight rod's, so a hard ball met within about a centimetre of
   * dead on can fold the rod flat ahead of it, and the rod springing back can throw it up. Keeping
   * the rod's vertical motion in its bends (it comes down as it bends, so a push up or down on it
   * bends it) cut the worst of that from 23 to 12 m/s at 100 km/h. What is left needs a rod that
   * stiffens as it bends far, which these straight-rod bends cannot do.
   */
  antenna: {
    modulus: 40e9,
    density: 1900,
    modes: 3,
    damping: 0.03,
    samples: 16,
    still: 1e-5,
    pressure: 30000,
    restitution: 0.7,
    wrapMax: 0.9,
    friction: 0.3,
    step: 0.00025,
    net: { tension: 1500, mass: 1, damping: 1 },
  },
  postRestitution: 0.5,
  wallRestitution: 0.4,
  /**
   * The float. A ball hit with no spin, flying near its critical speed (where the air's hold on it
   * changes), flies true and then breaks: its seams push it hard to one side, or straight down,
   * for a fraction of a second, and it carries on in the new direction. Once it slows below its
   * critical speed its drag jumps and it dies. Which way and when depends on how the panels face
   * the air, so each serve draws its own (`BallState.seed`): the server cannot choose it and
   * nobody can read it ahead.
   *
   * - A break is a side force 0.5 rho A `cs` v^2 at full strength (`BallState.knuckle` 1: a clean
   *   no-spin contact; a mishit leaves some spin on the ball and it floats less), about as hard as
   *   gravity pulls at 20 m/s. It fades out below `speedLo` m/s and is full from `speedFull`: a
   *   jump float (20 m/s off the hand) breaks harder than a standing float (17), a free ball not
   *   at all.
   * - The ball flies true for `quietMin`-`quietMax` s, then breaks for `breakMin`-`breakMax` s at
   *   `strengthMin`-1 of that strength (coming on and letting go over `edge` s), and so on: one to
   *   three breaks in a serve. `down` of the breaks go straight down, the rest left or right as
   *   often as each other.
   * - The critical speed of this serve is drawn between `crisisLo` and `crisisHi` m/s. Over the
   *   `crisisWidth` m/s below it the drag grows by `dieDrag` (x 1.6: from this model's 0.26 to
   *   0.42; a ball under the crisis sits at 0.4-0.5), so the ball drops short of where it looked
   *   to be going. Only floats get this: a spinning ball passes through the crisis too, but nobody
   *   sees it, and giving every ball it would retune every pass and set.
   * - `read`: what anyone watching knows of a floating ball's path is where it was heading this
   *   long ago (s, a reaction time), with no break to come. The landing marker and every AI player
   *   use that read (docs/adr/0005), looked at again every `readSteps` simulation steps. Nothing
   *   else makes a float hard to pass: a passer who was sent to the wrong spot is late, reaches,
   *   or has the platform up too early for a ball that died.
   *
   * Critical Reynolds numbers of match volleyballs are 2.0-3.3 x 10^5 depending on the ball and on
   * which way its panels face (Hong, Asai et al., wind tunnel, 2017-2020, read as abstracts): 14 to
   * 24 m/s, which is where float serves fly, at a drag coefficient of 0.15-0.2 just above it. The
   * critical speeds here sit at the low end of that, so that a float dies late in its flight, not
   * from the hand.
   *
   * Bent, and why: no source read gives a side force coefficient. A first version held a weak
   * push (`cs` 0.08) for the whole flight: the ball curved 0.2 m, smoothly, and nobody playing it
   * saw a float. `cs` 0.45 in short breaks is at or past the top of what a ball's seams can do, and
   * is set by what a float looks like from the court: it goes straight, then it is somewhere else.
   * A Perfect jump float comes down 0.56 m to one side of where it was heading (0.9 m one time
   * in ten, 1.2 m at most), a Perfect standing float 0.46 m to one side and 0.6 m short; a Good
   * contact half of that (tests/float.test.ts, 200 serves each). The Mini Rally's receivers pass
   * 37% of Perfect jump floats to target, where they passed 72% of the same serve without the
   * float, and are aced by one in eight (70 serves, Outside Hitter).
   */
  float: {
    cs: 0.45,
    speedLo: 10,
    speedFull: 14,
    quietMin: 0.22,
    quietMax: 0.5,
    breakMin: 0.14,
    breakMax: 0.22,
    strengthMin: 0.6,
    down: 0.25,
    edge: 0.03,
    crisisLo: 13,
    crisisHi: 16.5,
    crisisWidth: 1.2,
    dieDrag: 0.6,
    read: 0.2,
    readSteps: 4,
  },
} as const;
