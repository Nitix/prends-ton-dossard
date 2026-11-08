import { ClientResponseError } from "pocketbase";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { fieldErrors } from "../../i18n/errors";
import { toEventView, type EventView } from "./api";
import {
  buildBatch,
  saveEvent,
  SaveEventError,
  TraceUploadError,
  uploadTraces,
  type BatchOp,
  type EventDraft,
} from "./saveEvent";
import { eventRecord, f15, f42, trailType } from "./testFixture";

type Rec = Record<string, unknown>;
type Call = { action: string; collection: string; id?: string; body?: Rec };

const mocks = vi.hoisted(() => ({
  calls: [] as Call[],
  /** What the server was asked, in order: the batch, then each format that is updated on its own. */
  order: [] as string[],
  send: vi.fn<() => Promise<unknown>>(),
  update: vi.fn<(id: string, body: unknown) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    createBatch: () => ({
      collection: (collection: string) => ({
        create: (body: Rec) => mocks.calls.push({ action: "create", collection, body }),
        update: (id: string, body: Rec) =>
          mocks.calls.push({ action: "update", collection, id, body }),
        delete: (id: string) => mocks.calls.push({ action: "delete", collection, id }),
      }),
      send: () => {
        mocks.order.push("batch");
        return mocks.send();
      },
    }),
    collection: (collection: string) => ({
      update: (id: string, body: unknown) => {
        mocks.order.push(`update ${collection} ${id}`);
        return mocks.update(id, body);
      },
    }),
  },
}));

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.order.length = 0;
  mocks.send.mockReset().mockResolvedValue([]);
  mocks.update.mockReset().mockResolvedValue({});
});

const ME = "aliceRunner0000";
const ID_FORMAT = /^[a-z0-9]{15}$/;

/** A new event with two formats: a 42 km trail on the second day, and a 15 km one. */
function newDraft(extra: Partial<EventDraft> = {}): EventDraft {
  return {
    name: "Trail des Crêtes",
    location: "Annecy",
    start_date: "2026-06-13",
    end_date: "2026-06-14",
    formats: [
      { race_type: trailType.id, distance_km: 42, time_limit_min: 600, date: "2026-06-14" },
      { race_type: trailType.id, distance_km: 15, elevation_gain_m: 700 },
    ],
    ...extra,
  };
}

/** The event of the fixture (13-14 June, F15 and F42), which `existing` is. */
const existing = () => toEventView(eventRecord);

/** The draft that changes nothing of the fixture, ids included. */
function editDraft(extra: Partial<EventDraft> = {}): EventDraft {
  return {
    id: "event",
    name: "Trail des Crêtes",
    location: "Annecy",
    start_date: "2026-06-13",
    end_date: "2026-06-14",
    formats: [
      {
        id: "f42",
        race_type: trailType.id,
        distance_km: 42,
        time_limit_min: 600,
        elevation_gain_m: 2400,
        date: "2026-06-14",
      },
      { id: "f15", race_type: trailType.id, distance_km: 15, elevation_gain_m: 700 },
    ],
    ...extra,
  };
}

const summary = (ops: { action: string; collection: string }[]) =>
  ops.map(({ action, collection }) => `${action} ${collection}`);

