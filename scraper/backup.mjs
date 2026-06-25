// backup.mjs
// Copies the current final data into backup files for later diff comparison.
//   src/data/events.json → scraper/data/backup-events.json
//   src/data/venues.json  → scraper/data/backup-venues.json
// Each backup is a single file, always overwritten on every run.

import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, 'data');
const SRC_DIR = resolve(__dirname, '..', 'src', 'data');

mkdirSync(DATA_DIR, { recursive: true });

const files = [
  ['events.json', 'backup-events.json'],
  ['venues.json', 'backup-venues.json'],
];

for (const [src, dest] of files) {
  const srcPath = resolve(SRC_DIR, src);
  const destPath = resolve(DATA_DIR, dest);
  copyFileSync(srcPath, destPath);
  console.log(`Backed up: ${src} → ${dest}`);
}

console.log('Backup complete.');
