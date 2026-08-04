import { buildFeaturedCard, withFormColumn, type FeaturedTeamInput } from "./featured.js";
import { formatPlayoffPct } from "./adapters/kalshiOdds.js";
import { getRefreshAfterSeconds, isTeamActive } from "./activeSeasons.js";
import type { TeamData } from "./dashboardBuilder.js";
import type { BuildLiveOptions } from "./service.js";
import type {
  Dashboard,
  DashboardSection,
  StandingsSection,
  TeamCardSection,
  TeamContext,
  TeamSummary,
  WatchedTeam,
} from "./types.js";

/**
 * Workshop layout that rotates the two team-comparison card slots across
 * whichever watched teams are actually in season, instead of hardcoding
 * Tigers + Cubs. Rules (as specified, not derived):
 *
 *  - Default: Tigers + Cubs, exactly like the plain MLB-only Featured layout.
 *  - Once a non-MLB team (Lions, then MSU Football) is genuinely active,
 *    Cubs drops out of the second slot entirely in favor of it — Lions takes
 *    priority over MSU Football when both are active.
 *  - Once Tigers are mathematically eliminated (no path to any postseason
 *    spot), Tigers drop out too: both slots go to Lions + MSU Football.
 *
 * Only reachable via ?debug=ncaaf or ?debug=nfl while Lions/MSU Football stay
 * gated behind WatchedTeam.debugOnly — this is where the rotation gets
 * verified before those gates come off for real.
 */

function standingsSectionId(team: WatchedTeam): string {
  return (team.division ?? team.standingsGroup ?? "").toLowerCase().replace(/\s+/g, "-");
}

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
      opponent: "MICH",
      homeAway: "home",
      detail: "8:42 - 3rd",
      down: 3,
      distance: 7,
      yardsToGoal: 42,
      isRedZone: false,
      hasPossession: true,
      winProbability: 61,
      // Shape matches topPlayersFromFootballSummary's real output (top
      // passer/rusher/receiver by yards) — see espn.ts.
      topPlayers: [
        "Watson 245 pass yds, 2 TD",
        "Carter 88 rush yds, 1 TD",
        "Reed 94 rec yds, 1 TD",
      ],
    },
  };
}

function contextFor(now: Date, summary?: TeamSummary): TeamContext {
  return {
    now,
    hasLiveGame: summary?.isLive,
    hasPlayoffOrTournamentContext: summary?.hasPlayoffContext,
    ...(summary?.lastGame ? { lastGame: { date: summary.lastGame.date } } : {}),
    ...(summary?.nextGame ? { nextGame: { date: summary.nextGame.date } } : {}),
  };
}

/** Same "is this team actually in season" signal the plain dashboard uses —
 * independent of WatchedTeam.debugOnly, which only gates the plain view.
 * Also honors debugShowAll/debugSports so ?debug=nfl can force Lions into
 * the rotation for testing before it's genuinely active, same as the plain
 * dashboard's own isActive() does. */
function isReady(data: TeamData, now: Date, options: BuildLiveOptions): boolean {
  if (options.debugShowAll) return true;
  if (options.debugSports?.includes(data.team.sport)) return true;
  return isTeamActive(data.team, contextFor(now, data.summary));
}

function cardSectionFor(base: Dashboard, teamKey: string): TeamCardSection | undefined {
  return base.sections.find(
    (s): s is TeamCardSection => s.type === "teamCard" && s.id === `${teamKey}-card`,
  );
}

interface SlotResult {
  card: TeamCardSection;
  sections: DashboardSection[];
  awaitingEditorial: boolean;
}

/** Tigers-or-Cubs slot: the existing rich MLB treatment (scorebug/live card,
 * hot/cold, LLM recap, real playoff table), generalized to work in either
 * card position and for either league. */
