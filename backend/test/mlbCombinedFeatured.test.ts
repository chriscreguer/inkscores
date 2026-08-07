import { describe, it, expect } from "vitest";
import { assembleMlbCombinedFeatured } from "../src/mlbCombinedFeatured.js";
import { buildDashboard, standingsKey, type TeamData } from "../src/dashboardBuilder.js";
import { getTeamByKey } from "../src/config.js";
import type { AdapterRegistry, BuildLiveOptions } from "../src/service.js";
import type { BrefTeamStatsAdapter } from "../src/adapters/brefTeamStats.js";
import type {
  Accent,
  Dashboard,
  StandingsSection,
  StandingsTable,
  TeamCardSection,
  TeamSummary,
} from "../src/types.js";

const NOW = new Date("2026-08-07T13:00:00Z");

function summary(teamKey: string, sport: TeamSummary["sport"] = "mlb"): TeamSummary {
  const team = getTeamByKey(teamKey)!;
  return {
    teamKey,
    label: team.label,
    sport,
    lastGame: {
      date: "2026-08-06T23:40:00Z",
      opponent: "CLE",
      homeAway: "home",
      result: "W",
      score: "5-3",
    },
    record: "62-50",
    standing: "AL Central: 2nd, 2.5 GB",
  };
}

const alCentral: StandingsTable = {
  title: "AL Central",
  columns: ["#", "Team", "Record", "GB"],
  rows: [{ rank: "2", abbreviation: "DET", record: "62-50", gamesBack: "2.5", teamKey: "tigers" }],
};
const nlCentral: StandingsTable = {
  title: "NL Central",
  columns: ["#", "Team", "Record", "GB"],
  rows: [{ rank: "3", abbreviation: "CHC", record: "58-54", gamesBack: "4.5", teamKey: "cubs" }],
};

/** Just the fields assembleMlbCombinedFeatured actually reads off options. */
function baseOptions(over: Partial<BuildLiveOptions> = {}): BuildLiveOptions {
  return {
    now: NOW,
    adapters: {} as AdapterRegistry,
    ...over,
  };
}

function fakeBrefTeamStats(): BrefTeamStatsAdapter {
  return {
    async getTeamStatsTables(
      abbr: string,
      accent?: Accent,
    ): Promise<[StandingsSection, StandingsSection, StandingsSection]> {
      const table = (id: string, title: string): StandingsSection => ({
        type: "standings",
        id,
        title,
        columns: ["Name", "WAR", "X", "Y", "Z"],
        rows: [[`${abbr} Player`, "1.0", "1", "1", "1"]],
        cardIndex: 1,
        ...(accent ? { accent } : {}),
      });
      return [
        table("tigers-stats-hitting", "Hitting"),
        table("tigers-stats-starters", "Starters"),
        table("tigers-stats-pen", "Pen"),
      ];
    },
  };
}

/** Builds the base dashboard (cards + standings) that assembleMlbCombinedFeatured
 * expects to find cards in, for whichever team keys are given active summaries. */
function baseDashboard(activeKeys: string[]): Dashboard {
  const standings = new Map<string, StandingsTable>([
    [standingsKey("mlb", "AL Central"), alCentral],
    [standingsKey("mlb", "NL Central"), nlCentral],
  ]);
  const teamData: TeamData[] = [
    "tigers",
    "cubs",
    "lions",
    "pistons",
    "msu-football",
    "msu-basketball",
  ].map((key) => {
    const team = getTeamByKey(key)!;
    return {
      team,
      ...(activeKeys.includes(key) ? { summary: summary(key, team.sport) } : {}),
    };
  });
  return buildDashboard({ now: NOW, teamData, standings, debugShowAll: true });
}

function cards(d: Dashboard) {
  return d.sections.filter((s): s is TeamCardSection => s.type === "teamCard");
}
function standingsSections(d: Dashboard) {
  return d.sections.filter((s): s is StandingsSection => s.type === "standings");
}

