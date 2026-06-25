import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseBrefPlayoffOdds,
  formatOdds,
  createBrefOddsAdapter,
} from "../src/adapters/brefOdds.js";

const html = readFileSync(
  fileURLToPath(new URL("../fixtures/bref-playoff-odds.html", import.meta.url)),
  "utf8",
);

describe("formatOdds", () => {
  it("rounds, and clamps the tails to <1% / >99%", () => {
    expect(formatOdds(8.2)).toBe("8%");
    expect(formatOdds(56.7)).toBe("57%");
    expect(formatOdds(0.1)).toBe("<1%");
    expect(formatOdds(99.95)).toBe(">99%");
    expect(formatOdds(undefined)).toBeUndefined();
  });
});

describe("parseBrefPlayoffOdds", () => {
  const odds = parseBrefPlayoffOdds(html);

  it("reads make-playoffs % from the comment-wrapped table, keyed by canonical abbr", () => {
    expect(odds.DET).toBeCloseTo(8.2, 1);
    expect(odds.NYY).toBeGreaterThan(99);
    expect(odds.CHC).toBeCloseTo(56.7, 1);
    // CHW canonicalises to CWS, KCR to KC
    expect(odds.CWS).toBeCloseTo(67.3, 1);
    expect(odds.KC).toBeCloseTo(7.8, 1);
  });

  it("returns {} for markup without the playoff table", () => {
    expect(parseBrefPlayoffOdds("<html>no table</html>")).toEqual({});
  });
});

describe("createBrefOddsAdapter", () => {
  it("fetches and parses via injected fetchText (no network)", async () => {
    const adapter = createBrefOddsAdapter({
      fetchText: async () => html,
      now: () => new Date("2026-06-25T12:00:00Z"),
    });
    const odds = await adapter.getMakePlayoffOdds();
    expect(odds.DET).toBeCloseTo(8.2, 1);
  });
});
