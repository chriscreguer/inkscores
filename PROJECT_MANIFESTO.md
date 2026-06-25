# InkScores Project Manifesto

## Goal

Build a sports dashboard for the Seeed Studio reTerminal E1002, a 7.3-inch 800×480 color ePaper display powered by ESP32-S3.

The dashboard should show recent scores, next games, records, and relevant standings for only the teams/sports that are currently active:

* Detroit Tigers
* Chicago Cubs
* Detroit Pistons
* Michigan State football
* Michigan State men’s basketball

The app should automatically hide teams that are out of season, unless there is a very recent game, upcoming game, playoff/bracket context, or other relevant active status.

This is not a live scoreboard app. This is a calm, always-on, glanceable ePaper dashboard.

## Core Product Principles

1. The ePaper display is slow-refresh and low-power.

   * No animations.
   * No scrolling.
   * No rapid screen updates.
   * No unnecessary full-screen refreshes.
   * Design around static screens that update every 15 minutes to 6 hours depending on context.

2. The device should be dumb.

   * The ESP32 should not understand complex sports logic.
   * The backend decides what to show.
   * The device fetches one small JSON payload, renders it, then sleeps.

3. The backend should be smart.

   * It fetches sports data.
   * It determines active/inactive seasons.
   * It formats team cards.
   * It formats standings tables.
   * It handles API weirdness, caching, fallbacks, and off-season hiding.

4. The layout must fit 800×480.

   * Prioritize readability.
   * Use concise labels.
   * Avoid dense paragraphs.
   * Keep sections modular.
   * Favor 2-column standings when MLB is active.

5. The first useful MVP is MLB only.

   * Tigers card
   * Cubs card
   * AL Central standings
   * NL Central standings

After that, add Pistons, MSU football, and MSU basketball.

## Target Hardware

Device: Seeed Studio reTerminal E1002

Known relevant specs:

* 7.3-inch full-color ePaper display
* 800×480 resolution
* ESP32-S3
* 8 MB PSRAM
* 32 MB flash
* 2.4 GHz Wi-Fi
* USB-C power
* 2000 mAh battery
* Supports Arduino / PlatformIO / ESP-IDF / ESPHome
* Built for low-refresh dashboards

Preferred firmware approach:

* PlatformIO + Arduino framework
* Wi-Fi fetch
* JSON parse
* ePaper render
* deep sleep

Avoid Home Assistant/SenseCraft/TRMNL for this custom version unless explicitly chosen later.

## System Architecture

Use a two-part architecture:

```text
Sports APIs
   ↓
Backend service
   ↓
/api/dashboard.json
   ↓
reTerminal E1002 firmware
   ↓
Render static dashboard
   ↓
Deep sleep
```

Recommended backend:

* Cloudflare Worker, Vercel function, or small Node/Express service
* TypeScript preferred
* Public read-only endpoint
* No user auth required initially
* API keys, if any, must stay server-side

Recommended firmware:

* PlatformIO project for ESP32-S3
* Fetch JSON from backend over HTTPS
* Render sections onto ePaper
* Sleep according to backend-provided refresh interval

## Repository Structure

Use this structure:

```text
inkscores/
  README.md
  PROJECT_MANIFESTO.md

  backend/
    package.json
    src/
      index.ts
      config.ts
      types.ts
      activeSeasons.ts
      dashboardBuilder.ts
      cache.ts
      adapters/
        espn.ts
        mlb.ts
        nba.ts
        ncaaf.ts
        ncaamb.ts
      formatters/
        records.ts
        standings.ts
        games.ts
      mock/
        dashboard.mlb.json
        dashboard.mixed.json

  firmware/
    platformio.ini
    src/
      main.cpp
      config.example.h
      dashboard_types.h
      fetch_dashboard.cpp
      render_dashboard.cpp
      sleep.cpp
      wifi.cpp

  docs/
    api-contract.md
    layout.md
    data-sources.md
```

## Team Config

Use a single source of truth for watched teams.

```ts
export const WATCHED_TEAMS = [
  {
    key: "tigers",
    label: "Tigers",
    fullName: "Detroit Tigers",
    sport: "mlb",
    league: "MLB",
    espnTeamSlug: "det",
    division: "AL Central",
    priority: 1
  },
  {
    key: "cubs",
    label: "Cubs",
    fullName: "Chicago Cubs",
    sport: "mlb",
    league: "MLB",
    espnTeamSlug: "chc",
    division: "NL Central",
    priority: 2
  },
  {
    key: "pistons",
    label: "Pistons",
    fullName: "Detroit Pistons",
    sport: "nba",
    league: "NBA",
    espnTeamSlug: "det",
    standingsGroup: "Eastern Conference",
    priority: 3
  },
  {
    key: "msu-football",
    label: "MSU Football",
    fullName: "Michigan State Spartans Football",
    sport: "ncaaf",
    league: "NCAAF",
    espnTeamSlug: "msu",
    standingsGroup: "Big Ten",
    priority: 4
  },
  {
    key: "msu-basketball",
    label: "MSU Basketball",
    fullName: "Michigan State Spartans Men's Basketball",
    sport: "ncaamb",
    league: "NCAAMB",
    espnTeamSlug: "msu",
    standingsGroup: "Big Ten",
    priority: 5
  }
];
```

