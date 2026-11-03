import { useSyncExternalStore } from "react";

/**
 * The animated background of the skins that have one (see skins/README.md,
 * « Motion »): its motifs move slowly, for as long as they are on screen. That
 * lasts more than five seconds, so a person must be able to stop it (WCAG
 * 2.2.2): « Animer le fond » in Réglages → Apparence, shown for a skin that has
 * such a background. It is on by default, and kept on the device, in the local
 * storage, like the theme (lib/theme.ts). Whoever asked their system for less
 * motion has none whatever this says (the stylesheet of the motifs moves them
 * under `prefers-reduced-motion: no-preference` only).
 */

/** Where the device keeps the choice, when the background is stopped. */
export const AMBIENT_KEY = "ptd-ambient";

/** What is kept when it is stopped: nothing is kept when it is on. */
const OFF = "off";

const listeners = new Set<() => void>();

/** The choice of this page, when the storage could not keep it: the page has it until it is closed. */
let unkept: boolean | null = null;

/**
 * Whether the background moves on this device. Nothing kept, something else,
 * or a storage that refuses (some private windows): it does.
 */
export function readAmbient(): boolean {
  if (unkept !== null) return unkept;
  try {
    return localStorage.getItem(AMBIENT_KEY) !== OFF;
  } catch {
    return true;
  }
}

/** Keeps a choice on the device (on is kept as nothing); false when the storage refuses. */
function keepAmbient(on: boolean): boolean {
  try {
    if (on) localStorage.removeItem(AMBIENT_KEY);
    else localStorage.setItem(AMBIENT_KEY, OFF);
    return true;
  } catch {
    return false;
  }
}

function tell(): void {
  for (const listener of listeners) listener();
}

/** Turns the background on or off: kept on the device, told at once to the motifs on the page. */
export function chooseAmbient(on: boolean): void {
  unkept = keepAmbient(on) ? null : on;
  tell();
}

/** A change of the storage made by another page of the site: the choice, if it was its key. */
function changedElsewhere(event: StorageEvent): void {
  // `null`: the whole storage was emptied.
  if (event.key !== AMBIENT_KEY && event.key !== null) return;
  unkept = null;
  tell();
}

/**
 * Follows the storage while something shows the choice: another tab or window
 * of the app on this device changes it, and every page of the site is told.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", changedElsewhere);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", changedElsewhere);
  };
}

/** Whether the background moves on this device, and how to choose (the motifs follow at once). */
export function useAmbient(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, readAmbient, () => true);
  return [on, chooseAmbient];
}
