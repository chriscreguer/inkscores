import { describe, it, expect } from "vitest";
import { formatLastGame, formatNextGame } from "../src/formatters/games.js";
import type { NormalizedGame } from "../src/types.js";

describe("formatLastGame", () => {
  it("formats a home win as 'W 5-3 vs CLE'", () => {
    const g: NormalizedGame = {
      date: "2026-06-19T23:40:00Z",
      opponent: "CLE",
      homeAway: "home",
      result: "W",
      score: "5-3",
    };
    expect(formatLastGame(g)).toBe("W 5-3 vs CLE");
  });

  it("formats an away loss as 'L 4-2 @ STL'", () => {
    const g: NormalizedGame = {
      date: "2026-06-19T18:20:00Z",
      opponent: "STL",
      homeAway: "away",
      result: "L",
      score: "4-2",
    };
    expect(formatLastGame(g)).toBe("L 4-2 @ STL");
  });

  it("returns undefined when there is no last game", () => {
    expect(formatLastGame(undefined)).toBeUndefined();
  });
});

describe("formatNextGame", () => {
  it("uses displayTime and home indicator: 'Tonight 6:40 vs MIN'", () => {
    const g: NormalizedGame = {
      date: "2026-06-20T23:40:00Z",
      opponent: "MIN",
      homeAway: "home",
      displayTime: "Tonight 6:40",
    };
    expect(formatNextGame(g)).toBe("Tonight 6:40 vs MIN");
  });

  it("uses away indicator: 'Today 1:20 @ STL'", () => {
    const g: NormalizedGame = {
      date: "2026-06-20T18:20:00Z",
      opponent: "STL",
      homeAway: "away",
      displayTime: "Today 1:20",
    };
    expect(formatNextGame(g)).toBe("Today 1:20 @ STL");
  });

  it("returns undefined when there is no next game", () => {
    expect(formatNextGame(undefined)).toBeUndefined();
  });
});