describe("buildBatch, creation", () => {
  test("an event with two formats and my participation: four operations, in this order", () => {
    const { ops } = buildBatch(
      newDraft({ join: { formatIndex: 0, status: "registered" } }),
      undefined,
      ME,
    );

    expect(summary(ops)).toEqual([
      "create events",
      "create formats",
      "create formats",
      "create participations",
    ]);
  });

  test("the ids are made here, in the format of PocketBase, and are all different", () => {
    const { ops, eventId } = buildBatch(
      newDraft({ join: { formatIndex: 0, status: "registered" } }),
      undefined,
      ME,
    );

    for (const op of ops) expect(op.id).toMatch(ID_FORMAT);
    expect(new Set(ops.map((op) => op.id)).size).toBe(4);
    expect(ops[0]?.id).toBe(eventId);
  });

  test("the formats say which event they belong to", () => {
    const { ops, eventId } = buildBatch(newDraft(), undefined, ME);

    expect(ops[1]?.body?.event).toBe(eventId);
    expect(ops[2]?.body?.event).toBe(eventId);
  });

  test("my participation is on the first format, for my runner", () => {
    const { ops } = buildBatch(
      newDraft({ join: { formatIndex: 0, status: "registered" } }),
      undefined,
      ME,
    );

    expect(ops[3]?.body).toEqual({
      runner: ME,
      event: ops[0]?.id,
      format: ops[1]?.id,
      status: "registered",
    });
  });

  test("my participation says which event it is on, the one the same batch creates", () => {
    const { ops, eventId } = buildBatch(
      newDraft({ join: { formatIndex: 1, status: "registered" } }),
      undefined,
      ME,
    );

    expect(ops[3]?.collection).toBe("participations");
    expect(ops[3]?.body?.event).toBe(eventId);
  });

  test("it can be on the other format", () => {
    const { ops } = buildBatch(
      newDraft({ join: { formatIndex: 1, status: "interested" } }),
      undefined,
      ME,
    );

    expect(ops[3]?.body).toEqual({
      runner: ME,
      event: ops[0]?.id,
      format: ops[2]?.id,
      status: "interested",
    });
  });

  test("without a choice to join, there is no participation", () => {
    const { ops } = buildBatch(newDraft(), undefined, ME);

    expect(summary(ops)).toEqual(["create events", "create formats", "create formats"]);
  });

  test("what is not filled in goes as an empty text or 0, and the creator is never sent", () => {
    const { ops } = buildBatch(newDraft({ end_date: undefined }), undefined, ME);

    expect(ops[0]?.body).toEqual({
      name: "Trail des Crêtes",
      location: "Annecy",
      start_date: "2026-06-13",
      end_date: "",
      registration_url: "",
      registration_deadline: "",
      registration_opening: "",
      registration_opening_time: "",
      date_precision: "",
      notes: "",
    });
    expect(ops[2]?.body).toEqual({
      event: ops[0]?.id,
      name: "",
      race_type: trailType.id,
      distance_km: 15,
      duration_min: 0,
      time_limit_min: 0,
      elevation_gain_m: 700,
      price_eur: 0,
      route_url: "",
      date: "",
      start_time: "",
    });
  });

  test("the link of the course is sent when it is filled in, empty otherwise (which clears it)", () => {
    const draft = newDraft();
    const [first] = draft.formats;
    if (first) first.route_url = "https://www.openrunner.com/route-details/123";

    const { ops } = buildBatch(draft, undefined, ME);

    expect(ops[1]?.body).toMatchObject({
      route_url: "https://www.openrunner.com/route-details/123",
    });
    expect(ops[2]?.body).toMatchObject({ route_url: "" });
    // The track itself never goes in the batch: it is a file, sent afterwards.
    expect(ops[1]?.body).not.toHaveProperty("gpx");
  });

  test("the deadline and the price are sent when they are filled in", () => {
    const draft = newDraft({ registration_deadline: "2026-06-10" });
    const [first] = draft.formats;
    if (first) first.price_eur = 42.5;

    const { ops } = buildBatch(draft, undefined, ME);

    expect(ops[0]?.body).toMatchObject({ registration_deadline: "2026-06-10" });
    expect(ops[1]?.body).toMatchObject({ price_eur: 42.5 });
    expect(ops[2]?.body).toMatchObject({ price_eur: 0 });
  });

  test("eventBody — l'ouverture et son heure", () => {
    const draft = newDraft({
      registration_opening: "2026-05-01",
      registration_opening_time: "10:00",
    });

    const { ops } = buildBatch(draft, undefined, ME);

    expect(ops[0]?.body).toMatchObject({
      registration_opening: "2026-05-01",
      registration_opening_time: "10:00",
    });
  });

  test("a format that comes with an id keeps it", () => {
    const draft = newDraft();
    const [first] = draft.formats;
    if (first) first.id = "mine12345678901";

    const { ops } = buildBatch(draft, undefined, ME);

    expect(ops[1]?.id).toBe("mine12345678901");
  });

  test("gives the id of each format of the draft, in order", () => {
    const { ops, formatIds } = buildBatch(newDraft(), undefined, ME);

    expect(formatIds).toEqual([ops[1]?.id, ops[2]?.id]);
  });
});

describe("buildBatch, modification", () => {
  test("changes the formats that stay, then the event, by their id, and never sends the event of a format", () => {
    const { ops, eventId } = buildBatch(editDraft(), existing(), ME);

    expect(eventId).toBe("event");
    expect(summary(ops)).toEqual(["update formats", "update formats", "update events"]);
    expect(ops.map((op) => op.id)).toEqual(["f42", "f15", "event"]);
    for (const op of ops.slice(0, 2)) expect(op.body).not.toHaveProperty("event");
    expect(ops[2]?.body).not.toHaveProperty("created_by");
    // The dates are those of the draft: they all are days the event has.
    expect(ops[0]?.body).toMatchObject({ date: "2026-06-14" });
  });

  test("a format that was taken off the form is deleted", () => {
    const draft = editDraft();
    draft.formats = draft.formats.filter((format) => format.id !== "f15");

    const { ops } = buildBatch(draft, existing(), ME);

    expect(ops.filter((op) => op.action === "delete")).toEqual([
      { action: "delete", collection: "formats", id: "f15" },
    ]);
    expect(ops.filter((op) => op.collection === "formats" && op.action !== "delete")).toHaveLength(
      1,
    );
  });

  test("a format with no id is a new one, for the event", () => {
    const draft = editDraft();
    draft.formats.push({ race_type: trailType.id, duration_min: 360 });

    const { ops, formatIds } = buildBatch(draft, existing(), ME);

    const created = ops.filter((op) => op.action === "create");
    expect(created).toHaveLength(1);
    expect(created[0]?.collection).toBe("formats");
    expect(created[0]?.id).toMatch(ID_FORMAT);
    expect(created[0]?.body?.event).toBe("event");
    expect(formatIds).toEqual(["f42", "f15", created[0]?.id]);
  });

  test("a cleared end date, date or measure is sent as empty to clear it", () => {
    const draft = editDraft({ end_date: undefined });
    draft.formats = [{ id: "f15", race_type: trailType.id, distance_km: 15 }];

    const { ops } = buildBatch(draft, existing(), ME);

    expect(ops.find((op) => op.collection === "events")?.body).toMatchObject({ end_date: "" });
    expect(ops.find((op) => op.id === "f15")?.body).toMatchObject({
      date: "",
      time_limit_min: 0,
      elevation_gain_m: 0,
    });
  });

  test("the removed formats go first, so that they do not stop the dates of the event from changing", () => {
    const draft = editDraft({ end_date: undefined });
    draft.formats = [{ id: "f15", race_type: trailType.id, distance_km: 15 }];

    const { ops } = buildBatch(draft, existing(), ME);

    expect(summary(ops)).toEqual(["delete formats", "update formats", "update events"]);
  });

  test("the new formats are created after the event, whose dates they have to fit", () => {
    const draft = editDraft({ end_date: "2026-06-15" });
    draft.formats.push({ race_type: trailType.id, duration_min: 360, date: "2026-06-15" });

    const { ops } = buildBatch(draft, existing(), ME);

    expect(summary(ops)).toEqual([
      "update formats",
      "update formats",
      "update events",
      "create formats",
    ]);
  });

  test("a format that moves to a day the event gains: its date waits for the event", () => {
    const draft = editDraft({ end_date: "2026-06-15" });
    const [first] = draft.formats;
    if (first) first.date = "2026-06-15";

    const { ops } = buildBatch(draft, existing(), ME);

    expect(summary(ops)).toEqual([
      "update formats",
      "update formats",
      "update events",
      "update formats",
    ]);
    expect(ops[0]).toMatchObject({ id: "f42", body: { date: "", distance_km: 42 } });
    // The late request sends nothing but the date, and never the event.
    expect(ops[3]).toEqual({
      action: "update",
      collection: "formats",
      id: "f42",
      body: { date: "2026-06-15" },
    });
  });
});

