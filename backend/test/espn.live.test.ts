import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  topPlayersFromCompetition,
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
    // shortName + first two stat clauses, no third clause ("R", "2 BB" dropped).
    expect(lines[0]).toBe("K. Okamoto 3-4, 3 RBI");
    expect(lines[0]).not.toContain("BB");
    // no duplicate athletes
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("returns [] for an unknown team", () => {
    const comp = fixture("mlb-scoreboard.json").events[0].competitions[0];
    expect(topPlayersFromCompetition(comp, "ZZZ")).toEqual([]);
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
    expect(d.topPlayers).toEqual(["R. Greene 2-3, HR"]);
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
