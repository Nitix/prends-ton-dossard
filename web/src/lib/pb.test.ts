import { beforeEach, expect, test, vi } from "vitest";

import { pb } from "./pb";

beforeEach(() => {
  pb.authStore.save("a-token", { id: "u1", collectionId: "c1", collectionName: "users" });
});

test("a 401 answer to the stored token ends the stored session", () => {
  pb.afterSend?.(
    new Response(null, { status: 401 }),
    {},
    { headers: { Authorization: "a-token" } },
  );

  expect(pb.authStore.token).toBe("");
  expect(pb.authStore.record).toBeNull();
});

// A new password or a new email kills the token: a request still under way with
// the old one is refused after the new one is stored (in this tab, or in another
// one, which shares the store). That refusal is not the end of the new session.
test.each([
  ["another token", { headers: { Authorization: "old-token" } }],
  ["no token", { headers: { Authorization: "" } }],
  ["no header", {}],
])("a 401 answer to a request sent with %s keeps the stored session", (_, options) => {
  pb.afterSend?.(new Response(null, { status: 401 }), {}, options);

  expect(pb.authStore.token).toBe("a-token");
});

// The sign-in that follows a new password goes without the dead token
// (SettingsPage): the client must send the empty header as it is, and not put
// the stored token in its place.
test("an empty Authorization header goes out empty, not as the stored token", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      token: "fresh-token",
      record: { id: "u1", collectionId: "c1", collectionName: "users" },
    }),
  );
  try {
    await pb
      .collection("users")
      .authWithPassword("alice@example.test", "new-password-1", { headers: { Authorization: "" } });
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("Authorization")).toBe("");
  } finally {
    fetchSpy.mockRestore();
  }
  expect(pb.authStore.token).toBe("fresh-token");
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
