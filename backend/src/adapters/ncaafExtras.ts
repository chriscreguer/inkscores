import { fetchEspnJson } from "./espn.js";
import { TtlCache, CACHE_TTLS } from "../cache.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const RANKINGS_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings";

function scheduleUrl(teamAbbr: string, season: number): string {
  return `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${teamAbbr}/schedule?season=${season}&seasontype=2`;
}

/** The CFB season is named for the year it kicks off in; Jan-Jun still belongs
 * to the previous fall's season (bowls/playoff). */
function seasonYear(now: Date): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() + 1 <= 6 ? year - 1 : year;
}

/** AP Top 25 current rank keyed by ESPN standings abbreviation (e.g. "OSU": 5). */
export function parseApTop25(json: Any): Record<string, number> {
  const ranks: Any[] = json?.rankings?.[0]?.ranks ?? [];
  const out: Record<string, number> = {};
  for (const r of ranks) {
    const abbr = r?.team?.abbreviation;
    const current = r?.current;
    if (typeof abbr === "string" && Number.isFinite(current)) out[abbr] = current;
  }
  return out;
}

/**
 * Last `maxGames` completed-game W/L results for one team, oldest first (same
 * convention as MLB's recent-form dots). ESPN's Big Ten standings stats don't
 * include a "Last Ten Games" style field the way MLB's do, so this walks the
 * team's own schedule and derives it from each finished game's winner flag.
 */
export function parseRecentFormFromSchedule(
  json: Any,
  teamAbbr: string,
  maxGames: number,
): string {
  const events: Any[] = json?.events ?? [];
  const results: { date: string; result: "W" | "L" }[] = [];

  for (const ev of events) {
    const comp = ev?.competitions?.[0];
    const type = comp?.status?.type;
    if (type?.state !== "post" || type?.completed !== true) continue;

    const competitors: Any[] = comp?.competitors ?? [];
    const us = competitors.find((c) => c?.team?.abbreviation === teamAbbr);
    if (!us) continue;
    if (us.winner === true) results.push({ date: ev.date, result: "W" });
    else if (competitors.some((c) => c !== us && c.winner === true)) {
      results.push({ date: ev.date, result: "L" });
    }
    // Ties are vanishingly rare in modern CFB (OT resolves them) and aren't a
    // valid form-dot value, so they're dropped rather than mis-colored.
  }

  results.sort((a, b) => a.date.localeCompare(b.date));
  return results
    .slice(-maxGames)
    .map((r) => r.result)
    .join("");
}

export interface NcaafExtrasAdapter {
  getApTop25Ranks(): Promise<Record<string, number>>;
  /** Last-N-games W/L sequence per team abbreviation; best-effort, per team. */
  getRecentForm(teamAbbrs: string[], maxGames?: number): Promise<Record<string, string>>;
}

export function createNcaafExtrasAdapter(deps?: {
  cache?: TtlCache;
  now?: () => Date;
  fetchJson?: (url: string) => Promise<Any>;
}): NcaafExtrasAdapter {
  const cache = deps?.cache ?? new TtlCache();
  const now = deps?.now ?? (() => new Date());
  const fetchJson = deps?.fetchJson ?? fetchEspnJson;

  return {
    async getApTop25Ranks() {
      return cache.getOrLoad("ncaaf:ap-top-25", CACHE_TTLS.gameDay, () =>
        fetchJson(RANKINGS_URL).then(parseApTop25),
      );
    },

    async getRecentForm(teamAbbrs, maxGames = 5) {
      const season = seasonYear(now());
      const out: Record<string, string> = {};
      await Promise.all(
        teamAbbrs.map(async (abbr) => {
          try {
            const json = await cache.getOrLoad(
              `ncaaf:schedule:${abbr}:${season}`,
              CACHE_TTLS.gameDay,
              () => fetchJson(scheduleUrl(abbr, season)),
            );
            const form = parseRecentFormFromSchedule(json, abbr, maxGames);
            if (form) out[abbr] = form;
          } catch {
            // best-effort per team; a missing team just has no form column
          }
        }),
      );
      return out;
    },
  };
}
