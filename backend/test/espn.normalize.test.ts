import { describe, it, expect } from "vitest";
import {
  normalizeScheduleToGames,
  normalizeStandings,
  findLeafGroupByName,
  formatDisplayTime,
  scheduleUrl,
} from "../src/adapters/espn.js";
import schedule from "../fixtures/espn-schedule.sample.json" with { type: "json" };
import standings from "../fixtures/espn-standings.sample.json" with { type: "json" };

const NOW = new Date("2026-06-20T13:00:00Z"); // between game 2 (post) and game 3 (pre)

describe("normalizeScheduleToGames", () => {
  it("picks the most recent completed game as lastGame", () => {
    const r = normalizeScheduleToGames(schedule, "DET", NOW);
    expect(r.lastGame).toMatchObject({
      eventId: "2",
      opponent: "CLE",
      homeAway: "home",
      result: "W",
      score: "5-3",
    });
  });

  it("picks the next upcoming game as nextGame", () => {
    const r = normalizeScheduleToGames(schedule, "DET", NOW);
    expect(r.nextGame).toMatchObject({ opponent: "MIN", homeAway: "home" });
    expect(r.nextGame?.displayTime).toBeTruthy();
  });

  it("flags hasGameToday when a game falls on the current date", () => {
    const r = normalizeScheduleToGames(schedule, "DET", NOW);
    expect(r.hasGameToday).toBe(true); // game 3 is 2026-06-20
  });

  it("reports not live when no event is in progress", () => {
    const r = normalizeScheduleToGames(schedule, "DET", NOW);
    expect(r.isLive).toBe(false);
  });

  it("skips postponed games (state=post but not completed) when picking the last game", () => {
    // A postponed 0-0 game sits between the real last win and NOW; it must be
    // ignored, not shown as a 0-0 tie.
    const r = normalizeScheduleToGames(schedule, "DET", NOW);
    expect(r.lastGame).toMatchObject({ result: "W", score: "5-3", opponent: "CLE" });
  });

  it("computes an away loss correctly (orientation by team)", () => {
    // At an earlier 'now', game 1 (DET lost at home to CLE) is the last game.
    const earlier = new Date("2026-06-19T00:00:00Z");
    const r = normalizeScheduleToGames(schedule, "DET", earlier);
    expect(r.lastGame).toMatchObject({ result: "L", score: "2-4", opponent: "CLE" });
  });

  it("can filter NFL preseason games out of normalized summaries", () => {
    const raw = {
      events: [
        {
          date: "2026-08-22T16:00:00Z",
          seasonType: { id: "1", type: 1, name: "Preseason" },
          competitions: [
            {
              status: { type: { state: "post", completed: true } },
              competitors: [
                { homeAway: "home", team: { abbreviation: "DET" }, score: "10", winner: true },
                { homeAway: "away", team: { abbreviation: "WSH" }, score: "7", winner: false },
              ],
            },
          ],
        },
        {
          date: "2026-08-29T17:00:00Z",
          seasonType: { id: "1", type: 1, name: "Preseason" },
          competitions: [
            {
              status: { type: { state: "pre", completed: false } },
              competitors: [
                { homeAway: "away", team: { abbreviation: "DET" } },
                { homeAway: "home", team: { abbreviation: "IND" } },
              ],
            },
          ],
        },
        {
          date: "2026-09-13T17:00:00Z",
          seasonType: { id: "2", type: 2, name: "Regular Season" },
          competitions: [
            {
              status: { type: { state: "pre", completed: false } },
              competitors: [
                { homeAway: "home", team: { abbreviation: "DET" } },
                { homeAway: "away", team: { abbreviation: "NO" } },
              ],
            },
          ],
        },
      ],
    };

    const r = normalizeScheduleToGames(
      raw,
      "DET",
      new Date("2026-08-26T12:00:00Z"),
      "America/Chicago",
      { allowedSeasonTypes: [2, 3] },
    );

    expect(r.lastGame).toBeUndefined();
    expect(r.hasGameToday).toBe(false);
    expect(r.nextGame).toMatchObject({ opponent: "NO" });
  });
});

describe("scheduleUrl", () => {
  it("requests NFL regular-season schedules explicitly so preseason is excluded", () => {
    expect(scheduleUrl("nfl", "det", new Date("2026-08-26T12:00:00Z"))).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/det/schedule?season=2026&seasontype=2",
    );
  });
});

describe("formatDisplayTime", () => {
  const game = new Date("2026-06-21T17:40:00Z"); // 12:40 PM in Chicago (CDT)
  const now = new Date("2026-06-20T13:00:00Z");

  it("labels tomorrow 'Tmw' and localizes the time", () => {
    expect(formatDisplayTime(game, now, "America/Chicago")).toBe("Tmw 12:40 PM");
  });

  it("drops the label for a same-day game (just the time)", () => {
    const todayGame = new Date("2026-06-20T23:40:00Z"); // 6:40 PM CDT, same day as now
    expect(formatDisplayTime(todayGame, now, "America/Chicago")).toBe("6:40 PM");
  });

  it("uses a weekday label for games further out", () => {
    const later = new Date("2026-06-24T18:10:00Z"); // Wed 1:10 PM CDT
    expect(formatDisplayTime(later, now, "America/Chicago")).toBe("Wed 1:10 PM");
  });
});

describe("findLeafGroupByName / normalizeStandings", () => {
  it("locates a nested leaf division by name", () => {
    const group = findLeafGroupByName(standings, "American League Central");
    expect(group?.standings.entries).toHaveLength(5);
  });

  it("normalizes entries into a ranked standings table", () => {
    const table = normalizeStandings(standings, {
      espnGroupName: "American League Central",
      title: "AL Central",
      abbrToKey: { DET: "tigers" },
    });
    expect(table.title).toBe("AL Central");
    expect(table.columns).toEqual(["#", "Team", "Record", "GB"]);
    expect(table.rows).toHaveLength(5);
    expect(table.rows[0]).toMatchObject({ rank: "1", abbreviation: "CLE", record: "44-31", gamesBack: "-" });
    const det = table.rows.find((r) => r.abbreviation === "DET")!;
    expect(det).toMatchObject({ rank: "2", record: "42-34", gamesBack: "2.5", teamKey: "tigers" });
  });

  it("throws a clear error when the group is not present", () => {
    expect(() =>
      normalizeStandings(standings, { espnGroupName: "Nonexistent", title: "X" }),
    ).toThrow(/not found/i);
  });
});
