import { createEspnAdapter, type EspnAdapterDeps } from "./espn.js";
import { WATCHED_TEAMS } from "../config.js";
import { parseMlbStandings, playoffSection } from "../formatters/mlbStandings.js";
import type { SportsAdapter, StandingsSection } from "../types.js";

export interface MlbExtras {
  /** AL and NL playoff-picture tables (division leaders + wild-card race). */
  playoffs: StandingsSection[];
}

export interface MlbAdapter extends SportsAdapter {
  /** AL/NL playoff tables computed from the full standings tree. */
  getMlbExtras(): Promise<MlbExtras>;
}

/** MLB adapter. Standings live at level=3 (divisions). */
export function createMlbAdapter(deps?: EspnAdapterDeps): MlbAdapter {
  const base = createEspnAdapter({
    sport: "mlb",
    standingsLevel: 3,
    standingsColumns: ["#", "Team", "Record", "GB", "L10"],
    groupNameMap: {
      "AL Central": "American League Central",
      "NL Central": "National League Central",
    },
    ...(deps ? { deps } : {}),
  });

  function leagueHighlight(prefix: "AL" | "NL") {
    const team = WATCHED_TEAMS.find(
      (t) => t.sport === "mlb" && (t.division ?? "").startsWith(prefix),
    );
    if (!team) return { abbrToKey: {} as Record<string, string> };
    return {
      abbrToKey: { [team.espnTeamSlug.toUpperCase()]: team.key },
      ...(team.accent ? { accent: team.accent } : {}),
    };
  }

  async function getMlbExtras(): Promise<MlbExtras> {
    const divisions = parseMlbStandings(await base.getStandingsRaw());
    return {
      playoffs: [
        playoffSection(divisions, "AL", { id: "al-playoff", ...leagueHighlight("AL") }),
        playoffSection(divisions, "NL", { id: "nl-playoff", ...leagueHighlight("NL") }),
      ],
    };
  }

  return { ...base, getMlbExtras };
}
