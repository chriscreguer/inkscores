# Dashboard API Contract

The device fetches exactly one endpoint:

```
GET /api/dashboard.json
```

The response is a single JSON object. The firmware tolerates missing optional
fields — only the required fields below are guaranteed.

## Top-level

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `version` | ✅ | number | Contract version (currently `1`). |
| `updatedAt` | ✅ | string | ISO 8601 timestamp of generation. |
| `refreshAfterSeconds` | ✅ | number | How long the device should sleep. 60–86400. |
| `sections` | ✅ | array | Ordered list of sections (see below). |
| `timezone` | | string | IANA tz used for display times, e.g. `America/Chicago`. |
| `theme` | | object | `{ mode, density }`. Advisory only. |
| `footer` | | string | Short status line, e.g. `Updated 8:05 AM`. |

## Section types

The firmware renders three section types and ignores any it doesn't recognise.

### `teamCard`

```ts
{
  type: "teamCard";
  id: string;
  title: string;        // large, e.g. "Tigers"
  subtitle?: string;    // e.g. "Detroit Tigers"
  badge?: string;       // 1-3 char monogram (device fallback), e.g. "D"
  logoUrl?: string;     // full-colour team logo for image-capable clients
  status: "active" | "live" | "idle";
  last?: string;        // "W 5-3 vs CLE"
  next?: string;        // "Today 6:40 vs MIN"
  record?: string;      // "42-34"
  standing?: string;    // "AL Central: 2nd, 2.5 GB"
  accent?: "blue" | "red" | "green" | "orange" | "gray";
}
```

Missing string fields are rendered as `—` rather than crashing. A `live` status
shows a `LIVE` badge.

### `standings`

```ts
{
  type: "standings";
  id: string;
  title: string;            // "AL Central"
  columns: string[];        // ["#", "Team", "Record", "GB"]
  rows: string[][];         // ranked rows aligned to columns
  highlightTeamKeys?: string[];  // watched teams (informational)
  highlightRows?: number[];      // indices into rows for watched teams
  accent?: "blue" | "red" | "green" | "orange" | "gray";  // highlight colour
}
```

Row counts are already trimmed by the backend (e.g. NBA top 10 + Pistons), so
the firmware just renders what it receives. The device gives rows in
`highlightRows` a yellow highlighter fill with the team name in the section
`accent` colour, so the highlight survives a monochrome render — never colour
alone.

### `message`

```ts
{
  type: "message";
  id: string;       // "offseason", "data-error", ...
  title: string;
  body: string;
}
```

Used for the offseason screen and for degraded/error states.

## Guarantees

- The endpoint **always** returns a valid document matching this contract, even
  when every upstream call fails (it returns a single `message` section).
- Raw upstream errors are never forwarded to the device.
- `Cache-Control` is set from `refreshAfterSeconds` with `stale-if-error`.

## Example

See [`backend/src/mock/dashboard.mlb.json`](../backend/src/mock/dashboard.mlb.json)
for a complete MLB example and `dashboard.mixed.json` for a multi-sport one.
