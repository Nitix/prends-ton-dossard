/**
 * Calls `callback` each time the page comes back to the foreground: a switch
 * back to the tab, or a phone that resumes a tab it kept for hours or days
 * without reloading it. With `everyMs`, it is also called at that interval
 * while the page stays in view. Returns the function that stops it.
 *
 * What the app read when it started (the session, the day) can be stale by
 * then: this is the moment to look again.
 */
export function onResume(callback: () => void, everyMs?: number): () => void {
  const ifVisible = () => {
    if (document.visibilityState === "visible") callback();
  };
  document.addEventListener("visibilitychange", ifVisible);
  const timer = everyMs === undefined ? undefined : setInterval(ifVisible, everyMs);
  return () => {
    document.removeEventListener("visibilitychange", ifVisible);
    clearInterval(timer);
  };
}
