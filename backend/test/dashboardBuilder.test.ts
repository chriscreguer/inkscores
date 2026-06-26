import { describe, it, expect } from "vitest";
import { buildDashboard, standingsKey } from "../src/dashboardBuilder.js";
import { WATCHED_TEAMS, getTeamByKey } from "../src/config.js";
import type {
  StandingsTable,
  TeamSummary,
  TeamCardSection,
  StandingsSection,
  MessageSection,
  DashboardSection,
} from "../src/types.js";

const JUNE = new Date("2026-06-20T13:05:00Z");

function summary(teamKey: string, over: Partial<TeamSummary> = {}): TeamSummary {
  const team = getTeamByKey(teamKey)!;
  return {
    teamKey,
    label: team.label,
    sport: team.sport,
    lastGame: {
      date: "2026-06-19T23:40:00Z",
      opponent: "CLE",
      homeAway: "home",
      result: "W",
      score: "5-3",
    },
    nextGame: {
      date: "2026-06-20T23:40:00Z",
      opponent: "MIN",
      homeAway: "home",
      displayTime: "Tonight 6:40",
    },
    record: "42-34",
    standing: "AL Central: 2nd, 2.5 GB",
    ...over,
  };
}

function alCentral(): StandingsTable {
  return {
    title: "AL Central",
    columns: ["#", "Team", "Record", "GB"],
    rows: [
      { rank: "1", abbreviation: "CLE", record: "44-31", gamesBack: "-" },
      { rank: "2", abbreviation: "DET", record: "42-34", gamesBack: "2.5", teamKey: "tigers" },
      { rank: "3", abbreviation: "KC", record: "38-38", gamesBack: "6.5" },
      { rank: "4", abbreviation: "MIN", record: "36-40", gamesBack: "8.5" },
      { rank: "5", abbreviation: "CWS", record: "28-48", gamesBack: "16.5" },
    ],
  };
}

function nlCentral(): StandingsTable {
  return {
    title: "NL Central",
    columns: ["#", "Team", "Record", "GB"],
    rows: [
      { rank: "1", abbreviation: "MIL", record: "43-32", gamesBack: "-" },
      { rank: "2", abbreviation: "STL", record: "41-35", gamesBack: "2.5" },
      { rank: "3", abbreviation: "CHC", record: "39-37", gamesBack: "4.5", teamKey: "cubs" },
      { rank: "4", abbreviation: "CIN", record: "36-40", gamesBack: "7.5" },
      { rank: "5", abbreviation: "PIT", record: "31-45", gamesBack: "12.5" },
    ],
  };
}

const cards = (d: { sections: DashboardSection[] }) =>
  d.sections.filter((s): s is TeamCardSection => s.type === "teamCard");
const standings = (d: { sections: DashboardSection[] }) =>
  d.sections.filter((s): s is StandingsSection => s.type === "standings");
const messages = (d: { sections: DashboardSection[] }) =>
  d.sections.filter((s): s is MessageSection => s.type === "message");

