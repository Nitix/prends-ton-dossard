import { ClientResponseError } from "pocketbase";
import { describe, expect, test, vi } from "vitest";

import { isRefused, refreshWhenSettled } from "./refresh";

/** What the SDK throws for an answer of the server with this status. */
const answered = (status: number) => new ClientResponseError({ status, response: {} });

describe("isRefused", () => {
  test("isRefused — un 4xx du serveur est un refus", () => {
    for (const status of [400, 403, 404, 429]) expect(isRefused(answered(status))).toBe(true);
  });

  test("isRefused — un 5xx, un échec réseau et une autre erreur n'en sont pas", () => {
    expect(isRefused(answered(500))).toBe(false);
    expect(isRefused(answered(503))).toBe(false);
    // The SDK gives a network failure the status 0.
    expect(isRefused(new ClientResponseError(new TypeError("Failed to fetch")))).toBe(false);
    expect(isRefused(new Error("boom"))).toBe(false);
    expect(isRefused(undefined)).toBe(false);
  });
});

describe("refreshWhenSettled", () => {
  test("refreshWhenSettled — une requête réussie ou refusée attend la nouvelle liste", () => {
    const refreshed = Promise.resolve("new list");
    const refresh = vi.fn<() => Promise<unknown>>(() => refreshed);
    const { onSettled } = refreshWhenSettled(refresh);

    expect(onSettled({ id: "x" }, null)).toBe(refreshed);
    expect(onSettled(undefined, answered(404))).toBe(refreshed);
    expect(onSettled(undefined, answered(400))).toBe(refreshed);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  test("refreshWhenSettled — un autre échec redemande la liste sans l'attendre", () => {
    const refresh = vi.fn<() => Promise<unknown>>(() => new Promise(() => {}));
    const { onSettled } = refreshWhenSettled(refresh);

    expect(onSettled(undefined, answered(500))).toBeUndefined();
    expect(
      onSettled(undefined, new ClientResponseError(new TypeError("Failed to fetch"))),
    ).toBeUndefined();
    expect(onSettled(undefined, new Error("boom"))).toBeUndefined();
    // Started all the same.
    expect(refresh).toHaveBeenCalledTimes(3);
  });
});
