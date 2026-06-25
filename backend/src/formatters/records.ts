/** English ordinal for a 1-based position, e.g. 1 -> "1st", 12 -> "12th". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Build a compact standing line for a team card, e.g.
 * "AL Central: 2nd, 2.5 GB". The games-back clause is omitted when the team
 * leads ("-") or games-back is unknown.
 */
export function formatStandingLine(
  group: string,
  rank: number,
  gamesBack?: string,
): string {
  const base = `${group}: ${ordinal(rank)}`;
  if (!gamesBack || gamesBack === "-" || gamesBack === "0") return base;
  return `${base}, ${gamesBack} GB`;
}
