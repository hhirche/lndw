// patch.mjs — Applies manual address overrides from patches.json to scrape-raw.json.
// Patches are keyed by numeric event ID (from the detailUrl slug). Only address
// fields that appear in the patch are overridden — all others keep their scraped values.
// Usage: node scraper/patch.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, 'data');
const PATCH_FILE = resolve(DATA_DIR, 'patches.json');
const IN_FILE = resolve(DATA_DIR, 'scrape-raw.json');

function idFromUrl(url) {
  const m = url.match(/-(\d+)$/);
  return m ? m[1] : null;
}

function main() {
  if (!existsSync(PATCH_FILE)) {
    console.log('No patches.json found — nothing to patch.');
    return;
  }
  if (!existsSync(IN_FILE)) {
    console.error(`Missing ${IN_FILE}. Run merge first.`);
    process.exit(1);
  }

  const patches = JSON.parse(readFileSync(PATCH_FILE, 'utf8'));
  const data = JSON.parse(readFileSync(IN_FILE, 'utf8'));
  const events = data.events || [];

  if (!patches.patches || Object.keys(patches.patches).length === 0) {
    console.log('patches.json has no entries — nothing to patch.');
    return;
  }

  let patched = 0;
  for (const ev of events) {
    const id = idFromUrl(ev.detailUrl);
    if (!id || !patches.patches[id]) continue;
    const patch = patches.patches[id];
    if (!patch.address) continue;
    // Shallow-merge: only override fields present in the patch
    Object.assign(ev.address, patch.address);
    console.log(`Patched: ${id} — ${ev.title}`);
    patched++;
  }

  writeFileSync(IN_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Patched ${patched} event(s). Wrote ${IN_FILE}`);
}

main();
