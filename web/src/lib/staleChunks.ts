/** Where the time of the last reload for a missing chunk is kept. */
const RELOADED_AT = "courses:stale-chunk-reload";

/** A chunk still missing this soon after a reload is not reloaded again. */
const LOOP_GUARD_MS = 10_000;

/**
 * After a deploy, a tab opened before asks for chunks of the old build, which
 * the server no longer has (a 404, see server/webdist/spa.go). Vite then fires
 * `vite:preloadError`: the page is reloaded, which brings the new build.
 *
 * A reload that did not help (the chunk is still missing just after) is not
 * done again, so that a broken build cannot loop: the error then goes on to
 * the router, which shows it. Without a sessionStorage to remember the reload,
 * nothing is reloaded, for the same reason. Returns the function that stops.
 */
export function reloadOnStaleChunks({
  target = window,
  storage = () => sessionStorage,
  reload = () => location.reload(),
  now = Date.now,
}: {
  target?: EventTarget;
  storage?: () => Pick<Storage, "getItem" | "setItem">;
  reload?: () => void;
  now?: () => number;
} = {}): () => void {
  const onError = (event: Event) => {
    try {
      const store = storage();
      const last = Number(store.getItem(RELOADED_AT) ?? 0);
      if (now() - last < LOOP_GUARD_MS) return;
      store.setItem(RELOADED_AT, String(now()));
    } catch {
      return;
    }
    event.preventDefault();
    reload();
  };
  target.addEventListener("vite:preloadError", onError);
  return () => target.removeEventListener("vite:preloadError", onError);
}
