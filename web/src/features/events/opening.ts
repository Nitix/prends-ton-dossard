import type { Messages } from "../../i18n/fr";
import { PARIS } from "../../lib/dates";
import type { Formatters } from "../../lib/format";
import type { EventRecord, FormatRecord } from "../../lib/types";
import type { EventView } from "./api";
import { formatMeasures } from "./formatName";

// Which registration opening counts for whom. The Go port is
// `server/events/openings.go`: the reminders, the calendar feed and the
// assistant must answer what the site answers, so change both together.

/**
 * One opening: a day, a time (Paris, "" for none: the site then counts 9:00)
 * and its source. `formatIds` is empty for the opening of the event itself, and
 * holds the ids of the formats that have it otherwise (sorted when merged).
 */
export type Opening = { day: Temporal.PlainDate; time: string; formatIds: readonly string[] };

type EventOpeningFields = Pick<EventRecord, "registration_opening" | "registration_opening_time">;
type FormatOpeningFields = Pick<
  FormatRecord,
  "id" | "registration_opening" | "registration_opening_time"
>;

/** The time the site counts for an opening that has none. */
const DEFAULT_TIME = "09:00";

/** The instant of an opening, in milliseconds, or null when its time is not real. */
function instantOf(opening: Opening): number | null {
  try {
    // The later reading of a time that Paris has twice (the October change), as the server takes it.
    return opening.day
      .toPlainDateTime(opening.time || DEFAULT_TIME)
      .toZonedDateTime(PARIS, { disambiguation: "later" }).epochMilliseconds;
  } catch {
    return null;
  }
}

const firstId = (opening: Opening) => opening.formatIds[0] ?? "";

/**
 * The openings that have an instant, earliest first. The event's own (no id)
 * comes before a format at the same instant, then the first format id.
 */
