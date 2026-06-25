import type {
  Sport,
  WatchedTeam,
  TeamSummary,
  NormalizedGame,
  LiveSituation,
  StandingsRow,
  StandingsTable,
  SportsAdapter,
} from "../types.js";
import { TtlCache, CACHE_TTLS } from "../cache.js";
import { WATCHED_TEAMS, DEFAULT_TIMEZONE } from "../config.js";
import { formatStandingLine } from "../formatters/records.js";

/**
 * Shared ESPN adapter core. ESPN's site API is unofficial and its response
 * shapes must never leak past this module — everything here returns the
 * project's normalized types. Pure normalizers are exported for testing;
 * the network layer is a thin wrapper around them.
 */

/** ESPN sport path segments, e.g. "baseball/mlb". */
export const ESPN_SPORT_PATH: Record<Sport, string> = {
  mlb: "baseball/mlb",
  nba: "basketball/nba",
  nfl: "football/nfl",
  ncaaf: "football/college-football",
  ncaamb: "basketball/mens-college-basketball",
};

const SITE_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const CORE_BASE = "https://site.api.espn.com/apis/v2/sports";

export function scheduleUrl(sport: Sport, teamSlug: string): string {
  return `${SITE_BASE}/${ESPN_SPORT_PATH[sport]}/teams/${teamSlug}/schedule`;
}

export function scoreboardUrl(sport: Sport): string {
  return `${SITE_BASE}/${ESPN_SPORT_PATH[sport]}/scoreboard`;
}

export function summaryUrl(sport: Sport, eventId: string): string {
  return `${SITE_BASE}/${ESPN_SPORT_PATH[sport]}/summary?event=${eventId}`;
}

/**
 * level=3 yields the deepest groups (MLB/college divisions & conferences);
 * NBA needs level=2 to get Eastern/Western Conference instead of divisions.
 */
export function standingsUrl(sport: Sport, level = 3): string {
  return `${CORE_BASE}/${ESPN_SPORT_PATH[sport]}/standings?level=${level}`;
}

// ---------------------------------------------------------------------------
// Schedule normalization
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

function statValue(stats: Any[], name: string): string | undefined {
  const stat = stats?.find((s) => s.name === name);
  if (!stat) return undefined;
  return String(stat.displayValue ?? stat.value ?? "");
}

function scoreOf(competitor: Any): string | undefined {
  const s = competitor?.score;
  if (s == null) return undefined;
  if (typeof s === "object") return String(s.displayValue ?? s.value ?? "");
  return String(s);
}

const DEFAULT_TZ = "UTC";

/** Calendar date (en-CA gives YYYY-MM-DD) for a moment in a given timezone. */
function ymdInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(date);
}

function sameDayInTz(a: Date, b: Date, timeZone: string): boolean {
  return ymdInTz(a, timeZone) === ymdInTz(b, timeZone);
}

/** Whole-day difference between two YYYY-MM-DD strings. */
function dayDiffFromStrings(fromYmd: string, toYmd: string): number {
  const from = Date.parse(`${fromYmd}T00:00:00Z`);
  const to = Date.parse(`${toYmd}T00:00:00Z`);
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

/** Human display time for an upcoming game, localized to `timeZone`. */
export function formatDisplayTime(
  date: Date,
  now: Date,
  timeZone: string = DEFAULT_TZ,
): string {
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);

  const dayDiff = dayDiffFromStrings(ymdInTz(now, timeZone), ymdInTz(date, timeZone));

  if (dayDiff <= 0) return time; // today: just the time
  if (dayDiff === 1) return `Tmw ${time}`;
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(date);
  return `${weekday} ${time}`;
}

export interface ScheduleResult {
  lastGame?: NormalizedGame;
  nextGame?: NormalizedGame;
  isLive: boolean;
  hasGameToday: boolean;
  hasPlayoffContext: boolean;
  live?: LiveSituation;
  /** ESPN event id of the in-progress game, for fetching its summary. */
  liveEventId?: string;
}

/** Extract a live situation from an ESPN competition. Bases/outs come from
 * competition.situation when present (the scoreboard endpoint has it; the team
 * schedule endpoint usually only has the inning detail). */
