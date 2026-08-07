import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  brefTeamStatsUrl,
  parseHitters,
  parsePitchers,
  selectTopHitters,
  selectStarters,
  selectRelievers,
  buildHittingTable,
  buildStartersTable,
  buildPenTable,
  createBrefTeamStatsAdapter,
} from "../src/adapters/brefTeamStats.js";

const html = readFileSync(
  fileURLToPath(new URL("../fixtures/bref-team-stats-det.html", import.meta.url)),
  "utf8",
);

describe("brefTeamStatsUrl", () => {
  it("builds the team-season page URL", () => {
    expect(brefTeamStatsUrl("DET", 2026)).toBe(
      "https://www.baseball-reference.com/teams/DET/2026.shtml",
    );
  });
});

describe("parseHitters", () => {
  const hitters = parseHitters(html);

  it("reads every rostered player, skipping the header and Team Totals rows", () => {
    expect(hitters.length).toBeGreaterThan(20);
    expect(hitters.some((h) => h.name === "Team Totals")).toBe(false);
  });

  it("reads WAR/PA/OPS/OPS+/AVG for a known player", () => {
    const dingler = hitters.find((h) => h.name === "Dillon Dingler");
    expect(dingler).toBeDefined();
    expect(dingler?.pa).toBe(442);
    expect(dingler?.war).toBeCloseTo(4.5, 1);
    expect(dingler?.ops).toBeCloseTo(0.868, 3);
    expect(dingler?.opsPlus).toBeCloseTo(137, 0);
    expect(dingler?.avg).toBeCloseTo(0.275, 3);
  });

  it("returns [] for markup without the batting table", () => {
    expect(parseHitters("<html>no table</html>")).toEqual([]);
  });
});

describe("parsePitchers", () => {
  const pitchers = parsePitchers(html);

  it("reads every rostered pitcher, skipping the header and Team Totals rows", () => {
    expect(pitchers.length).toBeGreaterThan(15);
    expect(pitchers.some((p) => p.name === "Team Totals")).toBe(false);
  });

  it("reads WAR/G/GS/IP/ERA/ERA+/FIP for a known starter", () => {
    const montero = pitchers.find((p) => p.name === "Keider Montero");
    expect(montero).toBeDefined();
    expect(montero?.g).toBe(24);
    expect(montero?.gs).toBe(18);
    expect(montero?.ip).toBeCloseTo(116.333, 2);
    expect(montero?.era).toBeCloseTo(3.17, 2);
    expect(montero?.eraPlus).toBeCloseTo(135, 0);
    expect(montero?.fip).toBeCloseTo(3.7, 2);
  });

  it("converts thirds-of-an-inning IP notation correctly", () => {
    const skubal = pitchers.find((p) => p.name === "Tarik Skubal");
    expect(skubal?.ip).toBeCloseTo(96.667, 2); // 96.2 -> 96 + 2/3
  });
});

describe("selectTopHitters", () => {
  const top = selectTopHitters(parseHitters(html));

  it("takes the 9 highest-PA hitters, displayed sorted by WAR descending", () => {
    expect(top.map((h) => h.name)).toEqual([
      "Kevin McGonigle",
      "Dillon Dingler",
      "Riley Greene",
      "Gleyber Torres",
      "Colt Keith",
      "Zach McKinstry",
      "Spencer Torkelson",
      "Kerry Carpenter",
      "Matt Vierling",
    ]);
  });
});

describe("selectStarters / selectRelievers", () => {
  const pitchers = parsePitchers(html);

  it("classifies by majority-starts (GS/G >= 0.5) and takes top 5 by IP, displayed by WAR desc", () => {
    expect(selectStarters(pitchers).map((p) => p.name)).toEqual([
      "Keider Montero",
      "Tarik Skubal",
      "Casey Mize",
      "Framber Valdez",
      "Jack Flaherty",
    ]);
  });

  it("keeps swingmen and spot starters out of the reliever top 4 by IP, displayed by WAR desc", () => {
    expect(selectRelievers(pitchers).map((p) => p.name)).toEqual([
      "Tyler Holton",
      "Kyle Finnegan",
      "Drew Anderson",
      "Enmanuel De Jesus",
    ]);
  });
});

describe("buildHittingTable / buildStartersTable / buildPenTable", () => {
  const hitters = parseHitters(html);
  const pitchers = parsePitchers(html);

  it("formats the hitting table with no-leading-zero rate stats", () => {
    const table = buildHittingTable(hitters, "blue");
    expect(table).toMatchObject({
      type: "standings",
      id: "tigers-stats-hitting",
      title: "Hitting",
      columns: ["Name", "WAR", "OPS", "OPS+", "AVG"],
      cardIndex: 1,
      accent: "blue",
    });
    expect(table.rows[0]).toEqual(["Kevin McGonigle", "5.2", ".810", "126", ".282"]);
  });

  it("formats the starters/pen tables with ERA-family stats", () => {
    const starters = buildStartersTable(pitchers);
    expect(starters.id).toBe("tigers-stats-starters");
    expect(starters.columns).toEqual(["Name", "WAR", "ERA", "ERA+", "FIP"]);
    expect(starters.rows[0]).toEqual(["Keider Montero", "3.0", "3.17", "135", "3.70"]);

    const pen = buildPenTable(pitchers);
    expect(pen.id).toBe("tigers-stats-pen");
    expect(pen.rows[0]).toEqual(["Tyler Holton", "0.9", "2.94", "146", "4.02"]);
  });
});

describe("hot/cold streak markers", () => {
  const hitters = parseHitters(html);
  const pitchers = parsePitchers(html);

  it("appends #H/#C to a matching player's name, matched by the chip's last name", () => {
    const table = buildHittingTable(hitters, undefined, {
      hot: ["Dingler (.964)", "McGonigle (1.018)"],
      cold: ["Torkelson (.512)"],
    });
    const byName = Object.fromEntries(table.rows.map((r) => [String(r[0]), r]));
    expect(Object.keys(byName)).toContain("Dillon Dingler #H");
    expect(Object.keys(byName)).toContain("Kevin McGonigle #H");
    expect(Object.keys(byName)).toContain("Spencer Torkelson #C");
    // Untouched players keep a plain name.
    expect(Object.keys(byName)).toContain("Riley Greene");
  });

  it("leaves names untouched when no streak data is given", () => {
    const table = buildStartersTable(pitchers);
    expect(table.rows.some((r) => String(r[0]).includes("#"))).toBe(false);
  });
});

describe("createBrefTeamStatsAdapter", () => {
  it("fetches and parses via injected fetchText (no network)", async () => {
    const adapter = createBrefTeamStatsAdapter({
      fetchText: async () => html,
      now: () => new Date("2026-08-07T12:00:00Z"),
    });
    const [hitting, starters, pen] = await adapter.getTeamStatsTables("DET", "blue");
    expect(hitting.rows).toHaveLength(9);
    expect(starters.rows).toHaveLength(5);
    expect(pen.rows).toHaveLength(4);
    expect(hitting.rows[0]?.[0]).toBe("Kevin McGonigle");
  });
});
