import { createEspnAdapter, type EspnAdapterDeps } from "./espn.js";
import type { SportsAdapter } from "../types.js";

/** NFL adapter. NFC North division standings at level=3. */
export function createNflAdapter(deps?: EspnAdapterDeps): SportsAdapter {
  return createEspnAdapter({
    sport: "nfl",
    standingsLevel: 3,
    standingsColumns: ["#", "Team", "Record"],
    groupNameMap: {
      "NFC North": "NFC North",
    },
    ...(deps ? { deps } : {}),
  });
}