function liveFromCompetition(comp: Any, teamAbbr: string): LiveSituation | undefined {
  if (!comp) return undefined;
  const competitors: Any[] = comp.competitors ?? [];
  const us = competitors.find((c) => c.team?.abbreviation === teamAbbr);
  const them = competitors.find((c) => c.team?.abbreviation !== teamAbbr);
  if (!us || !them) return undefined;

  const sit = comp.situation ?? {};
  const live: LiveSituation = {};
  const usScore = scoreOf(us);
  const themScore = scoreOf(them);
  if (usScore != null && themScore != null) live.score = `${usScore}-${themScore}`;
  if (them.team?.abbreviation) live.opponent = them.team.abbreviation;
  live.homeAway = us.homeAway === "home" ? "home" : "away";
  const detail = comp.status?.type?.shortDetail;
  if (detail) live.detail = String(detail);
  if (typeof sit.onFirst === "boolean") live.onFirst = sit.onFirst;
  if (typeof sit.onSecond === "boolean") live.onSecond = sit.onSecond;
  if (typeof sit.onThird === "boolean") live.onThird = sit.onThird;
  if (typeof sit.outs === "number") live.outs = sit.outs;
  return live;
}

function liveFrom(event: Any, teamAbbr: string): LiveSituation | undefined {
  return liveFromCompetition(event?.competitions?.[0], teamAbbr);
}

/** Find the team's in-progress game in a scoreboard payload (which carries the
 * full live score + situation) and extract it. */
export function liveFromScoreboard(raw: Any, teamAbbr: string): LiveSituation | undefined {
  for (const ev of raw?.events ?? []) {
    const comp = ev.competitions?.[0];
    if (comp?.status?.type?.state !== "in") continue;
    if (!(comp.competitors ?? []).some((c: Any) => c.team?.abbreviation === teamAbbr)) continue;
    return liveFromCompetition(comp, teamAbbr);
  }
  return undefined;
}

/** Concise featured-player lines for the watched team, e.g. "Okamoto 3-4, 3
 * RBI". Built from the scoreboard competitor's per-category leaders (already
 * fetched for live games), trimmed to the first couple of stat clauses and
 * de-duplicated by athlete so the live card stays glanceable. */
export function topPlayersFromCompetition(comp: Any, teamAbbr: string, max = 4): string[] {
  const competitors: Any[] = comp?.competitors ?? [];
  const us = competitors.find((c) => c.team?.abbreviation === teamAbbr);
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const cat of us?.leaders ?? []) {
    const leader = cat?.leaders?.[0];
    const name = leader?.athlete?.shortName;
    const display = leader?.displayValue;
    if (!name || !display) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    // "3-4, 3 RBI, R, 2 BB" -> "3-4, 3 RBI" so several players fit one row.
    const brief = String(display).split(", ").slice(0, 2).join(", ");
    lines.push(`${name} ${brief}`);
    if (lines.length >= max) break;
  }
  return lines;
}

export interface LiveDetails {
  live?: LiveSituation;
  eventId?: string;
  topPlayers?: string[];
}

/** Find the team's in-progress game in a scoreboard payload and extract the
 * full live situation, the event id (for a summary fetch), and top players. */
export function liveDetailsFromScoreboard(raw: Any, teamAbbr: string): LiveDetails {
  for (const ev of raw?.events ?? []) {
    const comp = ev.competitions?.[0];
    if (comp?.status?.type?.state !== "in") continue;
    if (!(comp.competitors ?? []).some((c: Any) => c.team?.abbreviation === teamAbbr)) continue;
    const details: LiveDetails = {};
    const live = liveFromCompetition(comp, teamAbbr);
    if (live) details.live = live;
    if (ev.id != null) details.eventId = String(ev.id);
    const players = topPlayersFromCompetition(comp, teamAbbr);
    if (players.length) details.topPlayers = players;
    return details;
  }
  return {};
}

/** Watched team's live win probability (0-100) from a game summary payload.
 * winprobability is a per-play series; the last entry is the current state. */
export function winProbabilityFromSummary(raw: Any, teamAbbr: string): number | undefined {
  const series: Any[] = raw?.winprobability ?? [];
  const last = series[series.length - 1];
  if (!last || typeof last.homeWinPercentage !== "number") return undefined;
  const competitors: Any[] = raw?.header?.competitions?.[0]?.competitors ?? [];
  const us = competitors.find((c) => c.team?.abbreviation === teamAbbr);
  if (!us) return undefined;
  const homePct = last.homeWinPercentage;
  const pct = us.homeAway === "home" ? homePct : 1 - homePct;
  return Math.round(Math.max(0, Math.min(1, pct)) * 100);
}