describe("buildDashboard - MLB in June", () => {
  const input = {
    now: JUNE,
    teamData: WATCHED_TEAMS.map((team) => ({
      team,
      summary: team.sport === "mlb" ? summary(team.key) : undefined,
    })),
    standings: new Map<string, StandingsTable>([
      [standingsKey("mlb", "AL Central"), alCentral()],
      [standingsKey("mlb", "NL Central"), nlCentral()],
    ]),
  };

  it("has the required top-level contract fields", () => {
    const d = buildDashboard(input);
    expect(d.version).toBe(1);
    expect(typeof d.updatedAt).toBe("string");
    expect(typeof d.refreshAfterSeconds).toBe("number");
    expect(Array.isArray(d.sections)).toBe(true);
  });

  it("renders Tigers and Cubs cards only (NBA/NCAA hidden in June)", () => {
    const d = buildDashboard(input);
    const titles = cards(d).map((c) => c.title);
    expect(titles).toEqual(["Tigers", "Cubs"]);
  });

  it("formats the Tigers card from its summary", () => {
    const d = buildDashboard(input);
    const tigers = cards(d).find((c) => c.title === "Tigers")!;
    expect(tigers.last).toBe("W 5-3 vs CLE");
    expect(tigers.next).toBe("Tonight 6:40 vs MIN");
    expect(tigers.record).toBe("42-34");
    expect(tigers.accent).toBe("blue");
    expect(tigers.badge).toBe("D");
    expect(tigers.logoUrl).toContain("/mlb/500/det.png");
  });

  it("renders AL Central and NL Central standings with highlights", () => {
    const d = buildDashboard(input);
    const tables = standings(d);
    expect(tables.map((t) => t.title)).toEqual(["AL Central", "NL Central"]);
    const al = tables[0]!;
    expect(al.rows).toHaveLength(5);
    expect(al.highlightTeamKeys).toContain("tigers");
    // DET (tigers) sits at row index 1; section carries the team accent.
    expect(al.highlightRows).toEqual([1]);
    expect(al.accent).toBe("blue");
  });

  it("schedules the next wake on the daily schedule when no live game", () => {
    // JUNE is 08:05 CT -> next scheduled wake is the 09:00 morning wake (55 min).
    const d = buildDashboard(input);
    expect(d.refreshAfterSeconds).toBe(3300);
  });
});

describe("buildDashboard - season hiding", () => {
  it("shows a single offseason message when nothing is active", () => {
    const d = buildDashboard({
      now: JUNE,
      teamData: WATCHED_TEAMS.filter((t) => t.sport !== "mlb").map((team) => ({
        team,
        summary: undefined,
      })),
      standings: new Map(),
    });
    expect(cards(d)).toHaveLength(0);
    const msgs = messages(d);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.id).toBe("offseason");
  });

  it("debug showAll forces inactive teams to render", () => {
    const d = buildDashboard({
      now: JUNE,
      teamData: WATCHED_TEAMS.map((team) => ({ team, summary: undefined })),
      standings: new Map(),
      debugShowAll: true,
    });
    expect(cards(d).length).toBe(WATCHED_TEAMS.length);
  });
});

describe("buildDashboard - refresh + live", () => {
  it("uses a 10-minute refresh when any active team is live", () => {
    const d = buildDashboard({
      now: JUNE,
      teamData: [{ team: getTeamByKey("tigers")!, summary: summary("tigers", { isLive: true }) }],
      standings: new Map([[standingsKey("mlb", "AL Central"), alCentral()]]),
    });
    expect(d.refreshAfterSeconds).toBe(600);
    const tigers = cards(d)[0]!;
    expect(tigers.status).toBe("live");
  });
});

describe("buildDashboard - degraded data", () => {
  it("renders team cards plus a message when standings are missing", () => {
    const d = buildDashboard({
      now: JUNE,
      teamData: [{ team: getTeamByKey("tigers")!, summary: summary("tigers") }],
      standings: new Map(), // no standings available
    });
    expect(cards(d)).toHaveLength(1);
    expect(messages(d).length).toBeGreaterThanOrEqual(1);
  });

  it("does not crash and still renders others when one summary is missing", () => {
    const d = buildDashboard({
      now: JUNE,
      teamData: [
        { team: getTeamByKey("tigers")!, summary: summary("tigers") },
        { team: getTeamByKey("cubs")!, summary: undefined }, // cubs fetch failed
      ],
      standings: new Map([[standingsKey("mlb", "AL Central"), alCentral()]]),
      debugShowAll: true,
    });
    const titles = cards(d).map((c) => c.title);
    expect(titles).toContain("Tigers");
    expect(titles).toContain("Cubs");
    const cubs = cards(d).find((c) => c.title === "Cubs")!;
    expect(cubs.last).toBe("—"); // missing data renders em dash, not a crash
  });
});
