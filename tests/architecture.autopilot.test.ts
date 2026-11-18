import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { read } from './architecture.scan';

// An autopilot stands in for a player. A player's hands are not part of the simulation, so the
// same hands recorded and played back must give the same play with no autopilot there. That only
// holds if an autopilot never draws from the simulation's random stream.

/** every `<something>.rng` a file reads */
function rngReads(file: string): string[] {
  const found: string[] = [];
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'rng')
      found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.getText()}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('the autopilots', () => {
  it("roll dice of their own, never the simulation's", () => {
    expect(rngReads('src/app/bot.ts')).toEqual([]);
  });
});
