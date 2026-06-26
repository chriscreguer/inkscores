import { describe, it, expect } from "vitest";
import {
  scorebugLastLine,
  buildFeaturedCard,
  assembleFeatured,
  isFeaturedEligible,
  withFormColumn,
  type FeaturedTeamInput,
} from "../src/featured.js";
import type {
  Dashboard,
  TeamCardSection,
  StandingsSection,
  WatchedTeam,
} from "../src/types.js";

const tigers: WatchedTeam = {
  key: "tigers",
  label: "Tigers",
  fullName: "Detroit Tigers",
  sport: "mlb",
  league: "MLB",
  espnTeamSlug: "det",
  division: "AL Central",
  priority: 1,
  accent: "blue",
};

describe("scorebugLastLine", () => {
  it("keeps an away win in watched-team score order", () => {
    expect(
      scorebugLastLine({ date: "x", opponent: "CLE", homeAway: "away", result: "W", score: "5-3" }),
    ).toBe("W 5-3 @ CLE");
  });
  it("keeps a home loss in watched-team score order", () => {
    expect(
      scorebugLastLine({ date: "x", opponent: "NYY", homeAway: "home", result: "L", score: "2-3" }),
    ).toBe("L 2-3 vs NYY");
  });
  it("keeps an away loss in watched-team score order", () => {
    expect(
      scorebugLastLine({ date: "x", opponent: "STL", homeAway: "away", result: "L", score: "4-7" }),
    ).toBe("L 4-7 @ STL");
  });
  it("falls back to the plain formatter when there is no numeric score", () => {
    expect(
      scorebugLastLine({ date: "x", opponent: "MIN", homeAway: "home" }),
    ).toBe("vs MIN");
  });
});

describe("buildFeaturedCard", () => {
  const baseCard: TeamCardSection = {
    type: "teamCard",
    id: "tigers-card",
    title: "Tigers",
    status: "active",
    last: "L 2-3 vs NYY",
    accent: "blue",
  };

  it("turns a completed game into a scorebug with editorial", () => {
    const card = buildFeaturedCard({
      card: baseCard,
      team: tigers,
      summary: {
        teamKey: "tigers",
        label: "Tigers",
        sport: "mlb",
        lastGame: { date: "2026-06-24", opponent: "NYY", homeAway: "home", result: "L", score: "2-3" },
      },
      editorial: { summary: "Bats went quiet late." },
      hot: ["Greene"],
      cold: ["Baez"],
    });
    expect(card.cardVariant).toBe("scorebug");
    expect(card.teamAbbr).toBe("DET");
    expect(card.scorebugOpponent).toBe("NYY");
    expect(card.last).toBe("L 2-3 vs NYY");
    expect(card.lastGame).toEqual({ date: "2026-06-24" });
    expect(card.summary).toBe("Bats went quiet late.");
    expect(card.hot).toEqual(["Greene"]);
    expect(card.cold).toEqual(["Baez"]);
  });

  it("keeps the live treatment for an in-progress game", () => {
    const card = buildFeaturedCard({
      card: { ...baseCard, status: "live", live: { score: "3-2", opponent: "MIN" } },
      team: tigers,
      summary: {
        teamKey: "tigers",
        label: "Tigers",
        sport: "mlb",
        isLive: true,
        live: { score: "3-2", opponent: "MIN" },
      },
      editorial: { summary: "should be ignored while live" },
    });
    expect(card.status).toBe("live");
    expect(card.cardVariant).toBeUndefined();
    expect(card.summary).toBeUndefined();
  });
});

describe("isFeaturedEligible", () => {
  const card: TeamCardSection = { type: "teamCard", id: "tigers-card", title: "Tigers", status: "active" };
  const al: StandingsSection = { type: "standings", id: "al-central", title: "AL Central", columns: [], rows: [] };
  const nba: StandingsSection = { type: "standings", id: "eastern", title: "East", columns: [], rows: [] };

  it("is true for an MLB-only view", () => {
    expect(isFeaturedEligible({ version: 1, refreshAfterSeconds: 0, sections: [card, al] } as Dashboard)).toBe(true);
  });
  it("is false when a non-MLB standings table is present", () => {
    expect(isFeaturedEligible({ version: 1, refreshAfterSeconds: 0, sections: [card, nba] } as Dashboard)).toBe(false);
  });
  it("is false with no team cards", () => {
    expect(isFeaturedEligible({ version: 1, refreshAfterSeconds: 0, sections: [al] } as Dashboard)).toBe(false);
  });
});

describe("withFormColumn", () => {
  const table: StandingsSection = {
    type: "standings",
    id: "al-central",
    title: "AL Central",
    columns: ["#", "Team", "Record", "GB", "L10"],
    rows: [
      ["1", "CHW", "41-38", "-", "4-6"], // ESPN abbr -> canonical CWS
      ["2", "DET", "34-46", "7.5", "5-5"],
    ],
  };

  it("replaces the record column with last-10 form dots, joining on canonical abbr", () => {
    const out = withFormColumn(table, { CWS: "WLWWLWLWWL", DET: "LLWLWWLWLW" });
    expect(out.columns[4]).toBe("L10");
    expect(out.rows[0]![4]).toBe("WLWWLWLWWL"); // CHW matched via canonical CWS
    expect(out.rows[1]![4]).toBe("LLWLWWLWLW");
  });

  it("leaves a row untouched when no form is available", () => {
    const out = withFormColumn(table, { DET: "LLWLW" });
    expect(out.rows[0]![4]).toBe("4-6"); // CHW keeps its record
    expect(out.rows[1]![4]).toBe("LLWLW");
  });

  it("is a no-op when there is no form column", () => {
    const noForm: StandingsSection = { ...table, columns: ["#", "Team", "Record", "GB"], rows: [["1", "DET", "34-46", "7.5"]] };
    expect(withFormColumn(noForm, { DET: "WWWWW" })).toEqual(noForm);
  });
});

describe("assembleFeatured", () => {
  const card: TeamCardSection = { type: "teamCard", id: "tigers-card", title: "Tigers", status: "active" };
  const alCentral: StandingsSection = { type: "standings", id: "al-central", title: "AL Central", columns: ["#"], rows: [["1"]] };
  const base: Dashboard = {
    version: 1,
    updatedAt: "2026-06-25T00:00:00Z",
    refreshAfterSeconds: 7200,
    theme: { mode: "epaper-color", density: "compact" },
    sections: [card, alCentral],
    footer: "Updated",
  };
  const playoff: StandingsSection = { type: "standings", id: "al-playoff", title: "AL Playoff", columns: ["#"], rows: [["1"]] };
  const teams: FeaturedTeamInput[] = [{ card, team: tigers }];

  it("produces the team-comparison theme with cards, division and playoff tables", () => {
    const out = assembleFeatured({ base, teams, playoffTables: [playoff] });
    expect(out.theme?.layout).toBe("team-comparison");
    expect(out.theme?.cardHeight).toBe(132);
    const ids = out.sections.map((s) => s.id);
    expect(ids).toEqual(["tigers-card", "al-central", "al-playoff"]);
    // base meta preserved
    expect(out.refreshAfterSeconds).toBe(7200);
    expect(out.footer).toBe("Updated");
  });
});
