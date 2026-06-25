# InkScores

A calm, always-on sports dashboard for the **Seeed Studio reTerminal E1002**
(7.3" 800×480 colour ePaper, ESP32-S3). It shows recent scores, next games,
records, and standings for a small set of watched teams — and automatically
hides teams that are out of season.

Watched teams: **Detroit Tigers, Chicago Cubs, Detroit Pistons, Michigan State
football, Michigan State men's basketball.**

This is **not** a live scoreboard. It is a glanceable dashboard that updates
every 15 minutes to 6 hours depending on context, then sleeps.

## Architecture

```
Sports APIs (ESPN)  →  backend service  →  /api/dashboard.json  →  reTerminal firmware  →  render + deep sleep
```

- **The device is dumb.** It fetches one small JSON payload, renders it, sleeps.
- **The backend is smart.** It fetches data, decides which sports are active,
  formats cards and standings, caches upstream calls, and degrades gracefully.

See [`PROJECT_MANIFESTO.md`](./PROJECT_MANIFESTO.md) for the full product spec.

## Repository layout

```
inkscores/
  backend/      Node + Express + TypeScript service (the brains)
  firmware/     PlatformIO / Arduino firmware for the ESP32-S3
  docs/         API contract, layout, and data-source notes
```

## Backend

```bash
cd backend
npm install
npm run dev      # starts http://localhost:8787
npm test         # vitest (74 tests)
npm run typecheck
```

Endpoints:

| URL | Purpose |
|-----|---------|
| `GET /api/dashboard.json` | Live dashboard (real ESPN data, season-aware) |
| `GET /api/dashboard.json?mock=mlb` | Static MLB mock (no upstream calls) |
| `GET /api/dashboard.json?mock=mixed` | Static multi-sport mock |
| `GET /api/dashboard.json?debug=all` | Force **all** watched teams to render |
| `GET /api/dashboard.json?debug=mlb` | Force a single sport (mlb/nba/ncaaf/ncaamb) |
| `GET /healthz` | Liveness check |

The response always matches the dashboard contract — even on upstream failure it
returns a valid JSON document with a `message` section, never a raw error.

What it does:

- **Season-aware hiding** — a team shows only if it is in its broad season
  window, played in the last 7 days, plays in the next 14 days, is in a
  playoff/tournament context, or has a live game today. In June you get MLB only.
- **Standings rules** — MLB shows all 5 division teams; NBA shows the Eastern
  Conference top 10 plus the Pistons; Big Ten shows the top 8 plus MSU.
- **Caching** — upstream ESPN responses are cached with `stale-if-error` so a
  flaky API never takes the dashboard down.

## Firmware

```bash
cd firmware
cp src/config.example.h src/config.h   # then edit Wi-Fi + DASHBOARD_URL
pio run                                 # build
pio run --target upload                 # flash
pio device monitor                      # serial logs
```

The firmware wakes, connects to Wi-Fi, fetches the dashboard JSON, renders the
header + two team cards + two standings tables, then deep-sleeps for
`refreshAfterSeconds`. Failed fetches fall back to the last cached dashboard, or
an error screen, and retry sooner. See [`docs/layout.md`](./docs/layout.md).

> The ePaper panel binding (`GxEPD2` class + SPI pins) in
> `firmware/src/render_dashboard.cpp` is board-specific. Confirm it against
> Seeed's reTerminal E1002 ePaper example if the screen stays blank.

## Status

MVP backend is complete and verified end-to-end against live ESPN data for all
five teams across all four sports (MLB live; NBA/NCAAF/NCAAMB via `debug`
modes). Firmware is written against the contract; flash it to a board to
validate rendering.
