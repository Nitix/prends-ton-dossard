import { beforeEach, describe, expect, test, vi } from "vitest";

import { reloadOnStaleChunks } from "./staleChunks";

/** A sessionStorage of the test. */
function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

/** The event that Vite fires when it cannot load a chunk. */
function chunkError(): Event {
  return new Event("vite:preloadError", { cancelable: true });
}

describe("reloadOnStaleChunks", () => {
  let target: EventTarget;
  let storage: Pick<Storage, "getItem" | "setItem">;
  let now: number;
  const reload = vi.fn<() => void>();

  beforeEach(() => {
    target = new EventTarget();
    storage = memoryStorage();
    now = 1_000_000;
    reload.mockReset();
  });

  const start = () =>
    reloadOnStaleChunks({ target, storage: () => storage, reload, now: () => now });

  test("reloads the page when a chunk of the old build is missing", () => {
    start();
    const event = chunkError();

    target.dispatchEvent(event);

    expect(reload).toHaveBeenCalledTimes(1);
    // The error is not thrown: the page is going away.
    expect(event.defaultPrevented).toBe(true);
  });

  test("does not reload again just after a reload: the chunk is really missing", () => {
    start();
    target.dispatchEvent(chunkError());
    // The reloaded page fails on the same chunk, a few seconds later.
    now += 3_000;
    const event = chunkError();

    target.dispatchEvent(event);

    expect(reload).toHaveBeenCalledTimes(1);
    // The error goes on, to the router, which shows it.
    expect(event.defaultPrevented).toBe(false);
  });

  test("reloads again for a later deploy", () => {
    start();
    target.dispatchEvent(chunkError());
    now += 60 * 60_000;

    target.dispatchEvent(chunkError());

    expect(reload).toHaveBeenCalledTimes(2);
  });

  test("does not reload without a storage to remember it: it could loop", () => {
    reloadOnStaleChunks({
      target,
      storage: () => {
        throw new DOMException("denied", "SecurityError");
      },
      reload,
      now: () => now,
    });
    const event = chunkError();

    target.dispatchEvent(event);

    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  test("stops listening", () => {
    const stop = start();

    stop();
    target.dispatchEvent(chunkError());

    expect(reload).not.toHaveBeenCalled();
  });
});
