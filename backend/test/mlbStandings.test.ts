import { describe, it, expect } from "vitest";
import {
  parseMlbStandings,
  divisionLeaders,
  playoffSection,
} from "../src/formatters/mlbStandings.js";
import raw from "../fixtures/espn-mlb-standings-full.sample.json" with { type: "json" };

describe("parseMlbStandings", () => {
  it("flattens all six divisions with short labels and pct-sorted teams", () => {
    const divs = parseMlbStandings(raw);
    expect(divs).toHaveLength(6);
    const alc = divs.find((d) => d.short === "AL C")!;
    expect(alc.name).toBe("American League Central");
    expect(alc.teams.map((t) => t.abbr)).toEqual(["CLE", "DET", "KC"]); // sorted by pct
  });
});

describe("divisionLeaders", () => {
  it("returns the top team of each division, AL then NL by E/C/W", () => {
    const items = divisionLeaders(parseMlbStandings(raw));
    expect(items).toEqual([
      { group: "AL E", team: "NYY" },
      { group: "AL C", team: "CLE" },
      { group: "AL W", team: "HOU" },
      { group: "NL E", team: "PHI" },
      { group: "NL C", team: "MIL" },
      { group: "NL W", team: "LAD" },
    ]);
  });
});

describe("playoffSection", () => {
  const divs = parseMlbStandings(raw);

  it("puts division leaders atop, then the wild-card race with records + GB", () => {
    const pl = playoffSection(divs, "AL", { id: "al-playoff", abbrToKey: { DET: "tigers" } });
    expect(pl.type).toBe("standings");
    expect(pl.title).toBe("AL Playoff");
    expect(pl.columns).toEqual(["#", "Team", "Record", "GB"]);
    expect(pl.dividerAfter).toBe(3); // solid line after the 3 division leaders
    expect(pl.cutoffAfter).toBe(6); // dashed line after the 3 wild-card spots
    expect(pl.rows).toEqual([
      ["1", "NYY", "50-30", "-"],
      ["2", "CLE", "48-32", "-"],
      ["3", "HOU", "47-33", "-"],
      ["4", "DET", "46-34", "+2.0"],
      ["5", "BAL", "45-35", "+1.0"],
      ["6", "SEA", "44-36", "-"],
      ["7", "TEX", "42-38", "2.0"],
    ]);
    expect(pl.highlightRows).toEqual([3]); // DET (watched) in a wild-card spot
  });

  it("always appends the watched team (with its real seed) when outside the shown rows", () => {
    // STL is the 5th NL contender — beyond the 4 shown — so it gets appended.
    const pl = playoffSection(divs, "NL", { id: "nl-playoff", abbrToKey: { STL: "cardinals" } });
    const lastRow = pl.rows[pl.rows.length - 1]!;
    expect(lastRow[1]).toBe("STL");
    expect(lastRow[0]).toBe("8"); // real seed after the shown seeds 1-7
    expect(pl.highlightRows).toEqual([pl.rows.length - 1]);
  });

  it("highlights the watched NL team and carries the accent", () => {
    const pl = playoffSection(divs, "NL", { id: "nl-playoff", abbrToKey: { CHC: "cubs" }, accent: "blue" });
    const chc = pl.rows.findIndex((r) => r[1] === "CHC");
    expect(pl.highlightRows).toEqual([chc]);
    expect(pl.accent).toBe("blue");
  });
});
