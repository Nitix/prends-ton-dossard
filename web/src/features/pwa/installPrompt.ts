// The offer to install the site, which Chromium sends once, as the page loads
// (`beforeinstallprompt`), long before anybody opens the profile. The app
// listens from the start (see main.tsx) and keeps the event here, until the
// profile asks for it.

/** What Chromium adds to the event: the function that shows its own install dialog. */
export type InstallPromptEvent = Event & { prompt(): Promise<unknown> };

let waiting: InstallPromptEvent | null = null;
const subscribers = new Set<() => void>();

function isInstallPrompt(event: Event): event is InstallPromptEvent {
  return "prompt" in event && typeof event.prompt === "function";
}

function keep(event: InstallPromptEvent | null) {
  waiting = event;
  for (const subscriber of subscribers) subscriber();
}

function onPrompt(event: Event) {
  if (!isInstallPrompt(event)) return;
  event.preventDefault();
  keep(event);
}

function onInstalled() {
  keep(null);
}

/**
 * Starts keeping the install offer of the browser. The mini-bar of the
 * browser is held back, since the profile has a button for it. The offer is
 * forgotten when the site is installed. Returns the function that stops, and
 * forgets the offer.
 */
export function captureInstallPrompt(target: EventTarget = window): () => void {
  target.addEventListener("beforeinstallprompt", onPrompt);
  target.addEventListener("appinstalled", onInstalled);
  return () => {
    target.removeEventListener("beforeinstallprompt", onPrompt);
    target.removeEventListener("appinstalled", onInstalled);
    keep(null);
  };
}

/** The offer that the browser made and nobody has used, or null. For `useSyncExternalStore`. */
export function installPrompt(): InstallPromptEvent | null {
  return waiting;
}

/** For `useSyncExternalStore`. Returns the function that unsubscribes. */
export function subscribeInstallPrompt(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

/** The offer, which is spent as it is taken: an event can only be used once. Null if there is none. */
export function takeInstallPrompt(): InstallPromptEvent | null {
  const event = waiting;
  if (event !== null) keep(null);
  return event;
}
