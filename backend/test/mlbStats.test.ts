import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseTeamAbbrMap,
  parseStatsStandings,
  buildPlayoffTable,
  parseRecentForm,
  canonicalAbbr,
  createMlbStatsAdapter,
  parseHitterForms,
  parsePitcherForms,
  rankPlayerForms,
  formChip,
} from "../src/adapters/mlbStats.js";

function fixture(name: string): unknown {
  const url = new URL(`../fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

const standingsRaw = fixture("mlb-statsapi-standings.json");
const teamsRaw = fixture("mlb-statsapi-teams.json");

describe("parseTeamAbbrMap", () => {
  it("maps all 30 MLB team ids to abbreviations", () => {
    const map = parseTeamAbbrMap(teamsRaw);
    expect(Object.keys(map)).toHaveLength(30);
    expect(map[116]).toBe("DET");
    expect(map[112]).toBe("CHC");
    expect(map[147]).toBe("NYY");
  });

  it("ignores non-MLB (sport id != 1) entries", () => {
    const map = parseTeamAbbrMap({
      teams: [{ id: 1, abbreviation: "X", sport: { id: 22 } }],
    });
    expect(map).toEqual({});
  });
});

describe("parseStatsStandings", () => {
  const abbr = parseTeamAbbrMap(teamsRaw);
  const teams = parseStatsStandings(standingsRaw, abbr);

  it("returns all 30 teams split across AL and NL", () => {
    expect(teams).toHaveLength(30);
    expect(teams.filter((t) => t.league === "AL")).toHaveLength(15);
    expect(teams.filter((t) => t.league === "NL")).toHaveLength(15);
  });

  it("carries real wild-card + magic/elimination fields", () => {
    const det = teams.find((t) => t.abbr === "DET")!;
    expect(det.league).toBe("AL");
    expect(det.wins).toBeGreaterThan(0);
    expect(det.wildCardGamesBack).toBe("5.0");
    expect(det.wildCardEliminationNumber).toBe("78");
    expect(det.divisionLeader).toBe(false);

    const nyy = teams.find((t) => t.abbr === "NYY")!;
    expect(nyy.divisionLeader).toBe(true);
    expect(nyy.magicNumber).toBe("82");
  });
});

describe("buildPlayoffTable", () => {
  const abbr = parseTeamAbbrMap(teamsRaw);
  const teams = parseStatsStandings(standingsRaw, abbr);

  it("puts the three division leaders on top, then the wild-card race", () => {
    const table = buildPlayoffTable(teams, "AL", { id: "al-playoff", watchedAbbr: "DET" });
    expect(table.id).toBe("al-playoff");
    expect(table.title).toBe("AL Playoff");
    expect(table.columns).toEqual(["#", "Team", "Record", "WCGB", "Mag"]);
    expect(table.rows).toHaveLength(7); // always exactly 7 teams
    expect(table.dividerAfter).toBe(3); // three division winners
    expect(table.cutoffAfter).toBe(6); // + three wild-card spots

    // First three rows are the division leaders, sorted by record.
    const leaderAbbrs = table.rows.slice(0, 3).map((r) => r[1]);
    expect(leaderAbbrs).toContain("NYY");
    // Division leaders show "-" for wild-card games back.
    expect(table.rows[0]![3]).toBe("-");
    // and their magic number in the Mag column.
    expect(table.rows[0]![4]).toBe("82");
  });

  it("uses real make-playoffs odds for the last column when provided", () => {
    const table = buildPlayoffTable(teams, "AL", {
      id: "al-playoff",
      watchedAbbr: "DET",
      oddsByAbbr: { DET: 8.2, NYY: 99.95, CWS: 67.3 },
    });
    expect(table.columns[4]).toBe("Odds");
    const det = table.rows.find((r) => r[1] === "DET")!;
    expect(det[4]).toBe("8%");
    const nyy = table.rows.find((r) => r[1] === "NYY")!;
    expect(nyy[4]).toBe(">99%");
    // a team without odds falls back to the magic/elim tracker, not blank
    const noOdds = table.rows.find((r) => r[1] !== "DET" && r[1] !== "NYY" && r[1] !== "CWS");
    expect(noOdds?.[4]).toBeTruthy();
  });

  it("always includes and highlights the watched team even when out of the race", () => {
    const table = buildPlayoffTable(teams, "AL", { id: "al-playoff", watchedAbbr: "DET" });
    expect(table.rows).toHaveLength(7); // 3 leaders + 3 WC + DET as the 7th
    const detRowIndex = table.rows.findIndex((r) => r[1] === "DET");
    expect(detRowIndex).toBe(6); // the 7th row
    expect(table.highlightRows).toContain(detRowIndex);
    // DET shows real wild-card games back and an "e"-prefixed elimination number.
    expect(table.rows[detRowIndex]![3]).toBe("5.0");
    expect(table.rows[detRowIndex]![4]).toBe("e78");
  });

  it("when the watched team is in the top 6, the 7th row is the first team out", () => {
    // CWS is an AL division leader in the fixture, so it sits in the top 6.
    const table = buildPlayoffTable(teams, "AL", { id: "al-playoff", watchedAbbr: "CWS" });
    expect(table.rows).toHaveLength(7);
    // CWS is shown (as a leader) and highlighted...
    const cwsIndex = table.rows.findIndex((r) => r[1] === "CWS");
    expect(table.highlightRows).toContain(cwsIndex);
    expect(cwsIndex).toBeLessThan(6);
    // ...and the 7th row is a non-watched team one spot outside the cutoff.
    expect(table.rows[6]![1]).not.toBe("CWS");
  });
});

describe("canonicalAbbr", () => {
  it("reconciles ESPN and Stats API codes", () => {
    expect(canonicalAbbr("CHW")).toBe("CWS");
    expect(canonicalAbbr("CWS")).toBe("CWS");
    expect(canonicalAbbr("OAK")).toBe("ATH");
    expect(canonicalAbbr("ARI")).toBe("AZ");
    expect(canonicalAbbr("DET")).toBe("DET");
  });
});

describe("parseRecentForm", () => {
  // ids: 116 DET, 145 CWS(White Sox), 142 MIN
  const abbrById = { 116: "DET", 145: "CWS", 142: "MIN" };
  const game = (date: string, homeId: number, awayId: number, homeWon: boolean) => ({
    status: { abstractGameState: "Final" },
    gameDate: date,
    teams: {
      home: { team: { id: homeId }, isWinner: homeWon },
      away: { team: { id: awayId }, isWinner: !homeWon },
    },
  });
  const raw = {
    dates: [
      { games: [game("2026-06-20T18:00:00Z", 116, 142, true)] }, // DET W, MIN L
      { games: [game("2026-06-21T18:00:00Z", 142, 116, true)] }, // DET L, MIN W
      { games: [game("2026-06-22T18:00:00Z", 116, 142, true)] }, // DET W
      {
        games: [
          { status: { abstractGameState: "Live" }, gameDate: "2026-06-23T18:00:00Z", teams: { home: { team: { id: 116 } }, away: { team: { id: 145 } } } }, // ignored (not final)
          game("2026-06-23T20:00:00Z", 145, 116, false), // DET W (White Sox home, lost)
        ],
      },
    ],
  };

  it("builds oldest-first W/L sequences keyed by canonical abbr", () => {
    const form = parseRecentForm(raw, abbrById, 5);
    expect(form.DET).toBe("WLWW"); // chronological, in-progress game excluded
    expect(form.MIN).toBe("LWL"); // MIN played DET on 6/20, 6/21, 6/22
    // White Sox keyed canonically as CWS (one loss)
    expect(form.CWS).toBe("L");
  });

  it("caps the sequence to maxGames, keeping the most recent", () => {
    const form = parseRecentForm(raw, abbrById, 2);
    expect(form.DET).toBe("WW"); // last two of W,L,W,W
  });
});

describe("createMlbStatsAdapter", () => {
  it("returns AL + NL playoff tables from injected fetch (no network)", async () => {
    const adapter = createMlbStatsAdapter({
      fetchJson: async (url: string) =>
        url.includes("/teams") ? teamsRaw : standingsRaw,
      now: () => new Date("2026-06-25T12:00:00Z"),
    });
    const tables = await adapter.getPlayoffTables({
      watched: { AL: "DET", NL: "CHC" },
      accent: "blue",
    });
    expect(tables.map((t) => t.id)).toEqual(["al-playoff", "nl-playoff"]);
    expect(tables[0]!.accent).toBe("blue");
    expect(tables[1]!.rows.some((r) => r[1] === "CHC")).toBe(true);
  });
});

describe("hot/cold from real stats", () => {
  // Roster-hydrate shape: roster[].person.stats[].splits[].stat (deduped by id).
  const rosterEntry = (id: number, fullName: string, stat: Record<string, unknown>) => ({
    person: { id, fullName, stats: [{ splits: [{ stat }] }] },
  });
  const hitting = {
    roster: [
      rosterEntry(1, "Riley Greene", { atBats: 40, ops: "1.050" }),
      rosterEntry(2, "Spencer Torkelson", { atBats: 38, ops: "0.480" }),
      rosterEntry(3, "Bench Guy", { atBats: 5, ops: "1.400" }), // too few AB
    ],
  };
  const pitching = {
    roster: [
      rosterEntry(10, "Tarik Skubal", { inningsPitched: "16.1", era: "1.20" }),
      rosterEntry(11, "Jack Flaherty", { inningsPitched: "12.0", era: "7.50" }),
      rosterEntry(12, "Mop Up", { inningsPitched: "2.0", era: "0.00" }), // too few IP
    ],
  };

  it("filters by playing time and scores hitters by OPS", () => {
    const forms = parseHitterForms(hitting);
    expect(forms.map((f) => f.name)).toEqual(["Riley Greene", "Spencer Torkelson"]); // bench dropped
    expect(forms[0]!.score).toBeGreaterThan(0); // hot
    expect(forms[1]!.score).toBeLessThan(0); // cold
  });

  it("scores pitchers by ERA (lower is hotter) and drops low-IP arms", () => {
    const forms = parsePitcherForms(pitching);
    expect(forms.map((f) => f.name)).toEqual(["Tarik Skubal", "Jack Flaherty"]);
    expect(forms[0]!.score).toBeGreaterThan(0); // 1.20 ERA -> hot
    expect(forms[1]!.score).toBeLessThan(0); // 7.50 ERA -> cold
  });

  it("ranks hitters and pitchers together", () => {
    const forms = [...parseHitterForms(hitting), ...parsePitcherForms(pitching)];
    const { hot, cold } = rankPlayerForms(forms);
    expect(hot.map(formChip)).toContain("Skubal"); // 1.20 ERA tops the pool
    expect(hot.map(formChip)).toContain("Greene");
    expect(cold.map(formChip)).toContain("Flaherty");
    expect(cold.map(formChip)).toContain("Torkelson");
  });

  it("formChip uses the short-name exceptions", () => {
    expect(formChip({ name: "Pete Crow-Armstrong", isPitcher: false, score: 1 })).toBe("PCA");
  });
});
