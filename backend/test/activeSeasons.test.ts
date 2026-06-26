import { describe, it, expect } from "vitest";
import {
  isInsideBroadSeasonWindow,
  isTeamActive,
  getRefreshAfterSeconds,
  daysBetween,
} from "../src/activeSeasons.js";
import type { WatchedTeam, TeamContext } from "../src/types.js";

const mlbTeam: WatchedTeam = {
  key: "tigers",
  label: "Tigers",
  fullName: "Detroit Tigers",
  sport: "mlb",
  league: "MLB",
  espnTeamSlug: "det",
  division: "AL Central",
  priority: 1,
};

const nbaTeam: WatchedTeam = {
  key: "pistons",
  label: "Pistons",
  fullName: "Detroit Pistons",
  sport: "nba",
  league: "NBA",
  espnTeamSlug: "det",
  standingsGroup: "Eastern Conference",
  priority: 3,
};

// Use UTC dates to keep month math deterministic across CI timezones.
const d = (iso: string) => new Date(iso);

describe("daysBetween", () => {
  it("returns whole-day difference regardless of order", () => {
    expect(daysBetween(d("2026-06-01T00:00:00Z"), d("2026-06-08T00:00:00Z"))).toBe(7);
    expect(daysBetween(d("2026-06-08T00:00:00Z"), d("2026-06-01T00:00:00Z"))).toBe(7);
  });
});

describe("isInsideBroadSeasonWindow", () => {
  it("MLB is active in June (non-wrapping window Mar-Oct)", () => {
    expect(isInsideBroadSeasonWindow("mlb", d("2026-06-15T12:00:00Z"))).toBe(true);
  });

  it("MLB is inactive in December", () => {
    expect(isInsideBroadSeasonWindow("mlb", d("2026-12-15T12:00:00Z"))).toBe(false);
  });

  it("NBA window wraps the year: active in January", () => {
    expect(isInsideBroadSeasonWindow("nba", d("2026-01-15T12:00:00Z"))).toBe(true);
  });

  it("NBA window wraps the year: inactive in July", () => {
    expect(isInsideBroadSeasonWindow("nba", d("2026-07-15T12:00:00Z"))).toBe(false);
  });

  it("NCAAF wraps the year: active in January (bowls/playoff)", () => {
    expect(isInsideBroadSeasonWindow("ncaaf", d("2026-01-05T12:00:00Z"))).toBe(true);
  });
});

describe("isTeamActive", () => {
  const june = d("2026-06-15T12:00:00Z");

  it("MLB team is active in June via season window", () => {
    expect(isTeamActive(mlbTeam, { now: june })).toBe(true);
  });

  it("NBA team is hidden in June with no recent/upcoming games", () => {
    expect(isTeamActive(nbaTeam, { now: june })).toBe(false);
  });

  it("live game forces active even in offseason", () => {
    const ctx: TeamContext = { now: june, hasLiveGame: true };
    expect(isTeamActive(nbaTeam, ctx)).toBe(true);
  });

  it("playoff/tournament context forces active", () => {
    const ctx: TeamContext = { now: june, hasPlayoffOrTournamentContext: true };
    expect(isTeamActive(nbaTeam, ctx)).toBe(true);
  });

  it("a game within the last 7 days forces active", () => {
    const ctx: TeamContext = { now: june, lastGame: { date: "2026-06-10T00:00:00Z" } };
    expect(isTeamActive(nbaTeam, ctx)).toBe(true);
  });

  it("a game 10 days ago does NOT force active", () => {
    const ctx: TeamContext = { now: june, lastGame: { date: "2026-06-05T00:00:00Z" } };
    expect(isTeamActive(nbaTeam, ctx)).toBe(false);
  });

  it("a game within the next 14 days forces active", () => {
    const ctx: TeamContext = { now: june, nextGame: { date: "2026-06-25T00:00:00Z" } };
    expect(isTeamActive(nbaTeam, ctx)).toBe(true);
  });

  it("a game 20 days out does NOT force active", () => {
    const ctx: TeamContext = { now: june, nextGame: { date: "2026-07-05T00:00:00Z" } };
    expect(isTeamActive(nbaTeam, ctx)).toBe(false);
  });
});

describe("getRefreshAfterSeconds", () => {
  // June is CDT (UTC-5), so these UTC instants map to the noted CT wall times.
  it("live game -> 10 min", () => {
    expect(getRefreshAfterSeconds({ hasLiveGame: true })).toBe(600);
  });

  it("awaiting a final's editorial -> 30 min", () => {
    expect(getRefreshAfterSeconds({ awaitingEditorial: true })).toBe(1800);
  });

  it("offseason -> 6 hr", () => {
    expect(getRefreshAfterSeconds({ hasActiveSeason: false })).toBe(21600);
  });

  it("during active hours -> top of the next hour", () => {
    // 14:30 CT -> next wake 15:00 CT = 30 min.
    const now = new Date("2026-06-25T19:30:00Z");
    expect(getRefreshAfterSeconds({ hasActiveSeason: true, now })).toBe(1800);
  });

  it("overnight quiet -> sleeps to the 9 AM morning wake", () => {
    // 02:00 CT -> 09:00 CT = 7 hr.
    const now = new Date("2026-06-25T07:00:00Z");
    expect(getRefreshAfterSeconds({ hasActiveSeason: true, now })).toBe(7 * 3600);
  });

  it("after the last active wake -> sleeps to next morning", () => {
    // 23:30 CT -> 09:00 CT next day = 9.5 hr.
    const now = new Date("2026-06-26T04:30:00Z");
    expect(getRefreshAfterSeconds({ hasActiveSeason: true, now })).toBe(9.5 * 3600);
  });

  it("after the morning wake, before the active window -> sleeps to 1 PM", () => {
    // 10:00 CT -> 13:00 CT = 3 hr.
    const now = new Date("2026-06-25T15:00:00Z");
    expect(getRefreshAfterSeconds({ hasActiveSeason: true, now })).toBe(3 * 3600);
  });

  it("live overrides the schedule even at quiet hours", () => {
    const now = new Date("2026-06-25T07:00:00Z");
    expect(getRefreshAfterSeconds({ hasLiveGame: true, hasActiveSeason: true, now })).toBe(600);
  });
});