function gameFrom(
  event: Any,
  teamAbbr: string,
  now: Date,
  timeZone: string,
): NormalizedGame | undefined {
  const comp = event?.competitions?.[0];
  if (!comp) return undefined;
  const competitors: Any[] = comp.competitors ?? [];
  const us = competitors.find((c) => c.team?.abbreviation === teamAbbr);
  const them = competitors.find((c) => c.team?.abbreviation !== teamAbbr);
  if (!us || !them) return undefined;

  const state = comp.status?.type?.state as string | undefined;
  const game: NormalizedGame = {
    date: event.date,
    opponent: them.team?.abbreviation ?? "?",
    homeAway: us.homeAway === "home" ? "home" : "away",
  };

  if (state === "post") {
    const usScore = scoreOf(us);
    const themScore = scoreOf(them);
    if (usScore != null && themScore != null) game.score = `${usScore}-${themScore}`;
    if (us.winner === true) game.result = "W";
    else if (them.winner === true) game.result = "L";
    else game.result = "T";
  } else {
    game.displayTime = formatDisplayTime(new Date(event.date), now, timeZone);
  }

  return game;
}

function isPlayoffEvent(event: Any): boolean {
  const seasonType = event?.seasonType;
  // ESPN seasonType id 3 = postseason across sports.
  return seasonType?.id === "3" || seasonType?.id === 3;
}

/** Reduce an ESPN team schedule into last/next game and live/today flags. */
export function normalizeScheduleToGames(
  raw: Any,
  teamAbbr: string,
  now: Date,
  timeZone: string = DEFAULT_TZ,
): ScheduleResult {
  const events: Any[] = (raw?.events ?? []).filter((e: Any) => e?.date);
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let lastEvent: Any | undefined;
  let nextEvent: Any | undefined;
  let liveEvent: Any | undefined;
  let hasGameToday = false;
  let hasPlayoffContext = false;

  for (const ev of events) {
    const type = ev.competitions?.[0]?.status?.type;
    const state = type?.state as string | undefined;
    // Postponed/suspended games report state "post" but completed === false,
    // with a 0-0 score and no winner. They must not count as the last game.
    const completed = type?.completed === true;
    const date = new Date(ev.date);
    if (sameDayInTz(date, now, timeZone)) hasGameToday = true;

    if (state === "in") {
      liveEvent = ev;
      if (isPlayoffEvent(ev)) hasPlayoffContext = true;
    } else if (state === "post" && completed) {
      if (date.getTime() <= now.getTime()) lastEvent = ev; // latest wins (sorted asc)
    } else if (state === "pre") {
      // scheduled (postponed games are state "post" + not completed, ignored)
      if (!nextEvent && date.getTime() >= startOfDayMs(now)) {
        nextEvent = ev;
        if (isPlayoffEvent(ev)) hasPlayoffContext = true;
      }
    }
  }

  const result: ScheduleResult = {
    isLive: Boolean(liveEvent),
    hasGameToday,
    hasPlayoffContext,
  };
  // A live game is both the current and "last" thing happening.
  const last = lastEvent && gameFrom(lastEvent, teamAbbr, now, timeZone);
  const nextSource = liveEvent ?? nextEvent;
  const next = nextSource && gameFrom(nextSource, teamAbbr, now, timeZone);
  if (last) result.lastGame = last;
  if (next) result.nextGame = next;
  if (liveEvent) {
    const live = liveFrom(liveEvent, teamAbbr);
    if (live) result.live = live;
    if (liveEvent.id != null) result.liveEventId = String(liveEvent.id);
  }
  return result;
}

