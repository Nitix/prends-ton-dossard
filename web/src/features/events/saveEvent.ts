import { ClientResponseError } from "pocketbase";

import { errorCode, fieldErrors } from "../../i18n/errors";
import { newId } from "../../lib/ids";
import { pb } from "../../lib/pb";
import type { Status } from "../../lib/types";
import type { EventView } from "./api";

// Saving an event is a single batch request: the event, its formats, the
// formats that are removed and, when the member creates it, their own
// participation. The server runs a batch in one transaction, so either all of
// it is saved or none of it is. The ids of what is created are chosen here,
// which lets the formats and the participation point to what the same batch
// creates.
//
// The GPX tracks do not go in the batch: a file is a form, and the formats it
// belongs to must exist. Each track that is new or taken off is sent by a
// request of its own once the batch is saved (`uploadTraces`), and one that
// fails leaves the event saved.

/** One request of the batch. A `create` carries its own id, which the client chose. */
export type BatchOp = {
  action: "create" | "update" | "delete";
  collection: "events" | "formats" | "participations";
  id: string;
  body?: Record<string, unknown>;
};

/**
 * What the form does with the GPX track of a format: leaves it as it is (the one
 * it has, or none), sends the file that was chosen, or takes the track off.
 */
export type GpxChange = { kind: "keep" } | { kind: "new"; file: File } | { kind: "remove" };

/**
 * What the form holds, as the server stores it: dates are `YYYY-MM-DD` texts,
 * and what is not filled in is `undefined`. A format that has an `id` is one
 * that exists already (that is how the modification tells it from a new one).
 */
export type EventDraft = {
  id?: string;
  name: string;
  location: string;
  start_date: string;
  end_date?: string;
  registration_url?: string;
  /** The last day to register, a `YYYY-MM-DD` text, never after `start_date`. */
  registration_deadline?: string;
  /** The day registration opens, a `YYYY-MM-DD` text, never after `registration_deadline` or `start_date`. */
  registration_opening?: string;
  /** The time of that opening, `HH:MM`, Paris time. Needs `registration_opening`. */
  registration_opening_time?: string;
  notes?: string;
  formats: {
    id?: string;
    name?: string;
    race_type: string;
    distance_km?: number;
    duration_min?: number;
    time_limit_min?: number;
    elevation_gain_m?: number;
    /** In euros, to the cent. */
    price_eur?: number;
    /** A link to the course on a website. */
    route_url?: string;
    /** What to do with the track, once the batch is saved. None is `keep`. */
    gpx?: GpxChange;
    /** What the message that says a track was not sent calls the format. It defaults to its name. */
    label?: string;
    date?: string;
  }[];
  /** The member takes part in the format at `formatIndex` of `formats`. Only when the event is created. */
  join?: { formatIndex: number; status: Status };
};

type FormatDraft = EventDraft["formats"][number];

// PocketBase stores what is not set as an empty text or 0, so that is what
// is sent: it is also how a modification clears a field.

function eventBody(draft: EventDraft): Record<string, unknown> {
  return {
    name: draft.name,
    location: draft.location,
    start_date: draft.start_date,
    end_date: draft.end_date ?? "",
    registration_url: draft.registration_url ?? "",
    registration_deadline: draft.registration_deadline ?? "",
    registration_opening: draft.registration_opening ?? "",
    registration_opening_time: draft.registration_opening_time ?? "",
    notes: draft.notes ?? "",
  };
}

function formatBody(format: FormatDraft): Record<string, unknown> {
  return {
    name: format.name ?? "",
    race_type: format.race_type,
    distance_km: format.distance_km ?? 0,
    duration_min: format.duration_min ?? 0,
    time_limit_min: format.time_limit_min ?? 0,
    elevation_gain_m: format.elevation_gain_m ?? 0,
    price_eur: format.price_eur ?? 0,
    route_url: format.route_url ?? "",
    date: format.date ?? "",
  };
}

/** Whether a day (a `YYYY-MM-DD` text, which sorts like the day) is in the dates the event has now. An empty day is. */
function isInRangeOf(event: EventView["event"], day: string | undefined): boolean {
  if (!day) return true;
  return day >= event.start_date && (!event.end_date || day <= event.end_date);
}

