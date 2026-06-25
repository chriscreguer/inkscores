import type {
  StandingsRow,
  StandingsTable,
  StandingsSection,
  Accent,
} from "../types.js";

const MISSING = "—";

/**
 * Limit a standings table to the top N rows, but always keep any watched team
 * whose key is in `alwaysIncludeKeys`. A watched team outside the top N is
 * appended after it (preserving original rank order), never duplicated.
 *
 * When `topN` is undefined the table is returned unchanged (used for MLB
 * divisions, which always show all five teams).
 */
export function limitStandingsRows(
  rows: StandingsRow[],
  topN: number | undefined,
  alwaysIncludeKeys: string[],
): StandingsRow[] {
  if (topN === undefined || rows.length <= topN) return rows;

  const top = rows.slice(0, topN);
  const includedKeys = new Set(
    top.map((r) => r.teamKey).filter((k): k is string => Boolean(k)),
  );

  const extras = rows
    .slice(topN)
    .filter((r) => r.teamKey && alwaysIncludeKeys.includes(r.teamKey) && !includedKeys.has(r.teamKey));

  return [...top, ...extras];
}

function fieldFor(row: StandingsRow, column: string): string {
  switch (column.trim().toLowerCase()) {
    case "#":
    case "rank":
      return row.rank || MISSING;
    case "team":
      return row.abbreviation || MISSING;
    case "record":
    case "rec":
      return row.record || MISSING;
    case "gb":
      return row.gamesBack ?? MISSING;
    case "l10":
    case "last10":
      return row.lastTen ?? MISSING;
    case "conf":
    case "conference":
      return row.conferenceRecord ?? MISSING;
    default:
      return MISSING;
  }
}

export interface StandingsSectionOptions {
  id: string;
  /** Limit to this many rows (forced watched teams still appended). */
  topN?: number;
  /** Watched team keys to keep even when outside the top N. */
  alwaysIncludeKeys?: string[];
  /** Watched team keys the firmware should visually highlight. */
  highlightTeamKeys?: string[];
  /** Accent colour for the highlighted row(s). */
  accent?: Accent;
}

/** Convert a normalized standings table into a contract StandingsSection. */
export function toStandingsSection(
  table: StandingsTable,
  options: StandingsSectionOptions,
): StandingsSection {
  const limited = limitStandingsRows(
    table.rows,
    options.topN,
    options.alwaysIncludeKeys ?? [],
  );

  const highlightKeys = new Set(options.highlightTeamKeys ?? []);
  const highlightRows = limited
    .map((row, i) => (row.teamKey && highlightKeys.has(row.teamKey) ? i : -1))
    .filter((i) => i >= 0);

  return {
    type: "standings",
    id: options.id,
    title: table.title,
    columns: table.columns,
    rows: limited.map((row) => table.columns.map((col) => fieldFor(row, col))),
    ...(options.highlightTeamKeys
      ? { highlightTeamKeys: options.highlightTeamKeys }
      : {}),
    ...(highlightRows.length ? { highlightRows } : {}),
    ...(options.accent ? { accent: options.accent } : {}),
  };
}