function startOfDayMs(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

// ---------------------------------------------------------------------------
// Standings normalization
// ---------------------------------------------------------------------------

/** Numeric win percentage for sorting; 0 when unavailable. */
function winPct(entry: Any): number {
  const raw =
    statValue(entry.stats ?? [], "winPercent") ??
    statValue(entry.stats ?? [], "leagueWinPercent");
  if (raw == null) return 0;
  return Number.parseFloat(raw) || 0;
}

/** Depth-first search for a leaf group (one carrying standings entries). */
export function findLeafGroupByName(root: Any, name: string): Any | undefined {
  if (!root) return undefined;
  if (root.name === name && root.standings?.entries) return root;
  for (const child of root.children ?? []) {
    const found = findLeafGroupByName(child, name);
    if (found) return found;
  }
  return undefined;
}

export interface NormalizeStandingsOptions {
  /** ESPN's full group name, e.g. "American League Central". */
  espnGroupName: string;
  /** Display title, e.g. "AL Central". */
  title: string;
  /** Map of ESPN abbreviation -> watched team key for highlighting. */
  abbrToKey?: Record<string, string>;
  columns?: string[];
}

export function normalizeStandings(
  raw: Any,
  options: NormalizeStandingsOptions,
): StandingsTable {
  const group = findLeafGroupByName(raw, options.espnGroupName);
  if (!group) {
    throw new Error(`Standings group not found: ${options.espnGroupName}`);
  }

  // ESPN pre-sorts division entries but NOT conference entries, so sort by
  // win percentage (descending) ourselves. Stable when the stat is absent.
  const entries: Any[] = [...(group.standings?.entries ?? [])];
  entries.sort((a, b) => winPct(b) - winPct(a));

  const rows: StandingsRow[] = entries.map((entry, index) => {
    const stats = entry.stats ?? [];
    const abbr = entry.team?.abbreviation ?? "?";
    const overall = statValue(stats, "overall");
    const record =
      overall ?? `${statValue(stats, "wins") ?? "0"}-${statValue(stats, "losses") ?? "0"}`;
    const row: StandingsRow = {
      rank: String(index + 1),
      abbreviation: abbr,
      record,
      gamesBack: statValue(stats, "gamesBehind") ?? "-",
    };
    const l10 = statValue(stats, "Last Ten Games");
    if (l10) row.lastTen = l10;
    const key = options.abbrToKey?.[abbr];
    if (key) row.teamKey = key;
    return row;
  });

  return {
    title: options.title,
    columns: options.columns ?? ["#", "Team", "Record", "GB"],
    rows,
  };
}

// ---------------------------------------------------------------------------
// Network layer + adapter factory
// ---------------------------------------------------------------------------

/** Fetch JSON from ESPN with a timeout and a browser-ish User-Agent. */
export async function fetchEspnJson(url: string, timeoutMs = 8000): Promise<Any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "InkScores/0.1 (+epaper dashboard)" },
    });
    if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
    return (await res.json()) as Any;
  } finally {
    clearTimeout(timer);
  }
}

export interface EspnAdapterDeps {
  fetchJson?: (url: string) => Promise<Any>;
  cache?: TtlCache;
  now?: () => Date;
  /** TTL (ms) for cached upstream responses. */
  ttlMs?: number;
  /** IANA timezone used to localize game display times. */
  timeZone?: string;
}

export interface EspnAdapter extends SportsAdapter {
  /** The cached raw ESPN standings tree (used for sport-specific extras). */
  getStandingsRaw(): Promise<Any>;
}

export interface EspnAdapterConfig {
  sport: Sport;
  /** Standings level: 3 for divisions/conferences, 2 for NBA conferences. */
  standingsLevel?: number;
  /** Map dashboard group label -> ESPN's full group name. */
  groupNameMap: Record<string, string>;
  /** Column headers for this sport's standings table. */
  standingsColumns?: string[];
  deps?: EspnAdapterDeps;
}

/**
 * Build a {@link SportsAdapter} backed by ESPN's site API. All upstream calls
 * go through a shared TTL cache, and standings failures degrade gracefully
 * (the team summary still carries game data). Dependencies are injectable so
 * the adapter can be tested without the network.
 */
