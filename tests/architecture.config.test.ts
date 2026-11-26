import { describe, expect, it } from 'vitest';
import path from 'node:path';
import ts from 'typescript';
import { CONFIG_SHOWN } from '../scripts/brings-a-check.rule.mjs';
import { KNOWN_CONFIG_READS } from './architecture.known';
import { clocksAndDiceIn, filesUnder, importsOf, layerOf, read, touchesDom, type Layer } from './architecture.scan';

// Config is a folder with a file for each owner of the numbers, behind one index (docs/adr/0014).
// The owner of a number is the file it is in, and these rules keep that worth something:
//   - config has one door: everything outside the folder imports the index, never a file inside;
//   - the index is the list of the files, lowest first, and a file reads only the ones above it;
//   - a layer reads the numbers it owns, and the ones below: physics the court and the ball, and the
//     simulation nothing of the display's or the app's. What still breaks the second is listed by
//     name in architecture.known.ts, and the list only gets shorter;
//   - config is numbers and nothing else: no clock, no dice, no page.
//
// Who reads what is read off the named imports. Every import of config names what it takes
// (`import { AI, COURT } from '../config'`), so the names a file imports are the numbers it reads.

const FOLDER = 'src/config/';
const INDEX = `${FOLDER}index.ts`;
const SRC = filesUnder('src');
/** every file of config but the index, as paths from the repo root */
const FILES = SRC.filter((f) => f.startsWith(FOLDER) && f !== INDEX);
const parse = (file: string): ts.SourceFile => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
/** `src/config/skills.ts` as a reader says it: `skills.ts` */
const short = (file: string): string => file.slice(FOLDER.length);

/** the file an import written in `file` leads to, as a path from the repo root, when it is in this repo */
function leadsTo(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)).replace(/\.js$/, '');
  return [`${base}.ts`, `${base}/index.ts`].find((p) => SRC.includes(p)) ?? null;
}

// ---- the index

/** what the index is made of: the files it re-exports whole, in order, and every statement that is anything else */
function indexOf(): { order: string[]; other: string[] } {
  const order: string[] = [];
  const other: string[] = [];
  const source = parse(INDEX);
  for (const st of source.statements) {
    const whole = ts.isExportDeclaration(st) && !st.exportClause && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier);
    const to = whole ? leadsTo(INDEX, (st.moduleSpecifier as ts.StringLiteral).text) : null;
    if (to) order.push(to);
    else other.push(st.getText(source).split('\n')[0]);
  }
  return { order, other };
}

const { order: ORDER, other: NOT_A_FILE } = indexOf();

describe('config: one folder, one index', () => {
  it('the index re-exports every file of the folder, once, and holds nothing of its own', () => {
    expect(
      NOT_A_FILE,
      `${INDEX} is the list of config's files and nothing else: a number goes in its owner's file, which the index re-exports with \`export * from\``,
    ).toEqual([]);
    expect(
      FILES.filter((f) => !ORDER.includes(f)),
      `a file of config that ${INDEX} does not re-export is read by nobody: add \`export * from './<file>'\` for it, after the files it reads`,
    ).toEqual([]);
    expect(
      ORDER.filter((f, i) => ORDER.indexOf(f) !== i),
      `${INDEX} re-exports a file twice`,
    ).toEqual([]);
  });

  it('a config file imports only the files above it in the index', () => {
    const upward: string[] = [];
    for (const file of FILES) {
      for (const to of importsOf(file).files.filter((f) => f.startsWith(FOLDER))) {
        if (to === INDEX) upward.push(`${short(file)} imports the index: it is for everything outside the folder`);
        else if (ORDER.indexOf(to) >= ORDER.indexOf(file)) upward.push(`${short(file)} imports ${short(to)}`);
      }
    }
    expect(
      upward,
      `the index lists config's files lowest first, and a file reads only the ones listed before it: move the number down to the file that owns it, or move the importing file's line down in ${INDEX} if nothing above it reads it`,
    ).toEqual([]);
  });

  it('config has one door: nothing outside the folder imports a file inside it', () => {
    const outside = [...SRC.filter((f) => !f.startsWith(FOLDER)), ...filesUnder('tests')];
    const past: string[] = [];
    for (const file of outside) {
      for (const to of importsOf(file).files) if (to.startsWith(FOLDER) && to !== INDEX) past.push(`${file} imports ${to}`);
    }
    expect(
      past,
      "import config's numbers from the folder (`'../config'`), which is its index: then a number can move to another file of config and no importer changes",
    ).toEqual([]);
  });
});

// ---- who reads what

/** every name a config file exports, and the file that owns it */
const OWNER = new Map<string, string>();
for (const file of FILES) {
  for (const st of parse(file).statements) {
    if (!ts.canHaveModifiers(st) || !ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) OWNER.set(d.name.getText(), file);
    else if (
      (ts.isTypeAliasDeclaration(st) ||
        ts.isInterfaceDeclaration(st) ||
        ts.isFunctionDeclaration(st) ||
        ts.isClassDeclaration(st) ||
        ts.isEnumDeclaration(st)) &&
      st.name
    )
      OWNER.set(st.name.text, file);
  }
}

