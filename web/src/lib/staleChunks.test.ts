import { beforeEach, describe, expect, test, vi } from "vitest";

import { isOnline, reloadOnce, reloadOnStaleChunks } from "./staleChunks";

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

/** The event that Vite fires when it cannot load a chunk, with the error it carries. */
function chunkError(
  message = "Failed to fetch dynamically imported module: /assets/page.js",
): Event {
  return Object.assign(new Event("vite:preloadError", { cancelable: true }), {
    payload: new TypeError(message),
  });
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
    onLine = true;
    ignored = false;
    reload.mockReset();
  });

  let onLine: boolean;
  let ignored: boolean;

  const start = () =>
    reloadOnStaleChunks({
      target,
      storage: () => storage,
      reload,
      now: () => now,
      online: () => onLine,
      ignore: () => ignored,
    });

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

  // A chunk that does not come is not a chunk that is gone: the page stays, and
  // the import fails for whoever asked for it.
  test("does not reload while the browser is offline, and leaves the error to the caller", () => {
    start();
    onLine = false;
    const event = chunkError();

    target.dispatchEvent(event);

    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    // Nothing was remembered either: the next failure, online, still reloads.
    onLine = true;
    target.dispatchEvent(chunkError());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // TanStack Router reloads once by itself for a route component it cannot
  // import, under this key: offline, that reload is as little wanted.
  test("offline, tells TanStack Router that it has reloaded already for that failure, and only then", () => {
    start();
    const message = "Failed to fetch dynamically imported module: /assets/page.js";

    target.dispatchEvent(chunkError());
    expect(storage.getItem(`tanstack_router_reload:${message}`), "online").toBeNull();

    onLine = false;
    target.dispatchEvent(chunkError());
    expect(storage.getItem(`tanstack_router_reload:${message}`), "offline").toBe("1");
  });

  test("does not reload for a failure that the caller says is not a route (the look of a skin)", () => {
    start();
    ignored = true;
    const event = chunkError();

    target.dispatchEvent(event);

    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    ignored = false;
    target.dispatchEvent(chunkError());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("reloads by default when the browser says nothing of being offline (no navigator.onLine)", () => {
    // The default of `online`: a Node without `navigator.onLine`, or any browser, is online unless it says it is not.
    reloadOnStaleChunks({ target, storage: () => storage, reload, now: () => now });

    target.dispatchEvent(chunkError());

    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("stops listening", () => {
    const stop = start();

    stop();
    target.dispatchEvent(chunkError());

    expect(reload).not.toHaveBeenCalled();
  });
});

/** A storage that refuses, as some private windows' do. */
function denied(): never {
  throw new DOMException("denied", "SecurityError");
}

// The same guard, for the reload that something else asks for (a skin whose look
// is gone after a deploy: skins/index.ts), so that the two never chain.
describe("reloadOnce", () => {
  const reload = vi.fn<() => void>();
  let storage: Pick<Storage, "getItem" | "setItem">;
  let now: number;

  beforeEach(() => {
    storage = memoryStorage();
    now = 1_000_000;
    reload.mockReset();
  });

  const once = () => reloadOnce({ storage: () => storage, reload, now: () => now });

  test("reloads, and says so", () => {
    expect(once()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("does not reload again just after a reload, and says so: it cannot loop", () => {
    once();
    now += 3_000;

    expect(once()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("shares the guard with the stale chunks: a reload for one is not followed by one for the other", () => {
    const target = new EventTarget();
    reloadOnStaleChunks({ target, storage: () => storage, reload, now: () => now });
    target.dispatchEvent(chunkError());
    now += 1_000;

    expect(once()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("reloads again for a later deploy", () => {
    once();
    now += 60 * 60_000;

    expect(once()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  test("does not reload without a storage to remember it: it could loop", () => {
    expect(reloadOnce({ storage: denied, reload, now: () => now })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("isOnline", () => {
  test("is true where the browser says nothing of being offline (Node has no navigator.onLine)", () => {
    expect(isOnline()).toBe(true);
  });
});
