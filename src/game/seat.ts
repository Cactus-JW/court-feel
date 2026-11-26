import type { ServeKind } from '../config';
import type { Athlete } from './athlete';
import type { ContactSystem } from './contact';
import type { Intent } from './intent';
import { setStepAssist } from './setAssist';
import { takeoffSpot } from './setJump';
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
  /** the lesson, when this seat is being taught: it holds the buttons for the player in a guided rep */
  tutorial?: Pick<Tutorial, 'ownsButtons' | 'quiet'>;
  /** a swing was released: how far from the ideal moment, and when it meets the ball (the debug overlay shows it) */
  notePress?(err: number, contactT: number): void;
}

const NO_LESSON: Pick<Tutorial, 'ownsButtons' | 'quiet'> = { ownsButtons: () => false, quiet: () => false };

/** what a seat reads of the simulation it sits in */
export interface SeatSim {
  readonly simTime: number;
  readonly contact: ContactSystem;
  /** the drill being played: it says when the next ball is this player's to set */
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
 * intent: the last steps onto a set (`frame`). The controller only turns an intent into
 * commands; these are the game acting for the player, so every seat has its own.
 */
export class Seat {
  readonly controller = new UserController();
  readonly actions: UserActions;
  /** the serve this player has picked: their next toss is that serve's toss */
  serveKind: ServeKind = 'float';
  private body: Athlete;

  constructor(
    readonly id: number,
    athlete: Athlete,
    private readonly sim: SeatSim,
    host: SeatHost = {},
  ) {
    this.body = athlete;
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
      tutorial: host.tutorial ?? NO_LESSON,
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
   * the set-step assist takes the last steps onto a set. The order matters: the assist steers the
   * move command the controller has just written.
   */
  frame(dt: number): void {
    this.controller.frame(dt);
    this.assistSetStep();
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
