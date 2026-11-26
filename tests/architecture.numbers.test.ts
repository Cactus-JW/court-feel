import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { DETERMINISTIC, filesUnder, layerOf, read } from './architecture.scan';
import known from './architecture.numbers.json';

// Every tunable number lives in src/config.ts (AGENTS.md), so the feel can be tuned in one place
// and a difficulty can change it without touching game code. The game code is not there yet: it
// still holds numbers of its own. This is the ratchet. Each file's count is written down
// (tests/architecture.numbers.json) and only goes down: a new number in physics, the simulation,
// the brains or a drill fails here until it has a name in config, and a number that moved out has
// to be taken off the count.

/** numbers that are arithmetic, not tuning: nothing, one, twice and half */
const PLAIN = new Set([0, 1, 2, 0.5]);

/** the numbers written in a file, other than the plain ones */
function numbersIn(file: string): number {
  let n = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isNumericLiteral(node) && !PLAIN.has(Number(node.text))) n++;
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true));
  return n;
}

describe('numbers live in config', () => {
  const listed = known.files as Record<string, number>;
  const counts = filesUnder('src')
    .filter((file) => DETERMINISTIC.includes(layerOf(file)!))
    .map((file) => ({ file, n: numbersIn(file), was: listed[file] ?? 0 }));

  it('no file in physics, the simulation, the brains or the drills has more numbers of its own than it had', () => {
    const grown = counts.filter((c) => c.n > c.was).map((c) => `${c.file}: ${c.n} numbers, ${c.was} listed`);
    expect(
      grown,
      "give a new number a name in its owner's file under src/config/, with where it comes from. (A count may only be raised in a pull request of its own.)",
    ).toEqual([]);
  });

  it('a file that has given numbers to config has its count lowered: the list only goes down', () => {
    const shrunk = counts.filter((c) => c.n < c.was).map((c) => `${c.file}: ${c.n} numbers, ${c.was} listed`);
    expect(shrunk, 'lower these counts in tests/architecture.numbers.json (a file with none left comes off the list)').toEqual([]);
  });

  it('the list names only files that are there', () => {
    const gone = Object.keys(listed).filter((file) => !counts.some((c) => c.file === file));
    expect(gone).toEqual([]);
  });
});
