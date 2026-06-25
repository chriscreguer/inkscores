import { createEspnAdapter, type EspnAdapterDeps } from "./espn.js";
import type { SportsAdapter } from "../types.js";

/** College football adapter. Big Ten standings at level=3. */
export function createNcaafAdapter(deps?: EspnAdapterDeps): SportsAdapter {
  return createEspnAdapter({
    sport: "ncaaf",
    standingsLevel: 3,
    // College standings have no meaningful games-back; show the overall record.
    standingsColumns: ["#", "Team", "Record"],
    groupNameMap: {
      "Big Ten": "Big Ten Conference",
    },
    ...(deps ? { deps } : {}),
  });
}
