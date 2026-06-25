# LNdW Dresden — Interaktive Programmkarte

Eine neu aufgebaute, map-zentrierte Website für das Programm der **Dresdner Langen Nacht der Wissenschaften**. Die Daten werden von der [Original-Programmseite](https://www.wissenschaftsnacht-dresden.de/programm) extrahiert und um eine interaktive Karte mit Filtern herum aufbereitet.

## Features

- **Große interaktive Karte** als zentrales Element (Leaflet + OpenStreetMap)
- **Veranstaltungsorte als Marker** mit Event-Anzahl-Badge
- **Klick auf einen Ort** → Popup listet alle Veranstaltungen dort
- **Klick auf eine Veranstaltung** → Detail-Karte mit Beschreibung, Zeiten, Veranstalter, Links
- **Link zur Original-Veranstaltungsseite** auf jeder Karte
- **Filter**: Suche, Uhrzeit ab/bis, Veranstalter, Veranstaltungsort, Stadtteil, Format, Interessen
- **Teilbare Ansichten** via URL-Hash
- **Responsive** für Desktop & Mobile
- **Minimal dependencies**: nur Leaflet (via CDN), sonst Vanilla JS

## Architektur

```
LNDW/
├── scraper/              # Datengewinnung (Node, keine Runtime-Dependencies)
│   ├── data/             # Rohdaten + Cache + Backup + Diff
│   │   ├── cards.json        # Aus programm.html extrahierte Karten
│   │   ├── details.json      # Von Detailseiten extrahierte Daten
│   │   ├── scrape-raw.json   # Zusammengeführte Rohdaten
│   │   ├── patches.json      # Manuelle Adress-Patches (überschreibt scrape-raw nach merge)
│   │   ├── geocode-cache.json# Geocoding-Cache
│   │   ├── venues.json       # Geocodete Veranstaltungsorte
│   │   ├── backup-events.json# Backup der letzten events.json (überschrieben bei jedem Update)
│   │   ├── backup-venues.json# Backup der letzten venues.json (überschrieben bei jedem Update)
│   │   └── diff.md           # Diff-Report (menschenlesbar, zeigt Δ zwischen Backup und aktuellen Daten)
│   ├── backup.mjs         # src/data/{events,venues}.json → backup-*.json
│   ├── extract-cards.mjs  # programm.html → cards.json
│   ├── update-details.mjs # Fehlende Detailseiten nachladen → details.json
│   ├── merge.mjs          # cards.json + details.json → scrape-raw.json
│   ├── patch.mjs          # patches.json → scrape-raw.json (manuelle Adresskorrekturen)
│   ├── geocode.mjs        # Adressen → Koordinaten (Photon/Komoot)
│   ├── diff.mjs           # Vergleicht backup-*.json mit aktuellen Daten → diff.md
│   └── build.mjs          # scrape-raw.json + venues.json → src/data/*.json
├── src/                  # Statische Website
│   ├── index.html
│   ├── styles.css
│   ├── main.js
│   ├── map.js
│   ├── filters.js
│   ├── cards.js
│   └── data/             # Finaldaten (von build.mjs erzeugt)
├── build.mjs             # src/ → dist/ kopieren
├── serve.mjs             # Minimaler Static-Server (korrekte MIME-Types für ES Modules)
└── README.md
```

## Setup & Datenaktualisierung

### 1. Voraussetzungen
- Node.js 18+ (keine npm-Installation nötig — nur Standardmodule)

### 2. Daten aktualisieren

Die Programmseite rendert alle Veranstaltungen serverseitig als HTML — ein JavaScript-Browser ist zum Scrapen nicht nötig. Die Aktualisierung erfolgt in sechs Schritten: **Backup → Scrapen → Patchen → Aufbereiten → Diff → Review**.

**a) Backup der aktuellen Daten**

Vor jeder Aktualisierung werden die aktuellen finalen Daten gesichert. `backup.mjs` kopiert `events.json` und `venues.json` aus `src/data/` als `backup-events.json` und `backup-venues.json` nach `scraper/data/`. Die Backup-Dateien werden bei jedem Lauf überschrieben — es gibt immer nur eine Instanz.

```bash
node scraper/backup.mjs
```

**b) Programmseite herunterladen und Karten extrahieren**

`extract-cards.mjs` parst das HTML der Programmseite und extrahiert aus jeder Event-Karte Titel, Teaser, Veranstalter, Zeiten und Formate. Das Ergebnis ist `cards.json` — eine Karte pro Event.

```bash
curl -o scraper/data/programm.html https://www.wissenschaftsnacht-dresden.de/programm
node scraper/extract-cards.mjs
```

**c) Detailseiten nachladen**

