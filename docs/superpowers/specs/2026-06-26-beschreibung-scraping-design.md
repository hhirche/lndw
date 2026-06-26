# Design: Scrape "Beschreibung" from Event Detail Pages

**Date:** 2026-06-26
**Status:** Approved

## Problem

The event detail drawer currently shows only the `subheader` content from the original event detail page as `description`. The richer "Beschreibung" section (`<div class="description mb-3 mb-lg-5">`) on the same page often contains substantially more detail and is not being scraped.

**Example — "Magic on Ice" (15878):**
- `subheader` → "Experimentalvorführung zu Hochtemperatursupraleitern" (6 words)
- `Beschreibung` → "Hochtemperatursupraleiter lassen auf magische Weise einen Zug schweben. Anhand einer Experimentalvorführung werden physikalische Effekte und die Wirkungsweise von Supraleitern erläutert. Physik zum Anfassen, besonders geeignet für technikbegeisterte Kinder und Jugendliche."

## Approach

Add scraping of the Beschreibung HTML section alongside the existing subheader. Keep both fields — `description` (subheader/teaser) and `beschreibung` (full description) — and display both in the detail drawer.

Performance is unaffected: all scraping runs offline in the data update pipeline. The only runtime cost is one extra `<div>` in the detail drawer plus a small increase in `events.json` file size.

## Data Model

New field on event objects:

```
beschreibung: string  // plain-text content from <div class="description mb-3 mb-lg-5">,
                      // with HTML tags stripped, <br> → newlines.
                      // Empty string if no Beschreibung exists or it's identical to teaser.
```

## Files Changed

### 1. `scraper/update-details.mjs` — parseDetailPage()

Add extraction after the existing `description` parsing:

```js
let beschreibung = '';
const descMatch = html.match(/<div class="description mb-3 mb-lg-5">[\s\S]*?<h2>\s*Beschreibung\s*<\/h2>\s*([\s\S]*?)\s*<\/div>/);
if (descMatch) {
  beschreibung = dec(descMatch[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim());
}
```

Return `beschreibung` in the detail object.

### 2. `scraper/merge.mjs` — event mapping

Pass through in the event object:

```js
beschreibung: d.beschreibung || '',
```

### 3. `src/cards.js` — showEvent()

Render Beschreibung block below the existing description, only when present:

```js
${ev.beschreibung ? `<div class="card-beschreibung"><h3 class="card-section-title">Beschreibung</h3>${escapeHtml(ev.beschreibung)}</div>` : ''}
```

### 4. `scraper/diff.mjs` — event changes

Add `beschreibung` to the scalar fields list for diff comparison.

## Data Flow

```
[detail page HTML]
  ├─ <div class="subheader">  ──→  details.json[].description  ──→  events.json[].description
  └─ <div class="description mb-3 mb-lg-5">  ──→  details.json[].beschreibung  ──→  events.json[].beschreibung
                                         (NEW)                              (NEW)
```

Pipeline order unchanged: `extract-cards.mjs` → `update-details.mjs` → `merge.mjs` → `patch.mjs` → `build.mjs` → deploy.

## Display Behavior

- `description` (subheader) renders as before — in the `card-description` block
- `beschreibung` renders in a new `card-beschreibung` block below the description
- No new CSS required; the existing typography styles apply to the new block

## Edge Cases

- **Beschreibung identical to subheader**: Stored as-is. Display logic always shows both when present; minor redundancy in ~5% of events is acceptable and simpler than fragile string dedup.
- **Missing Beschreibung section**: Empty string (some detail pages may not have it)
- **HTML in Beschreibung**: Stripped to plain text, `<br>` converted to newlines — consistent with current `description` handling
- **Data size**: Even if every event gains 300 characters, that adds ~250KB to `events.json` — on a par with the existing file size, negligible for a static site

## Non-Goals

- Not preserving rich HTML formatting (bold, links, etc.)
- Not modifying the card-list teaser (that stays as-is from `extract-cards.mjs`)
- Not re-scraping existing detail pages — will only affect new runs of `update-details.mjs`
