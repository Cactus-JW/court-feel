import type { SimulationHooks } from '../src/game/simulation';

/**
 * A simulation with nobody watching: no camera to aim with, no aim assist for a player (an athlete
 * nobody plays has the simulation's own, `ASSIST.ai`, as in the game), and nobody told of a touch,
 * a bounce or the end of a rally. A test that wants to hear of one passes its own hook.
 */
export const NO_HOOKS: SimulationHooks = {
  aimAssist: () => 0,
  aimTargetFor: (_a, out) => out,
  contact: () => {},
  aiContact: () => {},
  ballEvent: () => {},
  floatBreak: () => {},
  outcome: () => {},
};
