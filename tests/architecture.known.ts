// What still breaks the layering of docs/adr/0010, by name. tests/architecture.test.ts fails when
// the code and these lists disagree, in either direction: a new entry has to be written here on
// purpose, and a fixed one has to be taken out.
//
// The lists only get shorter. A pull request that was open before this file existed adds its own
// entries when it rebases; nothing else adds to them. One thing can look like an addition and is
// not: a refactor step that takes a breach out of the simulation can leave it with `Game`, the
// shell that still builds the display (the ball's meshes became `game.ts -> world/ballView.ts`).
// That is the same breach, one step nearer to where it ends. `Game` itself is the app's shell
// (src/app/game.ts) and nothing below the app imports it: each part is handed a narrow host of its
// own (`AiHost`, `DrillHost`, `TutorialHost`, `UserActionsHost`, `EffectsHost`, `TouchHost`).
// Keep each list sorted, one entry per line.

/** imports that reach a layer the importing file may not see, as 'importer -> imported' (type-only imports count) */
export const KNOWN_IMPORTS: readonly string[] = [];

/** simulation files that touch the DOM (window, document, storage) */
export const KNOWN_DOM: readonly string[] = [];

/** simulation files that build scene objects: three.js classes that are not maths */
export const KNOWN_SCENE: readonly string[] = [];

/** tests that fake the game with a cast (to `Game`, or to the `AiHost` the brains see), because a real one cannot be built without a browser */
export const KNOWN_FAKE_GAME: readonly string[] = [];

/** tests that hand-make a ball (an object with its own `ensurePrediction`) or cast a host for the contact system, when tests/scene.ts gives them a real one */
export const KNOWN_HAND_MADE: readonly string[] = [];

/** files in the layers that must be repeatable (physics, the simulation, the brains, the drills) that read a clock or roll dice of their own */
export const KNOWN_CLOCK: readonly string[] = [];

/** simulation files (the simulation, the brains, the drills) that read a number of the display or the app from config, as 'file reads NAME (its file of config)' (tests/architecture.config.test.ts) */
export const KNOWN_CONFIG_READS: readonly string[] = ['src/game/modes/receiveDrill.ts reads FX (display.ts)'];