async function buildMlbSlot(
  base: Dashboard,
  data: TeamData,
  cardIndex: 0 | 1,
  options: BuildLiveOptions,
): Promise<SlotResult> {
  const cardFromBase = cardSectionFor(base, data.team.key);
  if (!cardFromBase) throw new Error(`mlb combined featured: missing card for ${data.team.key}`);

  const input: FeaturedTeamInput = {
    card: cardFromBase,
    team: data.team,
    ...(data.summary ? { summary: data.summary } : {}),
  };

  if (options.mlbStats && !input.summary?.isLive) {
    const key =
      input.summary?.lastGame?.date ?? (options.now ?? new Date()).toISOString().slice(0, 10);
    try {
      const { hot, cold } = await options.mlbStats.getHotCold(
        data.team.espnTeamSlug.toUpperCase(),
        key,
      );
      if (hot.length) input.hot = hot;
      if (cold.length) input.cold = cold;
    } catch {
      // best-effort; the card simply omits hot/cold
    }
  }

  let awaitingEditorial = false;
  if (options.editorial && !input.summary?.isLive) {
    const lastLine =
      cardFromBase.last && cardFromBase.last !== "—" ? cardFromBase.last : undefined;
    const lastFinalKey = input.summary?.lastGame?.date;
    const ctx = {
      teamName: data.team.fullName,
      ...(lastLine ? { lastGameLine: lastLine } : {}),
      ...(lastFinalKey ? { lastFinalKey } : {}),
    };
    if (options.forceEditorial) {
      input.editorial = await options.editorial.generate(data.team.key, ctx, { force: true });
    } else {
      const { editorial, pending } = options.editorial.getOrQueue(data.team.key, ctx);
      input.editorial = editorial;
      if (pending) awaitingEditorial = true;
    }
  }

  const card: TeamCardSection = { ...buildFeaturedCard(input), cardIndex };

  const division = data.team.division ?? "";
  const league: "AL" | "NL" | undefined = division.startsWith("AL")
    ? "AL"
    : division.startsWith("NL")
      ? "NL"
      : undefined;

  const oddsByAbbr = options.brefOdds
    ? await options.brefOdds.getMakePlayoffOdds().catch(() => undefined)
    : undefined;
  const [playoffTables, formByAbbr] = await Promise.all([
    options.mlbStats
      ? options.mlbStats.getPlayoffTables({
          ...(league ? { watched: { [league]: data.team.espnTeamSlug.toUpperCase() } } : {}),
          ...(data.team.accent ? { accent: data.team.accent } : {}),
          ...(oddsByAbbr ? { oddsByAbbr } : {}),
        })
      : Promise.resolve([]),
    options.mlbStats ? options.mlbStats.getRecentForm(10).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const playoffId = league === "AL" ? "al-playoff" : league === "NL" ? "nl-playoff" : undefined;
  const playoff = playoffId ? playoffTables.find((t) => t.id === playoffId) : undefined;

  const divisionRaw = base.sections.find(
    (s): s is StandingsSection => s.type === "standings" && s.id === standingsSectionId(data.team),
  );
  const division_ = divisionRaw && formByAbbr ? withFormColumn(divisionRaw, formByAbbr) : divisionRaw;

  const sections: DashboardSection[] = [
    ...(division_ ? [{ ...division_, cardIndex }] : []),
    ...(playoff ? [{ ...playoff, cardIndex }] : []),
  ];
  return { card, sections, awaitingEditorial };
}

/** Suffix a ranked team's abbreviation with its bare rank, e.g. "OSU" -> "OSU 5".
 * The renderer recognises the trailing number and draws it smaller and bold,
 * after the name, rather than as part of the name itself. */
function rankedName(abbr: string, ranksByAbbr: Record<string, number>): string {
  const rank = ranksByAbbr[abbr];
  return rank ? `${abbr} ${rank}` : abbr;
}

function enrichFootballStandings(
  section: StandingsSection,
  cardIndex: 0 | 1,
  data: {
    ranksByAbbr: Record<string, number>;
    formByAbbr: Record<string, string>;
    oddsByAbbr: Record<string, number>;
    includeRank: boolean;
  },
): StandingsSection {
  // "L5"/"Odds" match the exact column-header convention the MLB tables use
  // (L10 form dots, "Odds" for make-playoffs %).
  const columns = [...section.columns, "L5", "Odds"];
  const rows = section.rows.map((row) => {
    const abbr = String(row[1] ?? "");
    const name = data.includeRank ? rankedName(abbr, data.ranksByAbbr) : abbr;
    const form = data.formByAbbr[abbr] || "-";
    const pct = formatPlayoffPct(data.oddsByAbbr[abbr]) ?? "-";
    return [row[0] ?? "", name, row[2] ?? "", form, pct];
  });
  return { ...section, columns, rows, cardIndex };
}

/** Lions-or-MSU-Football slot: card with no title text once there's a real
 * next game (or a preseason outlook before then), plus its conference/
 * division standings enriched with real form + playoff odds — AP rank too
 * for NCAAF, which NFL has no equivalent of. */
async function buildFootballSlot(
  base: Dashboard,
  data: TeamData,
  cardIndex: 0 | 1,
  kind: "ncaaf" | "nfl",
  options: BuildLiveOptions,
  withStandings = true,
): Promise<SlotResult> {
  const cardFromBase = cardSectionFor(base, data.team.key);
  if (!cardFromBase) throw new Error(`mlb combined featured: missing card for ${data.team.key}`);

  let outlook: string | undefined;
  if (options.editorial && !data.summary?.isLive && !data.summary?.lastGame) {
    const season = String((options.now ?? new Date()).getUTCFullYear());
    const { editorial } = options.editorial.getOrQueueOutlook(data.team.key, {
      teamName: data.team.fullName,
      season,
    });
    outlook = editorial.summary;
  }

  // The base card was built from teamData before any mock override, so a
  // mocked live game needs its status/live carried onto the card too —
  // buildFeaturedCard's live branch returns the card as-is, it doesn't
  // derive `live` from the summary itself (see featured.ts).
  const cardForBuild: TeamCardSection =
    data.summary?.isLive && data.summary.live && !cardFromBase.live
      ? { ...cardFromBase, status: "live", live: data.summary.live }
      : cardFromBase;

  const cardRaw = buildFeaturedCard({
    card: cardForBuild,
    team: data.team,
    ...(data.summary ? { summary: data.summary } : {}),
    ...(outlook ? { editorial: { summary: outlook } } : {}),
  });
  const hasUpcomingGame =
    cardRaw.cardVariant === "standard" && cardRaw.next != null && cardRaw.next !== "—";
  const card: TeamCardSection = hasUpcomingGame
    ? { ...cardRaw, cardVariant: "upcoming", cardIndex }
    : { ...cardRaw, cardIndex };

  if (!withStandings) return { card, sections: [], awaitingEditorial: false };

  const raw = base.sections.find(
    (s): s is StandingsSection => s.type === "standings" && s.id === standingsSectionId(data.team),
  );
  if (!raw) return { card, sections: [], awaitingEditorial: false };

  const teamAbbrs = raw.rows.map((r) => String(r[1] ?? "")).filter(Boolean);
  const [ranksByAbbr, formByAbbr, oddsByAbbr] = await Promise.all([
    kind === "ncaaf" && options.ncaafExtras
      ? options.ncaafExtras.getApTop25Ranks().catch(() => ({}) as Record<string, number>)
      : Promise.resolve({} as Record<string, number>),
    kind === "ncaaf"
      ? options.ncaafExtras
        ? options.ncaafExtras.getRecentForm(teamAbbrs, 5).catch(() => ({}) as Record<string, string>)
        : Promise.resolve({} as Record<string, string>)
      : options.nflExtras
        ? options.nflExtras.getRecentForm(teamAbbrs, 5).catch(() => ({}) as Record<string, string>)
        : Promise.resolve({} as Record<string, string>),
    kind === "ncaaf"
      ? options.kalshiOdds
        ? options.kalshiOdds.getNcaafPlayoffOdds().catch(() => ({}) as Record<string, number>)
        : Promise.resolve({} as Record<string, number>)
      : options.kalshiOdds
        ? options.kalshiOdds.getNflPlayoffOdds().catch(() => ({}) as Record<string, number>)
        : Promise.resolve({} as Record<string, number>),
  ]);

  const enriched = enrichFootballStandings(raw, cardIndex, {
    ranksByAbbr,
    formByAbbr,
    oddsByAbbr,
    includeRank: kind === "ncaaf",
  });
  return { card, sections: [enriched], awaitingEditorial: false };
}

interface Slot {
  data: TeamData;
  kind: "mlb" | "nfl" | "ncaaf";
}

export async function assembleMlbCombinedFeatured(
  base: Dashboard,
  teamData: TeamData[],
  options: BuildLiveOptions,
): Promise<Dashboard> {
  const byKey = new Map(teamData.map((d) => [d.team.key, d] as const));
  const now = options.now ?? new Date();

  const tigers = byKey.get("tigers");
  const cubs = byKey.get("cubs");
  const lions = byKey.get("lions");
  let msuFootball = byKey.get("msu-football");
  if (options.mockNcaafLive && msuFootball) {
    msuFootball = { team: msuFootball.team, summary: mockMsuLiveSummary(msuFootball.team) };
  }

  const tigersEliminated =
    tigers && options.mlbStats
      ? await options.mlbStats.isEliminated(tigers.team.espnTeamSlug.toUpperCase()).catch(() => false)
      : false;
  const lionsReady = lions ? isReady(lions, now, options) : false;
  const msuReady = msuFootball ? isReady(msuFootball, now, options) : false;

  // Three-way: Tigers not eliminated, and BOTH Lions and MSU Football are
  // active. Tigers keeps the left column as normal; the right column stacks
  // Lions' card above MSU's, with only NFC North underneath (Big Ten is
  // dropped — there's no room for two standings tables in one column, and
  // the rule is "Lions' standings replace MSU's", not both).
  if (tigers && !tigersEliminated && lions && lionsReady && msuFootball && msuReady) {
    const tigersBuilt = await buildMlbSlot(base, tigers, 0, options);
    const lionsBuilt = await buildFootballSlot(base, lions, 1, "nfl", options);
    const msuBuilt = await buildFootballSlot(base, msuFootball, 1, "ncaaf", options, false);

    const sections: DashboardSection[] = [
      tigersBuilt.card,
      lionsBuilt.card,
      msuBuilt.card,
      ...tigersBuilt.sections,
      ...lionsBuilt.sections,
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
        hasLiveGame:
          Boolean(tigers.summary?.isLive) ||
          Boolean(lions.summary?.isLive) ||
          Boolean(msuFootball.summary?.isLive),
        hasActiveSeason: true,
        awaitingEditorial: tigersBuilt.awaitingEditorial,
        now,
      }),
    };
  }

  // Priority-ordered eligible list; slots 1 and 2 are just the first two.
  // Cubs is only eligible when no other sport has taken over the second
  // slot — the moment Lions or MSU Football is ready, Cubs drops out.
  const eligible: Slot[] = [];
  if (tigers && !tigersEliminated) eligible.push({ data: tigers, kind: "mlb" });
  if (lions && lionsReady) eligible.push({ data: lions, kind: "nfl" });
  if (msuFootball && msuReady) eligible.push({ data: msuFootball, kind: "ncaaf" });
  if (cubs && !lionsReady && !msuReady) eligible.push({ data: cubs, kind: "mlb" });

  const [slot1, slot2] = eligible;
  if (!slot1) throw new Error("mlb combined featured: no eligible team for either slot");

  async function build(slot: Slot, cardIndex: 0 | 1): Promise<SlotResult> {
    if (slot.kind === "mlb") return buildMlbSlot(base, slot.data, cardIndex, options);
    return buildFootballSlot(base, slot.data, cardIndex, slot.kind, options);
  }

  const built1 = await build(slot1, 0);
  const built2 = slot2 ? await build(slot2, 1) : undefined;

  const sections: DashboardSection[] = [
    built1.card,
    ...(built2 ? [built2.card] : []),
    ...built1.sections,
    ...(built2 ? built2.sections : []),
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
      hasLiveGame: Boolean(slot1.data.summary?.isLive) || Boolean(slot2?.data.summary?.isLive),
      hasActiveSeason: true,
      awaitingEditorial: built1.awaitingEditorial || built2?.awaitingEditorial === true,
      now,
    }),
  };
}
