import { TtlCache, CACHE_TTLS } from "../cache.js";
import { canonicalAbbr } from "./mlbStats.js";

/**
 * Baseball-Reference playoff odds. Unlike FanGraphs (Cloudflare-walled and
 * unfetchable server-side), B-Ref's playoff-odds page returns its full table in
 * plain HTML with no JS challenge, so we can read it directly. The odds are real
 * make-the-postseason probabilities from 25,000 season simulations.
 *
 * B-Ref renders some tables inside HTML comments; we strip those before parsing.
 * The page HTML never leaks past this module — callers get a number per team.
 */

const BREF_BASE = "https://www.baseball-reference.com/leagues/majors";

export function brefOddsUrl(season: number): string {
  return `${BREF_BASE}/${season}-playoff-odds.shtml`;
}

/** Format a make-playoffs probability for the narrow odds column. */
export function formatOdds(pct: number | undefined): string | undefined {
  if (pct == null || !Number.isFinite(pct)) return undefined;
  if (pct < 1) return "<1%";
  if (pct > 99) return ">99%";
  return `${Math.round(pct)}%`;
}

/**
 * Parse make-playoffs probabilities from the B-Ref playoff-odds page, keyed by
 * canonical abbreviation so they join onto the Stats API playoff tables. Each
 * team row links to /teams/<ABBR>/<year>… and carries a `ppr_postseason` cell
 * like "8.2%", ">99.9%", or "<0.1%".
 */
export function parseBrefPlayoffOdds(html: string): Record<string, number> {
  const merged = String(html).replace(/<!--/g, "").replace(/-->/g, "");
  const table = merged.match(/<table[^>]*id="playoff_prob_mlb"[\s\S]*?<\/table>/);
  if (!table) return {};

  const out: Record<string, number> = {};
  const rows = table[0].match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  for (const row of rows) {
    const href = row.match(/\/teams\/([A-Z]+)\/\d{4}/);
    const cell = row.match(/data-stat="ppr_postseason"[^>]*>([\s\S]*?)<\/t[hd]>/);
    if (!href || !cell) continue;
    const raw = cell[1]!.replace(/<[^>]+>/g, "").replace(/[<>%\s]/g, "").trim();
    const pct = Number.parseFloat(raw);
    if (!Number.isFinite(pct)) continue;
    out[canonicalAbbr(href[1]!)] = pct;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Network layer
// ---------------------------------------------------------------------------

export async function fetchBrefText(url: string, timeoutMs = 8000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
    });
    if (!res.ok) throw new Error(`Baseball-Reference ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export interface BrefOddsDeps {
  fetchText?: (url: string) => Promise<string>;
  cache?: TtlCache;
  now?: () => Date;
  ttlMs?: number;
}

export interface BrefOddsAdapter {
  /** Make-playoffs probability per canonical abbreviation, e.g. { DET: 8.2 }. */
  getMakePlayoffOdds(): Promise<Record<string, number>>;
}

/** Build the B-Ref odds adapter. Odds move slowly, so they refresh on the
 * active-season TTL with stale-if-error. */
export function createBrefOddsAdapter(deps?: BrefOddsDeps): BrefOddsAdapter {
  const fetchText = deps?.fetchText ?? fetchBrefText;
  const cache = deps?.cache ?? new TtlCache();
  const now = deps?.now ?? (() => new Date());
  const ttlMs = deps?.ttlMs ?? CACHE_TTLS.activeSeason;

  async function getMakePlayoffOdds(): Promise<Record<string, number>> {
    const year = now().getUTCFullYear();
    const html = await cache.getOrLoad(`bref:odds:${year}`, ttlMs, () =>
      fetchText(brefOddsUrl(year)),
    );
    return parseBrefPlayoffOdds(html);
  }

  return { getMakePlayoffOdds };
}
