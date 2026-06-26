import {
  isTeamActive,
  getRefreshAfterSeconds,
} from "./activeSeasons.js";
import { SEASON_WINDOWS, DEFAULT_TIMEZONE } from "./config.js";
import { toStandingsSection } from "./formatters/standings.js";
import { formatLastGame, formatNextGame } from "./formatters/games.js";
import type {
  Sport,
  WatchedTeam,
  TeamSummary,
  StandingsTable,
  Dashboard,
  DashboardSection,
  TeamCardSection,
  MessageSection,
  TeamContext,
} from "./types.js";

const MISSING = "—";

/** Standings lookup key. Includes sport so football/basketball Big Ten differ. */
export function standingsKey(sport: Sport, group: string): string {
  return `${sport}:${group}`;
}

/** How many standings rows to show per sport (watched team always kept). */
const STANDINGS_TOP_N: Record<Sport, number | undefined> = {
  mlb: undefined, // show all five division teams
  nba: 10, // Eastern Conference top 10 + Pistons
  nfl: undefined, // show all four NFC North teams
  ncaaf: 8, // Big Ten top 8 + MSU
  ncaamb: 8, // Big Ten top 8 + MSU
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface TeamData {
  team: WatchedTeam;
  /** Undefined when the upstream fetch failed or returned nothing. */
  summary?: TeamSummary;
}

export interface BuildInput {
  now: Date;
  timezone?: string;
  teamData: TeamData[];
  /** Keyed by standingsKey(sport, group). */
  standings: Map<string, StandingsTable>;
  /** Force every watched team to render (debug=all). */
  debugShowAll?: boolean;
  /** Force specific sports to render regardless of season (debug=<sport>). */
  debugSports?: Sport[];
}

function contextFor(now: Date, summary?: TeamSummary): TeamContext {
  return {
    now,
    hasLiveGame: summary?.isLive,
    hasPlayoffOrTournamentContext: summary?.hasPlayoffContext,
    ...(summary?.lastGame ? { lastGame: { date: summary.lastGame.date } } : {}),
    ...(summary?.nextGame ? { nextGame: { date: summary.nextGame.date } } : {}),
  };
}

function isActive(input: BuildInput, data: TeamData): boolean {
  if (input.debugShowAll) return true;
  if (input.debugSports?.includes(data.team.sport)) return true;
  return isTeamActive(data.team, contextFor(input.now, data.summary));
}

function buildTeamCard(data: TeamData): TeamCardSection {
  const { team, summary } = data;
  return {
    type: "teamCard",
    id: `${team.key}-card`,
    title: team.label,
    subtitle: team.fullName,
    ...(team.badge ? { badge: team.badge } : {}),
    ...(team.logoUrl ? { logoUrl: team.logoUrl } : {}),
    ...(summary?.live ? { live: summary.live } : {}),
    status: summary?.isLive ? "live" : "active",
    last: formatLastGame(summary?.lastGame) ?? MISSING,
    ...(summary?.lastGame ? { lastGame: { date: summary.lastGame.date } } : {}),
    next: formatNextGame(summary?.nextGame) ?? MISSING,
    record: summary?.record ?? MISSING,
    standing: summary?.standing ?? MISSING,
    ...(team.accent ? { accent: team.accent } : {}),
  };
}

function groupOf(team: WatchedTeam): string | undefined {
  return team.division ?? team.standingsGroup;
}

function formatFooter(now: Date, timezone: string): string {
  try {
    const time = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    }).format(now);
    return `Updated ${time}`;
  } catch {
    return "Updated";
  }
}

function offseasonBody(): string {
  const upcoming = (Object.keys(SEASON_WINDOWS) as Sport[]).map((sport) => {
    const month = MONTH_NAMES[SEASON_WINDOWS[sport].startMonth - 1];
    return `${sport.toUpperCase()} returns in ${month}`;
  });
  return upcoming.join(". ") + ".";
}

/** Assemble the full dashboard contract from normalized data. */
export function buildDashboard(input: BuildInput): Dashboard {
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;

  // Active teams, in configured priority order.
  const active = input.teamData
    .filter((d) => isActive(input, d))
    .sort((a, b) => a.team.priority - b.team.priority);

  const sections: DashboardSection[] = [];

  // 1. Team cards.
  for (const data of active) {
    sections.push(buildTeamCard(data));
  }

  // 2. Standings tables, one per (sport, group) of active teams.
  const seenGroups = new Set<string>();
  const missingStandings: string[] = [];

  for (const data of active) {
    const group = groupOf(data.team);
    if (!group) continue;
    const key = standingsKey(data.team.sport, group);
    if (seenGroups.has(key)) continue;
    seenGroups.add(key);

    const table = input.standings.get(key);
    const watchedInGroup = active.filter(
      (d) => d.team.sport === data.team.sport && groupOf(d.team) === group,
    );
    const watchedKeysInGroup = watchedInGroup.map((d) => d.team.key);

    if (!table) {
      missingStandings.push(group);
      continue;
    }

    const accent = watchedInGroup[0]?.team.accent;
    sections.push(
      toStandingsSection(table, {
        id: group.toLowerCase().replace(/\s+/g, "-"),
        topN: STANDINGS_TOP_N[data.team.sport],
        alwaysIncludeKeys: watchedKeysInGroup,
        highlightTeamKeys: watchedKeysInGroup,
        ...(accent ? { accent } : {}),
      }),
    );
  }

  // 3. Degraded / offseason messaging.
  if (active.length === 0) {
    const offseason: MessageSection = {
      type: "message",
      id: "offseason",
      title: "No active teams",
      body: offseasonBody(),
    };
    sections.push(offseason);
  } else if (missingStandings.length > 0) {
    sections.push({
      type: "message",
      id: "standings-unavailable",
      title: "Standings unavailable",
      body: `Showing team cards. Standings for ${missingStandings.join(", ")} could not be loaded.`,
    });
  }

  // 4. Refresh cadence from aggregate state.
  const hasLiveGame = active.some((d) => d.summary?.isLive);
  const hasGameToday = active.some((d) => d.summary?.hasGameToday);
  const refreshAfterSeconds = getRefreshAfterSeconds({
    hasLiveGame,
    hasGameToday,
    hasActiveSeason: active.length > 0,
    now: input.now,
  });

  return {
    version: 1,
    updatedAt: input.now.toISOString(),
    timezone,
    refreshAfterSeconds,
    theme: { mode: "epaper-color", density: "compact" },
    sections,
    footer: formatFooter(input.now, timezone),
  };
}
