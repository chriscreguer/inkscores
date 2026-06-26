import { buildDashboard, standingsKey, type TeamData } from "./dashboardBuilder.js";
import { getRefreshAfterSeconds } from "./activeSeasons.js";
import { WATCHED_TEAMS, DEFAULT_TIMEZONE } from "./config.js";
import { TtlCache } from "./cache.js";
import { createMlbAdapter } from "./adapters/mlb.js";
import { createNbaAdapter } from "./adapters/nba.js";
import { createNflAdapter } from "./adapters/nfl.js";
import { createNcaafAdapter } from "./adapters/ncaaf.js";
import { createNcaambAdapter } from "./adapters/ncaamb.js";
import { createMlbStatsAdapter, type MlbStatsAdapter } from "./adapters/mlbStats.js";
import { createBrefOddsAdapter, type BrefOddsAdapter } from "./adapters/brefOdds.js";
import {
  createEditorialClient,
  fileStore,
  type EditorialClient,
} from "./llm/editorial.js";
import {
  assembleFeatured,
  isFeaturedEligible,
  type FeaturedTeamInput,
} from "./featured.js";
import type {
  Sport,
  SportsAdapter,
  StandingsTable,
  Dashboard,
  DashboardSection,
  TeamCardSection,
  WatchedTeam,
} from "./types.js";

export type AdapterRegistry = Record<Sport, SportsAdapter>;

export interface BuildLiveOptions {
  now?: Date;
  timezone?: string;
  adapters: AdapterRegistry;
  debugShowAll?: boolean;
  debugSports?: Sport[];
  /** When provided, MLB-only views are rendered as the rich Featured layout. */
  mlbStats?: MlbStatsAdapter;
  /** Optional editorial (recap + hot/cold) source for Featured cards. */
  editorial?: EditorialClient;
  /** Optional real make-playoffs odds (B-Ref) for the playoff-table column. */
  brefOdds?: BrefOddsAdapter;
  /** Debug: regenerate editorial synchronously, bypassing the per-game cache. */
  forceEditorial?: boolean;
}

/** Featured services bundled separately from the per-sport adapter registry. */
export interface FeaturedServices {
  mlbStats: MlbStatsAdapter;
  editorial: EditorialClient;
  brefOdds: BrefOddsAdapter;
}

function groupOf(team: WatchedTeam): string | undefined {
  return team.division ?? team.standingsGroup;
}

/**
 * Fetch every watched team's summary and the relevant standings through the
 * adapters, then assemble the dashboard. Every upstream call is isolated with
 * allSettled so a single failure degrades that section instead of the whole
 * response.
 */
export async function buildLiveDashboard(
  options: BuildLiveOptions,
): Promise<Dashboard> {
  const now = options.now ?? new Date();
  const teams = WATCHED_TEAMS;

  // 1. Team summaries (one per watched team), failures -> undefined.
  const summaryResults = await Promise.allSettled(
    teams.map((team) => {
      const adapter = options.adapters[team.sport];
      return adapter
        ? adapter.getTeamSummary(team)
        : Promise.reject(new Error(`no adapter for ${team.sport}`));
    }),
  );
  const teamData: TeamData[] = teams.map((team, i) => {
    const r = summaryResults[i];
    return r && r.status === "fulfilled"
      ? { team, summary: r.value }
      : { team };
  });

  // 2. Standings, one fetch per distinct (sport, group). Reuses cached raw
  //    responses warmed by the summary calls above.
  const groupTargets = new Map<string, { sport: Sport; group: string }>();
  for (const team of teams) {
    const group = groupOf(team);
    if (!group) continue;
    groupTargets.set(standingsKey(team.sport, group), { sport: team.sport, group });
  }

  const standings = new Map<string, StandingsTable>();
  await Promise.allSettled(
    [...groupTargets].map(async ([key, { sport, group }]) => {
      const adapter = options.adapters[sport];
      if (!adapter) return;
      const table = await adapter.getStandings(group);
      standings.set(key, table);
    }),
  );

  // 3. Assemble.
  const dashboard = buildDashboard({
    now,
    timezone: options.timezone ?? DEFAULT_TIMEZONE,
    teamData,
    standings,
    ...(options.debugShowAll ? { debugShowAll: true } : {}),
    ...(options.debugSports ? { debugSports: options.debugSports } : {}),
  });

  // 4. The default for an MLB-only view is the rich Featured layout: scorebug
  //    cards with an LLM recap + hot/cold, division and (real, Stats API)
  //    playoff tables stacked per team. Falls back to the plain MLB view if the
  //    featured services aren't wired or anything in the enrichment fails.
  if (options.mlbStats && isFeaturedEligible(dashboard)) {
    try {
      return await assembleFeaturedDashboard(dashboard, teamData, options);
    } catch {
      // fall through to the plain MLB view below
    }
  }

  // 5. Otherwise MLB-only views still get wild-card races + division leaders in
  //    the spare bottom space, computed from the standings tree already fetched.
  await appendMlbExtras(dashboard, options.adapters);

  return dashboard;
}

/** Map an "AL Central"/"NL Central" division to its league code. */
function leagueOf(team: WatchedTeam): "AL" | "NL" | undefined {
  const div = team.division ?? "";
  if (div.startsWith("AL")) return "AL";
  if (div.startsWith("NL")) return "NL";
  return undefined;
}

