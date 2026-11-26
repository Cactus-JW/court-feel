// Reads the source tree for tests/architecture.test.ts: which layer a file is in, what it imports,
// and whether it touches the DOM or builds scene objects. See docs/adr/0010.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import layers from './architecture.layers.json';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The layers, lowest first (the table is tests/architecture.layers.json, shared with the lint rule):
 *   sim     athletes, ball, contacts, judge, plays, the user's seat (src/game, without the drills)
 *   ai      the brains (src/ai)
 *   drills  the rules of each drill (src/game/modes)
 *   display everything a player sees or hears (src/ui, fx, audio, camera, world, character)
 *   app     the one place that builds every part, and what only it needs: the quick-start link, the stored settings (src/main.ts, src/app)
 */
export type Layer = 'config' | 'core' | 'physics' | 'sim' | 'ai' | 'drills' | 'display' | 'app';

/** what each layer may import, besides itself */
export const MAY_IMPORT = layers.mayImport as Record<Layer, readonly Layer[]>;

/** the simulation: the layers that must run with no DOM and no renderer */
export const SIMULATION: readonly Layer[] = ['sim', 'ai', 'drills'];

/** the layers that must give the same play from the same start: no clock and no dice of their own */
export const DETERMINISTIC: readonly Layer[] = ['physics', 'sim', 'ai', 'drills'];

const FOLDERS = layers.folders as [string, Layer][];

/** the layer of a file under src/ (a path from the repo root), or null for a folder no layer has claimed yet */
export function layerOf(file: string): Layer | null {
  for (const [folder, layer] of FOLDERS) if (folder.endsWith('/') ? file.startsWith(folder) : file === folder) return layer;
  return null;
}

function walk(dir: string, out: string[]): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** every .ts file under a folder, as paths from the repo root, sorted */
export const filesUnder = (dir: string): string[] => walk(dir, []).sort();

export const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');

export interface Imports {
  /** files in this repo, as paths from the repo root */
  files: string[];
  /** npm packages and node built-ins */
  packages: string[];
}

/** everything a file imports: `import`, `import type`, `export ... from` and `import('...')` alike */
export function importsOf(file: string): Imports {
  const files: string[] = [];
  const packages: string[] = [];
  for (const { fileName } of ts.preProcessFile(read(file), true, true).importedFiles) {
    if (!fileName.startsWith('.')) {
      packages.push(fileName);
      continue;
    }
    if (/\.(css|svg|png|jpg|json)(\?.*)?$/.test(fileName)) continue;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), fileName)).replace(/\.js$/, '');
    const hit = [`${base}.ts`, `${base}/index.ts`, base].find(
      (p) => fs.existsSync(path.join(ROOT, p)) && fs.statSync(path.join(ROOT, p)).isFile(),
    );
    files.push(hit ?? `${base}.ts`);
  }
  return { files: [...new Set(files)].sort(), packages: [...new Set(packages)].sort() };
}

/** every identifier a file uses as a name of its own (not as a property of something else), and every `THREE.X` */
function namesIn(file: string): { free: Set<string>; three: Set<string> } {
  const free = new Set<string>();
  const three = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'THREE')
      three.add(node.name.text);
    else if (ts.isQualifiedName(node) && ts.isIdentifier(node.left) && node.left.text === 'THREE') three.add(node.right.text);
    if (ts.isIdentifier(node)) {
      const p = node.parent;
      const isMember =
        (ts.isPropertyAccessExpression(p) && p.name === node) ||
        (ts.isQualifiedName(p) && p.right === node) ||
        ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)) &&
          p.name === node);
      if (!isMember) free.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true));
  return { free, three };
}

/** browser globals that only exist with a page */
const DOM = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'navigator',
  'requestAnimationFrame',
  'matchMedia',
  'HTMLElement',
  'HTMLCanvasElement',
];

/** does the file use a browser global (comments and strings do not count) */
export function touchesDom(file: string): boolean {
  const { free } = namesIn(file);
  return DOM.some((name) => free.has(name));
}

/** three.js classes that are only values: maths with no scene, no GPU and no DOM behind them */
const THREE_MATHS = new Set([
  'Vector2',
  'Vector3',
  'Vector4',
  'Quaternion',
  'Euler',
  'Matrix3',
  'Matrix4',
  'MathUtils',
  'Plane',
  'Ray',
  'Box3',
  'Sphere',
  'Color',
]);

