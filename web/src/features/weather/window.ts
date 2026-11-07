import { isMonthOnly } from "../../lib/dates";
import type { EventView } from "../events/api";

/** How many days before the first day of a race its weather is shown. */
const DAYS_BEFORE = 7;

/**
 * The client side of the window of the weather (spec § 10.3): today, in Paris,
 * is between seven days before the start of the race and its last day, and the
 * race is on known days (a race known by its month has none). Outside it the
 * page does not even ask the server.
 */
export function weatherWindow(view: EventView, today: Temporal.PlainDate): boolean {
  if (isMonthOnly(view.event)) return false;
  return (
    Temporal.PlainDate.compare(today, view.start.subtract({ days: DAYS_BEFORE })) >= 0 &&
    Temporal.PlainDate.compare(today, view.end) <= 0
  );
}
