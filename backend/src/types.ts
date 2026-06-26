/**
 * Dashboard API contract types.
 *
 * These types define the shape of `/api/dashboard.json` consumed by the
 * reTerminal E1002 firmware. The firmware must tolerate missing optional
 * fields, so keep required fields minimal and stable.
 */

export type Sport = "mlb" | "nba" | "nfl" | "ncaaf" | "ncaamb";

export type Accent = "blue" | "red" | "green" | "orange" | "gray";

export type TeamStatus = "active" | "live" | "idle";

// ---------------------------------------------------------------------------
// Watched team configuration
// ---------------------------------------------------------------------------

export interface WatchedTeam {
  key: string;
  label: string;
  fullName: string;
  sport: Sport;
  league: string;
  /** ESPN team abbreviation / slug, e.g. "det", "chc", "msu". */
  espnTeamSlug: string;
  /** MLB division name, e.g. "AL Central". */
  division?: string;
  /** Conference / standings grouping for non-MLB sports. */
  standingsGroup?: string;
  priority: number;
  accent?: Accent;
  /** Short monogram (1-3 chars) fallback for the logo badge, e.g. "D", "MSU". */
  badge?: string;
  /** Full-colour team logo URL (ESPN CDN). Used by image-capable clients. */
  logoUrl?: string;
}

// ---------------------------------------------------------------------------
// Normalized data returned by adapters (internal, never sent to device)
// ---------------------------------------------------------------------------

export type GameResult = "W" | "L" | "T";
export type HomeAway = "home" | "away";

export interface NormalizedGame {
  /** ISO 8601 datetime string. */
  date: string;
  opponent: string;
  homeAway: HomeAway;
  result?: GameResult;
  /** e.g. "5-3". */
  score?: string;
  /** Human display time, e.g. "Tonight 6:40" or "Today 1:20". */
  displayTime?: string;
}

export interface TeamSummary {
  teamKey: string;
  label: string;
  sport: Sport;
  lastGame?: NormalizedGame;
  nextGame?: NormalizedGame;
  record?: string;
  standing?: string;
  isLive?: boolean;
  hasGameToday?: boolean;
  /** True when the team is in a playoff/tournament/bowl/bracket context. */
  hasPlayoffContext?: boolean;
  /** Live game situation when a game is in progress. */
  live?: LiveSituation;
}

export interface StandingsRow {
  rank: string;
  /** Watched-team key, present only when this row is a watched team. */
  teamKey?: string;
  abbreviation: string;
  record: string;
  gamesBack?: string;
  conferenceRecord?: string;
  /** Last-10-games record, e.g. "7-3" (not available for all sports). */
  lastTen?: string;
}

export interface StandingsTable {
  title: string;
  columns: string[];
  rows: StandingsRow[];
}

// ---------------------------------------------------------------------------
// Dashboard contract (sent to the device)
// ---------------------------------------------------------------------------

export interface TeamCardSection {
  type: "teamCard";
  id: string;
  title: string;
  subtitle?: string;
  /** Team abbreviation used in compact scorebug layouts. */
  teamAbbr?: string;
  /** Last-game opponent abbreviation used in compact scorebug layouts. */
  scorebugOpponent?: string;
  /** Visual treatment hint for renderers. */
  cardVariant?: "standard" | "scorebug" | "recommended" | "team-result";
  /** Optional preview-only card height override. */
  cardHeight?: number;
  /** Short monogram fallback for the logo badge, e.g. "D", "MSU". */
  badge?: string;
  /** Full-colour team logo URL for image-capable clients (e.g. the preview). */
  logoUrl?: string;
  status: TeamStatus;
  last?: string;
  /** Date metadata for the last completed game, used by richer renderers. */
  lastGame?: { date: string };
  next?: string;
  record?: string;
  standing?: string;
  accent?: Accent;
  /** Live game situation (MLB). Present only when status is "live". */
  live?: LiveSituation;
  /** One-line recap/outlook headline (LLM-generated) shown in the team box. */
  summary?: string;
  /** Players who are hot over the last ~10 games. */
  hot?: string[];
  /** Players who are cold over the last ~10 games. */
  cold?: string[];
}

/** A snapshot of an in-progress game. Volatile fields (ball/strike count) are
 * intentionally excluded — they change every pitch and would be stale on a
 * slow-refresh panel. */
export interface LiveSituation {
  /** Live score from the watched team's perspective, "us-them", e.g. "3-2". */
  score?: string;
  /** Opponent abbreviation, e.g. "MIN". */
  opponent?: string;
  /** Whether the watched team is home or away. */
  homeAway?: HomeAway;
  /** Inning/period detail, e.g. "Top 6th". */
  detail?: string;
  onFirst?: boolean;
  onSecond?: boolean;
  onThird?: boolean;
  /** 0-3. */
  outs?: number;
  /** Watched team's live win probability as a 0-100 percentage. */
  winProbability?: number;
  /** Brief featured player lines for live-card display, e.g. "Keith 1-2, HR". */
  topPlayers?: string[];
}

export interface StandingsSection {
  type: "standings";
  id: string;
  title: string;
  columns: string[];
  rows: string[][];
  highlightTeamKeys?: string[];
  /** Indices into `rows` for watched teams — the device emphasises these. */
  highlightRows?: number[];
  /** Accent colour used to emphasise the highlighted row(s). */
  accent?: Accent;
  /** Draw a playoff-cutoff (dashed) divider after this many rows. */
  cutoffAfter?: number;
  /** Draw a solid section divider after this many rows (e.g. division leaders). */
  dividerAfter?: number;
}

export interface MessageSection {
  type: "message";
  id: string;
  title: string;
  body: string;
}

export interface LeaderItem {
  /** Short group label, e.g. "AL E". */
  group: string;
  /** Leading team abbreviation, e.g. "NYY". */
  team: string;
  /** Optional extra, e.g. record. */
  detail?: string;
}

/** Compact strip of division leaders, used to fill space in MLB-only views. */
export interface LeadersSection {
  type: "leaders";
  id: string;
  title: string;
  items: LeaderItem[];
}

export type DashboardSection =
  | TeamCardSection
  | StandingsSection
  | MessageSection
  | LeadersSection;

export interface Dashboard {
  version: number;
  updatedAt: string;
  timezone?: string;
  refreshAfterSeconds: number;
  theme?: {
    mode: string;
    density: string;
    /** Layout hint for richer renderers, e.g. "team-comparison". */
    layout?: string;
    /** Per-dashboard card height override (px) for richer renderers. */
    cardHeight?: number;
  };
  sections: DashboardSection[];
  footer?: string;
}

// ---------------------------------------------------------------------------
// Context used by season / refresh logic
// ---------------------------------------------------------------------------

export interface TeamContext {
  now: Date;
  hasLiveGame?: boolean;
  hasPlayoffOrTournamentContext?: boolean;
  lastGame?: { date: string };
  nextGame?: { date: string };
}

export interface RefreshContext {
  hasLiveGame?: boolean;
  hasGameToday?: boolean;
  hasActiveSeason?: boolean;
  /** Current time, used to schedule the next wake on the wall clock. */
  now?: Date;
  /** A watched game is final but its editorial summary isn't ready yet. */
  awaitingEditorial?: boolean;
}

/** Adapter contract every sport adapter implements. */
export interface SportsAdapter {
  getTeamSummary(team: WatchedTeam): Promise<TeamSummary>;
  getStandings(group: string): Promise<StandingsTable>;
}