function byInstant(openings: readonly Opening[]): { at: number; opening: Opening }[] {
  const timed: { at: number; opening: Opening }[] = [];
  for (const opening of openings) {
    const at = instantOf(opening);
    if (at !== null) timed.push({ at, opening });
  }
  return timed.toSorted((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    const [x, y] = [firstId(a.opening), firstId(b.opening)];
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/** One opening per instant, earliest first: the event's if one of them is, else the sorted union of the format ids. */
function mergeSameInstant(openings: readonly Opening[]): Opening[] {
  const out: { at: number; opening: Opening }[] = [];
  for (const { at, opening } of byInstant(openings)) {
    const last = out.at(-1);
    if (last && last.at === at) {
      // The same instant can be written with or without a time (a day alone counts 09:00): keep the written one.
      const time = last.opening.time || opening.time;
      if (last.opening.formatIds.length === 0) {
        last.opening = { ...last.opening, time };
        continue;
      }
      last.opening =
        opening.formatIds.length === 0
          ? { ...opening, time, formatIds: [] }
          : {
              ...last.opening,
              time,
              formatIds: [...new Set([...last.opening.formatIds, ...opening.formatIds])].toSorted(),
            };
      continue;
    }
    out.push({ at, opening: { ...opening, formatIds: [...opening.formatIds] } });
  }
  return out.map((o) => o.opening);
}

/** The opening of the event itself, null when it has none. */
function eventOpening(event: EventOpeningFields): Opening | null {
  if (!event.registration_opening) return null;
  return {
    day: Temporal.PlainDate.from(event.registration_opening),
    time: event.registration_opening_time ?? "",
    formatIds: [],
  };
}

/**
 * The opening of a format, null when it has none of its own. A day alone takes
 * the time of the opening of the event, a time alone its day: a partial value
 * needs the event to have its own opening. A result at the very instant of the
 * event's opening is the event's, so null.
 */
export function formatOpening(
  event: EventOpeningFields,
  format: FormatOpeningFields,
): Opening | null {
  const ownDay = format.registration_opening ?? "";
  const ownTime = format.registration_opening_time ?? "";
  if (!ownDay && !ownTime) return null;
  const general = eventOpening(event);
  let day = ownDay;
  let time = ownTime;
  if (!day || !time) {
    if (!general) return null;
    if (!day) day = general.day.toString();
    else time = general.time;
  }
  const opening: Opening = { day: Temporal.PlainDate.from(day), time, formatIds: [format.id] };
  if (general) {
    const own = instantOf(general);
    if (own !== null && instantOf(opening) === own) return null;
  }
  return opening;
}

/** The openings of the formats that have their own, by format id. */
function formatOpenings(view: EventView): Map<string, Opening> {
  const all = new Map<string, Opening>();
  for (const { format } of view.formats) {
    const opening = formatOpening(view.event, format);
    if (opening) all.set(format.id, opening);
  }
  return all;
}

const sortedFormatOpenings = (view: EventView) =>
  byInstant([...formatOpenings(view).values()]).map((o) => o.opening);

/** Past is to the day: the day of an opening is not past. */
const notPast = (opening: Opening, today: Temporal.PlainDate) =>
  Temporal.PlainDate.compare(opening.day, today) >= 0;

/**
 * The opening of the event: its own; else, among its formats' openings, the
 * first one not past (the next to come), else the last (registrations are
 * open); null with none.
 */
export function generalOpening(view: EventView, today: Temporal.PlainDate): Opening | null {
  const own = eventOpening(view.event);
  if (own) return own;
  const all = sortedFormatOpenings(view);
  return all.find((o) => notPast(o, today)) ?? all.at(-1) ?? null;
}

/** The opening that counts for a format: its own, else the general one. */
export function openingOf(
  view: EventView,
  formatId: string | undefined,
  today: Temporal.PlainDate,
): Opening | null {
  const own = formatId ? formatOpenings(view).get(formatId) : undefined;
  return own ?? generalOpening(view, today);
}

/** Interested and registered count; a supporter and a person who does not start do not. */
const counts = (status: string) => status === "interested" || status === "registered";

/** The format id of each participation of the runner that counts, "" for one on the event alone. */
function countedFormats(view: EventView, runnerId: string | undefined): string[] {
  if (!runnerId) return [];
  const mine = (list: EventView["interested"]) =>
    list.some((p) => p.participation.runner === runnerId && counts(p.participation.status));
  const ids = view.formats.filter((v) => mine(v.participations)).map((v) => v.format.id);
  if (mine(view.interested)) ids.push("");
  return ids;
}

/** The openings of a runner on the event, one per instant, by instant. */
export function personOpenings(
  view: EventView,
  runnerId: string,
  today: Temporal.PlainDate,
): Opening[] {
  const openings: Opening[] = [];
  for (const id of countedFormats(view, runnerId)) {
    const opening = openingOf(view, id || undefined, today);
    if (opening) openings.push(opening);
  }
  return mergeSameInstant(openings);
}

/**
 * The opening shown to a person: the nearest of theirs (the first not past,
 * else the last), else the general one.
 */
export function shownOpening(
  view: EventView,
  runnerId: string | undefined,
  today: Temporal.PlainDate,
): Opening | null {
  const own = runnerId ? personOpenings(view, runnerId, today) : [];
  const nearest = own.find((o) => notPast(o, today)) ?? own.at(-1);
  return nearest ?? generalOpening(view, today);
}

/**
 * What a calendar holds for a format: its own opening; else the event's; else
 * every format opening, since a calendar does not depend on the day it is read.
 */
function forCalendar(view: EventView, formatId: string): Opening[] {
  const own = formatId ? formatOpenings(view).get(formatId) : undefined;
  if (own) return [own];
  const general = eventOpening(view.event);
  if (general) return [general];
  return sortedFormatOpenings(view);
}

/**
 * The openings a calendar holds for a runner, one per instant: those of each
 * participation that counts, or, with none, those of the event alone.
 */
export function calendarOpenings(view: EventView, runnerId: string | undefined): Opening[] {
  const ids = countedFormats(view, runnerId);
  return mergeSameInstant((ids.length > 0 ? ids : [""]).flatMap((id) => forCalendar(view, id)));
}

/** The names of the formats of an opening as the page names them, joined by ", "; "" for the event's. */
export function formatNames(view: EventView, opening: Opening, t: Messages, f: Formatters): string {
  const names: string[] = [];
  for (const id of opening.formatIds) {
    const found = view.formats.find((v) => v.format.id === id);
    if (found) names.push(...formatMeasures(found.format, found.raceType.label, f, t).slice(0, 1));
  }
  return names.join(", ");
}
