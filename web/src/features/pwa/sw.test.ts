import { readFileSync } from "node:fs";
import vm from "node:vm";

import { expect, test, vi } from "vitest";

// The service worker is a classic script in public/, not a module: the test
// reads the file and runs it in a context of its own, where `self`, `caches`
// and `fetch` are fakes. Nothing here registers a worker.

const ORIGIN = "https://courses.example.test";
const SOURCE = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");

/** What the worker reads of a response. */
type FakeResponse = {
  label: string;
  status: number;
  type: string;
  redirected: boolean;
  clone(): FakeResponse;
};

type FakeRequest = { url: string; method: string; mode: string };

/** A response as the network gives it: a 200 of the same origin, unless the test says otherwise. */
function reply(
  label: string,
  init: Partial<Pick<FakeResponse, "status" | "type" | "redirected">> = {},
): FakeResponse {
  const response: FakeResponse = {
    label,
    status: 200,
    type: "basic",
    redirected: false,
    ...init,
    clone: () => ({ ...response }),
  };
  return response;
}

/** A cache keeps its entries by path, since that is all the worker tells apart. */
function pathOf(key: string | FakeRequest): string {
  return typeof key === "string" ? key : new URL(key.url).pathname;
}

class FakeCache {
  readonly entries = new Map<string, FakeResponse>();
  match(key: string | FakeRequest): Promise<FakeResponse | undefined> {
    return Promise.resolve(this.entries.get(pathOf(key)));
  }
  put(key: string | FakeRequest, response: FakeResponse): Promise<void> {
    this.entries.set(pathOf(key), response);
    return Promise.resolve();
  }
}

type Listener = (event: unknown) => void;

/** Loads sw.js in a fresh context, with fakes for what a worker is given. */
function loadWorker() {
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, FakeCache>();
  const network = vi.fn<(input: unknown, init?: unknown) => Promise<FakeResponse>>();
  const skipWaiting = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const claim = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const open = vi.fn<(name: string) => Promise<FakeCache>>((name) => {
    let store = stores.get(name);
    if (store === undefined) {
      store = new FakeCache();
      stores.set(name, store);
    }
    return Promise.resolve(store);
  });

  const context = vm.createContext({
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, listener: Listener) => {
        listeners.set(type, listener);
      },
      skipWaiting,
      clients: { claim },
    },
    caches: {
      open,
      keys: () => Promise.resolve([...stores.keys()]),
      delete: (name: string) => Promise.resolve(stores.delete(name)),
    },
    fetch: network,
    URL,
  });
  vm.runInContext(SOURCE, context, { filename: "sw.js" });

  const strategyFor: unknown = vm.runInContext("strategyFor", context);
  if (typeof strategyFor !== "function") throw new Error("sw.js has no strategyFor");
  const cacheName: unknown = vm.runInContext("CACHE", context);
  if (typeof cacheName !== "string") throw new Error("sw.js has no CACHE");

  /** Fires an event and gives back what the worker handed to `respondWith` (null if nothing) and to `waitUntil`. */
  function fire(type: string, event: Record<string, unknown>) {
    const listener = listeners.get(type);
    if (listener === undefined) throw new Error(`sw.js does not listen to ${type}`);
    const result: { answer: Promise<FakeResponse> | null; waited: Promise<unknown>[] } = {
      answer: null,
      waited: [],
    };
    listener({
      ...event,
      respondWith: (promise: Promise<FakeResponse>) => {
        result.answer = promise;
      },
      waitUntil: (promise: Promise<unknown>) => {
        result.waited.push(promise);
      },
    });
    return result;
  }

  function requestOf(path: string, options: { method?: string; mode?: string; origin?: string }) {
    const { method = "GET", mode = "cors", origin = ORIGIN } = options;
    return { url: `${origin}${path}`, method, mode };
  }

  return {
    cacheName,
    network,
    skipWaiting,
    claim,
    open,
    stores,
    /** The cache of the current version. */
    cache(): FakeCache {
      let store = stores.get(cacheName);
      if (store === undefined) {
        store = new FakeCache();
        stores.set(cacheName, store);
      }
      return store;
    },
    strategyFor(path: string, mode: string): unknown {
      return Reflect.apply(strategyFor, undefined, [new URL(path, ORIGIN), mode]);
    },
    /** A request that the worker answers: the response the page gets, once what it kept is kept. */
    async get(
      path: string,
      options: { method?: string; mode?: string; origin?: string } = {},
    ): Promise<FakeResponse> {
      const { answer, waited } = fire("fetch", { request: requestOf(path, options) });
      if (answer === null) throw new Error(`the worker left ${path} to the browser`);
      const response = await answer;
      await Promise.all(waited);
      return response;
    },
    /** The worker does not answer: the browser goes to the network as it would without one. */
    leavesToBrowser(
      path: string,
      options: { method?: string; mode?: string; origin?: string } = {},
    ): boolean {
      return fire("fetch", { request: requestOf(path, options) }).answer === null;
    },
    /** The installation is over, or failed: what the worker told the browser to wait for. */
    async install(): Promise<void> {
      await Promise.all(fire("install", {}).waited);
    },
    async activate(): Promise<void> {
      await Promise.all(fire("activate", {}).waited);
    },
  };
}