## Season-Aware Display Rules

The backend must decide whether each sport is active.

Do not only hardcode calendar months. Use a hybrid rule:

A team is active if any of these are true:

1. It is inside the broad expected season window.
2. The team played within the last 7 days.
3. The team has a scheduled game within the next 14 days.
4. The team is in playoffs, tournament, bowl, or bracket context.
5. The team has a live game today.

Broad season windows:

```ts
const SEASON_WINDOWS = {
  mlb: {
    startMonth: 3,
    endMonth: 10,
    note: "Spring training can be ignored for MVP. Regular season through postseason."
  },
  nba: {
    startMonth: 10,
    endMonth: 6,
    note: "Regular season, play-in, playoffs. Hide during true offseason unless Summer League is intentionally added later."
  },
  ncaaf: {
    startMonth: 8,
    endMonth: 1,
    note: "Regular season through bowls/playoff."
  },
  ncaamb: {
    startMonth: 11,
    endMonth: 4,
    note: "Regular season through conference tournaments and March Madness."
  }
};
```

Active logic:

```ts
function isTeamActive(team, context) {
  const now = context.now;

  if (context.hasLiveGame) return true;
  if (context.hasPlayoffOrTournamentContext) return true;
  if (context.lastGame && daysBetween(context.lastGame.date, now) <= 7) return true;
  if (context.nextGame && daysBetween(now, context.nextGame.date) <= 14) return true;
  if (isInsideBroadSeasonWindow(team.sport, now)) return true;

  return false;
}
```

Important behavior:

* In June, show MLB only.
* During NBA season, show Pistons and Eastern Conference standings.
* During MSU football season, show MSU football and Big Ten standings.
* During MSU basketball season, show MSU basketball and Big Ten standings.
* During March Madness, replace normal standings with tournament/bracket status if MSU is alive.
* If no watched teams are active, show a clean offseason screen with next expected season dates.

## Dashboard API Contract

The device should fetch one endpoint:

```text
GET /api/dashboard.json
```

Response shape:

```json
{
  "version": 1,
  "updatedAt": "2026-06-20T08:05:00-05:00",
  "timezone": "America/Chicago",
  "refreshAfterSeconds": 7200,
  "theme": {
    "mode": "epaper-color",
    "density": "compact"
  },
  "sections": [
    {
      "type": "teamCard",
      "id": "tigers-card",
      "title": "Tigers",
      "subtitle": "Detroit Tigers",
      "status": "active",
      "last": "W 5–3 vs CLE",
      "next": "Tonight 6:40 vs MIN",
      "record": "42–34",
      "standing": "AL Central: 2nd, 2.5 GB",
      "accent": "blue"
    },
    {
      "type": "standings",
      "id": "al-central",
      "title": "AL Central",
      "columns": ["#", "Team", "Record", "GB"],
      "highlightTeamKeys": ["tigers"],
      "rows": [
        ["1", "CLE", "44-31", "-"],
        ["2", "DET", "42-34", "2.5"],
        ["3", "KC", "38-38", "6.5"],
        ["4", "MIN", "36-40", "8.5"],
        ["5", "CWS", "28-48", "16.5"]
      ]
    }
  ],
  "footer": "Updated 8:05 AM"
}
```

The firmware must not require every field. It should gracefully handle missing fields.

Required top-level fields:

* version
* updatedAt
* refreshAfterSeconds
* sections

Supported section types:

* teamCard
* standings
* message

Optional future section types:

* bracketStatus
* liveGame
* alert

## Section Rules

### teamCard

Use for a watched team.

Fields:

```ts
type TeamCardSection = {
  type: "teamCard";
  id: string;
  title: string;
  subtitle?: string;
  status: "active" | "live" | "idle";
  last?: string;
  next?: string;
  record?: string;
  standing?: string;
  accent?: "blue" | "red" | "green" | "orange" | "gray";
};
```

Display rules:

* `title` large
* `last` and `next` medium
* `record` and `standing` small
* If live, show `LIVE` badge
* If data missing, show `—`, not a crash

