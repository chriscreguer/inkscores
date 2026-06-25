import { describe, it, expect } from "vitest";
import { buildLiveDashboard } from "../src/service.js";
import { getTeamByKey } from "../src/config.js";
import { standingsKey } from "../src/dashboardBuilder.js";
import type {
  SportsAdapter,
  StandingsTable,
  TeamSummary,
  WatchedTeam,
  Sport,
} from "../src/types.js";

const JUNE = new Date("2026-06-20T13:05:00Z");

function tigersSummary(): TeamSummary {
  return {
    teamKey: "tigers",
    label: "Tigers",
    sport: "mlb",
    lastGame: { date: "2026-06-19T23:40:00Z", opponent: "CLE", homeAway: "home", result: "W", score: "5-3" },
    record: "42-34",
    standing: "AL Central: 2nd, 2.5 GB",
  };
}

const alCentral: StandingsTable = {
  title: "AL Central",
  columns: ["#", "Team", "Record", "GB"],
  rows: [{ rank: "1", abbreviation: "DET", record: "42-34", gamesBack: "-", teamKey: "tigers" }],
};

/** A fake MLB adapter: tigers ok, cubs throws on summary. */
const fakeMlb: SportsAdapter = {
  async getTeamSummary(team: WatchedTeam) {
    if (team.key === "cubs") throw new Error("cubs upstream 500");
    return tigersSummary();
  },
  async getStandings(group: string) {
    if (group === "NL Central") throw new Error("nl standings down");
    return alCentral;
  },
};

const throwingAdapter: SportsAdapter = {
  async getTeamSummary() {
    throw new Error("out of season fetch failed");
  },
  async getStandings() {
    throw new Error("out of season standings failed");
  },
};

function registry(): Record<Sport, SportsAdapter> {
  return { mlb: fakeMlb, nba: throwingAdapter, nfl: throwingAdapter, ncaaf: throwingAdapter, ncaamb: throwingAdapter };
}

describe("buildLiveDashboard", () => {
  it("renders a dashboard despite a failing team and failing standings", async () => {
    const dash = await buildLiveDashboard({ now: JUNE, adapters: registry() });

    const titles = dash.sections.filter((s) => s.type === "teamCard").map((s: any) => s.title);
    expect(titles).toContain("Tigers"); // tigers ok
    expect(titles).toContain("Cubs"); // cubs still shown (active via June window) with placeholders

    // It did not throw, and produced a valid contract.
    expect(dash.version).toBe(1);
    expect(typeof dash.refreshAfterSeconds).toBe("number");
  });

  it("includes AL Central standings sourced from the adapter", async () => {
    const dash = await buildLiveDashboard({ now: JUNE, adapters: registry() });
    const tables = dash.sections.filter((s) => s.type === "standings").map((s: any) => s.title);
    expect(tables).toContain("AL Central");
  });

  it("debugShowAll surfaces out-of-season sports even when their fetches fail", async () => {
    const dash = await buildLiveDashboard({ now: JUNE, adapters: registry(), debugShowAll: true });
    const titles = dash.sections.filter((s) => s.type === "teamCard").map((s: any) => s.title);
    expect(titles).toContain("Pistons");
  });
});
