import { describe, it, expect } from "vitest";
import {
  limitStandingsRows,
  toStandingsSection,
} from "../src/formatters/standings.js";
import type { StandingsRow, StandingsTable } from "../src/types.js";

function row(rank: number, abbr: string, teamKey?: string): StandingsRow {
  return {
    rank: String(rank),
    abbreviation: abbr,
    record: `${50 - rank}-${20 + rank}`,
    gamesBack: rank === 1 ? "-" : String(rank),
    teamKey,
  };
}

const tenRows: StandingsRow[] = Array.from({ length: 15 }, (_, i) =>
  row(i + 1, `T${i + 1}`, i + 1 === 12 ? "pistons" : undefined),
);

describe("limitStandingsRows", () => {
  it("returns all rows when topN is undefined (MLB divisions)", () => {
    const five = tenRows.slice(0, 5);
    expect(limitStandingsRows(five, undefined, [])).toHaveLength(5);
  });

  it("keeps only the top N when the watched team is already inside it", () => {
    const result = limitStandingsRows(tenRows, 10, ["T3-key"]);
    expect(result).toHaveLength(10);
    expect(result.map((r) => r.abbreviation)).toEqual(
      tenRows.slice(0, 10).map((r) => r.abbreviation),
    );
  });

  it("appends the watched team after top N when it falls outside (Pistons 12th)", () => {
    const result = limitStandingsRows(tenRows, 10, ["pistons"]);
    expect(result).toHaveLength(11);
    expect(result.slice(0, 10).map((r) => r.abbreviation)).toEqual(
      tenRows.slice(0, 10).map((r) => r.abbreviation),
    );
    // Pistons row appended at the end, not duplicated.
    expect(result[10]?.teamKey).toBe("pistons");
    expect(result.filter((r) => r.teamKey === "pistons")).toHaveLength(1);
  });

  it("does not append anything when the watched key is not in the table", () => {
    const result = limitStandingsRows(tenRows.slice(0, 11), 10, ["nobody"]);
    expect(result).toHaveLength(10);
  });
});

describe("toStandingsSection", () => {
  const table: StandingsTable = {
    title: "AL Central",
    columns: ["#", "Team", "Record", "GB"],
    rows: [
      { rank: "1", abbreviation: "CLE", record: "44-31", gamesBack: "-" },
      {
        rank: "2",
        abbreviation: "DET",
        record: "42-34",
        gamesBack: "2.5",
        teamKey: "tigers",
      },
    ],
  };

  it("maps normalized rows into a string matrix following the columns", () => {
    const section = toStandingsSection(table, {
      id: "al-central",
      highlightTeamKeys: ["tigers"],
    });
    expect(section.type).toBe("standings");
    expect(section.id).toBe("al-central");
    expect(section.title).toBe("AL Central");
    expect(section.columns).toEqual(["#", "Team", "Record", "GB"]);
    expect(section.rows).toEqual([
      ["1", "CLE", "44-31", "-"],
      ["2", "DET", "42-34", "2.5"],
    ]);
    expect(section.highlightTeamKeys).toEqual(["tigers"]);
  });

  it("marks highlightRows by index and carries the accent", () => {
    const section = toStandingsSection(table, {
      id: "al-central",
      highlightTeamKeys: ["tigers"],
      accent: "blue",
    });
    // DET (tigers) is the 2nd row -> index 1.
    expect(section.highlightRows).toEqual([1]);
    expect(section.accent).toBe("blue");
  });

  it("omits highlightRows when no row matches a highlighted key", () => {
    const section = toStandingsSection(table, { id: "al-central", highlightTeamKeys: ["nobody"] });
    expect(section.highlightRows ?? []).toEqual([]);
  });

  it("renders an em dash for missing fields rather than undefined", () => {
    const sparse: StandingsTable = {
      title: "Big Ten",
      columns: ["#", "Team", "Record", "GB"],
      rows: [{ rank: "1", abbreviation: "MSU", record: "10-2" }],
    };
    const section = toStandingsSection(sparse, { id: "big-ten" });
    expect(section.rows[0]).toEqual(["1", "MSU", "10-2", "—"]);
  });
});
