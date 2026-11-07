import type { Messages } from "../../i18n/fr";
import { eventRange } from "../../lib/dates";
import type { Formatters } from "../../lib/format";
import type { EventRecord } from "../../lib/types";
import { eventWhen } from "./eventWhen";

/**
 * The line that tells one event from another, for a list of events that may
 * be the same one: its name, its day or days, and its place ("Trail des
 * Crêtes · du sam. 13 juin 2026 au dim. 14 juin 2026 · Annecy"). A race known
 * by its month only says its month (see `eventWhen`).
 */
export function eventLabel(
  event: Pick<EventRecord, "name" | "location" | "start_date" | "end_date" | "date_precision">,
  f: Formatters,
  t: Messages,
): string {
  const when = eventWhen({ event, ...eventRange(event) }, f, t, "long");
  return `${event.name} · ${when} · ${event.location}`;
}