export function createEspnAdapter(config: EspnAdapterConfig): EspnAdapter {
  const fetchJson = config.deps?.fetchJson ?? fetchEspnJson;
  const cache = config.deps?.cache ?? new TtlCache();
  const now = config.deps?.now ?? (() => new Date());
  const ttlMs = config.deps?.ttlMs ?? CACHE_TTLS.activeSeason;
  const timeZone = config.deps?.timeZone ?? DEFAULT_TIMEZONE;
  const level = config.standingsLevel ?? 3;

  function abbrOf(team: WatchedTeam): string {
    return team.espnTeamSlug.toUpperCase();
  }

  function groupLabelOf(team: WatchedTeam): string | undefined {
    return team.division ?? team.standingsGroup;
  }

  async function loadStandingsRaw(): Promise<Any> {
    return cache.getOrLoad(`standings:${config.sport}:${level}`, ttlMs, () =>
      fetchJson(standingsUrl(config.sport, level)),
    );
  }

  /** Map of ESPN abbreviation -> watched key for this sport (for highlights). */
  function abbrToKey(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const t of WATCHED_TEAMS) {
      if (t.sport === config.sport) map[abbrOf(t)] = t.key;
    }
    return map;
  }

  async function getTeamSummary(team: WatchedTeam): Promise<TeamSummary> {
    const abbr = abbrOf(team);
    const schedule = await cache.getOrLoad(
      `schedule:${config.sport}:${team.espnTeamSlug}`,
      ttlMs,
      () => fetchJson(scheduleUrl(config.sport, team.espnTeamSlug)),
    );
    const games = normalizeScheduleToGames(schedule, abbr, now(), timeZone);

    const summary: TeamSummary = {
      teamKey: team.key,
      label: team.label,
      sport: team.sport,
      isLive: games.isLive,
      hasGameToday: games.hasGameToday,
      hasPlayoffContext: games.hasPlayoffContext,
    };
    if (games.lastGame) summary.lastGame = games.lastGame;
    if (games.nextGame) summary.nextGame = games.nextGame;
    // Live game: the schedule only has the inning, so pull the full score +
    // situation from the scoreboard (short-cached, only fetched while live).
    if (games.isLive) {
      let live = games.live;
      let eventId = games.liveEventId;
      let topPlayers: string[] | undefined;
      try {
        const sb = await cache.getOrLoad(
          `scoreboard:${config.sport}`,
          CACHE_TTLS.liveGame,
          () => fetchJson(scoreboardUrl(config.sport)),
        );
        const details = liveDetailsFromScoreboard(sb, abbr);
        if (details.live) live = details.live;
        if (details.eventId) eventId = details.eventId;
        if (details.topPlayers) topPlayers = details.topPlayers;
      } catch {
        // fall back to the schedule-derived live (inning only)
      }
      // Win probability lives only in the per-game summary (short-cached).
      if (eventId) {
        try {
          const sum = await cache.getOrLoad(
            `summary:${config.sport}:${eventId}`,
            CACHE_TTLS.liveGame,
            () => fetchJson(summaryUrl(config.sport, eventId!)),
          );
          const wp = winProbabilityFromSummary(sum, abbr);
          if (wp != null && live) live.winProbability = wp;
        } catch {
          // win prob is best-effort; the live card renders without it
        }
      }
      if (live) {
        if (topPlayers && !live.topPlayers) live.topPlayers = topPlayers;
        summary.live = live;
      }
    }

    // Standings are best-effort; failures must not drop the game data.
    const groupLabel = groupLabelOf(team);
    const espnGroupName = groupLabel ? config.groupNameMap[groupLabel] : undefined;
    if (groupLabel && espnGroupName) {
      try {
        const raw = await loadStandingsRaw();
        const table = normalizeStandings(raw, {
          espnGroupName,
          title: groupLabel,
          abbrToKey: { [abbr]: team.key },
          ...(config.standingsColumns ? { columns: config.standingsColumns } : {}),
        });
        const row = table.rows.find((r) => r.teamKey === team.key);
        if (row) {
          summary.record = row.record;
          summary.standing = formatStandingLine(
            groupLabel,
            Number(row.rank),
            row.gamesBack,
          );
        }
      } catch {
        // degraded: leave record/standing undefined
      }
    }

    return summary;
  }

  async function getStandings(group: string): Promise<StandingsTable> {
    const espnGroupName = config.groupNameMap[group] ?? group;
    const raw = await loadStandingsRaw();
    return normalizeStandings(raw, {
      espnGroupName,
      title: group,
      abbrToKey: abbrToKey(),
      ...(config.standingsColumns ? { columns: config.standingsColumns } : {}),
    });
  }

  return { getTeamSummary, getStandings, getStandingsRaw: loadStandingsRaw };
}
