// merge.mjs
// Merges cards.json (from browser scrape of the program page) and details.json
// (from browser scrape of each detail page) into scrape-raw.json.
// No external dependencies — Node built-ins only.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, 'data');
const CARDS_FILE = resolve(DATA_DIR, 'cards.json');
const DETAILS_FILE = resolve(DATA_DIR, 'details.json');
const OUT_FILE = resolve(DATA_DIR, 'scrape-raw.json');

mkdirSync(DATA_DIR, { recursive: true });

// Parse addressBlock HTML into structured fields.
// The block typically looks like:
//   HAIT<br> Tillich-Bau<br> Org, Helmholtzstraße 6, Tillich-Bau, Bibliothek (EG)<br> Helmholtzstraße 6 <br> 01069 Dresden (Dresdner Süden)
// Lines can be: building name, org name (comma-separated, may contain the real street),
// room/stand codes (N203, S106, POT 61a, Stand 2.07, Haus 21), the real street, and the zip line.
// Strategy: split ALL lines (including comma-separated org lines) into candidate fragments,
// then pick the best street fragment by German street suffix or "word + housenumber" pattern.
const STREET_SUFFIX = /(stra[sß]e|str\.?|weg|platz|allee|gasse|ring|ufer|chaussee|promenade|berg|höhe|damm|graben|wall|pforte|tor|brücke|hof)\b/i;
// Room/stand/building codes that should NOT be treated as streets
const NON_STREET = /^(Stand|Raum|Zimmer|Foyer|Halle|Saal|Haus|Tor|Flügel|Etage|Stock|Werkhalle|Tisch|Zelt|Bühne|Standort|Eingang|Ausgang|Niveau|Ebene)\b/i;
// Non-street keywords that can appear anywhere in a fragment (not just at start)
const NON_STREET_ANYWHERE = /\b(Innenhof|Innehof|Foyer|Hörsaal|Treffpunkt|Außengelände|Treppe|Podcaststudio|Buchmuseum|Klemperer-Saal|FoodStudio|Mediatheksbereich|Digi-Bar|Makerspace|Bibliothek)\b/i;
// Short alphanumeric codes like N203, S106, POT 61a, E05, BEY/S45, CHE/S89
const ROOM_CODE = /^[A-Z]{1,4}[\s/]*\d{1,4}[a-zA-Z]?$|^\d{1,4}[a-zA-Z]$/;
// Fragments that describe a room or location, not a street address
const ROOM_DESCRIPTION = /\(.*(Foyer|Innenhof|Innehof|EG|OG|UG|nur bei|schlecht|Hörsaal|Treffpunkt|Ebene).*\)/i;

function parseAddress(html) {
  if (!html) return { raw: '', street: '', zip: '', city: '', district: '', building: '', room: '' };
  const lines = html.replace(/<br\s*\/?>/gi, '\n').split('\n').map(s => s.trim()).filter(Boolean);
  const raw = lines.join(', ');
  // Zip line: "01069 Dresden (Dresdner Süden)"
  const zipLine = lines.find(l => /^\d{5}\s/.test(l)) || '';
  const zipMatch = zipLine.match(/^(\d{5})\s+(.+?)(?:\s*\((.+)\))?$/);

  // Collect all candidate fragments: split each line by commas, flatten
  const fragments = [];
  for (const line of lines) {
    if (line === zipLine) continue;
    for (const part of line.split(',')) {
      const p = part.trim();
      if (p) fragments.push(p);
    }
  }

  // Find the best street fragment:
  // 1. Prefer fragments with a German street suffix + house number
  // 2. Then fragments with street suffix (even without number)
  // 3. Then "Word+ number" fragments that aren't room codes / non-street keywords
  let streetLine = '';
  const isStreetLike = (f) => {
    if (!f || NON_STREET.test(f) || ROOM_CODE.test(f) || /^\d{5}/.test(f)) return false;
    // Exclude fragments containing URLs
    if (/https?:\/\//.test(f)) return false;
    // Exclude room/location descriptions (parenthesized room keywords)
    if (ROOM_DESCRIPTION.test(f)) return 0;
    // Exclude fragments containing non-street keywords anywhere
    if (NON_STREET_ANYWHERE.test(f)) return 0;
    // Strip parenthesized content for scoring: street addresses inside parens
    // are supplementary/alternate (e.g. "KAZ (Dürerstraße 28, 01307 Dresden)")
    // and should not compete with the primary street line.
    const clean = f.replace(/\([^)]*\)?/g, '').trim();
    if (!clean) return 0;
    // Classic German address pattern: suffix directly followed by house number (boost +1)
    const isClassicAddress = /(stra[sß]e|str\.?|weg|platz|allee|gasse|ring|ufer|chaussee|promenade|berg|höhe|damm|graben|wall|pforte|tor|brücke|hof)\s+\d+/i.test(clean);
    if (STREET_SUFFIX.test(clean) && /\d/.test(clean)) return isClassicAddress ? 3 : 2; // best: suffix + number, boosted if classic
    if (STREET_SUFFIX.test(clean)) return isClassicAddress ? 2 : 1; // suffix only, boosted if classic
    // "Word number" pattern, at least 4 chars, not a room code
    if (/^[^0-9]{4,}.*\d+/.test(clean) && clean.length < 60) return 1;
    return 0;
  };
  let bestScore = 0;
  for (const f of fragments) {
    const score = isStreetLike(f);
    if (score > bestScore) { bestScore = score; streetLine = f; }
  }

  // Building/room lines: remove zip and the selected street fragment from the context.
  // Build from fragments that aren't the street (not from lines, which loses data when the
  // address is all on one comma-separated line).
  const buildingFragments = fragments.filter(f => f !== streetLine);
  return {
    raw,
    street: streetLine,
    zip: zipMatch ? zipMatch[1] : '',
    city: zipMatch ? zipMatch[2] : '',
    district: zipMatch ? zipMatch[3] : '',
    building: buildingFragments.join(', '),
    room: '',
  };
}

function main() {
  if (!existsSync(CARDS_FILE)) { console.error(`Missing ${CARDS_FILE}. Run the browser card scrape first.`); process.exit(1); }
  const cards = JSON.parse(readFileSync(CARDS_FILE, 'utf8'));
  console.log(`Loaded ${cards.length} cards.`);

  const details = existsSync(DETAILS_FILE) ? JSON.parse(readFileSync(DETAILS_FILE, 'utf8')) : [];
  const detailByUrl = new Map(details.map(d => [d.detailUrl, d]));
  console.log(`Loaded ${details.length} detail records.`);

  const events = cards.map(c => {
    const d = detailByUrl.get(c.detailUrl) || {};
    const addr = parseAddress(d.addressBlock || '');
    return {
      detailUrl: c.detailUrl,
      title: d.title || c.title,
      teaser: c.teaser,
      description: d.description || '',
      formatInfo: d.formatInfo || '',
      begin: d.begin || c.begin,
      end: d.end || c.end,
      duration: d.duration || '',
      format: d.formatBadge || (c.formats && c.formats[0]) || '',
      interests: (c.formats || []).filter(f => f !== (d.formatBadge || '')),
      organizer: d.organizer || c.organizer,
      imageUrl: d.imageUrl || c.imageUrl,
      links: d.links || [],
      address: addr,
    };
  });

  writeFileSync(OUT_FILE, JSON.stringify({ scrapedAt: new Date().toISOString(), count: events.length, events }, null, 2), 'utf8');
  console.log(`Wrote ${events.length} events to ${OUT_FILE}`);
}

main();
