/** Where the time of the last reload for a missing chunk is kept. */
const RELOADED_AT = "courses:stale-chunk-reload";

/**
 * Where TanStack Router remembers that it reloaded the page for a route
 * component it could not import (its `lazyRouteComponent`), by the message of
 * the error: it does not reload twice for the same one.
 */
const ROUTER_RELOAD = "tanstack_router_reload:";

/** A chunk still missing this soon after a reload is not reloaded again. */
const LOOP_GUARD_MS = 10_000;

/** What the guard and the reload use: the session's storage, the reload itself, the clock. */
type Reloading = {
  storage?: () => Pick<Storage, "getItem" | "setItem">;
  reload?: () => void;
  now?: () => number;
};

/**
 * Whether the browser says it is online. A browser that says nothing (no
 * `navigator.onLine`: Node) is taken to be.
 */
export function isOnline(): boolean {
  return typeof navigator === "undefined" || !("onLine" in navigator) || navigator.onLine;
}

/**
 * Reloads the page, once: not again within `LOOP_GUARD_MS` of the last reload
 * that this (or `reloadOnStaleChunks`) did, so that a build that stays broken
 * cannot make the page loop; and not at all without a sessionStorage to
 * remember it, for the same reason. Says whether it reloaded.
 */
export function reloadOnce({
  storage = () => sessionStorage,
  reload = () => location.reload(),
  now = Date.now,
}: Reloading = {}): boolean {
  try {
    const store = storage();
    const last = Number(store.getItem(RELOADED_AT) ?? 0);
    if (now() - last < LOOP_GUARD_MS) return false;
    store.setItem(RELOADED_AT, String(now()));
  } catch {
    return false;
  }
  reload();
  return true;
}

/**
 * After a deploy, a tab opened before asks for chunks of the old build, which
 * the server no longer has (a 404, see server/webdist/spa.go). Vite then fires
 * `vite:preloadError`: the page is reloaded, which brings the new build.
 *
 * A reload that did not help (the chunk is still missing just after) is not
 * done again, so that a broken build cannot loop: the error then goes on to
 * the router, which shows it. Without a sessionStorage to remember the reload,
 * nothing is reloaded, for the same reason. Returns the function that stops.
 *
 * Two failures are not a stale build, and are left alone (not prevented, so
 * that the caller of the import gets its error and says what it has to):
 * - one while the browser is offline: a chunk that does not come is not one
 *   that is gone, and a reload would only lose the page (the focus, what was
 *   typed) for an error page of the browser. TanStack Router reloads by itself,
 *   once, for a route component that it cannot import (`lazyRouteComponent`,
 *   which remembers it in the sessionStorage under `ROUTER_RELOAD`): for such a
 *   failure it is told it has already done so;
 * - one that `ignore` names: the look of a skin (skins/index.ts), loaded when
 *   it is chosen, which a failure leaves as the page was and tells the person
 *   about. A look is not a route: the page has nothing to gain from a new build
 *   to go on showing the one it has.
 */
export function reloadOnStaleChunks({
  target = window,
  storage = () => sessionStorage,
  reload = () => location.reload(),
  now = Date.now,
  online = isOnline,
  ignore = () => false,
}: Reloading & {
  target?: EventTarget;
  online?: () => boolean;
  ignore?: () => boolean;
} = {}): () => void {
  const onError = (event: Event) => {
    if (ignore()) return;
    if (!online()) {
      holdRouter(event, storage);
      return;
    }
    // The error is not thrown when the page is reloaded: it is going away.
    if (reloadOnce({ storage, reload, now })) event.preventDefault();
  };
  target.addEventListener("vite:preloadError", onError);
  return () => target.removeEventListener("vite:preloadError", onError);
}

/** Tells TanStack Router that it has reloaded for the failure of a `vite:preloadError` already, so that it does not. */
function holdRouter(event: Event, storage: () => Pick<Storage, "getItem" | "setItem">): void {
  const payload: unknown = "payload" in event ? event.payload : undefined;
  if (!(payload instanceof Error)) return;
  try {
    storage().setItem(ROUTER_RELOAD + payload.message, "1");
  } catch {
    // No storage: the router reloads once, as it would have.
  }
}