/**
 * What a file reads of config: the names it imports from it (a type too: a type is how a file knows
 * the shape of a number it is handed), and `*` when it takes config whole (`import * as`,
 * `export * from`, `import()`), which hides what it reads
 */
function readsOfConfig(file: string): string[] {
  const names = new Set<string>();
  const source = parse(file);
  const isConfig = (spec: ts.Expression | undefined): boolean =>
    !!spec && ts.isStringLiteral(spec) && (leadsTo(file, spec.text) ?? '').startsWith(FOLDER);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isConfig(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      if (clause?.name || !bindings || ts.isNamespaceImport(bindings)) names.add('*');
      else for (const e of bindings.elements) names.add((e.propertyName ?? e.name).text);
    } else if (ts.isExportDeclaration(node) && isConfig(node.moduleSpecifier)) {
      if (!node.exportClause || !ts.isNamedExports(node.exportClause)) names.add('*');
      else for (const e of node.exportClause.elements) names.add((e.propertyName ?? e.name).text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && isConfig(node.arguments[0])) {
      names.add('*');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...names].sort();
}

/** `src/game/attempt.ts reads FX (display.ts)` for each name a file of these layers reads that `allowed` does not let it */
function readsNotAllowed(layers: readonly Layer[], allowed: (owner: string) => boolean): string[] {
  const out: string[] = [];
  for (const file of SRC.filter((f) => layers.includes(layerOf(f)!))) {
    for (const name of readsOfConfig(file)) {
      const owner = OWNER.get(name);
      if (name === '*') out.push(`${file} reads all of config (name what it reads, as every other file does)`);
      else if (!owner) out.push(`${file} reads ${name} (no file of config exports it)`);
      else if (!allowed(owner)) out.push(`${file} reads ${name} (${short(owner)})`);
    }
  }
  return out.sort();
}

describe('config: a layer reads the numbers it owns', () => {
  it('every name config exports has one owner: the tables below are not empty', () => {
    // were the scan to find no exports, or no imports, every rule below would pass on nothing
    expect(OWNER.size).toBeGreaterThan(40);
    expect(OWNER.get('COURT')).toBe(`${FOLDER}court.ts`);
    expect(readsOfConfig('src/physics/ball.ts')).toContain('BALL');
  });

  it('physics reads the court and the ball, and nothing else of config', () => {
    const mine = [`${FOLDER}court.ts`, `${FOLDER}ball.ts`];
    expect(
      readsNotAllowed(['physics'], (owner) => mine.includes(owner)),
      'physics knows the court and the ball (src/config/court.ts, src/config/ball.ts) and is handed everything else: pass the number in as an argument from the code that owns it',
    ).toEqual([]);
  });

  it('the simulation, the brains and the drills read no number of the display or the app, apart from the ones already known', () => {
    // what is drawn and what the app stores never feed the play (docs/adr/0008, 0009). The files are
    // the ones the gate counts as shown and heard (CONFIG_SHOWN in scripts/brings-a-check.rule.mjs):
    // one list, so a file cannot be the display's for the gate and the play's for the simulation
    for (const file of CONFIG_SHOWN) expect(FILES, `${file} is listed as shown and heard`).toContain(file);
    const reads = readsNotAllowed(['sim', 'ai', 'drills'], (owner) => !CONFIG_SHOWN.includes(owner));
    const known = new Set(KNOWN_CONFIG_READS);
    const now = new Set(reads);
    expect(
      [
        ...reads
          .filter((r) => !known.has(r))
          .map(
            (r) =>
              `new: ${r}. The play does not read what is drawn or stored: if the simulation needs the number it is the simulation's, so move it to the file of config that owns the rule (and read it from there in the display); if it is a setting, have it handed in. Do not list it.`,
          ),
        ...KNOWN_CONFIG_READS.filter((r) => !now.has(r)).map((r) => `fixed: ${r}. Take it out of tests/architecture.known.ts.`),
      ],
      'the simulation reads a number of the display or the app',
    ).toEqual([]);
  });

  it('the known list is sorted and has no entry twice', () => {
    expect([...KNOWN_CONFIG_READS]).toEqual([...new Set(KNOWN_CONFIG_READS)].sort());
  });
});

describe('config: numbers and nothing else', () => {
  it('no file of config reads a clock, rolls dice or touches the page', () => {
    // physics and the simulation import config, so a `Date.now()` or a `window` in it would reach
    // them through the one import no rule of theirs looks into
    const reaching = [INDEX, ...FILES].flatMap((file) => [
      ...clocksAndDiceIn(file).map((what) => `${file} uses ${what}`),
      ...(touchesDom(file) ? [`${file} uses a browser global (window, document, navigator, storage)`] : []),
    ]);
    expect(
      reaching,
      'config is the same numbers on every run and in every place the game is built, a unit test with no page among them: write the number down, and let the code that reads it ask the clock, the dice or the page',
    ).toEqual([]);
  });
});
