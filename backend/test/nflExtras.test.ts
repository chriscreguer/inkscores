import { describe, it, expect } from "vitest";
import { createNflExtrasAdapter } from "../src/adapters/nflExtras.js";

function completedEvent(date: string, usAbbr: string, usWon: boolean) {
  return {
    date,
    competitions: [
      {
        status: { type: { state: "post", completed: true } },
        competitors: [
          { team: { abbreviation: usAbbr }, winner: usWon },
          { team: { abbreviation: "OPP" }, winner: !usWon },
        ],
      },
    ],
  };
}

describe("createNflExtrasAdapter", () => {
  it("fetches per-team form from the NFL schedule endpoint, keyed by abbreviation", async () => {
    const adapter = createNflExtrasAdapter({
      now: () => new Date("2026-11-01T00:00:00Z"),
      fetchJson: async (url: string) => {
        expect(url).toContain("/sports/football/nfl/teams/DET/schedule");
        expect(url).toContain("season=2026");
        return { events: [completedEvent("2026-09-08T00:00Z", "DET", true)] };
      },
    });
    const form = await adapter.getRecentForm(["DET"], 5);
    expect(form.DET).toBe("W");
  });

  it("best-effort per team: a fetch failure just omits that team", async () => {
    const adapter = createNflExtrasAdapter({
      now: () => new Date("2026-11-01T00:00:00Z"),
      fetchJson: async () => {
        throw new Error("network down");
      },
    });
    expect(await adapter.getRecentForm(["DET"], 5)).toEqual({});
  });
});
