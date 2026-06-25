import { createEspnAdapter, type EspnAdapterDeps } from "./espn.js";
import type { SportsAdapter } from "../types.js";

/** NBA adapter. Conference standings require level=2 (not divisions). */
export function createNbaAdapter(deps?: EspnAdapterDeps): SportsAdapter {
  return createEspnAdapter({
    sport: "nba",
    standingsLevel: 2,
    standingsColumns: ["#", "Team", "Record", "GB", "L10"],
    groupNameMap: {
      "Eastern": "Eastern Conference",
      "Western": "Western Conference",
    },
    ...(deps ? { deps } : {}),
  });
}
