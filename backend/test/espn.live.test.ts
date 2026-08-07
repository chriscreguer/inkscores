import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  topPlayersFromCompetition,
  topPlayersFromSummary,
  topPlayersFromFootballSummary,
  gameNotesFromSummary,
  liveDetailsFromScoreboard,
  winProbabilityFromSummary,
  scoreboardUrl,
  findTeamEventInScoreboard,
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

describe("gameNotesFromSummary", () => {
  const summary = fixture("espn-mlb-boxscore.json"); // CIN vs PIT live boxscore

  it("turns verified ESPN summary facts into compact LLM source notes", () => {
    const lines = gameNotesFromSummary(
      {
        ...summary,
        headlines: [
          {
            description:
              "Griffin's homer gave Pittsburgh the lead before the bullpen had to hold on late.",
          },
        ],
        winprobability: [
          { homeWinPercentage: 0.2 },
          { homeWinPercentage: 0.8 },
        ],
        header: {
          competitions: [
            {
              competitors: [
                { homeAway: "home", team: { abbreviation: "PIT" } },
                { homeAway: "away", team: { abbreviation: "CIN" } },
              ],
            },
          ],
        },
      },
      "PIT",
      "mlb",
    );

    expect(lines).toContain(
      "Headline: Griffin's homer gave Pittsburgh the lead before the bullpen had to hold on late.",
    );
    expect(lines).toContain(
      "Top box-score lines: Griffin 1-2, HR, RBI; Reynolds 1-2; Skenes 4.0 IP, 4 ER, 7 K",
    );
    expect(lines).toContain("Game flow: Win probability swung from 20% to 80% for PIT");
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

describe("topPlayersFromFootballSummary", () => {
  // Synthetic — not a real ESPN payload, since no live CFB game existed to
  // capture one from when this was written. Shape mirrors the documented
  // boxscore.players[].statistics[] convention (name/keys/athletes).
  const summary = {
    boxscore: {
      players: [
        {
          team: { abbreviation: "MSU" },
          statistics: [
            {
              name: "passing",
              keys: ["completions/passingAttempts", "passingYards", "passingTouchdowns"],
              athletes: [
                { athlete: { shortName: "B. Watson" }, stats: ["18/27", "245", "2"] },
                { athlete: { shortName: "T. Backup" }, stats: ["0/1", "0", "0"] },
              ],
            },
            {
              name: "rushing",
              keys: ["rushingAttempts", "rushingYards", "rushingTouchdowns"],
              athletes: [
                { athlete: { shortName: "N. Carter" }, stats: ["14", "88", "1"] },
                { athlete: { shortName: "B. Watson" }, stats: ["6", "12", "0"] },
              ],
            },
            {
              name: "receiving",
              keys: ["receptions", "receivingYards", "receivingTouchdowns"],
              athletes: [
                { athlete: { shortName: "J. Reed" }, stats: ["6", "94", "1"] },
                { athlete: { shortName: "N. Carter" }, stats: ["2", "20", "0"] },
              ],
            },
          ],
        },
      ],
    },
  };

  it("picks the top passer/rusher/receiver by yards, with TDs when scored", () => {
    const lines = topPlayersFromFootballSummary(summary, "MSU");
    expect(lines).toEqual([
      "Watson 245 pass yds, 2 TD",
      "Carter 88 rush yds, 1 TD",
      "Reed 94 rec yds, 1 TD",
    ]);
  });

  it("omits the TD clause for a scoreless leader", () => {
    const noTds = JSON.parse(JSON.stringify(summary));
    noTds.boxscore.players[0].statistics[0].athletes[0].stats = ["18/27", "245", "0"];
    const lines = topPlayersFromFootballSummary(noTds, "MSU");
    expect(lines[0]).toBe("Watson 245 pass yds");
  });

  it("returns [] when the team or box score is missing", () => {
    expect(topPlayersFromFootballSummary(summary, "ZZZ")).toEqual([]);
    expect(topPlayersFromFootballSummary({}, "MSU")).toEqual([]);
  });

  it("returns [] instead of throwing when category keys don't match", () => {
    const wrongKeys = { boxscore: { players: [{ team: { abbreviation: "MSU" }, statistics: [{ name: "passing", keys: ["unexpected"], athletes: [] }] }] } };
    expect(topPlayersFromFootballSummary(wrongKeys, "MSU")).toEqual([]);
  });
});

describe("scoreboardUrl", () => {
  it("appends ?dates=YYYYMMDD when given a date", () => {
    expect(scoreboardUrl("ncaaf", "20260804")).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20260804",
    );
  });

  it("omits the query string entirely without a date", () => {
    expect(scoreboardUrl("mlb")).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
    );
  });
});

describe("findTeamEventInScoreboard", () => {
  // Regression: an unscoped scoreboard fetch was observed returning a whole
  // upcoming game week (not just today) for weekly-cadence sports, so a team
  // with nothing happening today still matched a game a month out. Scoping
  // the fetch via scoreboardUrl's dates param is the actual fix (this just
  // documents that the matcher itself has no date awareness — it trusts
  // whatever payload it's given, so callers must pass an already-scoped one).
  it("matches whatever event payload it's given, regardless of date", () => {
    const raw = {
      events: [
        {
          date: "2026-09-05T00:00Z",
          competitions: [{ competitors: [{ team: { abbreviation: "MSU" } }] }],
        },
      ],
    };
    expect(findTeamEventInScoreboard(raw, "MSU")).toBeDefined();
  });

  it("returns undefined when the team has no event in the given payload", () => {
    const raw = { events: [{ competitions: [{ competitors: [{ team: { abbreviation: "OSU" } }] }] }] };
    expect(findTeamEventInScoreboard(raw, "MSU")).toBeUndefined();
  });
});
