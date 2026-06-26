import { TtlCache, CACHE_TTLS } from "../cache.js";
import { shortenPlayerName } from "../llm/editorial.js";
import type { Accent, StandingsSection } from "../types.js";

/**
 * Official MLB Stats API adapter, used only for the playoff/wild-card tables.
 * Unlike ESPN's site API (division standings, schedules) and unlike FanGraphs
 * (modeled playoff %, which is Cloudflare-walled and unfetchable server-side),
 * statsapi.mlb.com is public, unauthenticated, and returns deterministic
 * postseason math: wild-card games-back, magic numbers, and elimination
 * numbers. Everything surfaced here is official and real — there is no model.
 *
 * Response shapes stay isolated in this module; callers receive the project's
 * contract types only. The pure normalizers are exported for testing.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const STATS_BASE = "https://statsapi.mlb.com/api/v1";

/** AL = 103, NL = 104 in the Stats API. */
const AL_LEAGUE_ID = 103;
const NL_LEAGUE_ID = 104;

export function standingsUrl(season: number): string {
  return `${STATS_BASE}/standings?leagueId=${AL_LEAGUE_ID},${NL_LEAGUE_ID}&season=${season}&standingsTypes=regularSeason`;
}

export function teamsUrl(season: number): string {
  return `${STATS_BASE}/teams?sportId=1&season=${season}`;
}

/** YYYY-MM-DD in UTC for the schedule date range. */
function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function scheduleUrl(start: Date, end: Date): string {
  return `${STATS_BASE}/schedule?sportId=1&startDate=${ymd(start)}&endDate=${ymd(end)}`;
}

export function dateRangeStatsUrl(
  group: "hitting" | "pitching",
  teamId: number,
  start: Date,
  end: Date,
  season: number,
): string {
  return (
    `${STATS_BASE}/stats?stats=byDateRange&group=${group}` +
    `&startDate=${ymd(start)}&endDate=${ymd(end)}&sportId=1&teamId=${teamId}&season=${season}`
  );
}

/**
 * Canonical team abbreviation, reconciling ESPN's codes with the Stats API's so
 * recent-form (Stats API) can be joined onto the division tables (ESPN). Most
 * teams match; only a few differ.
 */
export function canonicalAbbr(abbr: string): string {
  const a = String(abbr || "").toUpperCase();
  switch (a) {
    case "CHW":
    case "CWS":
      return "CWS";
    case "OAK":
    case "ATH":
      return "ATH";
    case "ARI":
    case "AZ":
      return "AZ";
    case "WSH":
    case "WSN":
      return "WSH";
    // Baseball-Reference's longer codes -> the common short forms.
    case "KC":
    case "KCR":
      return "KC";
    case "SD":
    case "SDP":
      return "SD";
    case "SF":
    case "SFG":
      return "SF";
    case "TB":
    case "TBR":
      return "TB";
    default:
      return a;
  }
}

export interface StatsTeam {
  abbr: string;
  /** "AL" | "NL". */
  league: "AL" | "NL";
  wins: number;
  losses: number;
  /** Sort key (win pct); ties broken by wins. */
  pct: number;
  divisionLeader: boolean;
  /** 1-based wild-card rank among non-leaders, when provided. */
  wildCardRank?: number;
  /** Wild-card games back, e.g. "+7.0" (in a spot), "-", or "5.0" (behind). */
  wildCardGamesBack: string;
  /** Magic number to clinch (division leaders), e.g. "12", or "-". */
  magicNumber: string;
  /** Tragic/elimination number from the wild-card race, e.g. "78", or "-". */
  wildCardEliminationNumber: string;
  clinched: boolean;
}

/** Map MLB team id -> abbreviation from the teams endpoint. */
export function parseTeamAbbrMap(raw: Any): Record<number, string> {
  const map: Record<number, string> = {};
  for (const t of raw?.teams ?? []) {
    if (t?.sport?.id === 1 && t?.id != null && t?.abbreviation) {
      map[t.id] = String(t.abbreviation);
    }
  }
  return map;
}

