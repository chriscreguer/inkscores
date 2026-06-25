import { describe, it, expect, vi } from "vitest";
import { createEspnAdapter } from "../src/adapters/espn.js";
import { TtlCache } from "../src/cache.js";
import schedule from "../fixtures/espn-schedule.sample.json" with { type: "json" };
import standings from "../fixtures/espn-standings.sample.json" with { type: "json" };
import type { WatchedTeam } from "../src/types.js";

const tigers: WatchedTeam = {
  key: "tigers",
  label: "Tigers",
  fullName: "Detroit Tigers",
  sport: "mlb",
  league: "MLB",
  espnTeamSlug: "det",
  division: "AL Central",
  priority: 1,
};

function adapterWith(fetchJson = vi.fn()) {
  return createEspnAdapter({
    sport: "mlb",
    groupNameMap: { "AL Central": "American League Central" },
    deps: {
      fetchJson,
      cache: new TtlCache(),
      now: () => new Date("2026-06-20T13:00:00Z"),
    },
  });
}

describe("createEspnAdapter.getTeamSummary", () => {
  it("combines schedule games with standings-derived record and standing", async () => {
    const fetchJson = vi.fn(async (url: string) =>
      url.includes("/schedule") ? schedule : standings,
    );
    const adapter = adapterWith(fetchJson);

    const summary = await adapter.getTeamSummary(tigers);

    expect(summary.teamKey).toBe("tigers");
    expect(summary.lastGame).toMatchObject({ result: "W", score: "5-3", opponent: "CLE" });
    expect(summary.nextGame).toMatchObject({ opponent: "MIN" });
    expect(summary.record).toBe("42-34");
    expect(summary.standing).toBe("AL Central: 2nd, 2.5 GB");
    expect(summary.hasGameToday).toBe(true);
  });

  it("still returns game data when standings fetch fails (degraded)", async () => {
    const fetchJson = vi.fn(async (url: string) => {
      if (url.includes("/schedule")) return schedule;
      throw new Error("standings 503");
    });
    const adapter = adapterWith(fetchJson);

    const summary = await adapter.getTeamSummary(tigers);
    expect(summary.lastGame).toBeDefined();
    expect(summary.record).toBeUndefined();
    expect(summary.standing).toBeUndefined();
  });

  it("caches upstream calls across two summary fetches", async () => {
    const fetchJson = vi.fn(async (url: string) =>
      url.includes("/schedule") ? schedule : standings,
    );
    const adapter = adapterWith(fetchJson);

    await adapter.getTeamSummary(tigers);
    await adapter.getTeamSummary(tigers);

    // 1 schedule + 1 standings, reused on the second call.
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });
});

describe("createEspnAdapter.getStandings", () => {
  it("returns a normalized standings table tagging watched teams", async () => {
    const fetchJson = vi.fn(async () => standings);
    const adapter = adapterWith(fetchJson);

    const table = await adapter.getStandings("AL Central");
    expect(table.title).toBe("AL Central");
    expect(table.rows.find((r) => r.abbreviation === "DET")?.teamKey).toBe("tigers");
  });
});
