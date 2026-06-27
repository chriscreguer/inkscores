import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  topPlayersFromCompetition,
  topPlayersFromSummary,
  liveDetailsFromScoreboard,
  winProbabilityFromSummary,
} from "../src/adapters/espn.js";

function fixture(name: string): any {
  const url = new URL(`../fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

describe("topPlayersFromCompetition", () => {
  it("builds concise de-duplicated player lines from competitor leaders", () => {
    const comp = fixture("mlb-scoreboard.json").events[0].competitions[0];
    const lines = topPlayersFromCompetition(comp, "TOR");
    expect(lines.length).toBeGreaterThan(0);
    // last name (initial dropped) + first two stat clauses, no third clause.
    expect(lines[0]).toBe("Okamoto 3-4, 3 RBI");
    expect(lines[0]).not.toContain("BB");
    // no duplicate athletes
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("returns [] for an unknown team", () => {
    const comp = fixture("mlb-scoreboard.json").events[0].competitions[0];
    expect(topPlayersFromCompetition(comp, "ZZZ")).toEqual([]);
  });
});

describe("topPlayersFromSummary", () => {
  const summary = fixture("espn-mlb-boxscore.json"); // CIN vs PIT live boxscore

  it("ranks the watched team's hitters by game impact and appends the pitcher", () => {
    const lines = topPlayersFromSummary(summary, "PIT");
    // top hitter leads, with HR + RBI clauses (initial dropped)
    expect(lines[0]).toBe("Griffin 1-2, HR, RBI");
    // the most-used pitcher's line comes last
    expect(lines[lines.length - 1]).toBe("Skenes 4.0 IP, 4 ER, 7 K");
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(new Set(lines).size).toBe(lines.length); // no duplicate players
  });

  it("orders hitters by impact and keeps RBI clauses concise", () => {
    const lines = topPlayersFromSummary(summary, "CIN");
    expect(lines[0]).toBe("Stephenson 2-2, RBI");
    expect(lines).toContain("Abbott 3.0 IP, 1 ER, 3 K");
  });

  it("returns [] when the team or boxscore is missing", () => {
    expect(topPlayersFromSummary(summary, "ZZZ")).toEqual([]);
    expect(topPlayersFromSummary({}, "PIT")).toEqual([]);
  });
});

describe("liveDetailsFromScoreboard", () => {
  const scoreboard = {
    events: [
      {
        id: "555",
        competitions: [
          {
            status: { type: { state: "in" } },
            situation: { onFirst: true, onSecond: false, onThird: true, outs: 2 },
            status_detail: "Top 6th",
            competitors: [
              {
                homeAway: "home",
                team: { abbreviation: "DET" },
                score: "3",
                leaders: [
                  {
                    name: "avg",
                    leaders: [
                      { athlete: { shortName: "R. Greene" }, displayValue: "2-3, HR, R, BB" },
                    ],
                  },
                ],
              },
              { homeAway: "away", team: { abbreviation: "MIN" }, score: "2" },
            ],
          },
        ],
      },
    ],
  };

  it("extracts live situation, event id, and top players for the watched team", () => {
    const d = liveDetailsFromScoreboard(scoreboard, "DET");
    expect(d.eventId).toBe("555");
    expect(d.live?.score).toBe("3-2");
    expect(d.live?.opponent).toBe("MIN");
    expect(d.live?.onThird).toBe(true);
    expect(d.live?.outs).toBe(2);
    expect(d.topPlayers).toEqual(["Greene 2-3, HR"]);
  });

  it("returns empty when the team has no in-progress game", () => {
    expect(liveDetailsFromScoreboard(scoreboard, "CHC")).toEqual({});
    const postOnly = { events: [{ competitions: [{ status: { type: { state: "post" } } }] }] };
    expect(liveDetailsFromScoreboard(postOnly, "DET")).toEqual({});
  });
});

describe("winProbabilityFromSummary", () => {
  const summary = fixture("espn-mlb-summary.min.json"); // TB home, KC away, last home%=0.57

  it("returns the home team's percentage directly", () => {
    expect(winProbabilityFromSummary(summary, "TB")).toBe(57);
  });

  it("inverts for the away team", () => {
    expect(winProbabilityFromSummary(summary, "KC")).toBe(43);
  });

  it("returns undefined when data is missing", () => {
    expect(winProbabilityFromSummary({}, "TB")).toBeUndefined();
    expect(winProbabilityFromSummary(summary, "ZZZ")).toBeUndefined();
  });
});