const OFFLINE = new TypeError("Failed to fetch");

test("sw — l'API passe toujours par le réseau", () => {
  const worker = loadWorker();
  const rows: [path: string, mode: string][] = [
    ["/api/app/calendar", "cors"],
    ["/api/collections/events/records", "cors"],
    // Avatars and GPX tracks: private to the group, never kept.
    ["/api/files/runners/abc123/photo.jpg", "no-cors"],
    ["/api/files/x.gpx", "cors"],
    // A page that the browser opens on the API or on PocketBase's dashboard is
    // not the app: its HTML must never be kept as the shell.
    ["/api/health", "navigate"],
    ["/api", "navigate"],
    ["/_/", "navigate"],
    ["/_", "navigate"],
    ["/_/assets/index-1a2b3c.js", "no-cors"],
    // Everything else that is not a page or a built file.
    ["/manifest.webmanifest", "cors"],
    ["/icons/icon-192.png", "no-cors"],
  ];
  // The rows that the worker would handle by itself, if there are any.
  expect(rows.filter(([path, mode]) => worker.strategyFor(path, mode) !== "network-only")).toEqual(
    [],
  );

  // The worker does not even answer: nothing is read from or written in a cache.
  worker.network.mockResolvedValue(reply("api"));
  expect(rows.filter(([path, mode]) => !worker.leavesToBrowser(path, { mode }))).toEqual([]);
  expect(worker.open).not.toHaveBeenCalled();
  expect(worker.network).not.toHaveBeenCalled();
});

test("sw — une page vient du réseau d'abord", async () => {
  const worker = loadWorker();
  const routes = ["/", "/liste", "/evenements/abc123/modifier", "/invitation"];
  expect(routes.filter((path) => worker.strategyFor(path, "navigate") !== "network-first")).toEqual(
    [],
  );
  // Only the directory is a built-files directory: a route that starts like it is a page.
  expect(worker.strategyFor("/assets-de-course", "navigate")).toBe("network-first");

  worker.network.mockResolvedValue(reply("fresh"));
  const response = await worker.get("/evenements/abc123", { mode: "navigate" });

  // The network is asked, and its answer is the one that is shown...
  expect(response.label).toBe("fresh");
  expect(worker.network).toHaveBeenCalledTimes(1);
  // ...and kept as the shell: the single-page app is the same page on every route.
  expect([...worker.cache().entries.keys()]).toEqual(["/"]);
  expect(worker.cache().entries.get("/")?.label).toBe("fresh");
});

test("sw — sans réseau, la dernière page gardée répond à n'importe quelle route", async () => {
  const worker = loadWorker();
  worker.network.mockResolvedValueOnce(reply("shell of the last visit"));
  await worker.get("/liste", { mode: "navigate" });

  worker.network.mockRejectedValue(OFFLINE);
  const response = await worker.get("/evenements/abc123", { mode: "navigate" });

  expect(response.label).toBe("shell of the last visit");
});

test("sw — sans réseau et sans page gardée, l'erreur remonte", async () => {
  const worker = loadWorker();
  worker.network.mockRejectedValue(OFFLINE);

  await expect(worker.get("/liste", { mode: "navigate" })).rejects.toBe(OFFLINE);
});

test("sw — une réponse qui n'est pas un 200 de la même origine n'est jamais gardée", async () => {
  const rows: [string, Partial<Pick<FakeResponse, "status" | "type" | "redirected">>][] = [
    ["a 404", { status: 404 }],
    ["a 500", { status: 500 }],
    ["a redirect that ended on a 200", { redirected: true }],
    ["an opaque response", { status: 0, type: "opaque" }],
    ["an opaque redirect", { status: 0, type: "opaqueredirect" }],
    ["a response of another origin", { type: "cors" }],
  ];
  for (const [what, init] of rows) {
    const worker = loadWorker();
    worker.network.mockResolvedValueOnce(reply("good shell"));
    await worker.get("/liste", { mode: "navigate" });

    worker.network.mockResolvedValueOnce(reply(what, init));
    const page = await worker.get("/stats", { mode: "navigate" });

    // The page still gets what the network said, but the good shell is not replaced.
    expect({ what, page: page.label }).toEqual({ what, page: what });
    expect({ what, shell: worker.cache().entries.get("/")?.label }).toEqual({
      what,
      shell: "good shell",
    });

    worker.network.mockResolvedValueOnce(reply(what, init));
    await worker.get("/assets/chunk-1a2b3c.js");
    expect({ what, kept: [...worker.cache().entries.keys()] }).toEqual({ what, kept: ["/"] });
  }
});

