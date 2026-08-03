import { TtlCache, CACHE_TTLS } from "../cache.js";

/**
 * Kalshi's "will this team make the College Football Playoff" market. Public,
 * unauthenticated, real JSON (no scraping) — the CFB equivalent of the
 * Baseball-Reference playoff-odds page used for MLB. Kalshi only lists a
 * market for teams with a realistic shot, so most non-contenders (including
 * Michigan State, currently) simply have no entry — callers should treat a
 * missing key as "no data", not "0%".
 */
const KALSHI_MARKETS_URL =
  "https://external-api.kalshi.com/trade-api/v2/markets?series_ticker=KXNCAAFPLAYOFF&status=open&limit=200";

/** ESPN standings abbreviation -> Kalshi ticker suffix, only where they differ. */
const ESPN_TO_KALSHI_ABBR: Record<string, string> = {
  IU: "IND", // Indiana
};

interface KalshiMarket {
  ticker: string;
  last_price_dollars?: string;
}

interface KalshiMarketsResponse {
  markets?: KalshiMarket[];
}

/** Format a make-playoffs probability (0-100) for the narrow odds column. */
export function formatPlayoffPct(pct: number | undefined): string | undefined {
  if (pct == null || !Number.isFinite(pct)) return undefined;
  if (pct < 1) return "<1%";
  if (pct > 99) return ">99%";
  return `${Math.round(pct)}%`;
}

/** Parse Kalshi's market list into a make-playoffs percentage keyed by ticker suffix. */
export function parseKalshiPlayoffOdds(json: KalshiMarketsResponse): Record<string, number> {
  const out: Record<string, number> = {};
  for (const market of json.markets ?? []) {
    const suffix = market.ticker?.split("-").pop();
    const price = Number.parseFloat(market.last_price_dollars ?? "");
    if (!suffix || !Number.isFinite(price)) continue;
    out[suffix] = price * 100;
  }
  return out;
}

export interface KalshiOddsAdapter {
  /** Make-playoffs percentage (0-100) keyed by ESPN standings abbreviation. */
  getNcaafPlayoffOdds(): Promise<Record<string, number>>;
}

export function createKalshiOddsAdapter(deps?: {
  cache?: TtlCache;
  now?: () => Date;
  fetchJson?: (url: string) => Promise<KalshiMarketsResponse>;
}): KalshiOddsAdapter {
  const cache = deps?.cache ?? new TtlCache();
  const fetchJson =
    deps?.fetchJson ??
    (async (url: string) => {
      const res = await fetch(url, {
        headers: { "User-Agent": "InkScores/0.1 (+epaper dashboard)" },
      });
      if (!res.ok) throw new Error(`Kalshi ${res.status}`);
      return (await res.json()) as KalshiMarketsResponse;
    });

  return {
    async getNcaafPlayoffOdds() {
      const byTicker = await cache.getOrLoad("kalshi:ncaaf-playoff-odds", CACHE_TTLS.gameDay, () =>
        fetchJson(KALSHI_MARKETS_URL).then(parseKalshiPlayoffOdds),
      );
      const out: Record<string, number> = {};
      for (const [espnAbbr, kalshiSuffix] of Object.entries(ESPN_TO_KALSHI_ABBR)) {
        if (byTicker[kalshiSuffix] != null) out[espnAbbr] = byTicker[kalshiSuffix]!;
      }
      for (const [ticker, pct] of Object.entries(byTicker)) {
        if (out[ticker] == null) out[ticker] = pct;
      }
      return out;
    },
  };
}
