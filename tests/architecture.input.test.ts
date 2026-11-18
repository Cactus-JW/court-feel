import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { filesUnder, layerOf, read } from './architecture.scan';

// All input goes through `Input` (AGENTS.md): keys, mouse, touch and the autopilots share that
// path, so timing windows are identical everywhere. A second listener for a gameplay key is a side
// door: it works on a keyboard and is silently missing for touch, for an autopilot and for a
// recording. This is the list of the files that may listen to the player at all, and why.

/** the events a player's hands make */
const HAND_EVENTS = /^(key|mouse|pointer|touch)|^(click|dblclick|wheel|contextmenu)$/;

/**
 * The files that may listen for them. `src/core/input.ts` is the door for everything that plays
 * the game. The others are either a way into it (the touch pad) or not the game (menus, the pause
 * key, the crash screen).
 */
const MAY_LISTEN: Record<string, string> = {
  'src/core/input.ts': 'the door: every gameplay key, the mouse and the pointer lock',
  'src/ui/touchControls.ts': 'the touch pad: turns touches into the same codes, through Input',
  'src/ui/playWheel.ts': 'a tap on a slice of the play wheel presses that play’s number, through Input',
  'src/ui/hud.ts': 'the Skip chip of a lesson: a button on the screen, not a gameplay key',
  'src/ui/menu.ts': 'the menus: their buttons, sliders and arrow keys',
  'src/ui/playDesigner.ts': 'the play designer: a form in the menus',
  'src/ui/crashScreen.ts': 'the crash screen’s buttons',
  'src/main.ts': 'the app’s own keys: Esc to pause, the first press that lets the sound start, the click that takes the mouse',
};

/** the hand events a file listens for: addEventListener('keydown', …) and el.onclick = … alike */
function handListeners(file: string): string[] {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'addEventListener' &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      HAND_EVENTS.test(node.arguments[0].text)
    )
      found.add(node.arguments[0].text);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text.startsWith('on') &&
      HAND_EVENTS.test(node.left.name.text.slice(2))
    )
      found.add(node.left.name.text.slice(2));
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true));
  return [...found].sort();
}

describe('input has one door', () => {
  const listening = filesUnder('src')
    .map((file) => ({ file, events: handListeners(file) }))
    .filter((f) => f.events.length > 0);

  it('only the listed files listen for keys, the mouse, the pointer or touch', () => {
    const strangers = listening.filter((f) => !(f.file in MAY_LISTEN)).map((f) => `${f.file} listens for ${f.events.join(', ')}`);
    expect(strangers, 'read keys through Input (src/core/input.ts), or through the intent in the simulation').toEqual([]);
  });

  it('nothing in the simulation listens to the player: it is handed an intent', () => {
    const below = listening.filter((f) => ['physics', 'sim', 'ai', 'drills'].includes(layerOf(f.file) ?? '')).map((f) => f.file);
    expect(below).toEqual([]);
  });

  it('the list names only files that still listen', () => {
    const stale = Object.keys(MAY_LISTEN).filter((file) => !listening.some((f) => f.file === file));
    expect(stale).toEqual([]);
  });
});
