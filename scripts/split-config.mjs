// Split src/config.ts into src/config/, one file for each owner of the numbers, behind an index that
// re-exports everything: `node scripts/split-config.mjs [<repo root> [<manifest>]]`.
//
// The manifest (scripts/split-config.manifest.json) names the files, in order, and the top-level
// declarations each one holds. Every top-level statement is moved whole, with the comment that
// stands over it, byte for byte. Nothing is rewritten: no key, no number, no comment. What the
// script writes of its own is one title line at the top of each file (a `//` line, so that no
// editor shows it as the doc comment of the file's first section), the imports a file needs from
// the files before it, and the index.
//
// It stops, and writes nothing, when a declaration has no file, is listed twice, would import
// from a file after its own, or when any text would be lost.
//
// It is here so that the move can be run again and compared: give it `src/config.ts` as it was on
// the commit before the move and it writes the `src/config/` of the move, to the byte. A branch
// that was open across the move is carried over it the same way, commit by commit; ALLOW_MISSING=1
// lets the manifest name a declaration such a commit does not have yet. It goes when the last of
// those branches is over.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(here, '..'));
const manifest = JSON.parse(fs.readFileSync(process.argv[3] ?? path.join(here, 'split-config.manifest.json'), 'utf8'));
// the TypeScript of the checkout that is being split
const ts = createRequire(path.join(root, 'package.json'))('typescript');

const src = path.join(root, 'src/config.ts');
const text = fs.readFileSync(src, 'utf8');
const sf = ts.createSourceFile('config.ts', text, ts.ScriptTarget.Latest, true);

// ---- the file's own header: its first comment, when a blank line parts it from the first statement
const first = sf.statements[0];
const lead = ts.getLeadingCommentRanges(text, first.getFullStart()) ?? [];
let header = '';
let headerEnd = 0;
if (lead.length > 1 || (lead.length === 1 && /\n\s*\n/.test(text.slice(lead[0].end, first.getStart(sf))))) {
  header = text.slice(lead[0].pos, lead[0].end);
  headerEnd = lead[0].end;
}

// ---- every top-level statement, with the comment that stands over it

/** the names a top-level statement declares, and whether it declares a type only */
function declared(statement) {
  if (ts.isVariableStatement(statement))
    return { names: statement.declarationList.declarations.map((d) => d.name.getText(sf)), isType: false };
  if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) return { names: [statement.name.text], isType: true };
  if (ts.isFunctionDeclaration(statement)) return { names: [statement.name.text], isType: false };
  throw new Error(`a statement the script does not know: ${statement.getText(sf).slice(0, 80)}`);
}

/** `{ names, isType, text, node }` for each statement, in the order of the file */
const decls = sf.statements.map((node) => {
  const from = node === first ? Math.max(node.getFullStart(), headerEnd) : node.getFullStart();
  return { ...declared(node), text: text.slice(from, node.getEnd()).replace(/^\s*\n/, ''), node };
});
const tail = text.slice(sf.statements.at(-1).getEnd()).trim();
if (tail) throw new Error(`text after the last statement would be lost: ${tail.slice(0, 80)}`);

// ---- which file each declaration goes to
const fileOf = new Map();
for (const f of manifest.files)
  for (const n of f.names) {
    if (fileOf.has(n)) throw new Error(`${n} is listed twice`);
    fileOf.set(n, f.file);
  }
const declOf = new Map(decls.flatMap((d) => d.names.map((n) => [n, d])));
for (const n of declOf.keys()) if (!fileOf.has(n)) throw new Error(`${n} has no file in the manifest`);
for (const n of [...fileOf.keys()]) {
  if (declOf.has(n)) continue;
  if (!process.env.ALLOW_MISSING) throw new Error(`the manifest names ${n}, which config does not declare`);
  fileOf.delete(n);
  for (const f of manifest.files) f.names = f.names.filter((x) => x !== n);
}

/** the top-level names a statement uses that are not its own */
function uses(d) {
  const found = new Set();
  const visit = (node) => {
    if (ts.isIdentifier(node) && declOf.has(node.text) && !d.names.includes(node.text)) {
      const p = node.parent;
      const isMember =
        (ts.isPropertyAccessExpression(p) && p.name === node) ||
        (ts.isQualifiedName(p) && p.right === node) ||
        ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p)) && p.name === node);
      if (!isMember) found.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(d.node);
  return found;
}

// ---- the text of every file, before any is written
const order = manifest.files.map((f) => f.file);
const report = [];
const written = [];
for (const f of manifest.files) {
  const mine = [...new Set(f.names.map((n) => declOf.get(n)))];
  /** file -> name -> whether it is a type */
  const imports = new Map();
  for (const d of mine)
    for (const u of uses(d)) {
      const to = fileOf.get(u);
      if (to === f.file) continue;
      if (order.indexOf(to) > order.indexOf(f.file)) throw new Error(`${f.file} would import ${u} from ${to}, which comes after it`);
      if (!imports.has(to)) imports.set(to, new Map());
      imports.get(to).set(u, declOf.get(u).isType);
    }
  // a value read before the statement that declares it, in the same file: said, not refused (a
  // function may read a later one when it is called)
  const seen = new Set();
  for (const d of mine) {
    for (const u of uses(d))
      if (fileOf.get(u) === f.file && !seen.has(u) && !declOf.get(u).isType && !d.isType)
        report.push(`note: ${f.file}: ${d.names[0]} uses ${u}, declared after it`);
    d.names.forEach((n) => seen.add(n));
  }
  const importLines = [...imports].map(([to, names]) => {
    const list = [...names].sort(([a], [b]) => a.localeCompare(b));
    const allTypes = list.every(([, isType]) => isType);
    const spec = list.map(([n, isType]) => (isType && !allTypes ? `type ${n}` : n)).join(', ');
    return `import ${allTypes ? 'type ' : ''}{ ${spec} } from './${to.replace(/\.ts$/, '')}';`;
  });
  const out = [`// ${f.title}`, ...(importLines.length ? [importLines.join('\n')] : []), ...mine.map((d) => d.text)].join('\n\n') + '\n';
  written.push([f.file, out]);
  report.push(
    `${f.file}: ${out.split('\n').length - 1} lines, ${mine.length} declarations${importLines.length ? `, imports ${[...imports.keys()].join(', ')}` : ''}`,
  );
}
const exports = manifest.files.map((f) => `export * from './${f.file.replace(/\.ts$/, '')}';`).join('\n');
written.push(['index.ts', `${header}\n\n${manifest.indexNote ? `${manifest.indexNote}\n\n` : ''}${exports}\n`]);

const dir = path.join(root, 'src/config');
fs.mkdirSync(dir, { recursive: true });
for (const [file, out] of written) fs.writeFileSync(path.join(dir, file), out);
fs.rmSync(src);
console.log(report.join('\n'));