### standings

Use for division/conference/Big Ten standings.

Fields:

```ts
type StandingsSection = {
  type: "standings";
  id: string;
  title: string;
  columns: string[];
  rows: string[][];
  highlightTeamKeys?: string[];
};
```

Display rules:

* MLB divisions: show all 5 teams.
* NBA Eastern Conference: show top 10 plus Pistons if not top 10.
* Big Ten football: show top 8 plus MSU if not top 8.
* Big Ten basketball: show top 8 plus MSU if not top 8.
* Highlight watched team row using border, bold text, or subtle color.
* Keep rows compact.

### message

Use when nothing active exists or data fails.

```ts
type MessageSection = {
  type: "message";
  id: string;
  title: string;
  body: string;
};
```

Example:

```json
{
  "type": "message",
  "id": "offseason",
  "title": "No active teams",
  "body": "Tigers and Cubs return in spring. Pistons return in October."
}
```

## Layout Requirements

Display: 800×480 landscape.

Default layout for MLB season:

```text
┌────────────────────────────────────────────────────────────┐
│ SPORTS DASHBOARD                         Updated 8:05 AM   │
├────────────────────────────────────────────────────────────┤
│ Tigers                         Cubs                         │
│ W 5–3 vs CLE                   L 4–2 vs STL                 │
│ Next: Tonight 6:40             Next: Today 1:20             │
│ 42–34 | AL Central: 2nd        39–37 | NL Central: 3rd      │
├──────────────────────────────┬─────────────────────────────┤
│ AL CENTRAL                   │ NL CENTRAL                  │
│ 1 CLE  44-31   -             │ 1 MIL  43-32   -            │
│ 2 DET  42-34   2.5           │ 2 STL  41-35   2.5          │
│ 3 KC   38-38   6.5           │ 3 CHC  39-37   4.5          │
│ 4 MIN  36-40   8.5           │ 4 CIN  36-40   7.5          │
│ 5 CWS  28-48   16.5          │ 5 PIT  31-45   12.5         │
└──────────────────────────────┴─────────────────────────────┘
```

General layout rules:

* 16 px outer margin
* 8–12 px section gap
* Header height around 44 px
* Team cards around 110–130 px high
* Standings area gets remaining height
* Avoid tiny type
* Prefer black text on light background
* Use color sparingly
* Do not rely on color alone for important meaning

Fonts:

* Use built-in display fonts first.
* If custom fonts are used, include only small bitmap fonts needed for headings/body.
* Target readable sizes:

  * Header: 24–32 px
  * Team names: 24–30 px
  * Body: 18–22 px
  * Standings rows: 16–20 px

Color rules for E Ink Spectra-style display:

* Favor black, white, red/orange/blue accents if supported.
* Avoid large solid dark fills because refresh artifacts and contrast may be worse.
* Use borders, spacing, and boldness more than color.
* Do not use gradients.
* Do not use shadows.
* Do not use transparency.
* Avoid dense images/logos for MVP.

## Refresh Logic

The backend should provide `refreshAfterSeconds`.

Suggested values:

```ts
function getRefreshAfterSeconds(context) {
  if (context.hasLiveGame) return 900;          // 15 min
  if (context.hasGameToday) return 1800;        // 30 min
  if (context.hasActiveSeason) return 7200;     // 2 hr
  return 21600;                                 // 6 hr
}
```

Firmware should:

1. Wake.
2. Connect to Wi-Fi.
3. Fetch dashboard JSON.
4. Render.
5. Sleep for `refreshAfterSeconds`.
6. If fetch fails, render cached dashboard if available.
7. If no cache, render simple error message.
8. Sleep 30–60 minutes after errors.

## Data Source Strategy

Use ESPN’s unofficial JSON endpoints for MVP because they cover MLB, NBA, college football, and men’s college basketball with a broadly consistent structure.

Important:

* ESPN does not provide this as a formal public API.
* Treat endpoints as unofficial and potentially unstable.
* Keep all endpoint logic isolated in adapters.
* Do not let ESPN response shapes leak into the dashboard contract.
* Build with fallbacks and mock data.

Potential endpoint patterns to investigate:

```text
https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard
https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard
https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard
https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard
```

Also investigate team and standings endpoints for each sport. Build discovery utilities if needed.

Backend adapters should expose normalized functions:

```ts
interface SportsAdapter {
  getTeamSummary(team: WatchedTeam): Promise<TeamSummary>;
  getStandings(group: string): Promise<StandingsTable>;
}
```

Normalized team summary:

