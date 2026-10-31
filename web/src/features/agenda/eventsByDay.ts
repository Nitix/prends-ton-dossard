import { eventDays } from "../../lib/dates";
import type { EventView } from "../events/api";

/**
 * The events of each day of `days`, by the ISO date of the day
 * (`2026-06-30`). An event is on every day of its range, so one that lasts
 * several days is under each of them, across a month or a year boundary too.
 *
 * Every day of `days` is a key, with an empty list when nothing happens that
 * day; the days of an event that are not in `days` are left out. The events
 * keep the order they are given in, so sort them first (see `sortEvents`):
 * each day then lists them by start and by name.
 */
export function eventsByDay(
  views: EventView[],
  days: Temporal.PlainDate[],
): Map<string, EventView[]> {
  const byDay = new Map<string, EventView[]>(days.map((day) => [day.toString(), []]));
  for (const view of views) {
    for (const day of eventDays(view.event)) {
      byDay.get(day.toString())?.push(view);
    }
  }
  return byDay;
}
