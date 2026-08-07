import { TtlCache, CACHE_TTLS } from "../cache.js";
import { fetchBrefText } from "./brefOdds.js";
import type { Accent, StandingsSection } from "../types.js";

/**
 * Baseball-Reference team season stat tables (batting + pitching), used for the
 * Tigers hitting/starters/pen stats panel. Same site as brefOdds.ts (fetchable,
 * no Cloudflare wall) and the same "strip HTML comments first" defensive parse,
 * even though these two tables happen to render uncommented today — B-Ref moves
 * tables in and out of comments across page sections without warning.
 *
 * FanGraphs' wRC+ isn't available here (see mlbStats.ts for why FanGraphs is
 * off the table entirely); OPS+ is B-Ref's own adjusted-offense stat and is
 * what ships in the hitting table instead.
 */

const BREF_TEAMS_BASE = "https://www.baseball-reference.com/teams";

export function brefTeamStatsUrl(abbr: string, season: number): string {
  return `${BREF_TEAMS_BASE}/${abbr}/${season}.shtml`;
}

export interface RawHitterLine {
  name: string;
  war: number;
  pa: number;
  ops: number;
  opsPlus: number;
  avg: number;
}

export interface RawPitcherLine {
  name: string;
  war: number;
  g: number;
  gs: number;
  ip: number;
  era: number;
  eraPlus: number;
  fip: number;
}

function stripComments(html: string): string {
  return html.replace(/<!--/g, "").replace(/-->/g, "");
}

function extractTable(html: string, id: string): string | undefined {
  const merged = stripComments(html);
  const m = merged.match(new RegExp(`<table[^>]*id="${id}"[\\s\\S]*?</table>`));
  return m?.[0];
}

function tableRows(table: string): string[] {
  return table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
}

/** Only rostered-player rows carry data-append-csv; header and "Team Totals"
 * rows don't, so this is the cheapest reliable player/non-player filter. */
function isPlayerRow(row: string): boolean {
  return row.includes("data-append-csv=");
}

function cell(row: string, stat: string): string | undefined {
  const m = row.match(new RegExp(`data-stat="${stat}"[^>]*>([\\s\\S]*?)<\\/t[hd]>`));
  if (!m) return undefined;
  return m[1]!.replace(/<[^>]+>/g, "").trim();
}

function playerName(row: string): string | undefined {
  const m = row.match(/<a href="\/players\/[a-z]\/[a-z0-9]+\.shtml">([^<]+)<\/a>/);
  return m?.[1]?.trim();
}