```ts
type TeamSummary = {
  teamKey: string;
  label: string;
  sport: string;
  lastGame?: {
    date: string;
    opponent: string;
    homeAway: "home" | "away";
    result?: "W" | "L" | "T";
    score?: string;
  };
  nextGame?: {
    date: string;
    opponent: string;
    homeAway: "home" | "away";
    displayTime: string;
  };
  record?: string;
  standing?: string;
  isLive?: boolean;
  hasGameToday?: boolean;
};
```

Normalized standings:

```ts
type StandingsTable = {
  title: string;
  columns: string[];
  rows: {
    rank: string;
    teamKey?: string;
    abbreviation: string;
    record: string;
    gamesBack?: string;
    conferenceRecord?: string;
  }[];
};
```

## Backend Implementation Plan

### Phase 1: Mock backend

Create `/api/dashboard.json` returning static mock MLB data.

Acceptance criteria:

* Endpoint returns valid JSON.
* Contains Tigers card.
* Contains Cubs card.
* Contains AL Central standings.
* Contains NL Central standings.
* Contains `refreshAfterSeconds`.

### Phase 2: Real MLB data

Implement MLB adapter.

Requirements:

* Fetch Tigers latest/next game.
* Fetch Cubs latest/next game.
* Fetch AL Central standings.
* Fetch NL Central standings.
* Normalize data into dashboard sections.
* Cache upstream responses.

Acceptance criteria:

* Dashboard shows real MLB data.
* If one fetch fails, still render partial dashboard.
* If standings unavailable, show team cards only with a message.

### Phase 3: Firmware MVP

Implement firmware that:

* Connects to Wi-Fi.
* Fetches dashboard JSON.
* Parses JSON.
* Renders header, two team cards, and two standings tables.
* Sleeps based on `refreshAfterSeconds`.

Acceptance criteria:

* Device can render mock dashboard.
* Device can render real backend dashboard.
* Device does not crash on missing fields.
* Device sleeps after refresh.

### Phase 4: Add Pistons

Add NBA adapter.

Rules:

* Show Pistons only during active NBA season, playoffs, live/recent/upcoming game, or explicit debug mode.
* Show Eastern Conference top 10 plus Pistons if not top 10.
* Hide during offseason.

### Phase 5: Add MSU football

Add college football adapter.

Rules:

* Show MSU football during active season.
* Show latest game, next game, record.
* Show Big Ten top 8 plus MSU if not top 8.
* Hide during offseason.

### Phase 6: Add MSU basketball

Add men’s college basketball adapter.

Rules:

* Show MSU basketball during active season.
* Show latest game, next game, record.
* Show Big Ten top 8 plus MSU if not top 8.
* During March Madness, prioritize tournament status over conference standings.

## Backend Caching

Use simple in-memory cache for local dev and Cloudflare Cache API or KV later.

Cache policy:

```ts
const CACHE_TTLS = {
  liveGame: 60,
  gameDay: 300,
  activeSeason: 1800,
  offseason: 21600
};
```

Never hammer upstream APIs.

If using Cloudflare Worker:

* Cache normalized dashboard response.
* Include `Cache-Control`.
* Add `stale-if-error` behavior if possible.

## Error Handling

Backend error behavior:

* Return partial dashboard if possible.
* Include an optional message section if data is degraded.
* Never return a raw upstream error to the device.
* Always return valid JSON matching the dashboard contract.

Example degraded response:

```json
{
  "version": 1,
  "updatedAt": "2026-06-20T08:05:00-05:00",
  "refreshAfterSeconds": 3600,
  "sections": [
    {
      "type": "message",
      "id": "data-error",
      "title": "Sports data unavailable",
      "body": "Showing cached data if available."
    }
  ],
  "footer": "Data issue"
}
```

Firmware error behavior:

* If fetch succeeds, render fetched data and save latest good JSON if feasible.
* If fetch fails, render cached dashboard.
* If no cached dashboard, render:

  * “Unable to load scores”
  * Wi-Fi status
  * Last attempt time
* Then sleep.

## Firmware Requirements

Use PlatformIO with Arduino framework.

Core tasks:

```cpp
setup():
  init serial
  init display
  connect Wi-Fi
  fetch dashboard JSON
  parse JSON
  render dashboard
  sleep
```

No meaningful `loop()` needed.

Firmware files:

```text
firmware/src/main.cpp
firmware/src/wifi.cpp
firmware/src/fetch_dashboard.cpp
firmware/src/render_dashboard.cpp
firmware/src/sleep.cpp
firmware/src/dashboard_types.h
firmware/src/config.example.h
```

`config.example.h`:

