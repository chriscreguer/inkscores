import { formatLastGame } from "./formatters/games.js";
import { canonicalAbbr } from "./adapters/mlbStats.js";
import type {
  Dashboard,
  DashboardSection,
  StandingsSection,
  TeamCardSection,
  NormalizedGame,
  TeamSummary,
  WatchedTeam,
} from "./types.js";
import type { Editorial } from "./llm/editorial.js";

/**
 * The "Featured" presentation: the two-column team-comparison layout where each
 * watched team's card sits above its division and playoff tables, and the card
 * itself becomes a rich scorebug (or live) box with an LLM recap and hot/cold
 * players. This module is pure — it transforms an already-built plain dashboard
 * plus the extra real data (playoff tables, editorial) into the featured shape.
 * All upstream fetching happens in the service; this just assembles.
 */

/** Team abbreviation used for logos and scorebugs (e.g. "DET", "CHC"). */
function abbrOf(team: WatchedTeam): string {
  return team.espnTeamSlug.toUpperCase();
}

/**
 * Last-game line ordered the way the renderer's scorebug parser expects: the
 * winner's score first. The normalized score is always "us-them", so a loss
 * must be flipped to "them-us" or the scorebug would show the wrong winner.
 */
export function scorebugLastLine(game: NormalizedGame): string {
  const m = String(game.score ?? "").match(/^(\d+)-(\d+)$/);
  if (!m) return formatLastGame(game) ?? "—";
  const us = m[1]!;
  const them = m[2]!;
  const venue = game.homeAway === "home" ? "vs" : "@";
  if (game.result === "L") return `L ${them}-${us} ${venue} ${game.opponent}`;
  if (game.result === "T") return `T ${us}-${them} ${venue} ${game.opponent}`;
  return `W ${us}-${them} ${venue} ${game.opponent}`;
}

export interface FeaturedTeamInput {
  /** The plain team card produced by the standard builder. */
  card: TeamCardSection;
  team: WatchedTeam;
  summary?: TeamSummary;
  editorial?: Editorial;
}

/** Enrich a plain team card into a scorebug (or keep it live) with editorial. */
export function buildFeaturedCard(input: FeaturedTeamInput): TeamCardSection {
  const { card, team, summary, editorial } = input;
  const out: TeamCardSection = { ...card, teamAbbr: abbrOf(team) };

  // A live game keeps the live treatment (the renderer prioritises it); the
  // plain builder already attached the live situation.
  if (summary?.isLive && summary.live) {
    out.status = "live";
    return out;
  }

  const game = summary?.lastGame;
  if (game && game.score) {
    out.cardVariant = "scorebug";
    out.scorebugOpponent = game.opponent;
    out.last = scorebugLastLine(game);
    out.lastGame = { date: game.date };
  } else {
    // No completed game yet: a plain summary card still carries the editorial.
    out.cardVariant = "standard";
  }

  if (editorial?.summary) out.summary = editorial.summary;
  if (editorial?.hot && editorial.hot.length) out.hot = editorial.hot;
  if (editorial?.cold && editorial.cold.length) out.cold = editorial.cold;

  return out;
}

export interface AssembleFeaturedInput {
  /** The plain dashboard (cards + division standings + footer/meta). */
  base: Dashboard;
  /** Active MLB teams in render order, with their summary + editorial. */
  teams: FeaturedTeamInput[];
  /** AL/NL playoff tables (ids al-playoff / nl-playoff). */
  playoffTables: StandingsSection[];
  /** Last-5 W/L sequence per canonical abbreviation, for the form-dots column. */
  formByAbbr?: Record<string, string>;
}

/**
 * Swap a division table's last-10 record column for real last-5 W/L sequences
 * (rendered as form dots). The team abbreviation is canonicalised so the ESPN
 * rows join the Stats API form data. Rows without form keep their existing
 * value, so the table degrades gracefully.
 */
export function withFormColumn(
  section: StandingsSection,
  formByAbbr: Record<string, string>,
): StandingsSection {
  const colIdx = section.columns.findIndex((c) => /^(l5|l10|form)$/i.test(c));
  if (colIdx < 0) return section;
  const columns = [...section.columns];
  columns[colIdx] = "L5";
  const rows = section.rows.map((row) => {
    const form = formByAbbr[canonicalAbbr(row[1] ?? "")];
    if (!form) return row;
    const next = [...row];
    next[colIdx] = form;
    return next;
  });
  return { ...section, columns, rows };
}

/**
 * Produce the featured dashboard from a plain one. Cards are replaced with
 * their scorebug/live variants; the division tables are kept; the playoff
 * tables are appended. The team-comparison theme makes the renderer stack each
 * league's tables under the matching team card.
 */
export function assembleFeatured(input: AssembleFeaturedInput): Dashboard {
  const { base, teams, playoffTables } = input;

  const cards = teams.map(buildFeaturedCard);
  const form = input.formByAbbr;
  const divisionStandings = base.sections
    .filter((s): s is StandingsSection => s.type === "standings")
    .map((s) => (form ? withFormColumn(s, form) : s));

  const sections: DashboardSection[] = [
    ...cards,
    ...divisionStandings,
    ...playoffTables,
  ];

  return {
    ...base,
    theme: {
      mode: base.theme?.mode ?? "epaper-color",
      density: base.theme?.density ?? "compact",
      layout: "team-comparison",
      cardHeight: 132,
    },
    sections,
  };
}

/** True when the plain dashboard is an MLB-only view eligible for Featured. */
export function isFeaturedEligible(dashboard: Dashboard): boolean {
  const standings = dashboard.sections.filter((s) => s.type === "standings");
  const cards = dashboard.sections.filter((s) => s.type === "teamCard");
  return (
    cards.length > 0 &&
    standings.length > 0 &&
    standings.every((s) => s.id === "al-central" || s.id === "nl-central")
  );
}