function num(value: Any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Normalize the Stats API standings into a flat list of teams per league. */
export function parseStatsStandings(
  raw: Any,
  abbrById: Record<number, string>,
): StatsTeam[] {
  const out: StatsTeam[] = [];
  for (const rec of raw?.records ?? []) {
    const leagueId = rec?.league?.id;
    const league: "AL" | "NL" | undefined =
      leagueId === AL_LEAGUE_ID ? "AL" : leagueId === NL_LEAGUE_ID ? "NL" : undefined;
    if (!league) continue;
    for (const t of rec?.teamRecords ?? []) {
      const abbr = abbrById[t?.team?.id] ?? "?";
      const wins = num(t.wins);
      const losses = num(t.losses);
      const games = wins + losses;
      out.push({
        abbr,
        league,
        wins,
        losses,
        pct: games > 0 ? wins / games : 0,
        divisionLeader: t.divisionLeader === true,
        ...(t.wildCardRank != null ? { wildCardRank: Number(t.wildCardRank) } : {}),
        wildCardGamesBack: String(t.wildCardGamesBack ?? "-"),
        magicNumber: String(t.magicNumber ?? "-"),
        wildCardEliminationNumber: String(t.wildCardEliminationNumber ?? "-"),
        clinched: t.clinched === true,
      });
    }
  }
  return out;
}

/** Format a make-playoffs % for the narrow odds column (kept local to avoid a
 * circular import with the B-Ref adapter). */
function formatOddsPct(pct: number | undefined): string | undefined {
  if (pct == null || !Number.isFinite(pct)) return undefined;
  if (pct < 1) return "<1%";
  if (pct > 99) return ">99%";
  return `${Math.round(pct)}%`;
}

/** The single "tracker" value shown in the Mag column: magic number when the
 * team can still clinch (good), an "e"-prefixed elimination number otherwise. */
function trackerValue(t: StatsTeam): string {
  if (t.clinched) return "CL";
  if (t.magicNumber && t.magicNumber !== "-") return t.magicNumber;
  if (t.wildCardEliminationNumber && t.wildCardEliminationNumber !== "-") {
    return `e${t.wildCardEliminationNumber}`;
  }
  return "-";
}

export interface PlayoffTableOptions {
  id: string;
  /** Watched-team abbreviation to always show + highlight, e.g. "DET". */
  watchedAbbr?: string;
  accent?: Accent;
  /** Wild-card spots (cutoff line). MLB is 3. */
  spots?: number;
  /** Real make-playoffs % per canonical abbr; replaces the magic/elim column. */
  oddsByAbbr?: Record<string, number>;
}

/**
 * One league's playoff picture as a single table: division leaders (seeds 1-3,
 * by record) up top with a solid divider, then the wild-card race (seeds 4+)
 * with a dashed cutoff after the final wild-card spot. Columns carry the real
 * wild-card games-back and magic/elimination tracker from the Stats API.
 */
export function buildPlayoffTable(
  teams: StatsTeam[],
  league: "AL" | "NL",
  options: PlayoffTableOptions,
): StandingsSection {
  const spots = options.spots ?? 3;
  const inLeague = teams.filter((t) => t.league === league);

  const leaders = inLeague
    .filter((t) => t.divisionLeader)
    .sort((a, b) => b.pct - a.pct || b.wins - a.wins);

  const contenders = inLeague
    .filter((t) => !t.divisionLeader)
    .sort((a, b) => {
      // Prefer the API's wild-card rank; fall back to record.
      if (a.wildCardRank != null && b.wildCardRank != null) {
        return a.wildCardRank - b.wildCardRank;
      }
      return b.pct - a.pct || b.wins - a.wins;
    });

  const wcHolders = contenders.slice(0, spots); // wild-card spot holders, seeds 4-6

  // Last column: real make-playoffs odds when available, else the magic/elim
  // tracker. Per-row fallback keeps the table real even if one team's odds miss.
  const odds = options.oddsByAbbr;
  const lastCol = (t: StatsTeam): string => {
    if (odds) {
      const formatted = formatOddsPct(odds[canonicalAbbr(t.abbr)]);
      if (formatted) return formatted;
    }
    return trackerValue(t);
  };
  const lastHeader = odds ? "Odds" : "Mag";

  const rows: string[][] = [];
  const highlightRows: number[] = [];
  const pushRow = (seed: number, t: StatsTeam, wcgb: string) => {
    rows.push([String(seed), t.abbr, `${t.wins}-${t.losses}`, wcgb, lastCol(t)]);
    if (options.watchedAbbr && t.abbr === options.watchedAbbr) {
      highlightRows.push(rows.length - 1);
    }
  };

  leaders.forEach((t, i) => pushRow(i + 1, t, "-")); // division winners, seeds 1-3
  const dividerAfter = leaders.length;
  wcHolders.forEach((t, i) => pushRow(leaders.length + i + 1, t, t.wildCardGamesBack));
  const cutoffAfter = leaders.length + spots; // 6

  // Exactly 7 rows: the 3 division leaders + 3 wild-card holders, then a 7th —
  // the watched team if it sits outside the top 6, otherwise the first team one
  // spot outside the wild-card cutoff.
  const watchedIdx = options.watchedAbbr
    ? contenders.findIndex((t) => t.abbr === options.watchedAbbr)
    : -1;
  const watchedOutsideTop6 = watchedIdx >= spots; // its seed is 7 or worse
  const seventh = watchedOutsideTop6 ? contenders[watchedIdx] : contenders[spots];
  const seventhSeed = leaders.length + (watchedOutsideTop6 ? watchedIdx : spots) + 1;
  if (seventh) pushRow(seventhSeed, seventh, seventh.wildCardGamesBack);

  return {
    type: "standings",
    id: options.id,
    title: `${league} Playoff`,
    columns: ["#", "Team", "Record", "WCGB", lastHeader],
    rows,
    dividerAfter,
    cutoffAfter,
    ...(highlightRows.length ? { highlightRows } : {}),
    ...(options.accent ? { accent: options.accent } : {}),
  };
}

/**
 * Build each team's last-N win/loss sequence (oldest game first, to match the
 * renderer's left-to-right form dots) from a schedule payload. Keyed by
 * canonical abbreviation so it joins onto the ESPN division tables. Only
 * completed, decided games count.
 */
export function parseRecentForm(
  raw: Any,
  abbrById: Record<number, string>,
  maxGames = 5,
): Record<string, string> {
  interface Result {
    date: string;
    win: boolean;
  }
  const byTeam = new Map<number, Result[]>();
  const push = (id: number, date: string, win: boolean) => {
    if (id == null) return;
    const list = byTeam.get(id) ?? [];
    list.push({ date, win });
    byTeam.set(id, list);
  };

  for (const bucket of raw?.dates ?? []) {
    for (const g of bucket?.games ?? []) {
      if (g?.status?.abstractGameState !== "Final") continue;
      if (g?.isTie === true) continue;
      const home = g?.teams?.home;
      const away = g?.teams?.away;
      const homeWon = home?.isWinner === true;
      const awayWon = away?.isWinner === true;
      if (!homeWon && !awayWon) continue; // undecided / no winner flag
      const date = String(g.gameDate ?? g.officialDate ?? "");
      if (home?.team?.id != null) push(home.team.id, date, homeWon);
      if (away?.team?.id != null) push(away.team.id, date, awayWon);
    }
  }

  const out: Record<string, string> = {};
  for (const [id, results] of byTeam) {
    const abbr = abbrById[id];
    if (!abbr) continue;
    results.sort((a, b) => a.date.localeCompare(b.date));
    const seq = results
      .slice(-maxGames)
      .map((r) => (r.win ? "W" : "L"))
      .join("");
    if (seq) out[canonicalAbbr(abbr)] = seq;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Network layer
// ---------------------------------------------------------------------------

// --- Recent hot/cold form -------------------------------------------------
// Hitters (OPS) and pitchers (ERA) are scored on a shared "standard deviations
// from a typical player at their position" scale, so they can be ranked in one
// pool: positive = hot, negative = cold. The league baselines are approximate
// and only used for relative ranking, so exact values don't matter much.
const HITTER_OPS_MEAN = 0.715;
const HITTER_OPS_STD = 0.13;
const PITCHER_ERA_MEAN = 4.0;
const PITCHER_ERA_STD = 1.5;
const MIN_HITTER_AB = 12; // enough recent at-bats to count as a regular
const MIN_PITCHER_IP = 12; // ~2+ starts over the wider pitcher window, not one
const HITTER_WINDOW_DAYS = 10; // ~last 10 games
const PITCHER_WINDOW_DAYS = 28; // ~5 starts, so one outing doesn't swing it
const FORM_THRESHOLD = 0.2; // distance from average before we call it hot/cold
const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);

export interface PlayerForm {
  name: string;
  isPitcher: boolean;
  score: number;
}

/** "16.1" innings -> 16.333 (the .1/.2 are thirds of an inning). */
function inningsToNumber(ip: Any): number {
  const [whole, frac] = String(ip ?? "0").split(".");
  return Number(whole || 0) + (frac ? Number(frac) / 3 : 0);
}

export function parseHitterForms(raw: Any): PlayerForm[] {
  const out: PlayerForm[] = [];
  for (const sp of raw?.stats?.[0]?.splits ?? []) {
    if (num(sp?.stat?.atBats) < MIN_HITTER_AB) continue;
    out.push({
      name: String(sp?.player?.fullName ?? ""),
      isPitcher: false,
      score: (num(sp?.stat?.ops) - HITTER_OPS_MEAN) / HITTER_OPS_STD,
    });
  }
  return out;
}

export function parsePitcherForms(raw: Any): PlayerForm[] {
  const out: PlayerForm[] = [];
  for (const sp of raw?.stats?.[0]?.splits ?? []) {
    if (inningsToNumber(sp?.stat?.inningsPitched) < MIN_PITCHER_IP) continue;
    out.push({
      name: String(sp?.player?.fullName ?? ""),
      isPitcher: true,
      // Lower ERA is hotter, so invert the deviation.
      score: (PITCHER_ERA_MEAN - num(sp?.stat?.era)) / PITCHER_ERA_STD,
    });
  }
  return out;
}

/** Top 3 most-above-average for hot, bottom 3 most-below for cold. */
export function rankPlayerForms(forms: PlayerForm[]): {
  hot: PlayerForm[];
  cold: PlayerForm[];
} {
  const hot = forms
    .filter((f) => f.score >= FORM_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const cold = forms
    .filter((f) => f.score <= -FORM_THRESHOLD)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);
  return { hot, cold };
}

/** Render a player as a compact chip: short last name only. */
export function formChip(form: PlayerForm): string {
  const parts = form.name.trim().split(/\s+/);
  let last = parts[parts.length - 1] ?? form.name;
  if (parts.length > 1 && NAME_SUFFIXES.has(last.toLowerCase())) {
    last = parts[parts.length - 2] ?? last;
  }
  return shortenPlayerName(last);
}

export async function fetchStatsJson(url: string, timeoutMs = 8000): Promise<Any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "InkScores/0.1 (+epaper dashboard)" },
    });
    if (!res.ok) throw new Error(`MLB StatsAPI ${res.status} for ${url}`);
    return (await res.json()) as Any;
  } finally {
    clearTimeout(timer);
  }
}

