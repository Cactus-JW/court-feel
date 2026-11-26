import { PLAYER, type ServeKind } from '../config';
import type { Athlete } from './athlete';
import type { ContactSystem } from './contact';
import type { Intent } from './intent';
import { setStepAssist } from './setAssist';
import { autoSetJump, takeoffSpot } from './setJump';
import type { Tutorial } from './tutorial';
import { UserActions } from './userActions';
import { UserController } from './userController';

/** what a seat needs of whoever runs the game. Everything has an answer that suits a game nobody is watching */
export interface SeatHost {
  /**
   * When a press made now is counted from: the simulation clock, brought forward by the part of a
   * step the frame on screen has already run. Without one it is the simulation clock.
   */
  inputTime?(): number;
  /** the lesson, when this seat is being taught: it holds the buttons for the player in a guided rep, and holds their line */
  tutorial?: Pick<Tutorial, 'ownsButtons' | 'quiet' | 'drive'>;
  /** a swing was released: how far from the ideal moment, and when it meets the ball (the debug overlay shows it) */
  notePress?(err: number, contactT: number): void;
  /** the body goes up for a set by itself (Settings: Auto jump set). Off without an answer */
  autoJumpSet?(): boolean;
  /**
   * The athlete was put on a spot, facing `yaw`: the camera turns with them. `snapped`: a walk back
   * that ran out of time (the screen dips), not a drill placing its player.
   */
  placed?(yaw: number, snapped: boolean): void;
}

const NO_LESSON: Pick<Tutorial, 'ownsButtons' | 'quiet' | 'drive'> = { ownsButtons: () => false, quiet: () => false, drive: () => {} };

/** what a seat reads of the simulation it sits in */
export interface SeatSim {
  readonly simTime: number;
  readonly contact: ContactSystem;
  /**
   * The drill being played: it says when the next ball is the player's to set. It answers for one
   * player, as the drills have one: with a second seat it has to be asked about an athlete
   * (docs/adr/0011, not built).
   */
  readonly drill: { userSetsNext?(): boolean } | null;
}

/**
 * A seat: one player's place in the game. It holds the athlete they play, the controller that
 * turns their intent into what that athlete does, and the actions they are holding (a pass, a
 * set, a block waiting on its moment). It is handed an `Intent` a frame and takes nothing else
 * from the player, so it does not matter whose hands they are: this machine's keys, a recording,
 * or a player on another machine (docs/adr/0011). Seat 0 is this machine's player.
 *
 * What the game does for a player is here too, written for this seat's athlete and this seat's
 * intent: the last steps onto a set and the walk back between reps (`frame`, once a frame), and
 * the auto jump set (`beforeStep`, once a fixed step). The controller only turns an intent into
 * commands; these are the game acting for the player, so every seat has its own.
 */
export class Seat {
  readonly controller = new UserController();
  readonly actions: UserActions;
  /** the serve this player has picked: their next toss is that serve's toss */
  serveKind: ServeKind = 'float';
  private body: Athlete;
  private readonly lesson: Pick<Tutorial, 'ownsButtons' | 'quiet' | 'drive'>;
  /** the walk back in hand: the spot, how long it has taken, and whether the player took the stick */
  private walk: { x: number; z: number; yaw: number; t: number; maxT: number; steered: boolean } | null = null;

  constructor(
    readonly id: number,
    athlete: Athlete,
    private readonly sim: SeatSim,
    private readonly host: SeatHost = {},
  ) {
    this.body = athlete;
    this.lesson = host.tutorial ?? NO_LESSON;
    athlete.isUser = true;
    this.controller.athlete = athlete;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const seat = this;
    this.actions = new UserActions({
      get simTime() {
        return sim.simTime;
      },
      inputTime: () => host.inputTime?.() ?? sim.simTime,
      get me() {
        return seat.body;
      },
      contact: sim.contact,
      user: this.controller,
      tutorial: this.lesson,
      get serveKind() {
        return seat.serveKind;
      },
      notePress: (err, contactT) => host.notePress?.(err, contactT),
    });
  }

  /** the athlete this player plays. A change of position gives them another */
  get athlete(): Athlete {
    return this.body;
  }
  set athlete(a: Athlete) {
    this.body = a;
    a.isUser = true;
    this.controller.athlete = a;
  }

  /** where this player is looking and what they hold, as of the frame being played */
  get intent(): Intent {
    return this.controller.intent;
  }

  /** this frame's intent from the player: hold it and play it (`frame`). A frame with none leaves the athlete doing what it was last asked */
  hear(dt: number, intent: Intent): void {
    this.controller.intent = intent;
    this.frame(dt);
  }

