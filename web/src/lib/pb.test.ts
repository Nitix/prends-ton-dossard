import { beforeEach, expect, test, vi } from "vitest";

import { pb } from "./pb";

beforeEach(() => {
  pb.authStore.save("a-token", { id: "u1", collectionId: "c1", collectionName: "users" });
});

test("a 401 answer ends the stored session", () => {
  pb.afterSend?.(new Response(null, { status: 401 }), {});

  expect(pb.authStore.token).toBe("");
  expect(pb.authStore.record).toBeNull();
});

test("a 401 answer to a request ends the session once", async () => {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ status: 401, message: "", data: {} }, { status: 401 }));
  let changes = 0;
  const stop = pb.authStore.onChange(() => changes++);
  try {
    await expect(pb.send("/api/collections/events/records", {})).rejects.toMatchObject({
      status: 401,
    });
  } finally {
    stop();
    fetchSpy.mockRestore();
  }

  expect(pb.authStore.token).toBe("");
  // One end of the session, not one more from the SDK's own clearing: each one
  // forgets the queries and checks the page again (connectSession).
  expect(changes).toBe(1);
});

test.each([400, 403, 404, 500])("a %i answer keeps the stored session", (status) => {
  pb.afterSend?.(new Response(null, { status }), {});

  expect(pb.authStore.token).toBe("a-token");
});

test("the data of the answer goes through untouched", () => {
  const data = { items: [] };

  expect(pb.afterSend?.(new Response(null, { status: 200 }), data)).toBe(data);
});
