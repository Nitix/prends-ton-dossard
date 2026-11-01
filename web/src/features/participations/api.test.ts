import { beforeEach, describe, expect, test, vi } from "vitest";

import { createParticipation, deleteParticipation, updateParticipation } from "./api";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  create: vi.fn<(body: Rec) => Promise<unknown>>(),
  update: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
  remove: vi.fn<(id: string) => Promise<unknown>>(),
  collection: vi.fn<(name: string) => void>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    collection: (name: string) => {
      mocks.collection(name);
      return { create: mocks.create, update: mocks.update, delete: mocks.remove };
    },
  },
}));

beforeEach(() => {
  mocks.create.mockReset().mockResolvedValue({ id: "p9" });
  mocks.update.mockReset().mockResolvedValue({ id: "p9" });
  mocks.remove.mockReset().mockResolvedValue(true);
  mocks.collection.mockReset();
});

describe("createParticipation", () => {
  test("creates in `participations` with the runner, the event, the format and the status, and gives the record back", async () => {
    const created = await createParticipation({
      runner: "r1",
      event: "e1",
      format: "f1",
      status: "registered",
    });

    expect(mocks.collection).toHaveBeenCalledWith("participations");
    // `added_by` and `confirmed` are the server's: they are never sent.
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      runner: "r1",
      event: "e1",
      format: "f1",
      status: "registered",
    });
    expect(created).toEqual({ id: "p9" });
  });

  test("createParticipation sends {runner, event, status} without a format for an undecided one", async () => {
    await createParticipation({ runner: "r1", event: "e1", status: "interested" });

    const [body] = mocks.create.mock.calls[0] ?? [];
    expect(body).toEqual({ runner: "r1", event: "e1", status: "interested" });
    // Not `format: undefined`: the key is not there.
    expect(Object.keys(body ?? {})).not.toContain("format");
  });

  test("createParticipation sends the format when there is one", async () => {
    await createParticipation({ runner: "r1", event: "e1", format: "f1", status: "interested" });

    const [body] = mocks.create.mock.calls[0] ?? [];
    expect(body).toEqual({ runner: "r1", event: "e1", format: "f1", status: "interested" });
  });

  test("lets the error of the server through", async () => {
    const refusal = new Error("validation_not_unique");
    mocks.create.mockRejectedValue(refusal);

    await expect(
      createParticipation({ runner: "r1", event: "e1", format: "f1", status: "interested" }),
    ).rejects.toBe(refusal);
  });
});

describe("updateParticipation", () => {
  test("sends only the patch it is given", async () => {
    await updateParticipation("p1", { status: "finished" });
    await updateParticipation("p1", { confirmed: true });
    await updateParticipation("p1", { format: "f2", status: "dns" });

    expect(mocks.collection).toHaveBeenCalledWith("participations");
    expect(mocks.update.mock.calls).toEqual([
      ["p1", { status: "finished" }],
      ["p1", { confirmed: true }],
      ["p1", { format: "f2", status: "dns" }],
    ]);
  });
});

describe("deleteParticipation", () => {
  test("deletes the record by its id, and gives nothing back", async () => {
    const result = await deleteParticipation("p1");

    expect(mocks.collection).toHaveBeenCalledWith("participations");
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("p1");
    expect(result).toBeUndefined();
  });
});
