// diff.mjs
// Compares backup data with current final data and produces a human-readable
// markdown diff report: scraper/data/diff.md
//
// Covers events and venues — additions, edits (field-level), and removals.
// Venue edits include explicit geolocation (lat/lng) change reporting.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, 'data');
const SRC_DIR = resolve(__dirname, '..', 'src', 'data');

const BACKUP_EVENTS = resolve(DATA_DIR, 'backup-events.json');
const BACKUP_VENUES = resolve(DATA_DIR, 'backup-venues.json');
const CURRENT_EVENTS = resolve(SRC_DIR, 'events.json');
const CURRENT_VENUES = resolve(SRC_DIR, 'venues.json');
const DIFF_OUT = resolve(DATA_DIR, 'diff.md');

function fmt(v) {
  if (v == null) return '`—`';
  if (typeof v === 'object') return '`' + JSON.stringify(v) + '`';
  return '`' + String(v) + '`';
}

function compareArrays(a, b) {
  // Returns a human-readable diff string for two arrays, or null if equal
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa === sb) return null;
  // Show counts + what was added/removed
  const added = b.filter(x => !a.some(y => JSON.stringify(y) === JSON.stringify(x)));
  const removed = a.filter(x => !b.some(y => JSON.stringify(y) === JSON.stringify(x)));
  const parts = [];
  if (removed.length) parts.push(`removed ${removed.length}: ${JSON.stringify(removed)}`);
  if (added.length) parts.push(`added ${added.length}: ${JSON.stringify(added)}`);
  return parts.join('; ');
}

// ----- Event diff -----------------------------------------------------------

function eventSummary(e) {
  return `"${e.title}" by ${e.organizer || '?'}` + (e.venueId ? ` @ ${e.venueId}` : '');
}

function diffEvents(oldEvents, newEvents) {
  const oldMap = new Map(oldEvents.map(e => [e.id, e]));
  const newMap = new Map(newEvents.map(e => [e.id, e]));
  const oldIds = new Set(oldMap.keys());
  const newIds = new Set(newMap.keys());

  const added = [];
  const removed = [];
  const edited = [];

  for (const id of newIds) {
    if (!oldIds.has(id)) {
      added.push(newMap.get(id));
    }
  }
  for (const id of oldIds) {
    if (!newIds.has(id)) {
      removed.push(oldMap.get(id));
    }
  }
  for (const id of newIds) {
    if (oldIds.has(id)) {
      const oldEv = oldMap.get(id);
      const newEv = newMap.get(id);
      const changes = eventChanges(oldEv, newEv);
      if (changes.length > 0) {
        edited.push({ id, old: oldEv, new: newEv, changes });
      }
    }
  }

  return { added, removed, edited };
}

function eventChanges(oldEv, newEv) {
  const changes = [];
  // Compare top-level scalar fields (skip address sub-object — handled separately)
  const scalarFields = ['title', 'teaser', 'description', 'begin', 'end', 'beginMin', 'endMin',
    'duration', 'interest', 'organizer', 'imageUrl', 'venueId'];
  for (const f of scalarFields) {
    const a = oldEv[f];
    const b = newEv[f];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ field: f, old: a, new: b });
    }
  }
  // formats, attributes, links via array comparison
  for (const f of ['formats', 'attributes', 'links']) {
    const diff = compareArrays(oldEv[f] || [], newEv[f] || []);
    if (diff) changes.push({ field: f, old: oldEv[f], new: newEv[f], desc: diff });
  }
  // address sub-object
  if (oldEv.address || newEv.address) {
    const oldAddr = oldEv.address || {};
    const newAddr = newEv.address || {};
    const addrFields = ['raw', 'street', 'zip', 'city', 'district', 'building', 'room'];
    for (const f of addrFields) {
      const a = oldAddr[f] || '';
      const b = newAddr[f] || '';
      if (a !== b) {
        changes.push({ field: `address.${f}`, old: a, new: b });
      }
    }
  }
  return changes;
}

// ----- Venue diff -----------------------------------------------------------