`update-details.mjs` vergleicht `cards.json` mit dem vorhandenen `details.json` und lädt nur für Karten, zu denen noch kein Detail-Datensatz existiert, die individuelle Detailseite nach. Aus jeder Seite werden Beschreibung, Adresse, Links und weitere Felder extrahiert. Existierende Detail-Datensätze bleiben unangetastet.

```bash
node scraper/update-details.mjs
```

**d) Adressdaten manuell korrigieren (optional)**

Die Original-Website enthält gelegentlich falsche Adressen — z. B. wenn eine Veranstaltung laut Detailseite an einem Ort stattfindet, tatsächlich aber woanders. Mit `patch.mjs` können einzelne Adressfelder pro Event überschrieben werden, bevor die Adressen geocodiert werden.

Patches werden in `scraper/data/patches.json` als JSON hinterlegt:

```json
{
  "patches": {
    "<event-id>": {
      "_note": "<Begründung>",
      "address": {
        "street": "<korrigierte Straße>",
        "zip": "<korrigierte PLZ>",
        "city": "<korrigierter Ort>",
        "district": "<korrigierter Stadtteil>",
        "building": "<korrigiertes Gebäude>"
      }
    }
  }
}
```

- Der Key ist die numerische Event-ID (aus der Detail-URL, z. B. `...-15765` → `"15765"`)
- Nur die Felder angeben, die korrigiert werden sollen — alle anderen bleiben unverändert
- `_note` dient der Dokumentation und wird vom Skript ignoriert
- Nach dem Patchen werden die korrigierten Adressen wie gewohnt geocodiert und landen in den finalen Daten

```bash
node scraper/patch.mjs
```

**e) Daten zusammenführen und aufbereiten**

Die drei folgenden Skripte erzeugen aus den Rohdaten die finalen JSON-Dateien für die Website:

| Skript | Eingabe | Ausgabe | Beschreibung |
|--------|---------|---------|--------------|
| `merge.mjs` | `cards.json` + `details.json` | `scrape-raw.json` | Führt Karten- und Detaildaten pro Event zusammen, parst Adressen |
| `geocode.mjs` | `scrape-raw.json` (+ Cache) | `venues.json` | Löst Adressen über die Photon-API zu Koordinaten auf (Ergebnisse werden gecacht) |
| `build.mjs` | `scrape-raw.json` + `venues.json` | `src/data/{events,venues,filters}.json` | Baut die finalen Datenstrukturen, weist Venue-IDs zu, generiert Filterlisten |

```bash
node scraper/merge.mjs
node scraper/geocode.mjs
node scraper/build.mjs
```

**f) Diff gegen Backup**

`diff.mjs` vergleicht die Backup-Dateien (`backup-events.json`, `backup-venues.json`) mit den aktuellen Daten (`src/data/events.json`, `src/data/venues.json`) und schreibt einen menschenlesbaren Diff-Report nach `scraper/data/diff.md`. Der Report listet Hinzufügungen, Änderungen (auf Feldebene) und Entfernungen — für Events und Venues getrennt. Bei Venues werden Änderungen an Geokoordinaten (lat/lng) gesondert hervorgehoben.

```bash
node scraper/diff.mjs
```

Der erzeugte `diff.md` kann vor dem Commit manuell geprüft werden, um die Plausibilität der Änderungen sicherzustellen.

### 3. Website bauen & ansehen

> **Wichtig:** Nicht `python -m http.server` verwenden! Python serviert `.js`-Dateien als `text/plain`, was Browser für ES-Module ablehnen. Die Seite lädt dann endlos. Stattdessen den mitgelieferten `serve.mjs` verwenden, der korrekte MIME-Types setzt.

```bash
# Für Entwicklung: src/ direkt serven
node serve.mjs src 8000
# → http://localhost:8000

# Für Produktion: dist/ bauen und serven
node build.mjs
node serve.mjs dist 8000
# → http://localhost:8000
```

Alternativ funktioniert auch jeder andere Webserver, der `.js` als `text/javascript` ausliefert (z. B. `npx serve dist`).

## Datenquelle & Lizenz

- **Daten**: © Landeshauptstadt Dresden, [wissenschaftsnacht-dresden.de](https://www.wissenschaftsnacht-dresden.de)
- **Kartendaten**: © OpenStreetMap Mitwirkende
- **Geocoding**: [Photon](https://photon.komoot.io) (Komoot)

Dieses Projekt ist ein nicht-kommerzielles Bildungsprojekt zur Verbesserung der Nutzererfahrung. Alle Veranstaltungsdaten stammen von der offiziellen Website; für verbindliche Informationen bitte die Original-Veranstaltungsseiten konsultieren.
