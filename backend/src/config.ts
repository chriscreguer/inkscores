import type { Sport, WatchedTeam } from "./types.js";

/**
 * Single source of truth for the teams this dashboard watches.
 * Order here is the default render priority.
 */
export const WATCHED_TEAMS: WatchedTeam[] = [
  {
    key: "tigers",
    label: "Tigers",
    fullName: "Detroit Tigers",
    sport: "mlb",
    league: "MLB",
    espnTeamSlug: "det",
    division: "AL Central",
    priority: 1,
    accent: "blue",
    badge: "D",
    logoUrl: "https://a.espncdn.com/i/teamlogos/mlb/500/det.png",
  },
  {
    key: "cubs",
    label: "Cubs",
    fullName: "Chicago Cubs",
    sport: "mlb",
    league: "MLB",
    espnTeamSlug: "chc",
    division: "NL Central",
    priority: 2,
    accent: "blue",
    badge: "C",
    logoUrl: "https://a.espncdn.com/i/teamlogos/mlb/500/chc.png",
  },
  {
    key: "lions",
    label: "Lions",
    fullName: "Detroit Lions",
    sport: "nfl",
    league: "NFL",
    espnTeamSlug: "det",
    standingsGroup: "NFC North",
    priority: 3,
    accent: "blue",
    badge: "L",
    logoUrl: "https://a.espncdn.com/i/teamlogos/nfl/500/det.png",
  },
  {
    key: "pistons",
    label: "Pistons",
    fullName: "Detroit Pistons",
    sport: "nba",
    league: "NBA",
    espnTeamSlug: "det",
    standingsGroup: "Eastern",
    priority: 4,
    accent: "red",
    badge: "P",
    logoUrl: "https://a.espncdn.com/i/teamlogos/nba/500/det.png",
  },
  {
    key: "msu-football",
    label: "MSU Football",
    fullName: "Michigan State Spartans Football",
    sport: "ncaaf",
    league: "NCAAF",
    espnTeamSlug: "msu",
    standingsGroup: "Big Ten",
    priority: 5,
    accent: "green",
    badge: "S",
    logoUrl: "https://a.espncdn.com/i/teamlogos/ncaa/500/127.png",
  },
  {
    key: "msu-basketball",
    label: "MSU Basketball",
    fullName: "Michigan State Spartans Men's Basketball",
    sport: "ncaamb",
    league: "NCAAMB",
    espnTeamSlug: "msu",
    standingsGroup: "Big Ten",
    priority: 6,
    accent: "green",
    badge: "S",
    logoUrl: "https://a.espncdn.com/i/teamlogos/ncaa/500/127.png",
  },
];

export interface SeasonWindow {
  startMonth: number;
  endMonth: number;
  note: string;
}

/**
 * Broad expected season windows, keyed by sport. Months are 1-indexed.
 * Windows that wrap the new year (endMonth < startMonth) are handled by the
 * season logic.
 */
export const SEASON_WINDOWS: Record<Sport, SeasonWindow> = {
  mlb: {
    startMonth: 3,
    endMonth: 10,
    note: "Regular season through postseason.",
  },
  nfl: {
    // Regular season starts in September and runs through the Super Bowl in
    // early February. Wraps the new year.
    startMonth: 9,
    endMonth: 2,
    note: "Regular season through playoffs and the Super Bowl (early Feb).",
  },
  nba: {
    // Window ends in May, not June, on purpose. The NBA Finals run into June
    // but involve only two teams — those surface via the playoff-context and
    // recent-game signals, which take precedence over the broad window. Keeping
    // June out of the generic window is what makes "In June, show MLB only"
    // hold for a non-Finals team like the Pistons.
    startMonth: 10,
    endMonth: 5,
    note: "Regular season, play-in, playoffs through conference finals (May). June Finals teams show via playoff/recent-game signals.",
  },
  ncaaf: {
    startMonth: 8,
    endMonth: 1,
    note: "Regular season through bowls/playoff.",
  },
  ncaamb: {
    startMonth: 11,
    endMonth: 4,
    note: "Regular season through conference tournaments and March Madness.",
  },
};

/** Default IANA timezone for display formatting. */
export const DEFAULT_TIMEZONE = "America/Chicago";

export function getTeamByKey(key: string): WatchedTeam | undefined {
  return WATCHED_TEAMS.find((t) => t.key === key);
}