```cpp
#pragma once

#define WIFI_SSID "your_wifi"
#define WIFI_PASSWORD "your_password"
#define DASHBOARD_URL "https://your-domain.com/api/dashboard.json"
#define DEFAULT_SLEEP_SECONDS 7200
```

Firmware must support:

* HTTPS GET
* JSON parsing
* Display rendering
* Deep sleep
* Missing fields
* Refresh interval from backend

Suggested libraries:

* WiFi
* HTTPClient or WiFiClientSecure
* ArduinoJson
* Seeed / ePaper display library from official examples

JSON memory:

* Keep payload small.
* Target under 16 KB.
* Use ArduinoJson carefully.
* Consider static allocation around 16–32 KB depending on real payload size.
* Avoid sending raw API data to device.

## Rendering Strategy

Implement one renderer per section type.

```cpp
void renderDashboard(JsonDocument& doc) {
  renderHeader(doc["footer"] | "Sports");

  JsonArray sections = doc["sections"].as<JsonArray>();

  for (JsonObject section : sections) {
    const char* type = section["type"];

    if (strcmp(type, "teamCard") == 0) {
      renderTeamCard(section);
    } else if (strcmp(type, "standings") == 0) {
      renderStandings(section);
    } else if (strcmp(type, "message") == 0) {
      renderMessage(section);
    }
  }

  refreshDisplay();
}
```

For MVP, create a fixed MLB layout first:

* Header
* Two team cards
* Two standings tables

Later, make layout dynamic.

Renderer should truncate long text safely:

```cpp
String fitText(String value, int maxChars) {
  if (value.length() <= maxChars) return value;
  return value.substring(0, maxChars - 1) + "…";
}
```

Do not attempt complex wrapping in MVP.

## Local Development

Backend commands should include:

```bash
cd backend
npm install
npm run dev
npm run test
```

Firmware commands:

```bash
cd firmware
pio run
pio run --target upload
pio device monitor
```

Mock endpoint:

```text
http://localhost:8787/api/dashboard.json?mock=mlb
```

Debug modes:

```text
/api/dashboard.json?debug=all
/api/dashboard.json?debug=mlb
/api/dashboard.json?debug=nba
/api/dashboard.json?debug=ncaaf
/api/dashboard.json?debug=ncaamb
```

Debug behavior:

* `debug=all` shows all teams even if inactive.
* Normal mode hides inactive teams.
* Debug mode helps test layout without waiting for seasons.

## Testing Requirements

Backend tests:

* `isInsideBroadSeasonWindow`
* `isTeamActive`
* MLB dashboard builder
* inactive sport hiding
* standings row filtering
* watched team forced into standings if outside top N
* partial data failure

Example tests:

```ts
describe("season logic", () => {
  it("shows MLB in June", () => {});
  it("hides Pistons in July without upcoming games", () => {});
  it("shows MSU football in September", () => {});
  it("shows MSU basketball in March", () => {});
});
```

Firmware testing:

* Parse mock MLB JSON.
* Parse missing fields.
* Parse empty sections.
* Render long team names without crashing.
* Sleep interval defaults if missing.

## Non-Goals

Do not build these in MVP:

* Touch interaction
* Animations
* Live play-by-play
* Player stats
* Betting odds
* Logos
* Full box scores
* Push notifications
* Account system
* Phone app
* Manual settings UI on device
* OAuth
* Complex bracket rendering

Possible later additions:

* Weather footer
* Calendar footer
* “Game today” alert badge
* Team logos as tiny monochrome bitmaps
* SD card config
* Web settings page
* Home Assistant integration
* TRMNL plugin version

## Definition of Done for MVP

The project is MVP-complete when:

1. Backend returns a valid `/api/dashboard.json`.
2. Backend shows Tigers and Cubs during MLB season.
3. Backend returns AL Central and NL Central standings.
4. Backend hides Pistons, MSU football, and MSU basketball when inactive.
5. Firmware fetches the endpoint.
6. Firmware renders an 800×480 readable ePaper dashboard.
7. Firmware sleeps after rendering.
8. Failed fetches do not crash the device.
9. Long text is truncated gracefully.
10. The display is useful from several feet away.

## Immediate First Task for Claude Code

Start by creating the repository structure and implementing the backend mock.

Tasks:

1. Create `/backend` TypeScript project.
2. Create `types.ts` with dashboard contract types.
3. Create `config.ts` with watched teams.
4. Create `activeSeasons.ts`.
5. Create `dashboardBuilder.ts`.
6. Create `mock/dashboard.mlb.json`.
7. Create endpoint `/api/dashboard.json`.
8. Add tests for season hiding.
9. Add README instructions.

Do not start firmware until the backend mock contract is stable.
