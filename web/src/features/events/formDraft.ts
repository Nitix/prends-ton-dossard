import { raceStarted } from "../../lib/dates";
import { newId } from "../../lib/ids";
import type { Measure, Status } from "../../lib/types";
import type { EventView } from "./api";
import type { EventDraft, GpxChange } from "./saveEvent";

// What the form of an event holds while it is being filled in. Everything the
// user types is a text, so that what is half typed ("42.", "") is left alone;
// the durations are the exception, since their fields hold the total of
// minutes. `toEventDraft` turns it into what is saved.

export type FormatRow = {
  /** Tells the row apart in the form, whether its format exists on the server or not. */
  key: string;
  /** The id of a format that exists on the server: a new row has none. */
  id?: string;
  name: string;
  raceType: string;
  distanceKm: string;
  /** In minutes. */
  duration?: number;
  /** In minutes. */
  timeLimit?: number;
  elevation: string;
  /** In euros, as it is typed. */
  price: string;
  /** A link to the course on a website, as it is typed. */
  routeUrl: string;
  /** Whether the format has a GPX track on the server: the form only needs to know that, to offer to take it off. */
  hasTrack: boolean;
  /** What is done with the track when the form is saved: the file chosen, or taking it off. */
  gpx: GpxChange;
  date: string;
};

export type FormDraft = {
  name: string;
  location: string;
  startDate: string;
  registrationUrl: string;
  /** A `YYYY-MM-DD` day, or empty. */
  registrationDeadline: string;
  notes: string;
  rows: FormatRow[];
  /** Whether the member takes part (a new event only). */
  join: boolean;
  /** The key of the row they take part in. */
  joinRow: string;
  joinStatus: Status;
};

/** A row to fill in, of the type given: a new row takes the type of the previous one, since the formats of an event are often alike. */
export function emptyRow(raceType = ""): FormatRow {
  return {
    key: newId(),
    name: "",
    raceType,
    distanceKm: "",
    elevation: "",
    price: "",
    routeUrl: "",
    hasTrack: false,
    gpx: { kind: "keep" },
    date: "",
  };
}

/** A number as it is typed in a field: nothing for what the API sends as 0 or empty. */
function typed(n: number | undefined): string {
  return n ? String(n) : "";
}

/** The values to start from: those of the event being edited, or an empty event with one format. */
export function initialDraft(existing: EventView | undefined): FormDraft {
  if (!existing) {
    const row = emptyRow();
    return {
      name: "",
      location: "",
      startDate: "",
      registrationUrl: "",
      registrationDeadline: "",
      notes: "",
      rows: [row],
      join: true,
      joinRow: row.key,
      joinStatus: "interested",
    };
  }
  const { event, formats } = existing;
  const saved = formats.map(({ format }): FormatRow => ({
    key: format.id,
    id: format.id,
    name: format.name ?? "",
    raceType: format.race_type,
    distanceKm: typed(format.distance_km),
    duration: format.duration_min || undefined,
    timeLimit: format.time_limit_min || undefined,
    elevation: typed(format.elevation_gain_m),
    price: typed(format.price_eur),
    routeUrl: format.route_url ?? "",
    hasTrack: !!format.gpx,
    gpx: { kind: "keep" },
    date: format.date ?? "",
  }));
  // An event has at least one format: one that has none (which only a write
  // outside the app can make) starts with a row to fill in.
  const rows = saved.length > 0 ? saved : [emptyRow()];
  return {
    name: event.name,
    location: event.location,
    startDate: event.start_date,
    registrationUrl: event.registration_url ?? "",
    registrationDeadline: event.registration_deadline ?? "",
    notes: event.notes ?? "",
    rows,
    join: false,
    joinRow: rows[0]?.key ?? "",
    joinStatus: "interested",
  };
}

/** Whether a text is a real `YYYY-MM-DD` day: what a date field holds once it is complete, or nothing. */
export function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  try {
    Temporal.PlainDate.from(text);
    return true;
  } catch (error) {
    // Not a real day ("2026-02-31"): Temporal refuses it with a RangeError.
    if (error instanceof RangeError) return false;
    throw error;
  }
}

