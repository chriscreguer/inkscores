# Data Sources

The backend uses ESPN's **unofficial** site API. It is not a formal public API:
treat endpoints as potentially unstable. All ESPN-specific shapes are isolated
in `backend/src/adapters/` and never leak into the dashboard contract.

## Endpoints in use

Sport path segments: `baseball/mlb`, `basketball/nba`,
`football/college-football`, `basketball/mens-college-basketball`.

### Team schedule (last / next game, live, today)

```
https://site.api.espn.com/apis/site/v2/sports/{sport}/teams/{slug}/schedule
```

Each `events[]` entry has `competitions[0]` with a `status.type.state`
(`pre` | `in` | `post`) and two `competitors` (home/away) carrying
`team.abbreviation`, `score`, and `winner`. The adapter picks the latest `post`
event as the last game and the earliest upcoming event as the next game.

### Standings

```
https://site.api.espn.com/apis/v2/sports/{sport}/standings?level={n}
```

- **`level=3`** returns the deepest groups: MLB divisions
  (`American League Central`, …) and college conferences
  (`Big Ten Conference`).
- **`level=2`** is required for NBA to get `Eastern Conference` /
  `Western Conference` rather than divisions.

Standings entries expose an `overall` record string (e.g. `42-34`), a
`winPercent`, and `gamesBehind`. MLB division entries arrive pre-sorted;
conference entries do **not**, so the adapter re-sorts by win percentage.

### Group-name mapping

The dashboard uses short labels; ESPN uses long names. The mapping lives in each
sport adapter (`adapters/mlb.ts`, `nba.ts`, `ncaaf.ts`, `ncaamb.ts`):

| Dashboard label | ESPN group name | level |
|-----------------|-----------------|-------|
| AL Central | American League Central | 3 |
| NL Central | National League Central | 3 |
| Eastern Conference | Eastern Conference | 2 |
| Big Ten | Big Ten Conference | 3 |

## Season windows

A note on the NBA window: the broad window ends in **May**, not June, even
though the Finals run into June. Only two teams play in June and they surface via
the playoff-context / recent-game signals, so excluding June from the generic
window is what makes "show MLB only in June" hold for the Pistons. See
`backend/src/config.ts`.

## Caching

`TtlCache` (`backend/src/cache.ts`) wraps every upstream call:

| Context | TTL |
|---------|-----|
| live game | 60 s |
| game day | 5 min |
| active season | 30 min |
| offseason | 6 hr |

On a loader error the cache serves the last good value (`stale-if-error`).

## Regenerating reference fixtures

The large captured payloads under `backend/fixtures/` (gitignored) can be
refreshed with:

```bash
curl -s "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/det/schedule" -o backend/fixtures/mlb-tigers-schedule.json
curl -s "https://site.api.espn.com/apis/v2/sports/baseball/mlb/standings?level=3"        -o backend/fixtures/mlb-standings.json
```

The small `*.sample.json` fixtures used by the unit tests are hand-written and
committed — they mirror the ESPN shape but stay tiny and deterministic.
