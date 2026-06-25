import type { NormalizedGame } from "../types.js";

function venue(homeAway: NormalizedGame["homeAway"]): string {
  return homeAway === "home" ? "vs" : "@";
}

/**
 * Format a completed game for a team card, e.g. "W 5-3 vs CLE" or
 * "L 4-2 @ STL". ASCII hyphen is used in scores deliberately so the firmware's
 * bitmap fonts render reliably. Returns undefined when there is no game.
 */
export function formatLastGame(game?: NormalizedGame): string | undefined {
  if (!game) return undefined;
  const parts: string[] = [];
  if (game.result) parts.push(game.result);
  if (game.score) parts.push(game.score);
  parts.push(venue(game.homeAway), game.opponent);
  return parts.join(" ");
}

/**
 * Format an upcoming game, e.g. "Tonight 6:40 vs MIN". Falls back to the raw
 * ISO date when no human displayTime is supplied. Returns undefined when there
 * is no game.
 */
export function formatNextGame(game?: NormalizedGame): string | undefined {
  if (!game) return undefined;
  const when = game.displayTime ?? game.date;
  return `${when} ${venue(game.homeAway)} ${game.opponent}`;
}