test("sw — les fichiers de /assets/ viennent du cache d'abord", async () => {
  const worker = loadWorker();
  const built: [path: string, mode: string][] = [
    ["/assets/index-1a2b3c.js", "cors"],
    ["/assets/index-4d5e6f.css", "no-cors"],
    ["/assets/fonts/inter.woff2", "cors"],
  ];
  expect(built.filter(([path, mode]) => worker.strategyFor(path, mode) !== "cache-first")).toEqual(
    [],
  );

  worker.network.mockResolvedValue(reply("from the network"));
  const first = await worker.get("/assets/index-1a2b3c.js");
  const second = await worker.get("/assets/index-1a2b3c.js");

  // The first time comes from the network and is kept; the next one never asks it.
  expect(first.label).toBe("from the network");
  expect(second.label).toBe("from the network");
  expect(worker.network).toHaveBeenCalledTimes(1);
  expect([...worker.cache().entries.keys()]).toEqual(["/assets/index-1a2b3c.js"]);
});

test("sw — un fichier de /assets/ gardé répond même sans réseau", async () => {
  const worker = loadWorker();
  await worker
    .cache()
    .put({ url: `${ORIGIN}/assets/a.js`, method: "GET", mode: "cors" }, reply("kept"));
  worker.network.mockRejectedValue(OFFLINE);

  expect((await worker.get("/assets/a.js")).label).toBe("kept");
  // A file that was never kept, offline, is an error.
  await expect(worker.get("/assets/b.js")).rejects.toBe(OFFLINE);
});

test("sw — seules les requêtes GET de la même origine sont traitées", async () => {
  const worker = loadWorker();
  worker.network.mockResolvedValue(reply("from the network"));

  expect(worker.leavesToBrowser("/assets/a.js", { method: "POST" })).toBe(true);
  expect(worker.leavesToBrowser("/liste", { method: "POST", mode: "navigate" })).toBe(true);
  expect(worker.leavesToBrowser("/assets/a.js", { origin: "https://cdn.example.test" })).toBe(true);
  expect(
    worker.leavesToBrowser("/liste", { mode: "navigate", origin: "http://courses.example.test" }),
  ).toBe(true);
  expect(worker.network).not.toHaveBeenCalled();
  expect(worker.open).not.toHaveBeenCalled();

  // The same requests, from the same origin with GET, are the worker's.
  expect((await worker.get("/assets/a.js")).label).toBe("from the network");
  expect((await worker.get("/liste", { mode: "navigate" })).label).toBe("from the network");
});

test("sw — l'installation garde la page, le manifeste et les icônes, puis prend la main", async () => {
  const worker = loadWorker();
  worker.network.mockImplementation((input) => Promise.resolve(reply(`copy of ${String(input)}`)));

  await worker.install();

  expect(worker.cacheName).toMatch(/^ptd-\d+$/);
  expect([...worker.cache().entries.keys()].toSorted()).toEqual([
    "/",
    "/icons/apple-touch-icon.png",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
    "/manifest.webmanifest",
  ]);
  // The browser's own HTTP cache could hold a shell of an older build: it is asked to go to the server.
  for (const [, init] of worker.network.mock.calls) expect(init).toEqual({ cache: "reload" });
  expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
});

test("sw — une installation dont un fichier manque échoue, sans prendre la main", async () => {
  const worker = loadWorker();
  worker.network.mockImplementation((input) =>
    Promise.resolve(reply(String(input), input === "/icons/icon-512.png" ? { status: 404 } : {})),
  );

  await expect(worker.install()).rejects.toThrow("/icons/icon-512.png");

  expect(worker.skipWaiting).not.toHaveBeenCalled();
});

test("sw — l'activation supprime les autres caches et prend la main", async () => {
  const worker = loadWorker();
  worker.stores.set("ptd-0", new FakeCache());
  worker.stores.set("another-app", new FakeCache());
  worker.cache();

  await worker.activate();

  expect([...worker.stores.keys()]).toEqual([worker.cacheName]);
  expect(worker.claim).toHaveBeenCalledTimes(1);
});