/** the three.js names a file uses that are not maths (meshes, materials, textures, the renderer), sorted */
export function sceneClassesIn(file: string): string[] {
  const found = new Set([...namesIn(file).three].filter((name) => !THREE_MATHS.has(name)));
  // named imports: import { Mesh, type Texture } from 'three', and anything from three's add-ons
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, false);
  for (const st of source.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const from = st.moduleSpecifier.text;
    if (from !== 'three' && !from.startsWith('three/')) continue;
    const named = st.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        const name = (el.propertyName ?? el.name).text;
        if (from !== 'three' || !THREE_MATHS.has(name)) found.add(name);
      }
    } else if (from !== 'three') found.add(from);
  }
  return [...found].sort();
}

/** the files a file imports for their values: a type-only import cannot make a circle at run time */
export function valueImportsOf(file: string): string[] {
  const out = new Set<string>();
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, false);
  for (const st of source.statements) {
    let spec: ts.Expression | undefined;
    if (ts.isImportDeclaration(st)) {
      const c = st.importClause;
      const named = c?.namedBindings;
      const typeOnly =
        !!c &&
        (c.isTypeOnly ||
          (!c.name && !!named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly)));
      if (!typeOnly) spec = st.moduleSpecifier;
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && !st.isTypeOnly) spec = st.moduleSpecifier;
    if (!spec || !ts.isStringLiteral(spec) || !spec.text.startsWith('.')) continue;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec.text)).replace(/\.js$/, '');
    const hit = [`${base}.ts`, `${base}/index.ts`].find((p) => fs.existsSync(path.join(ROOT, p)));
    if (hit) out.add(hit);
  }
  return [...out].sort();
}

/** groups of files that import each other in a circle (by value), each group sorted */
export function importCircles(files: readonly string[]): string[][] {
  const graph = new Map(files.map((f) => [f, valueImportsOf(f)]));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const circles: string[][] = [];
  let next = 0;
  const visit = (v: string): void => {
    index.set(v, next);
    low.set(v, next++);
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) !== index.get(v)) return;
    const group: string[] = [];
    for (let w = stack.pop()!; ; w = stack.pop()!) {
      onStack.delete(w);
      group.push(w);
      if (w === v) break;
    }
    if (group.length > 1) circles.push(group.sort());
  };
  for (const f of files) if (!index.has(f)) visit(f);
  return circles;
}

/** the clocks and dice a file reaches for on its own: `Math.random`, `Date.now`, `new Date`, `performance.now` */
export function clocksAndDiceIn(file: string): string[] {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const name = `${node.expression.text}.${node.name.text}`;
      if (name === 'Math.random' || name === 'Date.now' || name === 'performance.now') found.add(name);
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Date') found.add('new Date');
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true));
  return [...found].sort();
}

/**
 * The shapes a hand-made stand-in for the game takes in a test, found in the test's text. Each is
 * something tests/scene.ts gives for real, so no test has a reason to write one:
 *
 * - a ball of its own: a method, a property or a field called `ensurePrediction` (a call on a real
 *   ball, `ball.ensurePrediction(...)`, is not one);
 * - a host for the contact system: any use of the `ContactHost` type (`satisfies`, a cast, an
 *   annotation: a test of the play is handed the simulation's own contact system and never needs
 *   the type);
 * - a contact system of its own: `new ContactSystem`;
 * - a stub written over the simulation's dice or its contact system: an assignment to a member of
 *   something called `rng` or `contact`, or an `Object.assign` onto one. What the game itself
 *   leaves there as state may be set (`lastSet`, `lastSetResult`). `knobs`: the file is
 *   tests/scene.ts, the one place that holds the dice and the touch still, so this shape is its own.
 *
 * It reads text, so it is fooled by another name: a stub written through an alias
 * (`const cs = sim.contact; cs.tryPass = ...`), or a ball faked with no `ensurePrediction` at all.
 */
export function standInsIn(text: string, knobs = false): string[] {
  const found: string[] = [];
  if (/(?<![.\w])ensurePrediction\s*[:=(]/.test(text)) found.push('a ball of its own');
  if (/\bContactHost\b/.test(text)) found.push('a host for the contact system');
  if (/\bnew\s+ContactSystem\b/.test(text)) found.push('a contact system of its own');
  const stub = /\b(rng|contact)\s*\.\s*(?!lastSet\b|lastSetResult\b)\w+\s*=(?![=>])|Object\.assign\(\s*[\w.!?]*\b(rng|contact)\s*,/;
  if (!knobs && stub.test(text)) found.push('a stub on the dice or the contact system');
  return found;
}
