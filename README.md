# Pathly

Interactive workout tracker built with **vanilla JavaScript** and [**Leaflet**](https://leafletjs.com/).  
Pin runs and rides on a map, draw routes, sort/edit/delete workouts — all data stays in the browser.

Map-based CRUD app using OOP, `localStorage`, and public HTTP APIs (no backend).

---

## Quick start

```bash
# from this folder — ES modules + map tiles need a local server
npx serve .
# or VS Code / Cursor Live Server
```

Open the printed URL → map starts on **Warsaw** → click the map to add a workout.

---

## Usage

| Action | How |
|--------|-----|
| Add workout | Click the map → fill form → **Save** |
| Draw a route | **Draw route** → click points → **Finish** → Save |
| Jump to workout | Click a sidebar card → map flies to that pin |
| Edit | ✎ on a card → Save |
| Delete one | ✕ on a card → confirm |
| Delete all | **Clear all** → confirm |
| Sort | Newest / oldest / distance / duration |
| Show all pins | **Fit map** |

---

## Architecture

```
index.html   → UI shell, Leaflet CSS + importmap
style.css    → layout, theme, toasts, modal
script.js    → domain models + App controller
```

### Domain model

| Class | Role |
|-------|------|
| `Workout` | Base: `coords`, `distance`, `duration`, `id`, `date`, place, weather, optional `path` |
| `Running` | Extends `Workout` — `cadence`, `calcPace()` (min/km) |
| `Cycling` | Extends `Workout` — `elevationGain`, `calcSpeed()` (km/h) |
| `App` | Controller: private `#` fields, events, render, persistence |

### Map — [Leaflet](https://leafletjs.com/)

Leaflet is the **map UI library** (markers, popups, pan/zoom, polylines).

- Loaded via CDN + importmap (`LeafletMap`, `TileLayer`, `Marker`, `Popup`, `Polyline`, `LatLngBounds`, `CircleMarker`)
- Raster tiles: **OpenStreetMap** (`tile.openstreetmap.org`) — no API key
- Start view: Warsaw `[52.2297, 21.0122]`
- Card click → `flyTo` + open popup; **Fit map** → `fitBounds`

### Place names — [Nominatim](https://nominatim.openstreetmap.org/)

Nominatim is **not** a replacement for Leaflet. It is a separate **reverse-geocoding** API (lat/lng → city/country).

| Layer | Tool | Job |
|-------|------|-----|
| Interactive map | [Leaflet](https://leafletjs.com/) | Display, markers, routes, camera |
| Map imagery | OpenStreetMap tiles | The visual map pictures |
| Address lookup | [Nominatim](https://nominatim.openstreetmap.org/) | `GET /reverse?lat=…&lon=…&format=json` → e.g. `Warszawa, Polska` |

### Weather — [Open-Meteo](https://open-meteo.com/)

- `GET /v1/forecast?latitude=…&longitude=…&current=temperature_2m,weather_code`
- No API key; result stored on the workout and shown on the card/popup
- Labels from WMO weather codes

### Persistence

- Key: `pathly-workouts` (`localStorage`)
- JSON on every create / edit / delete
- On load, objects are re-created as `Running` / `Cycling` instances (methods restored)

### Other behaviour

- Draw-route mode → preview `Polyline` → saved path on the workout
- Toasts + centered `<dialog>` confirmations
- Sort, edit, delete, clear all

---

## Tech stack

| Piece | Choice |
|-------|--------|
| Language | Vanilla JS (ES modules) |
| Map UI | [Leaflet](https://leafletjs.com/) 2.x (CDN) |
| Tiles | OpenStreetMap |
| Geocoding | [Nominatim](https://nominatim.openstreetmap.org/) |
| Weather | [Open-Meteo](https://open-meteo.com/) |
| Storage | `localStorage` |
| Fonts | Syne + Figtree |

---

## Project structure

```
.
├── index.html
├── style.css
├── script.js
├── README.md
├── LICENSE
└── .gitignore
```

---

## Privacy

No accounts, no server, no analytics. Workout data stays in the browser’s `localStorage`.

---

## Summary

- OOP: inheritance + private fields
- Browser: `localStorage`, `fetch`, class rehydration after JSON
- Leaflet: markers, popups, polylines, `fitBounds` / `flyTo`
- APIs: Nominatim (place), Open-Meteo (weather) — both keyless
- UX: toasts, confirm dialog, draw-route, sort, edit/delete

## License

MIT — see `LICENSE`.