export interface MlbStatsDeps {
  fetchJson?: (url: string) => Promise<Any>;
  cache?: TtlCache;
  now?: () => Date;
  ttlMs?: number;
}

export interface PlayoffTablesInput {
  /** Watched-team abbreviations per league, e.g. { AL: "DET", NL: "CHC" }. */
  watched?: Partial<Record<"AL" | "NL", string>>;
  accent?: Accent;
  /** Real make-playoffs % per canonical abbr (B-Ref) for the odds column. */
  oddsByAbbr?: Record<string, number>;
}

export interface MlbStatsAdapter {
  /** AL + NL playoff tables (division leaders + wild-card race). */
  getPlayoffTables(input?: PlayoffTablesInput): Promise<StandingsSection[]>;
  /** Each team's last-5 W/L sequence, keyed by canonical abbreviation. */
  getRecentForm(maxGames?: number): Promise<Record<string, string>>;
  /**
   * Hottest/coldest players (hitters + pitchers) over the recent window,
   * computed from real stats. `cacheKey` scopes the result — pass the team's
   * last-game id so it only recomputes once per game. Best-effort: empty on
   * failure or an unknown abbreviation.
   */
  getHotCold(
    abbr: string,
    cacheKey: string,
  ): Promise<{ hot: string[]; cold: string[] }>;
}

