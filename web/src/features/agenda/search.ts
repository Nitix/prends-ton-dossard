import { validateListSearch, type ListSearch } from "../events/search";

// The month and the day of the calendar live in the URL too, next to the
// filters it shares with the list.

/**
 * The search parameters of the calendar: the filters of the list (`personne`
 * and `type`; the calendar has no `periode`), plus
 * - `mois`: the month shown, `YYYY-MM`; absent means the current month;
 * - `jour`: the day chosen under the grid on a phone, `YYYY-MM-DD`; absent
 *   means none.
 */
export type AgendaSearch = ListSearch & {
  mois?: string;
  jour?: string;
};

/** Whether `value` is a real month written `YYYY-MM`. */
function isMonth(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) return false;
  try {
    Temporal.PlainYearMonth.from(value);
    return true;
  } catch {
    return false;
  }
}

/** Whether `value` is a real date written `YYYY-MM-DD`. */
function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    Temporal.PlainDate.from(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the search parameters of the URL, which anybody can write by hand:
 * what is not understood is dropped, which leaves the default (the current
 * month, no day chosen, every event). `Temporal` must be there, as it is once
 * the app has started.
 */
export function validateAgendaSearch(search: Record<string, unknown>): AgendaSearch {
  const { personne, type } = validateListSearch(search);
  return {
    personne,
    type,
    mois: isMonth(search.mois) ? search.mois : undefined,
    jour: isDay(search.jour) ? search.jour : undefined,
  };
}