// The server checks the date of a format against the event as it is stored,
// and the dates of an event against the formats as they are stored, each
// time a request runs (server/events/hooks.go). This runs the requests of a
// batch against those two checks, in their order.

type Stored = { start: string; end: string; month: boolean; formats: Map<string, string> };

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

const isWithin = (day: string, start: string, end: string) =>
  day >= start && (end === "" || day <= end);

function runOnServer(ops: BatchOp[], view: EventView): Stored {
  const stored: Stored = {
    start: view.event.start_date,
    end: view.event.end_date ?? "",
    month: view.event.date_precision === "month",
    formats: new Map(view.formats.map(({ format }) => [format.id, format.date ?? ""])),
  };
  ops.forEach((op, index) => {
    if (op.collection === "events") {
      const start = textOf(op.body?.start_date);
      const end = textOf(op.body?.end_date);
      const month = textOf(op.body?.date_precision) === "month";
      for (const [id, day] of stored.formats) {
        if (month && day !== "") {
          throw new Error(`request ${index}: the event becomes a month while ${id} has a date`);
        }
        if (day !== "" && !isWithin(day, start, end)) {
          throw new Error(`request ${index}: the date ${day} of ${id} is out of the event`);
        }
      }
      stored.start = start;
      stored.end = end;
      stored.month = month;
    } else if (op.collection === "formats") {
      if (op.action === "delete") {
        stored.formats.delete(op.id);
        return;
      }
      const day = typeof op.body?.date === "string" ? op.body.date : stored.formats.get(op.id);
      if (day !== undefined && day !== "" && stored.month) {
        throw new Error(`request ${index}: ${op.id} has a date, and the event is a month`);
      }
      if (day !== undefined && day !== "" && !isWithin(day, stored.start, stored.end)) {
        throw new Error(`request ${index}: the date ${day} of ${op.id} is out of the event`);
      }
      if (textOf(op.body?.start_time) !== "" && stored.month) {
        throw new Error(`request ${index}: ${op.id} has a start time, and the event is a month`);
      }
      stored.formats.set(op.id, day ?? "");
    }
  });
  return stored;
}

/** The event of the fixture with F15 dated on the first day too: 13-14 June, F15 on the 13th, F42 on the 14th. */
const datedExisting = () =>
  toEventView({
    ...eventRecord,
    expand: { formats_via_event: [f42, { ...f15, date: "2026-06-13" }] },
  });

/** A draft of `editDraft`'s event with the dates of the event and of each format (F42, F15) given. */
function movedDraft(start: string, end: string | undefined, dates: [string?, string?]): EventDraft {
  const draft = editDraft({ start_date: start, end_date: end });
  draft.formats = draft.formats.map((format, index) => ({ ...format, date: dates[index] }));
  return draft;
}

