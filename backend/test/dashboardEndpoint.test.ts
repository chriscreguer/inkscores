import { describe, it, expect } from "vitest";
import { resolveDashboardResponse } from "../src/dashboardEndpoint.js";
import type { AdapterRegistry } from "../src/service.js";
import type { Dashboard, SportsAdapter, Sport } from "../src/types.js";

const JUNE = new Date("2026-06-20T13:05:00Z");

const okAdapter: SportsAdapter = {
  async getTeamSummary(team) {
    return { teamKey: team.key, label: team.label, sport: team.sport, record: "42-34" };
  },
  async getStandings(group) {
    return {
      title: group,
      columns: ["#", "Team", "Record", "GB"],
      rows: [{ rank: "1", abbreviation: "DET", record: "42-34", gamesBack: "-", teamKey: "tigers" }],
    };
  },
};

const explodingAdapter: SportsAdapter = {
  async getTeamSummary() {
    throw new Error("boom");
  },
  async getStandings() {
    throw new Error("boom");
  },
};

function registry(a: SportsAdapter): AdapterRegistry {
  return { mlb: a, nba: a, nfl: a, ncaaf: a, ncaamb: a } as Record<Sport, SportsAdapter>;
}

const mlbMock = { version: 1, refreshAfterSeconds: 7200, sections: [{ type: "teamCard", title: "Tigers" }] } as unknown as Dashboard;

describe("resolveDashboardResponse", () => {
  it("returns the MLB mock when mock=mlb, without calling adapters", async () => {
    const r = await resolveDashboardResponse({
      query: { mock: "mlb" },
      adapters: registry(okAdapter),
      now: JUNE,
      loadMock: (name) => (name === "mlb" ? mlbMock : undefined),
    });
    expect(r.dashboard).toBe(mlbMock);
    expect(r.cacheControlSeconds).toBe(7200);
  });

  it("builds a live dashboard in normal mode", async () => {
    const r = await resolveDashboardResponse({
      query: {},
      adapters: registry(okAdapter),
      now: JUNE,
      loadMock: () => undefined,
    });
    const titles = r.dashboard.sections.filter((s) => s.type === "teamCard").map((s: any) => s.title);
    expect(titles).toContain("Tigers");
    expect(r.cacheControlSeconds).toBe(r.dashboard.refreshAfterSeconds);
  });

  it("passes debug=all through as showAll", async () => {
    const r = await resolveDashboardResponse({
      query: { debug: "all" },
      adapters: registry(okAdapter),
      now: JUNE,
      loadMock: () => undefined,
    });
    const titles = r.dashboard.sections.filter((s) => s.type === "teamCard").map((s: any) => s.title);
    expect(titles).toContain("Pistons"); // out of season but forced
  });

  it("never throws: returns a degraded message dashboard when everything fails", async () => {
    const r = await resolveDashboardResponse({
      query: {},
      adapters: registry(explodingAdapter),
      now: JUNE,
      loadMock: () => undefined,
      // Force the whole build to throw by giving a bad builder hook.
      buildOverride: async () => {
        throw new Error("total failure");
      },
    });
    expect(r.dashboard.version).toBe(1);
    expect(r.dashboard.sections.some((s) => s.type === "message")).toBe(true);
    expect(typeof r.dashboard.refreshAfterSeconds).toBe("number");
  });
});
