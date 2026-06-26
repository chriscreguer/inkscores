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

// Refresh schedule (America/Chicago wall clock). A live game polls often; a
// just-finished game gets a short follow-up so the editorial pull can land;
// otherwise the device wakes on a fixed daily schedule — a morning catch-up plus
// hourly through the active window — and sleeps through the dead overnight hours.
const LIVE_REFRESH_SECONDS = 600; // 10 min
const EDITORIAL_PULL_SECONDS = 1800; // 30 min, to let a final's recap generate
const OFFSEASON_REFRESH_SECONDS = 21600; // 6 hr
const REFRESH_TZ = "America/Chicago";
const MORNING_WAKE_HOUR = 9; // overnight finals + fresh standings
const ACTIVE_START_HOUR = 13; // 1 PM
const ACTIVE_END_HOUR = 24; // midnight — last hourly wake fires at 23:00
const DAY_SECONDS = 86400;

/** Scheduled wake times, in seconds-since-CT-midnight: morning + hourly active. */
function wakeSecondsCt(): number[] {
  const hours = [MORNING_WAKE_HOUR];
  for (let h = ACTIVE_START_HOUR; h < ACTIVE_END_HOUR; h++) hours.push(h);
  return hours.map((h) => h * 3600).sort((a, b) => a - b);
}

/** Seconds since local midnight in the given IANA time zone. */
function secondsOfDayInTz(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const num = (t: string): number =>
    Number(parts.find((p) => p.type === t)?.value ?? "0");
  const hour = num("hour") % 24; // Intl can emit 24 at midnight
  return hour * 3600 + num("minute") * 60 + num("second");
}

/** Seconds to sleep until the next scheduled wake (wall clock, CT). */
function secondsUntilNextWake(now: Date): number {
  const cur = secondsOfDayInTz(now, REFRESH_TZ);
  const targets = wakeSecondsCt();
  const first = targets[0] ?? MORNING_WAKE_HOUR * 3600;
  // +60s guard so a wake that fires slightly early doesn't re-select its own slot.
  const next = targets.find((t) => t > cur + 60);
  const delta = next != null ? next - cur : DAY_SECONDS - cur + first;
  return Math.min(DAY_SECONDS, Math.max(60, delta));
}

/** Refresh cadence (seconds) the device should sleep for, by context. */
export function getRefreshAfterSeconds(context: RefreshContext): number {
  if (context.hasLiveGame) return LIVE_REFRESH_SECONDS;
  if (context.awaitingEditorial) return EDITORIAL_PULL_SECONDS;
  if (context.hasActiveSeason === false) return OFFSEASON_REFRESH_SECONDS;
  return secondsUntilNextWake(context.now ?? new Date());
}