function venueSummary(v) {
  const lat = v.lat != null ? v.lat.toFixed(5) : '?';
  const lng = v.lng != null ? v.lng.toFixed(5) : '?';
  return `"${v.name}" (${lat}, ${lng})`;
}

function diffVenues(oldVenues, newVenues) {
  const oldMap = new Map(oldVenues.map(v => [v.id, v]));
  const newMap = new Map(newVenues.map(v => [v.id, v]));
  const oldIds = new Set(oldMap.keys());
  const newIds = new Set(newMap.keys());

  const added = [];
  const removed = [];
  const edited = [];

  for (const id of newIds) {
    if (!oldIds.has(id)) added.push(newMap.get(id));
  }
  for (const id of oldIds) {
    if (!newIds.has(id)) removed.push(oldMap.get(id));
  }
  for (const id of newIds) {
    if (oldIds.has(id)) {
      const oldV = oldMap.get(id);
      const newV = newMap.get(id);
      const changes = venueChanges(oldV, newV);
      if (changes.length > 0) {
        edited.push({ id, old: oldV, new: newV, changes });
      }
    }
  }

  return { added, removed, edited };
}

function venueChanges(oldV, newV) {
  const changes = [];
  // scalar fields
  const scalarFields = ['name', 'displayName'];
  for (const f of scalarFields) {
    const a = oldV[f];
    const b = newV[f];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ field: f, old: a, new: b });
    }
  }
  // Geolocation — highlight explicitly
  if (oldV.lat !== newV.lat || oldV.lng !== newV.lng) {
    changes.push({ field: '📍 lat', old: oldV.lat, new: newV.lat });
    changes.push({ field: '📍 lng', old: oldV.lng, new: newV.lng });
  }
  // address sub-object
  if (oldV.address || newV.address) {
    const oldAddr = oldV.address || {};
    const newAddr = newV.address || {};
    const addrFields = ['raw', 'street', 'zip', 'city', 'district', 'building', 'room'];
    for (const f of addrFields) {
      const a = oldAddr[f] || '';
      const b = newAddr[f] || '';
      if (a !== b) {
        changes.push({ field: `address.${f}`, old: a, new: b });
      }
    }
  }
  // eventIds array
  const eventDiff = compareArrays(oldV.eventIds || [], newV.eventIds || []);
  if (eventDiff) changes.push({ field: 'eventIds', old: oldV.eventIds, new: newV.eventIds, desc: eventDiff });

  return changes;
}

// ----- Markdown output ------------------------------------------------------