/** Enrich the plain MLB dashboard into the Featured layout. */
async function assembleFeaturedDashboard(
  base: Dashboard,
  teamData: TeamData[],
  options: BuildLiveOptions,
): Promise<Dashboard> {
  const byKey = new Map(teamData.map((d) => [d.team.key, d] as const));
  const cards = base.sections.filter(
    (s): s is TeamCardSection => s.type === "teamCard",
  );

  const teams: FeaturedTeamInput[] = [];
  const watched: Partial<Record<"AL" | "NL", string>> = {};
  let accent: WatchedTeam["accent"];

  for (const card of cards) {
    const key = card.id.replace(/-card$/, "");
    const data = byKey.get(key);
    if (!data || data.team.sport !== "mlb") continue;
    teams.push({ card, team: data.team, ...(data.summary ? { summary: data.summary } : {}) });
    const league = leagueOf(data.team);
    if (league) watched[league] = data.team.espnTeamSlug.toUpperCase();
    accent = accent ?? data.team.accent;
  }

  // Editorial (recap + hot/cold) per team — non-blocking. Serve the cached
  // result if present; otherwise leave the card to show its stat-line fallback
  // and generate in the background, so a slow OpenAI call never delays (or times
  // out) the device fetch. Skipped for a live game: the live card replaces the
  // recap. `awaitingEditorial` shortens the next refresh so the recap lands soon.
  let awaitingEditorial = false;
  if (options.editorial) {
    const editorial = options.editorial;
    for (const t of teams) {
      if (t.summary?.isLive) continue;
      const lastLine = t.card.last && t.card.last !== "—" ? t.card.last : undefined;
      const lastFinalKey = t.summary?.lastGame?.date;
      const ctx = {
        teamName: t.team.fullName,
        ...(lastLine ? { lastGameLine: lastLine } : {}),
        ...(lastFinalKey ? { lastFinalKey } : {}),
      };
      if (options.forceEditorial) {
        // Debug path: regenerate now (synchronous), overwriting the cache.
        t.editorial = await editorial.generate(t.team.key, ctx, { force: true });
      } else {
        const { editorial: ed, pending } = editorial.getOrQueue(t.team.key, ctx);
        t.editorial = ed;
        if (pending) awaitingEditorial = true;
      }
    }
  }

  // Real make-playoffs odds (B-Ref) for the playoff column; best-effort, so a
  // failure falls back to the magic/elimination tracker.
  const oddsByAbbr = options.brefOdds
    ? await options.brefOdds.getMakePlayoffOdds().catch(() => undefined)
    : undefined;

  // Real playoff/wild-card tables + last-5 form, both from the MLB Stats API.
  // Form is best-effort: a failure just leaves the L10 record column in place.
  const [playoffTables, formByAbbr] = await Promise.all([
    options.mlbStats!.getPlayoffTables({
      watched,
      ...(accent ? { accent } : {}),
      ...(oddsByAbbr ? { oddsByAbbr } : {}),
    }),
    options.mlbStats!.getRecentForm(10).catch(() => undefined),
  ]);

  const featured = assembleFeatured({
    base,
    teams,
    playoffTables,
    ...(formByAbbr ? { formByAbbr } : {}),
  });

  // Recompute the cadence now that we know whether a recap is still pending: a
  // just-finished game with no editorial yet gets the short follow-up refresh.
  featured.refreshAfterSeconds = getRefreshAfterSeconds({
    hasLiveGame: teams.some((t) => t.summary?.isLive),
    hasActiveSeason: true,
    awaitingEditorial,
    now: options.now ?? new Date(),
  });
  return featured;
}

/** Append wild-card + leaders sections when the view shows MLB divisions only. */
async function appendMlbExtras(
  dashboard: Dashboard,
  adapters: AdapterRegistry,
): Promise<void> {
  const standings = dashboard.sections.filter((s) => s.type === "standings");
  const mlbOnly =
    standings.length > 0 &&
    standings.every((s) => s.id === "al-central" || s.id === "nl-central");
  if (!mlbOnly) return;

  const mlb = adapters.mlb as AdapterRegistry["mlb"] & {
    getMlbExtras?: () => Promise<{ playoffs: DashboardSection[] }>;
  };
  if (!mlb || typeof mlb.getMlbExtras !== "function") return;

  try {
    const extras = await mlb.getMlbExtras();
    dashboard.sections.push(...extras.playoffs);
  } catch {
    // extras are best-effort; never block the core dashboard
  }
}

/**
 * Build a real adapter registry sharing one cache and clock. Used by the
 * server; tests inject fakes instead.
 */
export function createDefaultAdapters(now: () => Date = () => new Date()): AdapterRegistry {
  const cache = new TtlCache();
  const deps = { cache, now };
  return {
    mlb: createMlbAdapter(deps),
    nba: createNbaAdapter(deps),
    nfl: createNflAdapter(deps),
    ncaaf: createNcaafAdapter(deps),
    ncaamb: createNcaambAdapter(deps),
  };
}

/**
 * Build the Featured services (real MLB Stats API playoff tables + OpenAI
 * editorial). Separate from the per-sport adapters so MLB-only views can be
 * upgraded to the Featured layout. Editorial is a no-op without OPENAI_API_KEY.
 */
export function createDefaultFeaturedServices(
  now: () => Date = () => new Date(),
): FeaturedServices {
  const cache = new TtlCache();
  return {
    mlbStats: createMlbStatsAdapter({ cache, now }),
    brefOdds: createBrefOddsAdapter({ cache, now }),
    // Persist editorial so each game's recap + hot/cold is generated once, even
    // across restarts. Defaults to a local .cache dir; set EDITORIAL_CACHE_DIR
    // to a mounted persistent volume (e.g. /data on Railway) so the cache also
    // survives container restarts and redeploys instead of being regenerated.
    editorial: createEditorialClient({
      store: fileStore(
        `${process.env.EDITORIAL_CACHE_DIR ?? `${process.cwd()}/.cache`}/editorial.json`,
      ),
    }),
  };
}
