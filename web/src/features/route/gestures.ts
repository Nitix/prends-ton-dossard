/**
 * The gestures of the map of a track (see TrackMap): the wheel scrolls the page
 * unless Ctrl (⌘ on Apple devices) is held, and a finger scrolls it too on a
 * touch screen, where two fingers are what move and zoom the map.
 */

/** The key that makes the wheel zoom the map: Ctrl, or ⌘ on a Mac, an iPhone or an iPad. */
export function zoomModifier(
  nav: Pick<Navigator, "platform" | "userAgent"> = navigator,
): "Ctrl" | "⌘" {
  // An iPad that asks for the site of a computer says `MacIntel` as its platform.
  return /Mac|iPhone|iPad|iPod/.test(nav.platform) || /iPhone|iPad|iPod/.test(nav.userAgent)
    ? "⌘"
    : "Ctrl";
}

/** Whether the main pointer of the device is coarse (a finger): `(pointer: coarse)`. */
export function coarsePointer(
  win: { matchMedia: (query: string) => Pick<MediaQueryList, "matches"> } = window,
): boolean {
  return win.matchMedia("(pointer: coarse)").matches;
}

/**
 * A wheel without Ctrl or ⌘ does not reach the map, which would zoom on it:
 * the listener is in the capture phase on `gate` (a parent of the map), stops
 * the event there, and does not prevent its default, so that the page scrolls as
 * it would without a map. `onPlainWheel` is told (it shows the hint). A wheel
 * with Ctrl or ⌘ (also what a browser sends for a pinch on a touchpad) goes on
 * to the map. Returns what removes the listener.
 */
export function gateWheel(gate: HTMLElement, onPlainWheel: () => void): () => void {
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) return;
    event.stopPropagation();
    onPlainWheel();
  };
  gate.addEventListener("wheel", onWheel, { capture: true, passive: true });
  return () => gate.removeEventListener("wheel", onWheel, { capture: true });
}
