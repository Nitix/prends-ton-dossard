import { beforeEach, expect, test } from "vitest";

import { pb } from "./pb";

beforeEach(() => {
  pb.authStore.save("a-token", { id: "u1", collectionId: "c1", collectionName: "users" });
});

test("a 401 answer ends the stored session", () => {
  pb.afterSend?.(new Response(null, { status: 401 }), {});

  expect(pb.authStore.token).toBe("");
  expect(pb.authStore.record).toBeNull();
});

test.each([400, 403, 404, 500])("a %i answer keeps the stored session", (status) => {
  pb.afterSend?.(new Response(null, { status }), {});

  expect(pb.authStore.token).toBe("a-token");
});

test("the data of the answer goes through untouched", () => {
  const data = { items: [] };

  expect(pb.afterSend?.(new Response(null, { status: 200 }), data)).toBe(data);
});
