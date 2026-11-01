// The year of the statistics lives in the URL, so that a year can be shared and
// survives a reload.

/** The search parameters of the statistics: `annee`, the year shown; absent means the current one. */
export type StatsSearch = { annee?: number };

/** The first and the last year that can be asked for: four digits. */
const FIRST_YEAR = 1000;
const LAST_YEAR = 9999;

/**
 * Reads the search parameters of the URL, which anybody can write by hand:
 * what is not understood is dropped, which leaves the default. The router
 * reads `?annee=2026` as a number, so a text is not a year.
 */
export function validateStatsSearch(search: Record<string, unknown>): StatsSearch {
  const { annee } = search;
  return {
    annee:
      typeof annee === "number" &&
      Number.isInteger(annee) &&
      annee >= FIRST_YEAR &&
      annee <= LAST_YEAR
        ? annee
        : undefined,
  };
}
