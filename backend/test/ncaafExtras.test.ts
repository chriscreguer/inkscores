import { describe, it, expect } from "vitest";
import {
  parseApTop25,
  parseRecentFormFromSchedule,
  createNcaafExtrasAdapter,
} from "../src/adapters/ncaafExtras.js";

const sampleRankings = {
  rankings: [
    {
      name: "AP Top 25",
      ranks: [
        { current: 1, team: { abbreviation: "IU" } },
        { current: 5, team: { abbreviation: "OSU" } },
        { current: 21, team: { abbreviation: "MICH" } },
      ],
    },
  ],
};

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

describe("parseApTop25", () => {
  it("keys current rank by ESPN abbreviation", () => {
    const ranks = parseApTop25(sampleRankings);
    expect(ranks.IU).toBe(1);
    expect(ranks.OSU).toBe(5);
    expect(ranks.MICH).toBe(21);
  });

  it("returns {} when there's no AP poll present", () => {
    expect(parseApTop25({})).toEqual({});
  });
});

describe("parseRecentFormFromSchedule", () => {
  it("orders completed games oldest-first and caps at maxGames", () => {
    const schedule = {
      events: [
        completedEvent("2026-09-05T00:00Z", "MSU", true),
        completedEvent("2026-09-12T00:00Z", "MSU", false),
        completedEvent("2026-09-19T00:00Z", "MSU", true),
        { date: "2026-09-26T00:00Z", competitions: [{ status: { type: { state: "pre", completed: false } }, competitors: [] }] },
      ],
    };
    expect(parseRecentFormFromSchedule(schedule, "MSU", 2)).toBe("LW");
    expect(parseRecentFormFromSchedule(schedule, "MSU", 10)).toBe("WLW");
  });

  it("returns an empty string when the team has no completed games", () => {
    const schedule = { events: [] };
    expect(parseRecentFormFromSchedule(schedule, "MSU", 5)).toBe("");
  });
});

describe("createNcaafExtrasAdapter", () => {
  it("fetches per-team form, keyed by abbreviation, best-effort on failure", async () => {
    const adapter = createNcaafExtrasAdapter({
      now: () => new Date("2026-08-03T00:00:00Z"),
      fetchJson: async (url: string) => {
        if (url.includes("rankings")) return sampleRankings;
        if (url.includes("/MSU/")) {
          return { events: [completedEvent("2026-09-05T00:00Z", "MSU", true)] };
        }
        throw new Error("network down");
      },
    });

    const ranks = await adapter.getApTop25Ranks();
    expect(ranks.OSU).toBe(5);

    const form = await adapter.getRecentForm(["MSU", "OSU"], 5);
    expect(form.MSU).toBe("W");
    expect(form.OSU).toBeUndefined(); // fetch throws -> best-effort omission
  });
});