  /**
   * Play the intent held, once a frame: the controller turns it into what the athlete does, then
   * the set-step assist takes the last steps onto a set, the lesson holds its line in a guided rep,
   * and the walk back jogs the athlete to their spot. The order matters: each steers the move
   * command the ones before it have written, and the walk back gives way to all of them.
   *
   * The walk back runs here, on the frame, and not in the simulation's fixed step: its clock is
   * the frame's (real seconds), so a lesson that holds the simulation still does not stall it, and
   * a drill that reads `walking` every step sees the arrival on the frame it happens.
   */
  frame(dt: number): void {
    this.controller.frame(dt);
    this.assistSetStep();
    // the lesson's together rep: the coach holds the player's line (what they hold decides whether time runs)
    this.lesson.drive(this.body);
    this.stepWalk(dt);
  }

  /**
   * Before the athletes move in a fixed step: what the arms get ready for, and the player's jump
   * set (Settings: Auto jump set). A pass in system is theirs to set, so their body goes up for it
   * by itself, timed so the top of the jump is in the middle of the touch. The catch and the
   * release stay theirs. Off, or out of system, they set from the floor (or jump themselves).
   *
   * Whether a ball is theirs to set is the drill's to say, and nothing else is asked: the game
   * used to ask too whether a menu was up, but under a menu the only drill running is the start
   * screen's demo, the Spike Drill, which never says so.
   */
  beforeStep(): void {
    const me = this.body;
    const sets = !!this.sim.drill?.userSetsNext?.();
    me.jumpSets = sets && !!this.host.autoJumpSet?.();
    // what the arms get ready for in the air, chosen on the floor (a jump keeps what it went up for)
    if (me.grounded) me.airIntent = sets ? 'set' : 'attack';
    if (me.jumpSets) autoSetJump(me, this.sim.contact.setCatch(me)?.jump ?? null, this.sim.simTime);
  }

  /** put the athlete on a spot, facing `yaw` (a teleport): their look turns with their body. Ends a walk back */
  place(x: number, z: number, yaw: number): void {
    this.put(x, z, yaw, false);
  }

  private put(x: number, z: number, yaw: number, snapped: boolean): void {
    this.walk = null;
    this.body.place(x, z, yaw);
    this.intent.yaw = yaw;
    this.controller.clear();
    this.host.placed?.(yaw, snapped);
  }

  /** jog the athlete back to a spot between reps (no teleport, no cut): `PLAYER.walkBack` */
  walkTo(x: number, z: number, yaw: number, maxT = PLAYER.walkBack.maxT): void {
    this.walk = { x, z, yaw, t: 0, maxT, steered: false };
  }

  /** a drill holds its next feed while this is true */
  get walking(): boolean {
    return this.walk !== null;
  }

  private stepWalk(dt: number): void {
    const r = this.walk;
    if (!r) return;
    const me = this.body;
    const W = PLAYER.walkBack;
    r.t += dt;
    const d = Math.hypot(me.pos.x - r.x, me.pos.z - r.z);
    const keys = this.intent.steering;
    if (keys) r.steered = true;
    if (d < W.near || (r.steered && d < W.nearSteered)) {
      this.walk = null;
      return;
    }
    if (r.t > r.maxT) {
      // still far (or the player wandered off): put them there (the host dips the screen, it does not cut)
      if (!r.steered || r.t > r.maxT + W.giveUp) {
        if (!r.steered) this.put(r.x, r.z, r.yaw, true);
        this.walk = null;
      }
      return;
    }
    if (keys || me.state !== 'ground' || Math.hypot(me.cmd.moveX, me.cmd.moveZ) > W.idle) return;
    // jog back (body keeps facing where the camera looks: a backpedal when looking at the net)
    const m = Math.min(1, d / W.ease);
    me.cmd.moveX = ((r.x - me.pos.x) / d) * m;
    me.cmd.moveZ = ((r.z - me.pos.z) / d) * m;
    me.cmd.sprint = d > W.sprintFrom;
  }

  /**
   * Set aim assist for the player's footwork: the ball is theirs to set and they are on the floor
   * near the spot, so their body takes the last steps onto it (`setStepAssist`). Off at assist 0,
   * once the ball is in their hands, and for hands that say where they go outright (an autopilot:
   * `Intent.helped`). Its strength is the player's Set aim assist, as the contact system has it.
   */
  private assistSetStep(): void {
    const me = this.body;
    const contact = this.sim.contact;
    const assist = contact.setAssist(me);
    if (!this.intent.helped || assist <= 0 || me.state !== 'ground' || !this.sim.drill?.userSetsNext?.()) return;
    if (me.action?.kind === 'set' && me.action.absorbing) return;
    // going up for it: the steps go to where the hop takes off from (the spot, less what your run carries)
    const jump = contact.setCatch(me)?.jump;
    const spot = jump ? takeoffSpot(me, jump, this.stepP) : contact.setSpot(me, this.stepP);
    if (spot) setStepAssist(me.cmd, me.pos, spot, assist);
  }
  private readonly stepP = { x: 0, y: 0, z: 0 };
}