/**
 * The last day of an event that starts on `start`, from the days of its formats:
 * the latest of them when it is after the start, and none (an empty text) when
 * no format is, which makes the event a one-day event. A format that has no
 * day takes place on the first day, so it never moves the end; neither does a
 * text that is not a day. Without a start day there is no period to speak of.
 * Both are `YYYY-MM-DD` texts, which sort as the days do.
 */
export function eventEndDate(start: string, formatDates: readonly string[]): string {
  if (!isDay(start)) return "";
  let end = start;
  for (const day of formatDates) {
    if (day > end && isDay(day)) end = day;
  }
  return end === start ? "" : end;
}

/** The number in a field, or undefined when it is empty. */
function numberOf(text: string): number | undefined {
  return text.trim() === "" ? undefined : Number(text);
}

/** Whether a format has one of its three measures: a distance, a duration or a time limit. Zero is none. */
export function hasMeasure(row: FormatRow): boolean {
  return (numberOf(row.distanceKm) ?? 0) > 0 || (row.duration ?? 0) > 0 || (row.timeLimit ?? 0) > 0;
}

/**
 * The measures of a row that have a value, a text that is not empty or a duration
 * that is not zero: what the form shows whatever the race type uses (a measure
 * that is filled in is never put away).
 */
export function filledMeasures(row: FormatRow): ReadonlySet<Measure> {
  const filled = new Set<Measure>();
  if (row.distanceKm.trim() !== "") filled.add("distance");
  if (row.elevation.trim() !== "") filled.add("elevation");
  if ((row.duration ?? 0) > 0) filled.add("duration");
  if ((row.timeLimit ?? 0) > 0) filled.add("time_limit");
  return filled;
}

/**
 * The row that the member takes part in: the one chosen, or the first when
 * that one has been removed since.
 */
export function joinRowOf(draft: FormDraft): FormatRow | undefined {
  return draft.rows.find((row) => row.key === draft.joinRow) ?? draft.rows[0];
}

/**
 * Whether the race that the member takes part in has started, going by what is
 * typed: the day of its row, else the first day of the event, being `today` or
 * past. It is not while the day is not typed yet (or is not a day): nobody has
 * finished a race that has no day.
 */
export function joinStarted(draft: FormDraft, today: Temporal.PlainDate): boolean {
  const row = joinRowOf(draft);
  if (!row) return false;
  try {
    return raceStarted({ date: row.date }, { start_date: draft.startDate }, today);
  } catch (error) {
    // The day is empty, or half typed: Temporal refuses it with a RangeError.
    if (error instanceof RangeError) return false;
    throw error;
  }
}

/**
 * What to save. `existing` is the event being edited, which gives its id;
 * `join` is whether the member takes part, which only the creation offers;
 * `label` names a row (by its place in the form, from 0) in the message that
 * says its track was not sent: the form gives the name the page would show.
 */
export function toEventDraft(
  draft: FormDraft,
  existing: EventView | undefined,
  join: boolean,
  label?: (row: FormatRow, index: number) => string,
): EventDraft {
  const joinRow = joinRowOf(draft);
  return {
    id: existing?.event.id,
    name: draft.name.trim(),
    location: draft.location.trim(),
    start_date: draft.startDate,
    end_date: eventEndDate(
      draft.startDate,
      draft.rows.map((row) => row.date),
    ),
    registration_url: draft.registrationUrl.trim() || undefined,
    registration_deadline: draft.registrationDeadline || undefined,
    notes: draft.notes.trim() || undefined,
    formats: draft.rows.map((row, index) => ({
      id: row.id,
      name: row.name.trim() || undefined,
      race_type: row.raceType,
      distance_km: numberOf(row.distanceKm),
      duration_min: row.duration,
      time_limit_min: row.timeLimit,
      elevation_gain_m: numberOf(row.elevation),
      price_eur: numberOf(row.price),
      route_url: row.routeUrl.trim() || undefined,
      gpx: row.gpx,
      label: label?.(row, index),
      date: row.date || undefined,
    })),
    join:
      join && joinRow
        ? { formatIndex: draft.rows.indexOf(joinRow), status: draft.joinStatus }
        : undefined,
  };
}