function num(v: string | undefined): number {
  const n = Number.parseFloat(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** "16.1" innings-pitched notation (thirds of an inning) -> 16.333. */
function ipToNumber(v: string | undefined): number {
  const [whole, frac] = String(v ?? "0").split(".");
  return Number(whole || 0) + (frac ? Number(frac) / 3 : 0);
}

export function parseHitters(html: string): RawHitterLine[] {
  const table = extractTable(html, "players_standard_batting");
  if (!table) return [];
  const out: RawHitterLine[] = [];
  for (const row of tableRows(table)) {
    if (!isPlayerRow(row)) continue;
    const name = playerName(row);
    if (!name) continue;
    out.push({
      name,
      war: num(cell(row, "b_war")),
      pa: num(cell(row, "b_pa")),
      ops: num(cell(row, "b_onbase_plus_slugging")),
      opsPlus: num(cell(row, "b_onbase_plus_slugging_plus")),
      avg: num(cell(row, "b_batting_avg")),
    });
  }
  return out;
}

export function parsePitchers(html: string): RawPitcherLine[] {
  const table = extractTable(html, "players_standard_pitching");
  if (!table) return [];
  const out: RawPitcherLine[] = [];
  for (const row of tableRows(table)) {
    if (!isPlayerRow(row)) continue;
    const name = playerName(row);
    if (!name) continue;
    out.push({
      name,
      war: num(cell(row, "p_war")),
      g: num(cell(row, "p_g")),
      gs: num(cell(row, "p_gs")),
      ip: ipToNumber(cell(row, "p_ip")),
      era: num(cell(row, "p_earned_run_avg")),
      eraPlus: num(cell(row, "p_earned_run_avg_plus")),
      fip: num(cell(row, "p_fip")),
    });
  }
  return out;
}

/** Majority-of-appearances-as-a-starter, so a swingman with 3 starts in 40
 * outings still reads as a reliever. */
function isStarter(p: RawPitcherLine): boolean {
  return p.g > 0 && p.gs / p.g >= 0.5;
}

/** Top-N by playing time, then re-sorted by WAR for display. */
export function selectTopHitters(hitters: RawHitterLine[], n = 9): RawHitterLine[] {
  return [...hitters]
    .sort((a, b) => b.pa - a.pa)
    .slice(0, n)
    .sort((a, b) => b.war - a.war);
}

export function selectStarters(pitchers: RawPitcherLine[], n = 5): RawPitcherLine[] {
  return pitchers
    .filter(isStarter)
    .sort((a, b) => b.ip - a.ip)
    .slice(0, n)
    .sort((a, b) => b.war - a.war);
}

export function selectRelievers(pitchers: RawPitcherLine[], n = 5): RawPitcherLine[] {
  return pitchers
    .filter((p) => !isStarter(p))
    .sort((a, b) => b.ip - a.ip)
    .slice(0, n)
    .sort((a, b) => b.war - a.war);
}

function fmtWar(n: number): string {
  return n.toFixed(1);
}

/** ".868" / ".275" style: three decimals, no leading zero. */
function fmtRate3(n: number): string {
  const s = n.toFixed(3);
  return s.startsWith("0") ? s.slice(1) : s;
}

function fmtIndex(n: number): string {
  return String(Math.round(n));
}

function fmtEra(n: number): string {
  return n.toFixed(2);
}

export function buildHittingTable(hitters: RawHitterLine[], accent?: Accent): StandingsSection {
  const rows = selectTopHitters(hitters).map((h) => [
    h.name,
    fmtWar(h.war),
    fmtRate3(h.ops),
    fmtIndex(h.opsPlus),
    fmtRate3(h.avg),
  ]);
  return {
    type: "standings",
    id: "tigers-stats-hitting",
    title: "Hitting",
    columns: ["Name", "WAR", "OPS", "OPS+", "AVG"],
    rows,
    cardIndex: 1,
    ...(accent ? { accent } : {}),
  };
}

function buildPitchingTable(
  id: string,
  title: string,
  pitchers: RawPitcherLine[],
  accent: Accent | undefined,
): StandingsSection {
  const rows = pitchers.map((p) => [
    p.name,
    fmtWar(p.war),
    fmtEra(p.era),
    fmtIndex(p.eraPlus),
    fmtEra(p.fip),
  ]);
  return {
    type: "standings",
    id,
    title,
    columns: ["Name", "WAR", "ERA", "ERA+", "FIP"],
    rows,
    cardIndex: 1,
    ...(accent ? { accent } : {}),
  };
}

export function buildStartersTable(pitchers: RawPitcherLine[], accent?: Accent): StandingsSection {
  return buildPitchingTable("tigers-stats-starters", "Starters", selectStarters(pitchers), accent);
}

export function buildPenTable(pitchers: RawPitcherLine[], accent?: Accent): StandingsSection {
  return buildPitchingTable("tigers-stats-pen", "Pen", selectRelievers(pitchers), accent);
}

// ---------------------------------------------------------------------------
// Network layer
// ---------------------------------------------------------------------------

export interface BrefTeamStatsDeps {
  fetchText?: (url: string) => Promise<string>;
  cache?: TtlCache;
  now?: () => Date;
  ttlMs?: number;
}

export interface BrefTeamStatsAdapter {
  /** Hitting, starters, pen tables (in that order) for a team's current season,
   * from Baseball-Reference's team page. */
  getTeamStatsTables(abbr: string, accent?: Accent): Promise<[StandingsSection, StandingsSection, StandingsSection]>;
}

/** Build the B-Ref team-stats adapter. Stats move slowly enough in-season that
 * the active-season TTL (shared with brefOdds) is fine, with stale-if-error. */
export function createBrefTeamStatsAdapter(deps?: BrefTeamStatsDeps): BrefTeamStatsAdapter {
  const fetchText = deps?.fetchText ?? fetchBrefText;
  const cache = deps?.cache ?? new TtlCache();
  const now = deps?.now ?? (() => new Date());
  const ttlMs = deps?.ttlMs ?? CACHE_TTLS.activeSeason;

  async function getTeamStatsTables(
    abbr: string,
    accent?: Accent,
  ): Promise<[StandingsSection, StandingsSection, StandingsSection]> {
    const year = now().getUTCFullYear();
    const html = await cache.getOrLoad(`bref:teamstats:${abbr}:${year}`, ttlMs, () =>
      fetchText(brefTeamStatsUrl(abbr, year)),
    );
    const hitters = parseHitters(html);
    const pitchers = parsePitchers(html);
    return [
      buildHittingTable(hitters, accent),
      buildStartersTable(pitchers, accent),
      buildPenTable(pitchers, accent),
    ];
  }

  return { getTeamStatsTables };
}
