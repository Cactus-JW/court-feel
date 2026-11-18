// ESLint (flat config): `npm run lint`. Formatting is Prettier's job (`npm run format`), not ESLint's.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import fs from 'node:fs';

// ---- the layer rule, in the editor (docs/adr/0010)
// The same table as the architecture test (tests/architecture.layers.json). The test is the
// authority: it also follows imports this rule cannot see. This is the early warning, a red line
// under the import while it is being typed.
const layers = JSON.parse(fs.readFileSync(new URL('./tests/architecture.layers.json', import.meta.url), 'utf8'));
const known = fs.readFileSync(new URL('./tests/architecture.known.ts', import.meta.url), 'utf8');
/** files with an import the known list still allows: the test holds them to that list, exactly */
const knownImporters = [...new Set([...known.matchAll(/'(src\/[^']+) -> /g)].map((m) => m[1]))];

/** an import path, as written in any file under src/, that leads into this folder or file */
function leadsInto(folder) {
  if (!folder.endsWith('/')) return [`^(\\.\\./)+${folder.slice(4, -3)}$`, `^\\./${folder.slice(4, -3)}$`];
  const [top, ...rest] = folder.slice(4, -1).split('/');
  const inner = rest.length ? `${rest.join('/')}/` : '';
  // from outside the top folder (../game/modes/x), and for a folder inside one, from beside it (./modes/x)
  return [`^(\\.\\./)+${top}/${inner}`, ...(inner ? [`^\\./${inner}`] : [])];
}

const layerRules = Object.keys(layers.mayImport).map((layer) => {
  const mine = layers.folders.filter(([, l]) => l === layer).map(([f]) => f);
  const banned = layers.folders.filter(([, l]) => l !== layer && !layers.mayImport[layer].includes(l));
  // a folder inside another layer's folder is the other layer's (src/game/modes is the drills', src/game the simulation's)
  const inside = layers.folders
    .filter(([f, l]) => l !== layer && mine.some((m) => m.endsWith('/') && f.startsWith(m)))
    .map(([f]) => `${f}**`);
  const patterns = banned.flatMap(([folder, to]) =>
    leadsInto(folder).map((regex) => ({
      regex,
      message: `${layer} may not import ${to}: every import points down (docs/adr/0010, tests/architecture.layers.json).`,
    })),
  );
  // physics is pure: no package at all
  if (layer === 'physics') patterns.push({ regex: '^[^.]', message: 'physics imports config and itself, and no package.' });
  return {
    files: mine.map((f) => (f.endsWith('/') ? `${f}**/*.ts` : f)),
    ignores: [...inside, ...knownImporters],
    rules: patterns.length ? { 'no-restricted-imports': ['error', { patterns }] } : {},
  };
});

export default defineConfig([
  globalIgnores(['dist/', 'scripts/out/', 'shots/', '.claude/', 'coverage/']),
  {
    files: ['**/*.{ts,js,mjs}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      // a leading underscore marks a parameter that an override or callback signature requires but does not use
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  ...layerRules,
  {
    // test doubles are deliberately partial (a fake ball, a stub game with only an rng)
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // node tooling; the e2e and the agent skills' helpers also run functions inside the page (page.evaluate), hence browser globals too
    files: ['scripts/**/*.mjs', '.agents/**/*.mjs', 'vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
]);
