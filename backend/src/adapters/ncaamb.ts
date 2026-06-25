import { createEspnAdapter, type EspnAdapterDeps } from "./espn.js";
import type { SportsAdapter } from "../types.js";

/** Men's college basketball adapter. Big Ten standings at level=3. */
export function createNcaambAdapter(deps?: EspnAdapterDeps): SportsAdapter {
  return createEspnAdapter({
    sport: "ncaamb",
    standingsLevel: 3,
    standingsColumns: ["#", "Team", "Record"],
    groupNameMap: {
      "Big Ten": "Big Ten Conference",
    },
    ...(deps ? { deps } : {}),
  });
}
