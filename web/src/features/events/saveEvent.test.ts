import { ClientResponseError } from "pocketbase";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { toEventView, type EventView } from "./api";
import { buildBatch, saveEvent, SaveEventError, type EventDraft } from "./saveEvent";
import { eventRecord, trailType } from "./testFixture";

type Rec = Record<string, unknown>;
type Call = { action: string; collection: string; id?: string; body?: Rec };

const mocks = vi.hoisted(() => ({
  calls: [] as Call[],
  send: vi.fn<() => Promise<unknown>>(),
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
      send: mocks.send,
    }),
  },
}));

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.send.mockReset().mockResolvedValue([]);
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

    expect(ops[3]?.body).toEqual({ runner: ME, format: ops[1]?.id, status: "registered" });
  });

  test("it can be on the other format", () => {
    const { ops } = buildBatch(
      newDraft({ join: { formatIndex: 1, status: "interested" } }),
      undefined,
      ME,
    );

    expect(ops[3]?.body).toEqual({ runner: ME, format: ops[2]?.id, status: "interested" });
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
      date: "",
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
  test("changes the event and its formats by their id, and never sends the event of a format", () => {
    const { ops, eventId } = buildBatch(editDraft(), existing(), ME);

    expect(eventId).toBe("event");
    expect(summary(ops)).toEqual(["update events", "update formats", "update formats"]);
    expect(ops.map((op) => op.id)).toEqual(["event", "f42", "f15"]);
    for (const op of ops.slice(1)) expect(op.body).not.toHaveProperty("event");
    expect(ops[0]?.body).not.toHaveProperty("created_by");
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

  test("shrinking the dates: the formats that move inside the new ones go before the event", () => {
    const draft = editDraft({ end_date: undefined });
    draft.formats = draft.formats.map((format) => ({ ...format, date: undefined }));

    const { ops } = buildBatch(draft, existing(), ME);

    expect(summary(ops)).toEqual(["update formats", "update formats", "update events"]);
  });

  test("extending the dates: a format that moves to the new day goes after the event", () => {
    const draft = editDraft({ end_date: "2026-06-15" });
    const [first] = draft.formats;
    if (first) first.date = "2026-06-15";

    const { ops } = buildBatch(draft, existing(), ME);

    expect(summary(ops)).toEqual(["update events", "update formats", "update formats"]);
  });

  test("with the same dates, the event goes first", () => {
    const { ops } = buildBatch(editDraft({ name: "Trail des Crêtes 2026" }), existing(), ME);

    expect(ops[0]?.collection).toBe("events");
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
    expect(mocks.calls[3]?.body).toMatchObject({ runner: ME, format: mocks.calls[1]?.body?.id });
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
