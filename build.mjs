// build.mjs (root) — Copies src/* + data into dist/ for static hosting.
import { cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, 'src');
const DIST = resolve(__dirname, 'dist');
const DATA = resolve(__dirname, 'src', 'data');

// Clean dist
if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// Copy src
cpSync(SRC, DIST, { recursive: true });

// Copy data files into dist/data
const distData = resolve(DIST, 'data');
mkdirSync(distData, { recursive: true });
for (const f of ['events.json', 'venues.json', 'filters.json']) {
  const src = resolve(DATA, f);
  if (existsSync(src)) cpSync(src, resolve(distData, f));
}

console.log(`Built static site in ${DIST}`);
console.log('Serve with: npx serve dist  OR  python -m http.server -d dist');