describe("buildBatch, the dates of the event and of its formats move together", () => {
  test("postponing a two-day event with its day-2 format moved along: 13-14 to 20-21, F42 to the 21st", () => {
    const draft = movedDraft("2026-06-20", "2026-06-21", ["2026-06-21", undefined]);

    const { ops } = buildBatch(draft, existing(), ME);

    // The format waits (no date), the event moves, then the format gets its day.
    expect(summary(ops)).toEqual([
      "update formats",
      "update formats",
      "update events",
      "update formats",
    ]);
    expect(ops.map((op) => op.id)).toEqual(["f42", "f15", "event", "f42"]);
    expect(ops[0]?.body).toMatchObject({ date: "" });
    expect(ops[3]?.body).toEqual({ date: "2026-06-21" });
    for (const op of ops.filter(({ collection }) => collection === "formats")) {
      expect(op.body).not.toHaveProperty("event");
    }
    const stored = runOnServer(ops, existing());
    expect(stored).toMatchObject({ start: "2026-06-20", end: "2026-06-21" });
    expect(stored.formats.get("f42")).toBe("2026-06-21");
  });

  test("an overlapping shift: F15 dated on the old first day goes undated, F42 moves to the new day", () => {
    // 13-14 June becomes 14-15 June: F15 (the 13th) is cleared, F42 (the 14th) moves to the 15th.
    const draft = movedDraft("2026-06-14", "2026-06-15", ["2026-06-15", undefined]);

    const { ops } = buildBatch(draft, datedExisting(), ME);

    expect(summary(ops)).toEqual([
      "update formats",
      "update formats",
      "update events",
      "update formats",
    ]);
    const stored = runOnServer(ops, datedExisting());
    expect(stored).toMatchObject({ start: "2026-06-14", end: "2026-06-15" });
    expect(stored.formats.get("f42")).toBe("2026-06-15");
    expect(stored.formats.get("f15")).toBe("");
  });

  test("the model of the server does refuse the order that puts the event first", () => {
    const draft = movedDraft("2026-06-20", "2026-06-21", ["2026-06-21", undefined]);
    const { ops } = buildBatch(draft, existing(), ME);
    const [, , event] = ops;
    if (!event) throw new Error("no event request");

    expect(() => runOnServer([event, ...ops.filter((op) => op !== event)], existing())).toThrow(
      /out of the event/,
    );
  });

  // Every final state that is valid is saved by the same batch.
  test.each([
    ["the same dates", "2026-06-13", "2026-06-14", ["2026-06-14", undefined]],
    ["shrinking to one day, dates cleared", "2026-06-13", undefined, [undefined, undefined]],
    ["extending, F42 moved to the new day", "2026-06-13", "2026-06-15", ["2026-06-15", undefined]],
    [
      "a disjoint shift, formats dated on both days",
      "2026-06-20",
      "2026-06-21",
      ["2026-06-21", "2026-06-20"],
    ],
    ["a disjoint shift, dates cleared", "2026-06-20", "2026-06-21", [undefined, undefined]],
    [
      "an overlapping shift, F15 on the shared day",
      "2026-06-14",
      "2026-06-15",
      ["2026-06-15", "2026-06-14"],
    ],
    ["an earlier event", "2026-05-01", "2026-05-02", ["2026-05-02", "2026-05-01"]],
    ["an open-ended event, F42 on a later day", "2026-06-13", undefined, ["2026-06-30", undefined]],
  ] as const)("%s", (_name, start, end, dates) => {
    const draft = movedDraft(start, end, [dates[0], dates[1]]);

    const { ops } = buildBatch(draft, existing(), ME);

    const stored = runOnServer(ops, existing());
    expect(stored).toMatchObject({ start, end: end ?? "" });
    expect(stored.formats.get("f42")).toBe(dates[0] ?? "");
    expect(stored.formats.get("f15")).toBe(dates[1] ?? "");
  });

  test("a removed format that was dated outside the new dates does not hold the event back", () => {
    const draft = movedDraft("2026-06-20", "2026-06-21", [undefined, undefined]);
    draft.formats = draft.formats.filter((format) => format.id !== "f42");

    const { ops } = buildBatch(draft, existing(), ME);

    expect(summary(ops)).toEqual(["delete formats", "update formats", "update events"]);
    expect(runOnServer(ops, existing()).formats.has("f42")).toBe(false);
  });
});

describe("saveEvent", () => {
  test("sends every operation in one batch and gives the id of the event", async () => {
    const id = await saveEvent(
      newDraft({ join: { formatIndex: 0, status: "registered" } }),
      undefined,
      ME,
    );

    expect(mocks.send).toHaveBeenCalledOnce();
    expect(summary(mocks.calls)).toEqual([
      "create events",
      "create formats",
      "create formats",
      "create participations",
    ]);
    expect(mocks.calls[0]?.body?.id).toBe(id);
    expect(mocks.calls[1]?.body).toMatchObject({ event: id, distance_km: 42 });
    expect(mocks.calls[3]?.body).toMatchObject({
      runner: ME,
      event: id,
      format: mocks.calls[1]?.body?.id,
    });
  });

  test("a modification updates by id, with no event in the formats, and deletes the removed ones", async () => {
    const draft = editDraft();
    draft.formats = draft.formats.filter((format) => format.id !== "f15");

    const id = await saveEvent(draft, existing(), ME);

    expect(id).toBe("event");
    expect(mocks.calls).toContainEqual({ action: "delete", collection: "formats", id: "f15" });
    const updates = mocks.calls.filter(({ action }) => action === "update");
    expect(updates.map((call) => call.id ?? "").toSorted((a, b) => a.localeCompare(b))).toEqual([
      "event",
      "f42",
    ]);
    for (const { body } of updates.filter(({ collection }) => collection === "formats")) {
      expect(body).not.toHaveProperty("event");
    }
  });

  test("wanting to join with no runner is a mistake of the caller: nothing is sent", async () => {
    await expect(
      saveEvent(newDraft({ join: { formatIndex: 0, status: "registered" } })),
    ).rejects.toThrow(/runner/);

    expect(mocks.send).not.toHaveBeenCalled();
  });

  test("a join on a format that is not there is refused before sending", async () => {
    await expect(
      saveEvent(newDraft({ join: { formatIndex: 5, status: "registered" } }), undefined, ME),
    ).rejects.toThrow(RangeError);

    expect(mocks.send).not.toHaveBeenCalled();
  });
});

/** A field error of the server, whose text is never shown. */
const field = (code: string) => ({ code, message: "server text" });

