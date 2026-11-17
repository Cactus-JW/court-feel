// What still breaks the layering of docs/adr/0010, by name. tests/architecture.test.ts fails when
// the code and these lists disagree, in either direction: a new entry has to be written here on
// purpose, and a fixed one has to be taken out.
//
// The lists only get shorter. A pull request that was open before this file existed adds its own
// entries when it rebases; nothing else adds to them. Keep each list sorted, one entry per line.

/** imports that reach a layer the importing file may not see, as 'importer -> imported' (type-only imports count) */
export const KNOWN_IMPORTS: readonly string[] = [
  'src/core/launch.ts -> src/game/bot.ts',
  'src/core/launch.ts -> src/game/modes/mode.ts',
  'src/core/settings.ts -> src/game/body.ts',
  'src/game/athlete.ts -> src/character/rig.ts',
  'src/game/ballEntity.ts -> src/world/textures.ts',
  'src/game/body.ts -> src/character/rig.ts',
  'src/game/bot.ts -> src/ai/approach.ts',
  'src/game/bot.ts -> src/ai/team.ts',
  'src/game/game.ts -> src/ai/brain.ts',
  'src/game/game.ts -> src/camera/cameraRig.ts',
  'src/game/game.ts -> src/character/athleteView.ts',
  'src/game/game.ts -> src/character/bodyMaterial.ts',
  'src/game/game.ts -> src/character/kits.ts',
  'src/game/game.ts -> src/character/rig.ts',
  'src/game/game.ts -> src/fx/effects.ts',
  'src/game/game.ts -> src/fx/post.ts',
  'src/game/game.ts -> src/game/modes/mode.ts',
  'src/game/game.ts -> src/game/modes/registry.ts',
  'src/game/game.ts -> src/ui/debug.ts',
  'src/game/game.ts -> src/ui/hud.ts',
  'src/game/game.ts -> src/world/arena.ts',
  'src/game/game.ts -> src/world/floorReflection.ts',
  'src/game/game.ts -> src/world/textures.ts',
  'src/game/game.ts -> src/world/venue.ts',
  'src/game/modes/mode.ts -> src/world/textures.ts',
  'src/game/modes/spikeDrill.ts -> src/fx/approachGuide.ts',
  'src/game/plays.ts -> src/ai/approach.ts',
  'src/game/tutorial.ts -> src/game/modes/mode.ts',
  'src/game/userController.ts -> src/camera/cameraRig.ts',
];

/** simulation files that touch the DOM (window, document, storage) */
export const KNOWN_DOM: readonly string[] = ['src/game/game.ts', 'src/game/tutorial.ts'];

/** simulation files that build scene objects: three.js classes that are not maths */
export const KNOWN_SCENE: readonly string[] = [
  'src/game/ballEntity.ts',
  'src/game/debugGizmos.ts',
  'src/game/game.ts',
  'src/game/modes/freePlay.ts',
  'src/game/modes/mode.ts',
  'src/game/modes/receiveDrill.ts',
  'src/game/modes/setterDrill.ts',
  'src/game/modes/spikeDrill.ts',
];

/** tests that fake a `Game` with a cast, because a real one cannot be built without a browser */
export const KNOWN_FAKE_GAME: readonly string[] = [
  'tests/giveWay.test.ts',
  'tests/jumpServe.test.ts',
  'tests/middleBlock.test.ts',
  'tests/serve.test.ts',
  'tests/setterCall.test.ts',
  'tests/teamDefence.test.ts',
];
