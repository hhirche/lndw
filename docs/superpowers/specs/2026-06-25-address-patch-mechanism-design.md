# Address Patch Mechanism — Design

## Motivation

The source website (wissenschaftsnacht-dresden.de) sometimes lists wrong addresses for events. We need a manual override mechanism to correct address data after scraping, before geocoding and building final output.

**Example:** Event 15765 ("Hunger und Durst? Die Mensa Johanna hat geöffnet!") is listed at "Alte Mensa, Mommsenstraße 13, 01069 Dresden" but actually takes place at "Mensa Johanna, Marschnerstraße 38, 01307 Dresden".

## Scope

Patch **address fields only**: `street`, `zip`, `city`, `district`, `building`, `room`. Any subset can be specified — unspecified fields keep their scraped values.

## Pipeline Position

```
merge → patch (NEW) → geocode → build → diff
```

`patch.mjs` modifies `scrape-raw.json` after merge so corrected addresses flow through geocoding and into final output.

## File: `scraper/data/patches.json`

```json
{
  "patches": {
    "<event-id>": {
      "_note": "<human explanation for this patch>",
      "address": {
        "street": "<corrected street>",
        "zip": "<corrected zip>",
        "city": "<corrected city>",
        "district": "<corrected district>",
        "building": "<corrected building>",
        "room": "<corrected room>"
      }
    }
  }
}
```

- Keyed by numeric event ID extracted from the detailUrl slug (e.g. `...-15765` → `"15765"`)
- Only changed address fields need to appear — a shallow merge is applied per event
- `_note` is human documentation, ignored by the script
- File lives in `scraper/data/` alongside other data files

## Script: `scraper/patch.mjs`

- Reads `patches.json` and `scrape-raw.json`
- For each event, extracts the numeric ID from `detailUrl`
- If a patch exists for that ID, shallow-merges `patch.address` into `event.address`
- Logs which events were patched
- Writes updated `scrape-raw.json`

## README

Add `patch.mjs` as a step in the data update pipeline, explaining the patch file format and when to use it.
