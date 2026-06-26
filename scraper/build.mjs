// build.mjs
// Merges scrape-raw.json + venues.json into the final data files consumed by the site:
//   events.json, venues.json, filters.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, 'data');
const SCRAPE = resolve(DATA_DIR, 'scrape-raw.json');
const GEO = resolve(DATA_DIR, 'venues.json');
const OUT_DIR = resolve(__dirname, '..', 'src', 'data');
mkdirSync(OUT_DIR, { recursive: true });

function timeToMinutes(t) {
  if (!t) return null;
  // Strip optional " Uhr" suffix (scraper produces "HH:MM Uhr", initial data is bare "HH:MM")
  const cleaned = t.replace(/\s*Uhr\s*$/i, '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(cleaned)) return null;
  const [h, m] = cleaned.split(':').map(Number);
  return h * 60 + m;
}

function main() {
  if (!existsSync(SCRAPE)) { console.error(`Missing ${SCRAPE}`); process.exit(1); }
  const raw = JSON.parse(readFileSync(SCRAPE, 'utf8'));
  const eventsRaw = raw.events || [];

  // Build venue lookup
  let venueLookup = new Map();
  if (existsSync(GEO)) {
    const geo = JSON.parse(readFileSync(GEO, 'utf8'));
    for (const v of geo.venues || []) {
      venueLookup.set(v.query, v);
    }
  } else {
    console.warn('venues.json missing — events will have no coordinates until geocode runs.');
  }

  function venueKey(addr, organizer) {
    const street = (addr.street || '').trim();
    const zip = (addr.zip || '').trim();
    if (street && zip) return `${street}, ${zip} Dresden`;
    if (street) return `${street}, Dresden`;
    if (zip) return `${zip} Dresden`;
    return `${addr.building || ''} ${organizer || ''}`.trim() + ', Dresden';
  }

  // Known event formats (from source site's format filter) vs attributes
  const FORMAT_VALUES = new Set(['Experiment', 'Vortrag', 'Präsentation', 'Ausstellung', 'Führung', 'Quiz', 'Diskussion', 'Show', 'Workshop', 'Konzert', 'Lesung', 'Film', 'Tour']);
  function parseFormats(formatInfo) {
    if (!formatInfo) return { formats: [], attributes: [] };
    const parts = formatInfo.split('\n').map(s => s.trim()).filter(Boolean);
    const formats = [], attributes = [];
    for (const p of parts) {
      if (FORMAT_VALUES.has(p)) formats.push(p);
      else attributes.push(p);
    }
    return { formats, attributes };
  }

  // Assign venue IDs to events
  const events = [];
  const venuesById = new Map();
  for (const ev of eventsRaw) {
    const key = venueKey(ev.address, ev.organizer);
    const v = venueLookup.get(key);
    const venueId = v ? v.id : null;
    const id = ev.detailUrl.split('-').slice(-1)[0];
    const { formats, attributes } = parseFormats(ev.formatInfo);
    events.push({
      id,
      detailUrl: ev.detailUrl,
      title: ev.title,
      teaser: ev.teaser,
      description: ev.description,
      beschreibung: ev.beschreibung,
      begin: ev.begin,
      end: ev.end,
      beginMin: timeToMinutes(ev.begin),
      endMin: timeToMinutes(ev.end),
      duration: ev.duration,
      // The "format" badge on the source is actually the science category/interest
      interest: ev.format || '',
      // Real event formats come from the formatInfo section
      formats,
      attributes,
      organizer: ev.organizer,
      imageUrl: ev.imageUrl,
      links: ev.links || [],
      venueId,
      address: ev.address,
    });
    if (v && !venuesById.has(v.id)) {
      venuesById.set(v.id, {
        id: v.id,
        name: v.name,
        address: v.address,
        lat: v.lat,
        lng: v.lng,
        displayName: v.displayName,
        eventIds: [],
      });
    }
    if (v) venuesById.get(v.id).eventIds.push(id);
  }

  // Assign events with no venue (empty address) or whose venue has no coordinates
  // to their organizer's primary venue (the one with the most events at a geocoded venue).
  const orgVenueCount = new Map(); // organizer -> Map(venueId -> count)
  for (const ev of events) {
    if (!ev.venueId) continue;
    const v = venuesById.get(ev.venueId);
    if (!v || v.lat == null) continue; // only count geocoded venues as valid targets
    if (!orgVenueCount.has(ev.organizer)) orgVenueCount.set(ev.organizer, new Map());
    const m = orgVenueCount.get(ev.organizer);
    m.set(ev.venueId, (m.get(ev.venueId) || 0) + 1);
  }
  let reassigned = 0;
  for (const ev of events) {
    const v = venuesById.get(ev.venueId);
    // Already has a valid venue with coordinates — nothing to do
    if (ev.venueId && v && v.lat != null) continue;
    const m = orgVenueCount.get(ev.organizer);
    if (!m || m.size === 0) continue;
    // Pick the venue with the most events for this organizer
    let bestVenueId = null, bestCount = 0;
    for (const [vid, cnt] of m) { if (cnt > bestCount) { bestCount = cnt; bestVenueId = vid; } }
    if (bestVenueId) {
      // Remove from old venue's eventIds if present
      if (ev.venueId && venuesById.has(ev.venueId)) {
        const oldV = venuesById.get(ev.venueId);
        oldV.eventIds = oldV.eventIds.filter(id => id !== ev.id);
      }
      ev.venueId = bestVenueId;
      venuesById.get(bestVenueId)?.eventIds.push(ev.id);
      reassigned++;
    }
  }
  if (reassigned > 0) console.log(`Reassigned ${reassigned} events with missing address/coordinates to their organizer's primary venue.`);

  // Build filters
  const distinct = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  const organizers = distinct(events.map(e => e.organizer));
  const formats = distinct(events.flatMap(e => e.formats));
  const districts = distinct(events.map(e => e.address?.district));
  const interests = distinct(events.map(e => e.interest));
  const attributes = distinct(events.flatMap(e => e.attributes));
  const venues = distinct(Array.from(venuesById.values()).map(v => v.name));
  const times = events.map(e => e.beginMin).filter(Boolean);
  const timeRange = times.length ? { min: Math.min(...times), max: Math.max(...times) } : { min: 0, max: 1440 };

  const filters = {
    organizers, formats, districts, interests, attributes, venues, timeRange,
    timeMinLabel: `${Math.floor(timeRange.min / 60)}:${String(timeRange.min % 60).padStart(2, '0')}`,
    timeMaxLabel: `${Math.floor(timeRange.max / 60)}:${String(timeRange.max % 60).padStart(2, '0')}`,
  };

  writeFileSync(resolve(OUT_DIR, 'events.json'), JSON.stringify(events), 'utf8');
  writeFileSync(resolve(OUT_DIR, 'venues.json'), JSON.stringify({ venues: Array.from(venuesById.values()) }), 'utf8');
  writeFileSync(resolve(OUT_DIR, 'filters.json'), JSON.stringify(filters), 'utf8');

  console.log(`Built: ${events.length} events, ${venuesById.size} venues.`);
  console.log(`Filters: ${organizers.length} organizers, ${formats.length} formats, ${districts.length} districts, ${interests.length} interests.`);
  const withCoords = Array.from(venuesById.values()).filter(v => v.lat != null).length;
  console.log(`Venues with coordinates: ${withCoords}/${venuesById.size}`);
}

main();
