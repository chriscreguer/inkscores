import { fetchEspnJson } from "./espn.js";
import { TtlCache, CACHE_TTLS } from "../cache.js";
import { parseRecentFormFromSchedule } from "./ncaafExtras.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function scheduleUrl(teamAbbr: string, season: number): string {
  return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamAbbr}/schedule?season=${season}&seasontype=2`;
}

/** The NFL season is named for the year it kicks off in (Sept); Jan-Jun still
 * belongs to the previous season (playoffs/Super Bowl). Same convention as
 * ncaafExtras' seasonYear. */
function seasonYear(now: Date): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() + 1 <= 6 ? year - 1 : year;
}

export interface NflExtrasAdapter {
  /** Last-N-games W/L sequence per team abbreviation; best-effort, per team.
   * No AP-Top-25 equivalent here — the NFL has no poll ranking. */
  getRecentForm(teamAbbrs: string[], maxGames?: number): Promise<Record<string, string>>;
}

export function createNflExtrasAdapter(deps?: {
  cache?: TtlCache;
  now?: () => Date;
  fetchJson?: (url: string) => Promise<Any>;
}): NflExtrasAdapter {
  const cache = deps?.cache ?? new TtlCache();
  const now = deps?.now ?? (() => new Date());
  const fetchJson = deps?.fetchJson ?? fetchEspnJson;

  return {
    async getRecentForm(teamAbbrs, maxGames = 5) {
      const season = seasonYear(now());
      const out: Record<string, string> = {};
      await Promise.all(
        teamAbbrs.map(async (abbr) => {
          try {
            const json = await cache.getOrLoad(
              `nfl:schedule:${abbr}:${season}`,
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
