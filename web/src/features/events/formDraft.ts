import { newId } from "../../lib/ids";
import type { Status } from "../../lib/types";
import type { EventView } from "./api";
import type { EventDraft } from "./saveEvent";

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
  date: string;
};

export type FormDraft = {
  name: string;
  location: string;
  startDate: string;
  endDate: string;
  registrationUrl: string;
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
      endDate: "",
      registrationUrl: "",
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
    date: format.date ?? "",
  }));
  // An event has at least one format: one that has none (which only a write
  // outside the app can make) starts with a row to fill in.
  const rows = saved.length > 0 ? saved : [emptyRow()];
  return {
    name: event.name,
    location: event.location,
    startDate: event.start_date,
    endDate: event.end_date ?? "",
    registrationUrl: event.registration_url ?? "",
    notes: event.notes ?? "",
    rows,
    join: false,
    joinRow: rows[0]?.key ?? "",
    joinStatus: "interested",
  };
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
 * The row that the member takes part in: the one chosen, or the first when
 * that one has been removed since.
 */
export function joinRowOf(draft: FormDraft): FormatRow | undefined {
  return draft.rows.find((row) => row.key === draft.joinRow) ?? draft.rows[0];
}

/**
 * What to save. `existing` is the event being edited, which gives its id;
 * `join` is whether the member takes part, which only the creation offers.
 */
export function toEventDraft(
  draft: FormDraft,
  existing: EventView | undefined,
  join: boolean,
): EventDraft {
  const joinRow = joinRowOf(draft);
  return {
    id: existing?.event.id,
    name: draft.name.trim(),
    location: draft.location.trim(),
    start_date: draft.startDate,
    end_date: draft.endDate || undefined,
    registration_url: draft.registrationUrl.trim() || undefined,
    notes: draft.notes.trim() || undefined,
    formats: draft.rows.map((row) => ({
      id: row.id,
      name: row.name.trim() || undefined,
      race_type: row.raceType,
      distance_km: numberOf(row.distanceKm),
      duration_min: row.duration,
      time_limit_min: row.timeLimit,
      elevation_gain_m: numberOf(row.elevation),
      date: row.date || undefined,
    })),
    join:
      join && joinRow
        ? { formatIndex: draft.rows.indexOf(joinRow), status: draft.joinStatus }
        : undefined,
  };
}
