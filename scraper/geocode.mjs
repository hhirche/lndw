// geocode.mjs
// Geocodes unique venue addresses from scrape-raw.json using Photon (Komoot, Nominatim-based).
// Photon is more permissive than nominatim.openstreetmap.org. Small delay between requests.
// Persistent cache. Emits venues.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import https from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, 'data');
const IN_FILE = resolve(DATA_DIR, 'scrape-raw.json');
const CACHE_FILE = resolve(DATA_DIR, 'geocode-cache.json');
const OUT_FILE = resolve(DATA_DIR, 'venues.json');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Build a venue key from address fields
function venueKey(addr, organizer) {
  const street = (addr.street || '').trim();
  const zip = (addr.zip || '').trim();
  if (street && zip) return `${street}, ${zip} Dresden`;
  if (street) return `${street}, Dresden`;
  if (zip) return `${zip} Dresden`;
  return `${addr.building || ''} ${organizer || ''}`.trim() + ', Dresden';
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'LNDW-Map-Explorer/1.0', 'Accept': 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function geocode(query) {
  const url = 'https://photon.komoot.io/api/?' + new URLSearchParams({ q: query, limit: 1 });
  const data = await fetchJson(url);
  if (data && data.features && data.features.length > 0) {
    const f = data.features[0];

    // Quality gate: if the query contains a house number, verify the Photon
    // result actually matches. Two failure modes:
    // 1. No housenumber AND no street → street/area centroid (e.g. wrong zip
    //    caused Photon to return the street way instead of the address point).
    // 2. Has housenumber but it doesn't match any candidate from the query →
    //    Photon fuzzy-matched a different address (e.g. "Str. 1b" → house 14).
    //
    // Collect all house-number candidates from the query (handle ranges like
    // "12-14", "3/5" and alphanumeric like "3b", "1 b").
    const candidates = [];
    const singleRE = /\b(\d{1,4})\s*([a-zA-Z]?)(?=\b|[,-]|\s|$)/g;
    let m;
    while ((m = singleRE.exec(query)) !== null) {
      candidates.push((m[1] + m[2]).toLowerCase());
    }
    const rangeRE = /\b(\d{1,4})\s*[-/]\s*(\d{1,4})\b/g;
    while ((m = rangeRE.exec(query)) !== null) {
      candidates.push(m[1].toLowerCase());
      candidates.push(m[2].toLowerCase());
    }
    const expectedHNs = [...new Set(candidates)];

    if (expectedHNs.length > 0) {
      const resultHN = (f.properties.housenumber || '').toLowerCase().replace(/\s+/g, '');
      // Case 1: street/area centroid
      if (!f.properties.housenumber && !f.properties.street) {
        return null;
      }
      // Case 2: result housenumber matches none of the query candidates
      if (resultHN && !expectedHNs.some(e => resultHN.startsWith(e))) {
        return null;
      }
    }

    const [lng, lat] = f.geometry.coordinates;
    return { lat, lng, displayName: f.properties.name ? `${f.properties.name}, ${f.properties.city || ''}` : `${f.properties.street || ''} ${f.properties.housenumber || ''}, ${f.properties.city || ''}` };
  }
  return null;
}

// Extract candidate building names from the address.building field.
// Returns short, distinct names like "Jante-Bau", "Willers-Bau" etc.
// that Photon often resolves more precisely than house numbers on campus.
function extractBuildingNames(building) {
  if (!building) return [];
  const candidates = [];
  const parts = building.split(',');
  for (const p of parts) {
    // Remove parenthesized annotations like "(Innenhof)", "(EG)"
    const cleaned = p.replace(/\(.*\)/g, '').trim();
    if (!cleaned) continue;
    // Match common German campus building name patterns
    if (/^[A-Z][a-zäöüß]+-(Bau|Haus|Gebäude|Labor|Institut|Halle|Zentrum|Flügel|Saal)$/.test(cleaned)) {
      candidates.push(cleaned);
    }
  }
  return candidates;
}

async function main() {
  if (!existsSync(IN_FILE)) { console.error(`Missing ${IN_FILE}. Run merge first.`); process.exit(1); }
  const raw = JSON.parse(readFileSync(IN_FILE, 'utf8'));
  const events = raw.events || [];

  // Build unique venues
  const venueMap = new Map();
  for (const ev of events) {
    const key = venueKey(ev.address, ev.organizer);
    if (!venueMap.has(key)) {
      venueMap.set(key, {
        id: 'v' + (venueMap.size + 1),
        name: ev.organizer || ev.address.building || key,
        address: ev.address,
        query: key,
        eventIds: [],
      });
    }
    venueMap.get(key).eventIds.push(ev.detailUrl);
  }
  console.log(`Unique venues: ${venueMap.size}`);

  // Load cache
  const cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {};

  let geocoded = 0, failed = 0;
  let idx = 0;
  for (const [key, venue] of venueMap) {
    idx++;
    if (cache[key] && cache[key].lat != null) {
      venue.lat = cache[key].lat;
      venue.lng = cache[key].lng;
      venue.displayName = cache[key].displayName;
      continue;
    }
    try {
      let r = null;
      const buildingNames = extractBuildingNames(venue.address?.building);

      // Primary: street + zip + Dresden
      r = await geocode(key);

      if (!r && venue.address?.street) {
        // Fallback 1: street + zip + Dresden (explicit, whitespace-normalized)
        r = await geocode(`${venue.address.street}, ${venue.address.zip || ''} Dresden`.replace(/\s+/g, ' ').trim());
      }
      if (!r && venue.address?.street) {
        // Fallback 2: street + Dresden only (drops potentially wrong zip code)
        r = await geocode(`${venue.address.street}, Dresden`);
      }
      // Building-name fallbacks: only when street-based queries fail, because
      // a street address can host multiple buildings (e.g. Zeuner-Bau and
      // Walter-Frenzel-Bau both at George-Bähr-Straße 3c). Using a building
      // name prematurely would pick the wrong one for some events.
      if (!r) {
        for (const bn of buildingNames) {
          r = await geocode(`${bn}, Dresden`);
          if (r) break;
          await sleep(100);
        }
      }
      if (!r && venue.address?.street) {
        // Fallback 3: building name + street + Dresden
        for (const bn of buildingNames) {
          r = await geocode(`${bn}, ${venue.address.street}, Dresden`);
          if (r) break;
          await sleep(100);
        }
      }
      if (!r) {
        // Fallback 4: organizer name + Dresden
        const fallback = `${venue.name}, Dresden`;
        r = await geocode(fallback);
      }
      if (r) {
        venue.lat = r.lat; venue.lng = r.lng; venue.displayName = r.displayName;
        cache[key] = r;
        geocoded++;
      } else {
        failed++;
        cache[key] = { lat: null, lng: null, displayName: null };
        console.warn(`  No result: ${key}`);
      }
    } catch (e) {
      failed++;
      console.warn(`  Error: ${key} — ${e.message}`);
    }
    if (idx % 10 === 0) console.log(`  ${idx}/${venueMap.size}`);
    await sleep(300); // polite delay
  }

  // Persist cache
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');

  const venues = Array.from(venueMap.values());
  writeFileSync(OUT_FILE, JSON.stringify({ count: venues.length, venues }, null, 2), 'utf8');
  console.log(`Geocoded: ${geocoded}, failed: ${failed}. Wrote ${venues.length} venues to ${OUT_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
