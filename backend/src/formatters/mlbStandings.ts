import type { Accent, LeaderItem, StandingsSection } from "../types.js";

/**
 * Compute MLB-specific extras (division leaders, wild-card races) from the full
 * ESPN standings tree we already fetch. ESPN response shapes stay isolated
 * here — everything returned is the project's contract.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export interface ParsedTeam {
  abbr: string;
  wins: number;
  losses: number;
  pct: number;
}

export interface ParsedDivision {
  /** ESPN name, e.g. "American League Central". */
  name: string;
  /** Short label, e.g. "AL C". */
  short: string;
  /** "AL" | "NL". */
  league: string;
  /** Teams sorted by win percentage, descending. */
  teams: ParsedTeam[];
}

function stat(stats: Any[], name: string): string | undefined {
  const s = stats?.find((x) => x.name === name);
  return s ? String(s.displayValue ?? s.value ?? "") : undefined;
}

/** "American League Central" -> "AL C". */
export function shortDivision(name: string): string {
  const league = name.startsWith("National") ? "NL" : "AL";
  const part = /East$/.test(name) ? "E" : /West$/.test(name) ? "W" : "C";
  return `${league} ${part}`;
}

function divisionOrder(short: string): number {
  const league = short.startsWith("AL") ? 0 : 1;
  const part = short.endsWith("E") ? 0 : short.endsWith("C") ? 1 : 2;
  return league * 10 + part;
}

function collectLeaves(node: Any, acc: Any[]): Any[] {
  if (node?.standings?.entries?.length) acc.push(node);
  for (const child of node?.children ?? []) collectLeaves(child, acc);
  return acc;
}

export function parseMlbStandings(raw: Any): ParsedDivision[] {
  const leaves = collectLeaves(raw, []);
  const divisions: ParsedDivision[] = leaves.map((leaf) => {
    const teams: ParsedTeam[] = (leaf.standings.entries ?? []).map((e: Any) => {
      const stats = e.stats ?? [];
      const overall = stat(stats, "overall");
      let wins = Number(stat(stats, "wins") ?? 0);
      let losses = Number(stat(stats, "losses") ?? 0);
      if (overall && overall.includes("-")) {
        const parts = overall.split("-");
        const w = Number(parts[0]);
        const l = Number(parts[1]);
        if (Number.isFinite(w)) wins = w;
        if (Number.isFinite(l)) losses = l;
      }
      const pctRaw = stat(stats, "winPercent");
      const pct = pctRaw != null ? Number.parseFloat(pctRaw) || 0 : 0;
      return { abbr: e.team?.abbreviation ?? "?", wins, losses, pct };
    });
    teams.sort((a, b) => b.pct - a.pct || b.wins - a.wins);
    return {
      name: leaf.name,
      short: shortDivision(leaf.name),
      league: leaf.name.startsWith("National") ? "NL" : "AL",
      teams,
    };
  });
  divisions.sort((a, b) => divisionOrder(a.short) - divisionOrder(b.short));
  return divisions;
}

export function divisionLeaders(divisions: ParsedDivision[]): LeaderItem[] {
  return divisions
    .filter((d) => d.teams.length > 0)
    .map((d) => ({ group: d.short, team: d.teams[0]!.abbr }));
}

/** Whole/half games one team is behind another (negative = ahead). */
function gamesBehind(team: ParsedTeam, ref: ParsedTeam): number {
  return ((ref.wins - team.wins) + (team.losses - ref.losses)) / 2;
}

function formatGb(gb: number): string {
  if (Math.abs(gb) < 0.001) return "-";
  const mag = Math.abs(gb).toFixed(1);
  return gb < 0 ? `+${mag}` : mag;
}

export interface PlayoffOptions {
  id: string;
  abbrToKey?: Record<string, string>;
  accent?: Accent;
  /** Number of wild-card spots (cutoff line). MLB is 3. */
  spots?: number;
  /** How many wild-card contenders to list (a couple beyond the cutoff). */
  wildCardShown?: number;
}

/**
 * The full league playoff picture as one table: the division leaders at the top
 * (seeds 1-3, by record), a solid divider, then the wild-card race (seeds 4+)
 * with games-back to the last wild-card spot and a dashed cutoff line.
 */
export function playoffSection(
  divisions: ParsedDivision[],
  league: "AL" | "NL",
  options: PlayoffOptions,
): StandingsSection {
  const spots = options.spots ?? 3;
  const wcShown = options.wildCardShown ?? 4;
  const leagueDivs = divisions.filter((d) => d.league === league);

  const leaders = leagueDivs
    .map((d) => d.teams[0])
    .filter((t): t is ParsedTeam => Boolean(t))
    .sort((a, b) => b.pct - a.pct || b.wins - a.wins);

  const allContenders = leagueDivs
    .flatMap((d) => d.teams.slice(1))
    .sort((a, b) => b.pct - a.pct || b.wins - a.wins);
  const shown = allContenders.slice(0, wcShown);
  const cutoff = shown[spots - 1];

  const rows: string[][] = [];
  const highlightRows: number[] = [];
  const pushRow = (seed: number, t: ParsedTeam, gb: string) => {
    rows.push([String(seed), t.abbr, `${t.wins}-${t.losses}`, gb]);
    if (options.abbrToKey?.[t.abbr]) highlightRows.push(rows.length - 1);
  };

  leaders.forEach((t, i) => pushRow(i + 1, t, "-")); // division winners, seeds 1-3
  const dividerAfter = leaders.length;
  shown.forEach((t, i) =>
    pushRow(leaders.length + i + 1, t, formatGb(cutoff ? gamesBehind(t, cutoff) : 0)),
  );

  // Always show the watched team, even if it falls outside the shown rows —
  // append it with its real seed (leaving a visible rank gap).
  const watched = Object.keys(options.abbrToKey ?? {})[0];
  if (watched && !rows.some((r) => r[1] === watched)) {
    const idx = allContenders.findIndex((t) => t.abbr === watched);
    if (idx >= 0) {
      const t = allContenders[idx]!;
      pushRow(leaders.length + idx + 1, t, formatGb(cutoff ? gamesBehind(t, cutoff) : 0));
    }
  }

  return {
    type: "standings",
    id: options.id,
    title: `${league} Playoff`,
    columns: ["#", "Team", "Record", "GB"],
    rows,
    dividerAfter,
    cutoffAfter: dividerAfter + spots,
    ...(highlightRows.length ? { highlightRows } : {}),
    ...(options.accent ? { accent: options.accent } : {}),
  };
}
