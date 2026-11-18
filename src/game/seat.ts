import type { ServeKind } from '../config';
import type { Athlete } from './athlete';
import type { ContactSystem } from './contact';
import type { Intent } from './intent';
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

/**
 * A seat: one player's place in the game. It holds the athlete they play, the controller that
 * turns their intent into what that athlete does, and the actions they are holding (a pass, a
 * set, a block waiting on its moment). It is handed an `Intent` a frame and takes nothing else
 * from the player, so it does not matter whose hands they are: this machine's keys, a recording,
 * or a player on another machine (docs/adr/0011). Seat 0 is this machine's player.
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
    sim: { readonly simTime: number; readonly contact: ContactSystem },
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

  /** this frame's intent from the player: play it. A frame with none leaves the athlete doing what it was last asked */
  hear(dt: number, intent: Intent): void {
    this.controller.intent = intent;
    this.controller.frame(dt);
  }
}
