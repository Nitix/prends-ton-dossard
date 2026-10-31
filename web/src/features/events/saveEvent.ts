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

/** One request of the batch. A `create` carries its own id, which the client chose. */
export type BatchOp = {
  action: "create" | "update" | "delete";
  collection: "events" | "formats" | "participations";
  id: string;
  body?: Record<string, unknown>;
};

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
  notes?: string;
  formats: {
    id?: string;
    name?: string;
    race_type: string;
    distance_km?: number;
    duration_min?: number;
    time_limit_min?: number;
    elevation_gain_m?: number;
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
    date: format.date ?? "",
  };
}

/** Whether a day (a `YYYY-MM-DD` text, which sorts like the day) is in the dates the event has now. An empty day is. */
function isInRangeOf(event: EventView["event"], day: string | undefined): boolean {
  if (!day) return true;
  return day >= event.start_date && (!event.end_date || day <= event.end_date);
}

/**
 * The requests that save `draft`.
 *
 * - Creation: the event, then its formats in the order of the form, then the
 *   participation of the member (`myRunnerId`) when `draft.join` is set.
 * - Modification (`existing` is the event as it was loaded): the formats taken
 *   off the form are deleted, the event and the formats that stay are
 *   updated, and the new ones are created. A format is never sent with its
 *   `event`: the server refuses to move one.
 *
 * The server checks the dates of a format against the event, and the dates of
 * an event against its formats, as they are when each request runs. So when
 * the dates of the event change, the order matters: the formats go first if
 * all of them fit the dates the event has now (so that the event can shrink
 * around them), and the event goes first otherwise (so that they can move to
 * the days it gains). The formats that are deleted always go first: a format
 * on its way out must not hold the event back.
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
  const formatOps = draft.formats.map((format): BatchOp => {
    const id = format.id ?? newId();
    return existingIds.has(id)
      ? { action: "update", collection: "formats", id, body: formatBody(format) }
      : {
          action: "create",
          collection: "formats",
          id,
          body: { event: eventId, ...formatBody(format) },
        };
  });
  const formatIds = formatOps.map((op) => op.id);

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
      body: { runner: myRunnerId, format, status: draft.join.status },
    });
  }

  const datesChanged =
    existing !== undefined &&
    (draft.start_date !== existing.event.start_date ||
      (draft.end_date ?? "") !== (existing.event.end_date ?? ""));
  const formatsFirst =
    existing !== undefined &&
    datesChanged &&
    draft.formats.every((format) => isInRangeOf(existing.event, format.date));

  const ops = formatsFirst
    ? [...deleteOps, ...formatOps, eventOp, ...joinOps]
    : [...deleteOps, eventOp, ...formatOps, ...joinOps];
  return { ops, eventId, formatIds };
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
 * failure, say) is thrown as it came.
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
  return eventId;
}
