import { buildFeaturedCard, withFormColumn, type FeaturedTeamInput } from "./featured.js";
import { formatPlayoffPct } from "./adapters/kalshiOdds.js";
import { getRefreshAfterSeconds } from "./activeSeasons.js";
import type { TeamData } from "./dashboardBuilder.js";
import type { BuildLiveOptions } from "./service.js";
import type {
  Dashboard,
  DashboardSection,
  StandingsSection,
  TeamCardSection,
  TeamSummary,
  WatchedTeam,
} from "./types.js";

/** A synthetic mid-season live MSU game, for ?debug=ncaaf-live — lets the
 * field-position live card be previewed before the real season starts. */
function mockMsuLiveSummary(team: WatchedTeam): TeamSummary {
  return {
    teamKey: team.key,
    label: team.label,
    sport: "ncaaf",
    isLive: true,
    hasGameToday: true,
    record: "3-2",
    live: {
      score: "17-14",
      opponent: "OSU",
      homeAway: "home",
      detail: "8:42 - 3rd",
      down: 3,
      distance: 7,
      yardsToGoal: 42,
      isRedZone: false,
      hasPossession: true,
      winProbability: 61,
      topPlayers: ["Watson 210 pass yds, 2 TD"],
    },
  };
}

/**
 * Workshop-only variant of the Featured layout: Tigers keep their normal MLB
 * card + AL standings/playoff tables, and the second slot is Michigan State
 * football instead of the Cubs, with an enriched Big Ten standings table
 * (AP rank, real form dots, Kalshi playoff %). Only reachable via
 * ?debug=ncaaf while this design is being built out — see WatchedTeam.debugOnly.
 */

/** Suffix a ranked team's abbreviation with its bare AP rank, e.g. "OSU" -> "OSU 5".
 * The renderer (preview.ts) recognises the trailing number and draws it smaller
 * and bold, after the name, rather than as part of the name itself. */
function rankedName(abbr: string, ranksByAbbr: Record<string, number>): string {
  const rank = ranksByAbbr[abbr];
  return rank ? `${abbr} ${rank}` : abbr;
}

function enrichBigTenStandings(
  section: StandingsSection,
  data: {
    ranksByAbbr: Record<string, number>;
    formByAbbr: Record<string, string>;
    playoffPctByAbbr: Record<string, number>;
  },
): StandingsSection {
  // "L5"/"Odds" match the exact column-header convention the AL Central/AL
  // Playoff tables already use (L10 form dots, "Odds" for make-playoffs %).
  const columns = [...section.columns, "L5", "Odds"];
  const rows = section.rows.map((row) => {
    const abbr = String(row[1] ?? "");
    const form = data.formByAbbr[abbr] || "-";
    const pct = formatPlayoffPct(data.playoffPctByAbbr[abbr]) ?? "-";
    return [row[0] ?? "", rankedName(abbr, data.ranksByAbbr), row[2] ?? "", form, pct];
  });
  return { ...section, columns, rows };
}

