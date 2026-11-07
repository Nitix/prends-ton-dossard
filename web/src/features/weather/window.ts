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
  return weatherPhase(view, today).phase === "now";
}

/**
 * Where today is, against the window of the weather: the forecast is there
 * (`now`), the window has not opened (`not_yet`, with the first day of it:
 * the server's `from`), it is over, or the race has no day (`no_day`). The
 * same words as the server's answer, so that the page can say it without asking.
 */
export type WeatherPhase =
  | { phase: "now" | "over" | "no_day" }
  | { phase: "not_yet"; from: Temporal.PlainDate };

export function weatherPhase(view: EventView, today: Temporal.PlainDate): WeatherPhase {
  if (isMonthOnly(view.event)) return { phase: "no_day" };
  // Calendar days, in Paris: seven days before is a date, whatever the clocks did in between.
  const from = view.start.subtract({ days: DAYS_BEFORE });
  if (Temporal.PlainDate.compare(today, from) < 0) return { phase: "not_yet", from };
  if (Temporal.PlainDate.compare(today, view.end) > 0) return { phase: "over" };
  return { phase: "now" };
}
