// A duration is stored in minutes (46 h 30 = 2790), and typed in hours and
// minutes. These two functions go from one to the other.

const MINUTES_PER_HOUR = 60;

/**
 * The total of minutes of what was typed. A part that is left empty counts for
 * nothing, and nothing at all, zero or less is no duration: `undefined`. The
 * result is a whole number, which is what the server stores.
 */
export function toMinutes(
  hours: number | undefined,
  minutes: number | undefined,
): number | undefined {
  const total = Math.round((hours ?? 0) * MINUTES_PER_HOUR + (minutes ?? 0));
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

/** The hours and minutes of a total, a part that is zero left out: 2880 is 48 h. */
export function fromMinutes(total: number | undefined): { hours?: number; minutes?: number } {
  if (total === undefined || !(total > 0)) return {};
  const hours = Math.floor(total / MINUTES_PER_HOUR);
  const minutes = total % MINUTES_PER_HOUR;
  return {
    ...(hours > 0 && { hours }),
    ...(minutes > 0 && { minutes }),
  };
}
