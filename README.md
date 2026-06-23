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
│   ├── data/             # Rohdaten + Cache
│   │   ├── cards.json        # Extrahierte Karten vom Browser
│   │   ├── details.json      # Extrahierte Detailseiten vom Browser
│   │   ├── scrape-raw.json   # Zusammengeführte Rohdaten
│   │   ├── geocode-cache.json# Geocoding-Cache
│   │   └── venues.json       # Geocodete Veranstaltungsorte
│   ├── merge.mjs         # cards.json + details.json → scrape-raw.json
│   ├── geocode.mjs       # Adressen → Koordinaten (Photon/Komoot)
│   ├── build.mjs         # scrape-raw.json + venues.json → src/data/*.json
│   └── receive.mjs       # HTTP-Receiver für Browser-Scraping
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

### 2. Daten scrapen (via VS Code integriertem Browser)

Das Scraping nutzt den in VS Code integrierten Browser (Playwright), da die Originalseite Karten via JavaScript lädt.

```powershell
# a) Receiver starten (für Browser → Datei-Transfer)
node scraper\receive.mjs scraper\data\cards.json

# b) Im VS Code Browser: https://www.wissenschaftsnacht-dresden.de/programm öffnen
#    Dann via Copilot Browser-Tools page.evaluate ausführen, um Karten zu extrahieren
#    und an den Receiver zu POSTen. (Siehe scraper/merge.mjs für Feldstruktur.)

# c) Details analog: Receiver für details.json starten, Detailseiten via fetch+DOMParser
#    im Browser extrahieren und POSTen.
```

### 3. Daten zusammenführen & aufbereiten

```powershell
node scraper\merge.mjs       # cards + details → scrape-raw.json
node scraper\geocode.mjs     # Adressen → Koordinaten (Photon API, gecacht)
node scraper\build.mjs       # → src/data/{events,venues,filters}.json
```

### 4. Website bauen & ansehen

> **Wichtig:** Nicht `python -m http.server` verwenden! Python serviert `.js`-Dateien als `text/plain`, was Browser für ES-Module ablehnen. Die Seite lädt dann endlos. Stattdessen den mitgelieferten `serve.mjs` verwenden, der korrekte MIME-Types setzt.

```powershell
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