const tigersOnly: TeamData[] = [{ team: getTeamByKey("tigers")!, summary: summary("tigers") }];
const tigersAndCubs: TeamData[] = [
  { team: getTeamByKey("tigers")!, summary: summary("tigers") },
  { team: getTeamByKey("cubs")!, summary: summary("cubs") },
];

describe("assembleMlbCombinedFeatured - tigersStatsPanel toggle", () => {
  it("swaps the Cubs slot for the Tigers stats panel when the flag is on", async () => {
    const base = baseDashboard(["tigers", "cubs"]);
    const out = await assembleMlbCombinedFeatured(
      base,
      tigersAndCubs,
      baseOptions({ tigersStatsPanel: true, brefTeamStats: fakeBrefTeamStats() }),
    );

    const titles = cards(out).map((c) => c.title);
    expect(titles).toEqual(["Tigers"]);
    expect(titles).not.toContain("Cubs");

    const rightIds = standingsSections(out)
      .filter((s) => s.cardIndex === 1)
      .map((s) => s.id);
    expect(rightIds).toEqual(["tigers-stats-hitting", "tigers-stats-starters", "tigers-stats-pen"]);
    // Tigers' own left-column division standings are untouched.
    expect(standingsSections(out).some((s) => s.id === "al-central" && s.cardIndex !== 1)).toBe(
      true,
    );
  });

  it("shows Cubs as usual when the flag is off", async () => {
    const base = baseDashboard(["tigers", "cubs"]);
    const out = await assembleMlbCombinedFeatured(base, tigersAndCubs, baseOptions());

    const titles = cards(out).map((c) => c.title);
    expect(titles).toEqual(["Tigers", "Cubs"]);
    expect(standingsSections(out).some((s) => s.id.startsWith("tigers-stats-"))).toBe(false);
  });

  it("falls back to Cubs when the flag is on but brefTeamStats isn't configured", async () => {
    const base = baseDashboard(["tigers", "cubs"]);
    const out = await assembleMlbCombinedFeatured(
      base,
      tigersAndCubs,
      baseOptions({ tigersStatsPanel: true }),
    );

    const titles = cards(out).map((c) => c.title);
    expect(titles).toEqual(["Tigers", "Cubs"]);
  });

  it("has no effect once Lions have taken the second slot", async () => {
    const lionsSummary: TeamSummary = {
      teamKey: "lions",
      label: "Lions",
      sport: "nfl",
      isLive: false,
      hasGameToday: true,
      record: "8-2",
      standing: "NFC North: 1st",
    };
    const base = baseDashboard(["tigers"]);
    const teamData: TeamData[] = [
      { team: getTeamByKey("tigers")!, summary: summary("tigers") },
      { team: getTeamByKey("cubs")!, summary: summary("cubs") },
      { team: getTeamByKey("lions")!, summary: lionsSummary },
    ];
    const out = await assembleMlbCombinedFeatured(
      base,
      teamData,
      baseOptions({ tigersStatsPanel: true, brefTeamStats: fakeBrefTeamStats() }),
    );

    const titles = cards(out).map((c) => c.title);
    expect(titles).toEqual(["Tigers", "Lions"]);
    expect(standingsSections(out).some((s) => s.id.startsWith("tigers-stats-"))).toBe(false);
  });

  it("doesn't rescue an eliminated Tigers into showing a slot", async () => {
    const base = baseDashboard(["tigers"]);
    const promise = assembleMlbCombinedFeatured(
      base,
      tigersOnly,
      baseOptions({
        tigersStatsPanel: true,
        brefTeamStats: fakeBrefTeamStats(),
        mlbStats: {
          async getPlayoffTables() {
            return [];
          },
          async getRecentForm() {
            return {};
          },
          async getHotCold() {
            return { hot: [], cold: [] };
          },
          async isEliminated() {
            return true;
          },
        },
      }),
    );

    // Eliminated Tigers + nothing else active -> no eligible slot at all,
    // same as today. The stats-panel toggle must not change that.
    await expect(promise).rejects.toThrow();
  });
});