export async function assembleMlbNcaafFeatured(
  base: Dashboard,
  teamData: TeamData[],
  options: BuildLiveOptions,
): Promise<Dashboard> {
  const byKey = new Map(teamData.map((d) => [d.team.key, d] as const));
  const tigers = byKey.get("tigers");
  const msuFootball = byKey.get("msu-football");
  if (!tigers || !msuFootball) {
    throw new Error("mlb/ncaaf featured requires both tigers and msu-football");
  }
  const msuSummary: TeamSummary | undefined = options.mockNcaafLive
    ? mockMsuLiveSummary(msuFootball.team)
    : msuFootball.summary;

  const tigersCard = base.sections.find(
    (s): s is TeamCardSection => s.type === "teamCard" && s.id === "tigers-card",
  );
  const msuCard = base.sections.find(
    (s): s is TeamCardSection => s.type === "teamCard" && s.id === "msu-football-card",
  );
  const alCentral = base.sections.find(
    (s): s is StandingsSection => s.type === "standings" && s.id === "al-central",
  );
  const bigTen = base.sections.find(
    (s): s is StandingsSection => s.type === "standings" && s.id === "big-ten",
  );
  if (!tigersCard || !msuCard || !alCentral || !bigTen) {
    throw new Error("mlb/ncaaf featured missing an expected card/standings section");
  }

  const tigersInput: FeaturedTeamInput = {
    card: tigersCard,
    team: tigers.team,
    ...(tigers.summary ? { summary: tigers.summary } : {}),
  };

  // Hot/cold + editorial for Tigers only — same enrichment as the MLB-only
  // Featured path, just scoped to the one team in this combined view.
  if (options.mlbStats && !tigersInput.summary?.isLive) {
    const key =
      tigersInput.summary?.lastGame?.date ??
      (options.now ?? new Date()).toISOString().slice(0, 10);
    try {
      const { hot, cold } = await options.mlbStats.getHotCold(
        tigers.team.espnTeamSlug.toUpperCase(),
        key,
      );
      if (hot.length) tigersInput.hot = hot;
      if (cold.length) tigersInput.cold = cold;
    } catch {
      // best-effort; the card simply omits hot/cold
    }
  }

  let awaitingEditorial = false;
  if (options.editorial && !tigersInput.summary?.isLive) {
    const lastLine = tigersCard.last && tigersCard.last !== "—" ? tigersCard.last : undefined;
    const lastFinalKey = tigersInput.summary?.lastGame?.date;
    const ctx = {
      teamName: tigers.team.fullName,
      ...(lastLine ? { lastGameLine: lastLine } : {}),
      ...(lastFinalKey ? { lastFinalKey } : {}),
    };
    if (options.forceEditorial) {
      tigersInput.editorial = await options.editorial.generate(tigers.team.key, ctx, {
        force: true,
      });
    } else {
      const { editorial, pending } = options.editorial.getOrQueue(tigers.team.key, ctx);
      tigersInput.editorial = editorial;
      if (pending) awaitingEditorial = true;
    }
  }

  const tigersFeaturedCard = buildFeaturedCard(tigersInput);

  // No completed game yet: a preseason outlook (LLM) fills the card instead of
  // a last-game recap. Same non-blocking getOrQueue pattern as the recap.
  let msuOutlook: string | undefined;
  if (options.editorial && !msuSummary?.isLive && !msuSummary?.lastGame) {
    const season = String((options.now ?? new Date()).getUTCFullYear());
    const { editorial } = options.editorial.getOrQueueOutlook(msuFootball.team.key, {
      teamName: msuFootball.team.fullName,
      season,
    });
    msuOutlook = editorial.summary;
  }

  // The base dashboard's card was built from the real (non-mocked) summary,
  // so a mocked live game needs its status/live carried onto the card too —
  // buildFeaturedCard's live branch returns the card as-is, it doesn't derive
  // `live` from the summary itself (see featured.ts).
  const msuCardForBuild: TeamCardSection =
    options.mockNcaafLive && msuSummary?.live
      ? { ...msuCard, status: "live", live: msuSummary.live }
      : msuCard;

  const msuFeaturedCardRaw = buildFeaturedCard({
    card: msuCardForBuild,
    team: msuFootball.team,
    ...(msuSummary ? { summary: msuSummary } : {}),
    ...(msuOutlook ? { editorial: { summary: msuOutlook } } : {}),
  });
  // No completed game yet (buildFeaturedCard falls back to "standard", which
  // shows a large title + bottom-left next game). Once there's a real next
  // game, match the Tigers scorebug card's convention instead: no title text,
  // next game styled/positioned top-right like the scorebug's next-game slot,
  // preseason outlook filling the body.
  const hasUpcomingGame =
    msuFeaturedCardRaw.cardVariant === "standard" &&
    msuFeaturedCardRaw.next != null &&
    msuFeaturedCardRaw.next !== "—";
  const msuFeaturedCard: TeamCardSection = hasUpcomingGame
    ? { ...msuFeaturedCardRaw, cardVariant: "upcoming" }
    : msuFeaturedCardRaw;

  // Real AL wild-card table (B-Ref odds) + last-10 form, same sources as the
  // MLB-only Featured path, narrowed to AL/Tigers.
  const oddsByAbbr = options.brefOdds
    ? await options.brefOdds.getMakePlayoffOdds().catch(() => undefined)
    : undefined;
  const [playoffTables, mlbFormByAbbr] = await Promise.all([
    options.mlbStats
      ? options.mlbStats.getPlayoffTables({
          watched: { AL: tigers.team.espnTeamSlug.toUpperCase() },
          ...(tigers.team.accent ? { accent: tigers.team.accent } : {}),
          ...(oddsByAbbr ? { oddsByAbbr } : {}),
        })
      : Promise.resolve([]),
    options.mlbStats ? options.mlbStats.getRecentForm(10).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const alPlayoff = playoffTables.find((t) => t.id === "al-playoff");
  const enrichedAlCentral = mlbFormByAbbr ? withFormColumn(alCentral, mlbFormByAbbr) : alCentral;

  // AP rank + real form + Kalshi playoff odds for the Big Ten table.
  const bigTenAbbrs = bigTen.rows.map((r) => String(r[1] ?? "")).filter(Boolean);
  const [ranksByAbbr, ncaafFormByAbbr, playoffPctByAbbr] = await Promise.all([
    options.ncaafExtras
      ? options.ncaafExtras.getApTop25Ranks().catch(() => ({}) as Record<string, number>)
      : Promise.resolve({} as Record<string, number>),
    options.ncaafExtras
      ? options.ncaafExtras
          .getRecentForm(bigTenAbbrs, 5)
          .catch(() => ({}) as Record<string, string>)
      : Promise.resolve({} as Record<string, string>),
    options.kalshiOdds
      ? options.kalshiOdds.getNcaafPlayoffOdds().catch(() => ({}) as Record<string, number>)
      : Promise.resolve({} as Record<string, number>),
  ]);
  const enrichedBigTen = enrichBigTenStandings(bigTen, {
    ranksByAbbr,
    formByAbbr: ncaafFormByAbbr,
    playoffPctByAbbr,
  });

  const sections: DashboardSection[] = [
    tigersFeaturedCard,
    msuFeaturedCard,
    enrichedAlCentral,
    ...(alPlayoff ? [alPlayoff] : []),
    enrichedBigTen,
  ];

  return {
    ...base,
    theme: {
      mode: base.theme?.mode ?? "epaper-color",
      density: base.theme?.density ?? "compact",
      layout: "team-comparison",
      cardHeight: 132,
    },
    sections,
    refreshAfterSeconds: getRefreshAfterSeconds({
      hasLiveGame: Boolean(tigersInput.summary?.isLive) || Boolean(msuSummary?.isLive),
      hasActiveSeason: true,
      awaitingEditorial,
      now: options.now ?? new Date(),
    }),
  };
}