/** What PocketBase answers when the request number `index` of a batch fails. */
function refused(index: number, status: number, data: Rec = {}) {
  return new ClientResponseError({
    url: "/api/batch",
    status: 400,
    response: {
      status: 400,
      message: "Batch transaction failed.",
      data: {
        requests: {
          [index]: {
            code: "batch_request_failed",
            message: "Batch request failed.",
            response: { status, message: "Failed.", data },
          },
        },
      },
    },
  });
}

/** The error that saving the draft throws when the server answers `err` to the batch. */
async function failure(
  err: unknown,
  draft = newDraft(),
  prior?: EventView,
): Promise<SaveEventError> {
  mocks.send.mockRejectedValue(err);
  try {
    await saveEvent(draft, prior, ME);
  } catch (caught) {
    if (caught instanceof SaveEventError) return caught;
    throw caught;
  }
  throw new Error("saveEvent did not fail");
}

describe("saveEvent, a refused batch", () => {
  test("the first request is the event: its fields have the codes of the server", async () => {
    const error = await failure(
      refused(0, 400, { end_date: { code: "end_before_start", message: "x" } }),
    );

    expect(error.target).toEqual({ kind: "event" });
    expect(error.fields).toEqual({ end_date: "end_before_start" });
  });

  test("the request of a format is that of its row in the form", async () => {
    const error = await failure(
      refused(2, 400, { distance_km: { code: "format_measure_required", message: "x" } }),
    );

    expect(error.target).toEqual({ kind: "format", index: 1 });
    expect(error.fields).toEqual({ distance_km: "format_measure_required" });
  });

  test("a removed format has no row: its deletion is told apart", async () => {
    const draft = editDraft();
    draft.formats = draft.formats.filter((format) => format.id !== "f15");

    // The deletion of F15 is the first operation of the batch.
    const error = await failure(refused(0, 404), draft, existing());

    expect(error.target).toEqual({ kind: "removal" });
    expect(error.code).toBe("not_found");
  });

  test("a date the server refuses in the last request belongs to the row of its format", async () => {
    // 13-14 June becomes 20 June, F42 (the first format of the draft) is put on the 21st: out of the event.
    const draft = movedDraft("2026-06-20", undefined, ["2026-06-21", undefined]);
    // The requests: F42 (undated), F15, the event, then the date of F42.
    const error = await failure(
      refused(3, 400, { date: field("format_date_out_of_range") }),
      draft,
      existing(),
    );

    expect(error.target).toEqual({ kind: "format", index: 0 });
    expect(error.fields).toEqual({ date: "format_date_out_of_range" });
  });

  test("the participation is told apart, since it has no field of the form", async () => {
    const error = await failure(
      refused(3, 400, { runner: { code: "validation_not_unique", message: "x" } }),
      newDraft({ join: { formatIndex: 0, status: "registered" } }),
    );

    expect(error.target).toEqual({ kind: "participation" });
    expect(error.fields).toEqual({ runner: "validation_not_unique" });
  });

  test("a rule that refuses (404, 403) has no field: its code comes from the status", async () => {
    expect((await failure(refused(1, 404))).code).toBe("not_found");
    expect((await failure(refused(1, 403))).code).toBe("forbidden");
    expect((await failure(refused(1, 400))).code).toBeUndefined();
  });

  test("the code of a field is the one to show when the error has no field of the form", async () => {
    const error = await failure(
      refused(0, 400, { start_date: { code: "format_date_out_of_range", message: "x" } }),
    );

    expect(error.code).toBe("format_date_out_of_range");
  });

  test("anything else (a network failure, a server error) is not changed", async () => {
    const offline = new ClientResponseError({ status: 0, originalError: new TypeError("fetch") });
    mocks.send.mockRejectedValue(offline);

    await expect(saveEvent(newDraft(), undefined, ME)).rejects.toBe(offline);
  });

  test("an answer that names no request of this batch is not changed either", async () => {
    const odd = refused(9, 400);
    mocks.send.mockRejectedValue(odd);

    await expect(saveEvent(newDraft(), undefined, ME)).rejects.toBe(odd);
  });
});

// --- The tracks, sent after the batch ---

const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const GPX_BODY =
  '<gpx version="1.1" creator="tests" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="45" lon="6"><ele>450</ele></trkpt></trkseg></trk></gpx>';
const GPX = `${DECLARATION}\n${GPX_BODY}`;
/** The mark that some editors put at the start of a UTF-8 file. */
const BOM = String.fromCodePoint(0xfeff);

/** A GPX file as the user picks it. */
const gpxFile = (text = GPX, filename = "trace.gpx") =>
  new File([text], filename, { type: "application/gpx+xml" });

/** What the request number `n` to the server sent as the track (a file), or the body when it is not a form. */
function sentTo(n: number): { id: unknown; body: unknown } {
  const [id, body] = mocks.update.mock.calls[n] ?? [];
  return { id, body };
}

function sentFile(n: number): File {
  const { body } = sentTo(n);
  if (!(body instanceof FormData)) throw new Error("the track was not sent as a form");
  const file = body.get("gpx");
  if (!(file instanceof File)) throw new Error("the form has no file");
  return file;
}

/** The error that a call fails with, which has to be a `TraceUploadError`. */
async function unsent(call: Promise<unknown>): Promise<TraceUploadError> {
  try {
    await call;
  } catch (err) {
    if (err instanceof TraceUploadError) return err;
    throw err;
  }
  throw new Error("every track was sent");
}

