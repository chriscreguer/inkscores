import { describe, it, expect } from "vitest";
import {
  formatPlayoffPct,
  parseKalshiPlayoffOdds,
  createKalshiOddsAdapter,
} from "../src/adapters/kalshiOdds.js";

const sampleMarkets = {
  markets: [
    { ticker: "KXNCAAFPLAYOFF-26-OSU", last_price_dollars: "0.7700" },
    { ticker: "KXNCAAFPLAYOFF-26-IND", last_price_dollars: "0.7400" },
    { ticker: "KXNCAAFPLAYOFF-26-ILL", last_price_dollars: "0.0900" },
    { ticker: "KXNCAAFPLAYOFF-26-BAD" }, // no price -> dropped
  ],
};

describe("formatPlayoffPct", () => {
  it("rounds, and clamps the tails to <1% / >99%", () => {
    expect(formatPlayoffPct(9)).toBe("9%");
    expect(formatPlayoffPct(76.7)).toBe("77%");
    expect(formatPlayoffPct(0.5)).toBe("<1%");
    expect(formatPlayoffPct(99.9)).toBe(">99%");
    expect(formatPlayoffPct(undefined)).toBeUndefined();
  });
});

describe("parseKalshiPlayoffOdds", () => {
  it("keys make-playoff percentage by ticker suffix", () => {
    const odds = parseKalshiPlayoffOdds(sampleMarkets);
    expect(odds.OSU).toBeCloseTo(77, 0);
    expect(odds.IND).toBeCloseTo(74, 0);
    expect(odds.ILL).toBeCloseTo(9, 0);
    expect(odds.BAD).toBeUndefined();
  });

  it("returns {} for an empty markets list", () => {
    expect(parseKalshiPlayoffOdds({})).toEqual({});
  });
});

describe("createKalshiOddsAdapter", () => {
  it("re-keys Indiana's IND ticker to ESPN's IU abbreviation, keeps others as-is", async () => {
    const adapter = createKalshiOddsAdapter({
      fetchJson: async () => sampleMarkets,
    });
    const odds = await adapter.getNcaafPlayoffOdds();
    expect(odds.IU).toBeCloseTo(74, 0);
    expect(odds.OSU).toBeCloseTo(77, 0);
    expect(odds.ILL).toBeCloseTo(9, 0);
  });

  it("a team with no Kalshi market is simply absent, not 0%", async () => {
    const adapter = createKalshiOddsAdapter({
      fetchJson: async () => sampleMarkets,
    });
    const odds = await adapter.getNcaafPlayoffOdds();
    expect(odds.MSU).toBeUndefined();
  });

  it("getNflPlayoffOdds hits the NFL series and needs no abbreviation overrides", async () => {
    const nflMarkets = {
      markets: [
        { ticker: "KXNFLPLAYOFF-27-DET", last_price_dollars: "0.8100" },
        { ticker: "KXNFLPLAYOFF-27-GB", last_price_dollars: "0.6200" },
      ],
    };
    const adapter = createKalshiOddsAdapter({
      fetchJson: async (url: string) =>
        url.includes("KXNFLPLAYOFF") ? nflMarkets : sampleMarkets,
    });
    const nflOdds = await adapter.getNflPlayoffOdds();
    expect(nflOdds.DET).toBeCloseTo(81, 0);
    expect(nflOdds.GB).toBeCloseTo(62, 0);

    // The two series stay independent — NCAAF odds unaffected.
    const ncaafOdds = await adapter.getNcaafPlayoffOdds();
    expect(ncaafOdds.OSU).toBeCloseTo(77, 0);
    expect(ncaafOdds.DET).toBeUndefined();
  });
});