/**
 * Build the MLB Stats API adapter. Standings refresh on the active-season TTL
 * (odds-style data moves slowly); the team id->abbr map is effectively static
 * for a season and cached for the offseason TTL. Both calls go through the
 * shared cache with stale-if-error, so a flaky upstream never drops the tables.
 */
export function createMlbStatsAdapter(deps?: MlbStatsDeps): MlbStatsAdapter {
  const fetchJson = deps?.fetchJson ?? fetchStatsJson;
  const cache = deps?.cache ?? new TtlCache();
  const now = deps?.now ?? (() => new Date());
  const ttlMs = deps?.ttlMs ?? CACHE_TTLS.activeSeason;

  function season(): number {
    return now().getUTCFullYear();
  }

  async function loadStandings(): Promise<Any> {
    const yr = season();
    return cache.getOrLoad(`mlbstats:standings:${yr}`, ttlMs, () =>
      fetchJson(standingsUrl(yr)),
    );
  }

  async function loadAbbrMap(): Promise<Record<number, string>> {
    const yr = season();
    return cache.getOrLoad(`mlbstats:teams:${yr}`, CACHE_TTLS.offseason, async () =>
      parseTeamAbbrMap(await fetchJson(teamsUrl(yr))),
    );
  }

  async function getPlayoffTables(
    input: PlayoffTablesInput = {},
  ): Promise<StandingsSection[]> {
    const [raw, abbrById] = await Promise.all([loadStandings(), loadAbbrMap()]);
    const teams = parseStatsStandings(raw, abbrById);
    const accent = input.accent;
    const odds = input.oddsByAbbr;
    return [
      buildPlayoffTable(teams, "AL", {
        id: "al-playoff",
        ...(input.watched?.AL ? { watchedAbbr: input.watched.AL } : {}),
        ...(accent ? { accent } : {}),
        ...(odds ? { oddsByAbbr: odds } : {}),
      }),
      buildPlayoffTable(teams, "NL", {
        id: "nl-playoff",
        ...(input.watched?.NL ? { watchedAbbr: input.watched.NL } : {}),
        ...(accent ? { accent } : {}),
        ...(odds ? { oddsByAbbr: odds } : {}),
      }),
    ];
  }

  async function getRecentForm(maxGames = 10): Promise<Record<string, string>> {
    const end = now();
    // ~25 days back comfortably covers 10 completed games per team (with off
    // days / the All-Star break).
    const start = new Date(end.getTime() - 25 * 24 * 60 * 60 * 1000);
    const [raw, abbrById] = await Promise.all([
      cache.getOrLoad(
        `mlbstats:schedule:${ymd(start)}:${ymd(end)}`,
        ttlMs,
        () => fetchJson(scheduleUrl(start, end)),
      ),
      loadAbbrMap(),
    ]);
    return parseRecentForm(raw, abbrById, maxGames);
  }

  async function getHotCold(
    abbr: string,
    cacheKey: string,
  ): Promise<{ hot: string[]; cold: string[] }> {
    const wantAbbr = canonicalAbbr(abbr);
    return cache.getOrLoad(
      `mlbstats:hotcold:${wantAbbr}:${cacheKey}`,
      ttlMs,
      async () => {
        const abbrById = await loadAbbrMap();
        const entry = Object.entries(abbrById).find(
          ([, ab]) => canonicalAbbr(ab) === wantAbbr,
        );
        if (!entry) return { hot: [], cold: [] };
        const teamId = Number(entry[0]);
        const end = now();
        const day = 24 * 60 * 60 * 1000;
        // Hitters: ~last 10 games. Pitchers get a wider window because starters
        // go every ~5 days — a short window is just one or two outings.
        const hitStart = new Date(end.getTime() - HITTER_WINDOW_DAYS * day);
        const pitStart = new Date(end.getTime() - PITCHER_WINDOW_DAYS * day);
        const yr = season();
        const [hitRaw, pitRaw] = await Promise.all([
          fetchJson(dateRangeStatsUrl("hitting", teamId, hitStart, end, yr)).catch(() => null),
          fetchJson(dateRangeStatsUrl("pitching", teamId, pitStart, end, yr)).catch(() => null),
        ]);
        const forms = [...parseHitterForms(hitRaw), ...parsePitcherForms(pitRaw)];
        const { hot, cold } = rankPlayerForms(forms);
        return { hot: hot.map(formChip), cold: cold.map(formChip) };
      },
    );
  }

  return { getPlayoffTables, getRecentForm, getHotCold };
}