describe("uploadTraces", () => {
  test("uploadTraces — envoie les nouvelles traces après le lot, retire celles à retirer", async () => {
    const trace = gpxFile();
    const draft = editDraft();
    const [big, small] = draft.formats;
    if (!big || !small) throw new Error("the draft has two formats");
    draft.formats = [
      { ...big, gpx: { kind: "new", file: trace } },
      { ...small, gpx: { kind: "remove" } },
    ];

    await saveEvent(draft, existing(), ME);

    // The batch first: the formats of the tracks exist (or are updated) by then.
    expect(mocks.order).toEqual(["batch", "update formats f42", "update formats f15"]);
    expect(sentTo(0).id).toBe("f42");
    const sent = sentFile(0);
    expect(sent.name).toBe("trace.gpx");
    expect(await sent.text()).toBe(GPX);
    // A track that is taken off is a field set to null, which is how PocketBase clears a file.
    expect(mocks.update).toHaveBeenNthCalledWith(2, "f15", { gpx: null });
  });

  test("uploadTraces — une trace gardée, ou un champ sans trace, n'envoie rien", async () => {
    const draft = editDraft();
    draft.formats = draft.formats.map((one, i) =>
      i === 0 ? { ...one, gpx: { kind: "keep" } } : one,
    );

    await saveEvent(draft, existing(), ME);

    expect(mocks.order).toEqual(["batch"]);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test("uploadTraces — la trace d'une épreuve créée par le lot part avec l'identifiant choisi pour elle", async () => {
    const draft = newDraft();
    const [first] = draft.formats;
    if (first) first.gpx = { kind: "new", file: gpxFile() };

    await saveEvent(draft, undefined, ME);

    // The id of the first format is the one of the request that creates it.
    const created = mocks.calls.filter(({ collection }) => collection === "formats");
    expect(sentTo(0).id).toBe(created[0]?.body?.id);
    expect(mocks.update).toHaveBeenCalledOnce();
  });

  test("uploadTraces — un fichier sans déclaration XML en reçoit une, que PocketBase reconnaît comme du XML", async () => {
    const bare = gpxFile(GPX_BODY, "sans-declaration.gpx");

    await uploadTraces(["f42"], [{ gpx: { kind: "new", file: bare } }]);

    const sent = sentFile(0);
    expect(await sent.text()).toBe(`${DECLARATION}\n${GPX_BODY}`);
    expect(sent.name).toBe("sans-declaration.gpx");
    expect(sent.type).toBe("application/gpx+xml");
  });

  test("uploadTraces — des espaces avant la balise ne font pas oublier la déclaration", async () => {
    await uploadTraces(["a"], [{ gpx: { kind: "new", file: gpxFile(`\n  ${GPX_BODY}`) } }]);

    expect(await sentFile(0).text()).toBe(`${DECLARATION}\n\n  ${GPX_BODY}`);
  });

  test("uploadTraces — une marque d'ordre des octets sans déclaration : la déclaration est la première chose du fichier envoyé", async () => {
    await uploadTraces(["a"], [{ gpx: { kind: "new", file: gpxFile(`${BOM}${GPX_BODY}`) } }]);

    const sent = sentFile(0);
    expect(await sent.text()).toBe(`${DECLARATION}\n${GPX_BODY}`);
    // Not even the mark in front of it, which an XML parser would refuse after it.
    expect(new Uint8Array(await sent.arrayBuffer()).slice(0, 5)).toEqual(
      new TextEncoder().encode("<?xml"),
    );
  });

  test("uploadTraces — un fichier qui a déjà sa déclaration part tel quel, marque d'ordre des octets comprise", async () => {
    const trace = gpxFile(`${BOM}${GPX}`, "ma-trace.gpx");

    await uploadTraces(["f42"], [{ gpx: { kind: "new", file: trace } }]);

    const sent = sentFile(0);
    expect(sent.name).toBe("ma-trace.gpx");
    expect(await sent.arrayBuffer()).toEqual(await trace.arrayBuffer());
  });

  test("uploadTraces — un échec lève TraceUploadError avec le nom de l'épreuve, les autres traces partent quand même", async () => {
    mocks.update.mockImplementation((id) =>
      id === "f42" ? Promise.reject(new Error("offline")) : Promise.resolve({}),
    );

    const error = await unsent(
      uploadTraces(
        ["f42", "f15", "f10"],
        [
          { label: "Trail 42 km", gpx: { kind: "new", file: gpxFile() } },
          { label: "Trail 15 km", gpx: { kind: "remove" } },
          { label: "Trail 10 km", gpx: { kind: "new", file: gpxFile() } },
        ],
      ),
    );

    expect(error.formats).toEqual(["Trail 42 km"]);
    // The failure of one does not stop the others.
    expect(mocks.update).toHaveBeenCalledTimes(3);
  });

  test("uploadTraces — plusieurs échecs sont tous nommés, dans l'ordre du formulaire", async () => {
    mocks.update.mockRejectedValue(new Error("offline"));

    const error = await unsent(
      uploadTraces(
        ["a", "b"],
        [
          { label: "Trail 42 km", gpx: { kind: "new", file: gpxFile() } },
          { label: "Trail 15 km", gpx: { kind: "remove" } },
        ],
      ),
    );

    expect(error.formats).toEqual(["Trail 42 km", "Trail 15 km"]);
  });

  test("uploadTraces — une épreuve sans libellé est nommée par son nom, sinon par son identifiant", async () => {
    mocks.update.mockRejectedValue(new Error("offline"));

    const error = await unsent(
      uploadTraces(
        ["a", "b"],
        [{ name: "Marathon", gpx: { kind: "remove" } }, { gpx: { kind: "remove" } }],
      ),
    );

    expect(error.formats).toEqual(["Marathon", "b"]);
  });

  test("uploadTraces — la raison de chaque échec est gardée, dans l'ordre des épreuves nommées", async () => {
    const tooBig = new ClientResponseError({
      status: 400,
      response: {
        status: 400,
        message: "Failed to update record.",
        data: { gpx: field("validation_file_size_limit") },
      },
    });
    const offline = new Error("offline");
    mocks.update
      .mockRejectedValueOnce(tooBig)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(offline);

    const error = await unsent(
      uploadTraces(
        ["a", "b", "c"],
        [
          { label: "A", gpx: { kind: "new", file: gpxFile() } },
          { label: "B", gpx: { kind: "remove" } },
          { label: "C", gpx: { kind: "remove" } },
        ],
      ),
    );

    expect(error.formats).toEqual(["A", "C"]);
    // One reason per name, in the same order: the code of the server for the first.
    expect(error.causes).toEqual([tooBig, offline]);
    expect(fieldErrors(error.causes[0])).toEqual({ gpx: "validation_file_size_limit" });
  });

  test("saveEvent — la trace qui n'est pas partie laisse l'événement enregistré, et dit lequel", async () => {
    const offline = new Error("offline");
    mocks.update.mockRejectedValue(offline);
    const draft = editDraft();
    const [big, small] = draft.formats;
    if (!big || !small) throw new Error("the draft has two formats");
    draft.formats = [
      { ...big, label: "Trail 42 km", gpx: { kind: "new", file: gpxFile() } },
      small,
    ];

    const error = await unsent(saveEvent(draft, existing(), ME));

    expect(error.formats).toEqual(["Trail 42 km"]);
    expect(error.causes).toEqual([offline]);
    expect(error.eventId).toBe("event");
    // The batch went through: the event is saved.
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  test("saveEvent — un lot refusé n'envoie aucune trace", async () => {
    mocks.send.mockRejectedValue(refused(0, 400, { name: field("validation_required") }));
    const draft = newDraft();
    const [first] = draft.formats;
    if (first) first.gpx = { kind: "new", file: gpxFile() };

    await expect(saveEvent(draft, undefined, ME)).rejects.toBeInstanceOf(SaveEventError);

    expect(mocks.update).not.toHaveBeenCalled();
  });
});

/** The event of the fixture as a month: June 2027, its formats with no date. */
const monthExisting = () =>
  toEventView({
    ...eventRecord,
    start_date: "2027-06-01",
    end_date: "2027-06-30",
    date_precision: "month",
    expand: { formats_via_event: [{ ...f42, date: "" }, f15] },
  });

/** A draft of the fixture's formats, as a month: no date on any format. */
function monthDraft(extra: Partial<EventDraft> = {}): EventDraft {
  const draft = editDraft({
    start_date: "2027-06-01",
    end_date: "2027-06-30",
    date_precision: "month",
    ...extra,
  });
  draft.formats = draft.formats.map((format) => ({ ...format, date: undefined }));
  return draft;
}

describe("buildBatch — la précision de la date", () => {
  test("la précision part avec la course : `month`, et vide pour un jour (ce qui l'efface)", () => {
    expect(buildBatch(monthDraft(), undefined, ME).ops[0]?.body).toMatchObject({
      date_precision: "month",
      start_date: "2027-06-01",
      end_date: "2027-06-30",
    });
    expect(
      buildBatch(newDraft({ date_precision: "day" }), undefined, ME).ops[0]?.body,
    ).toMatchObject({
      date_precision: "",
    });
    expect(buildBatch(newDraft(), undefined, ME).ops[0]?.body).toMatchObject({
      date_precision: "",
    });
  });

  test("buildBatch — passer au mois vide d'abord les dates des épreuves", () => {
    // 13-14 June 2026, F42 on the 14th: June 2027 as a month.
    const { ops } = buildBatch(monthDraft(), existing(), ME);

    expect(summary(ops)).toEqual(["update formats", "update formats", "update events"]);
    expect(ops[0]).toMatchObject({ id: "f42", body: { date: "" } });
    expect(ops[2]?.body).toMatchObject({ date_precision: "month", start_date: "2027-06-01" });
    // The server refuses an event that becomes a month while a format has a day.
    expect(runOnServer(ops, existing())).toMatchObject({
      start: "2027-06-01",
      end: "2027-06-30",
      month: true,
    });
    expect(runOnServer(ops, existing()).formats.get("f42")).toBe("");
  });

  test("buildBatch — un brouillon au mois qui garderait la date d'une épreuve ne l'envoie pas", () => {
    const draft = monthDraft();
    draft.formats = draft.formats.map((format) => ({ ...format, date: "2027-06-12" }));

    const { ops } = buildBatch(draft, existing(), ME);

    for (const op of ops.filter(({ collection }) => collection === "formats")) {
      expect(op.body).toMatchObject({ date: "" });
    }
    expect(() => runOnServer(ops, existing())).not.toThrow();
  });

  test("buildBatch — une course au mois créée n'envoie aucune date d'épreuve", () => {
    const draft = monthDraft();
    draft.formats = draft.formats.map((format) => ({ ...format, date: "2027-06-12" }));

    const { ops } = buildBatch(draft, undefined, ME);

    expect(summary(ops)).toEqual(["create events", "create formats", "create formats"]);
    expect(ops[1]?.body).toMatchObject({ date: "" });
    expect(ops[2]?.body).toMatchObject({ date: "" });
  });

  test("buildBatch — passer au jour date les épreuves après la course", () => {
    // June 2027 as a month: back to a day, 12-13 June, F42 on the 13th.
    const draft = editDraft({
      start_date: "2027-06-12",
      end_date: "2027-06-13",
      date_precision: "day",
    });
    draft.formats = draft.formats.map((format) => ({
      ...format,
      date: format.id === "f42" ? "2027-06-13" : undefined,
    }));

    const { ops } = buildBatch(draft, monthExisting(), ME);

    // The format is kept with no date first (the stored event is a month, which
    // offers none), then the event changes, then the format gets its day.
    expect(summary(ops)).toEqual([
      "update formats",
      "update formats",
      "update events",
      "update formats",
    ]);
    expect(ops[0]).toMatchObject({ id: "f42", body: { date: "" } });
    expect(ops[2]?.body).toMatchObject({ date_precision: "", start_date: "2027-06-12" });
    expect(ops[3]).toEqual({
      action: "update",
      collection: "formats",
      id: "f42",
      body: { date: "2027-06-13" },
    });
    expect(runOnServer(ops, monthExisting())).toMatchObject({
      start: "2027-06-12",
      end: "2027-06-13",
      month: false,
    });
    expect(runOnServer(ops, monthExisting()).formats.get("f42")).toBe("2027-06-13");
  });

  test("buildBatch — une course qui reste au mois ne sort pas de son mois : ses épreuves restent sans date", () => {
    const { ops } = buildBatch(monthDraft({ name: "Trail de juin" }), monthExisting(), ME);

    expect(summary(ops)).toEqual(["update formats", "update formats", "update events"]);
    expect(ops[2]?.body).toMatchObject({ name: "Trail de juin", date_precision: "month" });
  });

  test("un jour à ajouter à une épreuve d'une course au mois attend que la course devienne un jour", () => {
    // A format dated on a day that is in the stored month: still not in range.
    const draft = editDraft({
      start_date: "2027-06-01",
      end_date: "2027-06-30",
      date_precision: "day",
    });
    draft.formats = draft.formats.map((format) => ({
      ...format,
      date: format.id === "f42" ? "2027-06-10" : undefined,
    }));

    const { ops } = buildBatch(draft, monthExisting(), ME);

    expect(summary(ops)).toEqual([
      "update formats",
      "update formats",
      "update events",
      "update formats",
    ]);
    expect(ops[3]).toMatchObject({ id: "f42", body: { date: "2027-06-10" } });
    expect(() => runOnServer(ops, monthExisting())).not.toThrow();
  });
});

describe("buildBatch — l'heure de départ", () => {
  test("elle part avec l'épreuve, et vide quand il n'y en a pas (ce qui l'efface)", () => {
    const draft = editDraft();
    const [first] = draft.formats;
    if (first) first.start_time = "07:30";

    const { ops } = buildBatch(draft, existing(), ME);

    expect(ops.find((op) => op.id === "f42")?.body).toMatchObject({ start_time: "07:30" });
    expect(ops.find((op) => op.id === "f15")?.body).toMatchObject({ start_time: "" });
  });

  test("une course au mois n'envoie aucune heure de départ, ce que garde le brouillon n'y fait rien", () => {
    const draft = monthDraft();
    draft.formats = draft.formats.map((format) => ({ ...format, start_time: "07:30" }));

    for (const view of [undefined, existing()]) {
      const { ops } = buildBatch(draft, view, ME);

      const formats = ops.filter(({ collection }) => collection === "formats");
      expect(formats.length).toBeGreaterThan(0);
      for (const op of formats) expect(op.body).toMatchObject({ start_time: "" });
    }
  });
});

describe("buildBatch — de la course au mois à la course d'un jour, avec des heures", () => {
  test("l'heure attend l'événement avec la date, et le serveur ne refuse rien", () => {
    const draft = editDraft({
      start_date: "2027-06-12",
      end_date: "2027-06-13",
      date_precision: "day",
    });
    draft.formats = [
      { ...draft.formats[0]!, date: "2027-06-13", start_time: "07:30" },
      { ...draft.formats[1]!, start_time: "09:00" },
    ];

    const { ops } = buildBatch(draft, monthExisting(), ME);

    // Before the event, no time and no date; after it, the date and the time together.
    const eventAt = ops.findIndex((op) => op.collection === "events");
    for (const op of ops.slice(0, eventAt))
      expect(op.body).toMatchObject({ start_time: "", date: "" });
    expect(ops.slice(eventAt + 1).find((op) => op.id === "f42")?.body).toEqual({
      date: "2027-06-13",
      start_time: "07:30",
    });
    expect(ops.slice(eventAt + 1).find((op) => op.id === "f15")?.body).toEqual({
      start_time: "09:00",
    });
    expect(() => runOnServer(ops, monthExisting())).not.toThrow();
  });
});