function writeMarkdown(evDiff, vDiff) {
  const now = new Date().toISOString().replace('T', ' ').replace(/:\d{2}\.\d{3}Z/, '');
  const lines = [];

  lines.push(`# Data Diff Report — ${now}`);
  lines.push('');
  lines.push('> Compares `backup-*.json` (previous state) against current `src/data/*.json` after update.');
  lines.push('');

  // Summary
  const totalChanges = evDiff.added.length + evDiff.removed.length + evDiff.edited.length +
    vDiff.added.length + vDiff.removed.length + vDiff.edited.length;
  if (totalChanges === 0) {
    lines.push('## ✅ No changes');
    lines.push('');
    lines.push('The current data is identical to the backup. Nothing was added, edited, or removed.');
  }

  // ---- Events ----
  if (totalChanges > 0) {
    lines.push('## Events');
    lines.push('');

    if (evDiff.added.length > 0) {
      lines.push(`### 🟢 Additions (${evDiff.added.length})`);
      lines.push('');
      for (const e of evDiff.added) {
        lines.push(`- **${e.id}**: ${eventSummary(e)}`);
      }
      lines.push('');
    }

    if (evDiff.edited.length > 0) {
      lines.push(`### 🟡 Edits (${evDiff.edited.length})`);
      lines.push('');
      for (const { id, changes } of evDiff.edited) {
        const ev = evDiff.edited.find(x => x.id === id).new;
        lines.push(`- **${id}**: ${eventSummary(ev)}`);
        for (const ch of changes) {
          if (ch.desc) {
            lines.push(`  - ${ch.field}: ${ch.desc}`);
          } else {
            lines.push(`  - ${ch.field}: ${fmt(ch.old)} → ${fmt(ch.new)}`);
          }
        }
        lines.push('');
      }
    }

    if (evDiff.removed.length > 0) {
      lines.push(`### 🔴 Removals (${evDiff.removed.length})`);
      lines.push('');
      for (const e of evDiff.removed) {
        lines.push(`- **${e.id}**: ${eventSummary(e)}`);
      }
      lines.push('');
    }

    // ---- Venues ----
    lines.push('## Venues');
    lines.push('');

    if (vDiff.added.length > 0) {
      lines.push(`### 🟢 Additions (${vDiff.added.length})`);
      lines.push('');
      for (const v of vDiff.added) {
        lines.push(`- **${v.id}**: ${venueSummary(v)} — ${v.eventIds.length} event(s)`);
      }
      lines.push('');
    }

    if (vDiff.edited.length > 0) {
      lines.push(`### 🟡 Edits (${vDiff.edited.length})`);
      lines.push('');
      for (const { id, changes } of vDiff.edited) {
        const v = vDiff.edited.find(x => x.id === id).new;
        lines.push(`- **${id}**: ${venueSummary(v)}`);
        for (const ch of changes) {
          if (ch.desc) {
            lines.push(`  - ${ch.field}: ${ch.desc}`);
          } else {
            lines.push(`  - ${ch.field}: ${fmt(ch.old)} → ${fmt(ch.new)}`);
          }
        }
        lines.push('');
      }
    }

    if (vDiff.removed.length > 0) {
      lines.push(`### 🔴 Removals (${vDiff.removed.length})`);
      lines.push('');
      for (const v of vDiff.removed) {
        lines.push(`- **${v.id}**: ${venueSummary(v)} — ${v.eventIds.length} event(s)`);
      }
      lines.push('');
    }
  }

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DIFF_OUT, lines.join('\n'), 'utf8');
}

// ----- Main ----------------------------------------------------------------

function main() {
  const missing = [];
  if (!existsSync(BACKUP_EVENTS)) missing.push(BACKUP_EVENTS);
  if (!existsSync(BACKUP_VENUES)) missing.push(BACKUP_VENUES);
  if (!existsSync(CURRENT_EVENTS)) missing.push(CURRENT_EVENTS);
  if (!existsSync(CURRENT_VENUES)) missing.push(CURRENT_VENUES);
  if (missing.length > 0) {
    console.error('Missing files:', missing.join(', '));
    console.error('Run backup.mjs first, then the data update pipeline.');
    process.exit(1);
  }

  const oldEvents = JSON.parse(readFileSync(BACKUP_EVENTS, 'utf8'));
  const oldVenuesParsed = JSON.parse(readFileSync(BACKUP_VENUES, 'utf8'));
  const oldVenues = oldVenuesParsed.venues || oldVenuesParsed;

  const newEvents = JSON.parse(readFileSync(CURRENT_EVENTS, 'utf8'));
  const newVenuesParsed = JSON.parse(readFileSync(CURRENT_VENUES, 'utf8'));
  const newVenues = newVenuesParsed.venues || newVenuesParsed;

  const evDiff = diffEvents(Array.isArray(oldEvents) ? oldEvents : [], Array.isArray(newEvents) ? newEvents : []);
  const vDiff = diffVenues(Array.isArray(oldVenues) ? oldVenues : [], Array.isArray(newVenues) ? newVenues : []);

  writeMarkdown(evDiff, vDiff);

  const total = evDiff.added.length + evDiff.edited.length + evDiff.removed.length +
    vDiff.added.length + vDiff.edited.length + vDiff.removed.length;
  console.log(`Diff written to scraper/data/diff.md`);
  console.log(`Events: +${evDiff.added.length} ~${evDiff.edited.length} -${evDiff.removed.length}`);
  console.log(`Venues: +${vDiff.added.length} ~${vDiff.edited.length} -${vDiff.removed.length}`);
  console.log(`Total changes: ${total}`);
}

main();
