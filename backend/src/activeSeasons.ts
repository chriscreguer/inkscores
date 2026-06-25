import { SEASON_WINDOWS } from "./config.js";
import type {
  Sport,
  WatchedTeam,
  TeamContext,
  RefreshContext,
} from "./types.js";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Whole-day difference between two dates (always non-negative). */
export function daysBetween(a: Date, b: Date): number {
  return Math.abs(Math.round((b.getTime() - a.getTime()) / MS_PER_DAY));
}

/**
 * True when `now` falls inside a sport's broad expected season window.
 * Months are 1-indexed and inclusive. Windows where endMonth < startMonth
 * wrap across the new year (e.g. NBA Oct->Jun, NCAAF Aug->Jan).
 */
export function isInsideBroadSeasonWindow(sport: Sport, now: Date): boolean {
  const window = SEASON_WINDOWS[sport];
  const month = now.getUTCMonth() + 1;
  const { startMonth, endMonth } = window;

  if (startMonth <= endMonth) {
    return month >= startMonth && month <= endMonth;
  }
  // Wrapping window: active if at/after start OR at/before end.
  return month >= startMonth || month <= endMonth;
}

/**
 * A team is active if any of:
 *  - it has a live game today
 *  - it is in a playoff/tournament/bowl/bracket context
 *  - it played within the last 7 days
 *  - it has a scheduled game within the next 14 days
 *  - it is inside the broad expected season window
 */
export function isTeamActive(team: WatchedTeam, context: TeamContext): boolean {
  const { now } = context;

  if (context.hasLiveGame) return true;
  if (context.hasPlayoffOrTournamentContext) return true;

  if (context.lastGame) {
    const last = new Date(context.lastGame.date);
    if (last <= now && daysBetween(last, now) <= 7) return true;
  }

  if (context.nextGame) {
    const next = new Date(context.nextGame.date);
    if (next >= now && daysBetween(now, next) <= 14) return true;
  }

  if (isInsideBroadSeasonWindow(team.sport, now)) return true;

  return false;
}

/** Refresh cadence (seconds) the device should sleep for, by context. */
export function getRefreshAfterSeconds(context: RefreshContext): number {
  if (context.hasLiveGame) return 900; // 15 min
  if (context.hasGameToday) return 1800; // 30 min
  if (context.hasActiveSeason) return 7200; // 2 hr
  return 21600; // 6 hr
}