/**
 * The requests that save `draft`, in the order the server needs.
 *
 * - Creation: the event, then its formats in the order of the form, then the
 *   participation of the member (`myRunnerId`) when `draft.join` is set.
 * - Modification (`existing` is the event as it was loaded), always in four
 *   phases:
 *   1. the formats taken off the form are deleted;
 *   2. the formats that stay are updated, each with its own date when that day
 *      is in the dates the event has now (the stored ones), and with no date
 *      otherwise (an empty date is always valid);
 *   3. the event is updated;
 *   4. the formats whose date is a day the event gains get that date (an
 *      update that sends nothing else), and the new formats are created.
 *
 * The server checks the date of a format against the event, and the dates of
 * an event against its formats, as they are when each request runs. Phase 2
 * only keeps dates the stored event accepts, and phase 3 only meets stored
 * dates that are either the final ones or empty, so the event can shrink,
 * extend, or move to other days, with its formats moving along, in one batch:
 * whatever the final state, if it is valid, no request fails on the way. A
 * format is never sent with its `event` once it exists: the server refuses to
 * move one. A request of phase 2 and the one of phase 4 for the same format
 * have its id, which is how an error is told to be about its row.
 *
 * `formatIds` is the id of each format of `draft.formats`, in order.
 */
export function buildBatch(
  draft: EventDraft,
  existing: EventView | undefined,
  myRunnerId: string,
): { ops: BatchOp[]; eventId: string; formatIds: string[] } {
  const eventId = existing?.event.id ?? draft.id ?? newId();
  const existingIds = new Set(existing?.formats.map(({ format }) => format.id));

  const eventOp: BatchOp = {
    action: existing ? "update" : "create",
    collection: "events",
    id: eventId,
    body: eventBody(draft),
  };

  const formatIds: string[] = [];
  const keptOps: BatchOp[] = [];
  const lateOps: BatchOp[] = [];
  for (const format of draft.formats) {
    const id = format.id ?? newId();
    formatIds.push(id);
    if (existing && existingIds.has(id)) {
      // A day that the event does not have yet waits for the event.
      const waits = !isInRangeOf(existing.event, format.date);
      const kept = waits ? { ...format, date: undefined } : format;
      keptOps.push({ action: "update", collection: "formats", id, body: formatBody(kept) });
      if (waits) {
        lateOps.push({ action: "update", collection: "formats", id, body: { date: format.date } });
      }
    } else {
      lateOps.push({
        action: "create",
        collection: "formats",
        id,
        body: { event: eventId, ...formatBody(format) },
      });
    }
  }

  const deleteOps = (existing?.formats ?? [])
    .filter(({ format }) => !formatIds.includes(format.id))
    .map(({ format }): BatchOp => ({ action: "delete", collection: "formats", id: format.id }));

  const joinOps: BatchOp[] = [];
  if (draft.join) {
    const format = formatIds[draft.join.formatIndex];
    if (format === undefined) {
      throw new RangeError(`there is no format at the index ${draft.join.formatIndex}`);
    }
    if (myRunnerId === "") throw new Error("joining the event needs the runner of the member");
    joinOps.push({
      action: "create",
      collection: "participations",
      id: newId(),
      body: { runner: myRunnerId, event: eventId, format, status: draft.join.status },
    });
  }

  const ops = [...deleteOps, ...keptOps, eventOp, ...lateOps, ...joinOps];
  return { ops, eventId, formatIds };
}

/**
 * The event is saved, but the track of some of its formats was not sent or not
 * taken off. `formats` names them, in the order of the form, `causes` is what
 * each request failed with (one per name, in the same order: the answer of the
 * server tells why), and `eventId` is the event that was saved, for the caller
 * to go on with it.
 */
export class TraceUploadError extends Error {
  constructor(
    public readonly formats: string[],
    public readonly eventId = "",
    public readonly causes: unknown[] = [],
  ) {
    super(`the track of ${formats.join(", ")} was not sent`);
    this.name = "TraceUploadError";
  }
}

/** The start of a document that has its XML declaration, after blanks (`text()` has dropped any BOM). */
const XML_DECLARATION = /^\s*<\?xml/;

/**
 * PocketBase tells the type of a file from what it holds, and does not take a
 * GPX file that has no XML declaration for XML (it says `text/plain` and refuses
 * it). A file that starts with the declaration goes as it is; any other gets
 * one, in UTF-8.
 */
async function withXmlDeclaration(file: File): Promise<File> {
  const text = await file.text();
  if (XML_DECLARATION.test(text)) return file;
  return new File([`<?xml version="1.0" encoding="UTF-8"?>\n${text}`], file.name, {
    type: "application/gpx+xml",
  });
}

/**
 * Sends the track of each format that has a new one, and takes off those that
 * are to be. `formatIds` is the id of each format, and `rows` what to do with
 * each, in the same order. The requests go one after the other, in that order,
 * and one that fails does not stop the others.
 *
 * @throws {TraceUploadError} naming the formats whose request failed.
 */
export async function uploadTraces(
  formatIds: string[],
  rows: { gpx?: GpxChange; label?: string; name?: string }[],
): Promise<void> {
  const failed: string[] = [];
  const causes: unknown[] = [];
  for (const [i, row] of rows.entries()) {
    const id = formatIds[i];
    const change = row.gpx;
    if (id === undefined || change === undefined || change.kind === "keep") continue;
    try {
      if (change.kind === "remove") {
        await pb.collection("formats").update(id, { gpx: null });
      } else {
        const body = new FormData();
        const file = await withXmlDeclaration(change.file);
        body.append("gpx", file, file.name);
        await pb.collection("formats").update(id, body);
      }
    } catch (err) {
      failed.push(row.label ?? (row.name || id));
      causes.push(err);
    }
  }
  if (failed.length > 0) throw new TraceUploadError(failed, "", causes);
}

/** What a failed request of the batch was about, to show its error where the user can fix it. */
export type SaveTarget =
  | { kind: "event" }
  /** The format at this index of `EventDraft.formats`. */
  | { kind: "format"; index: number }
  /** The deletion of a format that was taken off the form. */
  | { kind: "removal" }
  | { kind: "participation" };

/**
 * The server refused the batch because of one of its requests, none of which
 * was saved. `target` says which one, `fields` has the code of each field the
 * server found invalid, and `code` is what to say when no field of the form
 * is concerned.
 */
export class SaveEventError extends Error {
  readonly target: SaveTarget;
  readonly fields: Readonly<Record<string, string>>;
  readonly code: string | undefined;

  constructor(
    target: SaveTarget,
    fields: Record<string, string>,
    code: string | undefined,
    cause: unknown,
  ) {
    super(code ?? "a request of the batch was refused", { cause });
    this.name = "SaveEventError";
    this.target = target;
    this.fields = fields;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The index of the request that failed in a refused batch, and the answer to that request; undefined for any other error. */
function failedRequest(
  err: unknown,
): { index: number; status: number; answer: unknown } | undefined {
  if (!(err instanceof ClientResponseError)) return undefined;
  // `{requests: {"<index>": {code, message, response: {status, message, data}}}}`
  const data: unknown = err.response.data;
  const requests = isRecord(data) ? data.requests : undefined;
  if (!isRecord(requests)) return undefined;
  const [entry] = Object.entries(requests);
  if (!entry) return undefined;
  const [index, failed] = entry;
  const answer = isRecord(failed) ? failed.response : undefined;
  if (!isRecord(answer) || typeof answer.status !== "number") return undefined;
  return { index: Number(index), status: answer.status, answer };
}

/** The codes of the messages of the rules that refuse a request, which have no field. */
const CODE_OF_STATUS: Readonly<Record<number, string>> = { 403: "forbidden", 404: "not_found" };

function toSaveError(
  err: unknown,
  ops: BatchOp[],
  formatIds: string[],
): SaveEventError | undefined {
  const failed = failedRequest(err);
  const op = failed && ops[failed.index];
  if (!failed || !op) return undefined;

  let target: SaveTarget;
  if (op.collection === "events") target = { kind: "event" };
  else if (op.collection === "participations") target = { kind: "participation" };
  else if (op.action === "delete") target = { kind: "removal" };
  else target = { kind: "format", index: formatIds.indexOf(op.id) };

  // The answer to the request has the shape of any answer of the API, which
  // the helpers of the i18n read.
  const answer = new ClientResponseError({ status: failed.status, response: failed.answer });
  const fields = fieldErrors(answer);
  const code = errorCode(answer) ?? Object.values(fields)[0] ?? CODE_OF_STATUS[failed.status];
  return new SaveEventError(target, fields, code, err);
}

/**
 * Saves the event in one batch and gives its id. `myRunnerId` is the runner of
 * the member, needed for `draft.join`. A batch that the server refuses for one
 * of its requests throws a `SaveEventError`; any other failure (a network
 * failure, say) is thrown as it came. Once the batch is saved, the tracks are
 * sent: those that cannot be make a `TraceUploadError`, which has the id of the
 * event that is saved all the same.
 */
export async function saveEvent(
  draft: EventDraft,
  existing?: EventView,
  myRunnerId?: string,
): Promise<string> {
  const { ops, eventId, formatIds } = buildBatch(draft, existing, myRunnerId ?? "");

  const batch = pb.createBatch();
  for (const op of ops) {
    const records = batch.collection(op.collection);
    if (op.action === "create") records.create({ id: op.id, ...op.body });
    else if (op.action === "update") records.update(op.id, op.body);
    else records.delete(op.id);
  }
  try {
    await batch.send();
  } catch (err) {
    throw toSaveError(err, ops, formatIds) ?? err;
  }
  try {
    await uploadTraces(formatIds, draft.formats);
  } catch (err) {
    if (err instanceof TraceUploadError) {
      throw new TraceUploadError(err.formats, eventId, err.causes);
    }
    throw err;
  }
  return eventId;
}
