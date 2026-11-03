import { useSyncExternalStore } from "react";

/**
 * The theme of the app, chosen in the settings: « Auto » follows the setting of
 * the phone (the stylesheet has the dark colours under `prefers-color-scheme:
 * dark`), « Clair » and « Sombre » win over it. The choice is kept on the
 * device, in the local storage; index.html applies it before the page is first
 * drawn, so that a forced theme does not flash the other one.
 */
export type ThemeChoice = "auto" | "light" | "dark";

/** Where the device keeps the choice. index.html reads the same key. */
export const THEME_KEY = "ptd-theme";

/**
 * The choice kept on the device. Nothing kept, something else, or a storage
 * that refuses (some private windows): auto.
 */
export function readTheme(): ThemeChoice {
  try {
    const kept = localStorage.getItem(THEME_KEY);
    return kept === "light" || kept === "dark" ? kept : "auto";
  } catch {
    return "auto";
  }
}

/**
 * The mode of the skin of the page when it has one only (see skins/index.ts):
 * the page is drawn in it whatever the choice, which stays kept for the skins
 * that have both. None for « Crête ».
 */
let only: "light" | "dark" | null = null;

/**
 * Puts a choice on the page: `data-theme` on <html> for a forced theme, none
 * for auto, and the colour scheme that the native controls (a date, a select,
 * the scroll bars) follow. Under a skin that has one mode only, that mode.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  const shown = only ?? choice;
  if (shown === "auto") delete root.dataset.theme;
  else root.dataset.theme = shown;
  root.style.colorScheme = shown === "auto" ? "light dark" : shown;
}

/**
 * Draws the page in the only mode of its skin, or (`null`, a skin with both
 * modes) in the one chosen on the device again. index.html does the same
 * before the page is first drawn.
 */
export function forceMode(mode: "light" | "dark" | null): void {
  only = mode;
  applyTheme(current());
}

/** Keeps a choice on the device (auto is kept as nothing); false when the storage refuses. */
function keepTheme(choice: ThemeChoice): boolean {
  try {
    if (choice === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();

/** The choice of this page, when the storage could not keep it: the page has it until it is closed. */
let unkept: ThemeChoice | null = null;

/** Chooses a theme: kept on the device, applied at once, told to whoever shows it. */
export function chooseTheme(choice: ThemeChoice): void {
  unkept = keepTheme(choice) ? null : choice;
  applyTheme(choice);
  for (const listener of listeners) listener();
}

/** A change of the storage made by another page of the site: the theme, if it was its key. */
function changedElsewhere(event: StorageEvent): void {
  // `null`: the whole storage was emptied.
  if (event.key !== THEME_KEY && event.key !== null) return;
  unkept = null;
  applyTheme(readTheme());
  for (const listener of listeners) listener();
}

/**
 * Follows a choice made in another tab or window of the app on this device:
 * the storage tells every other page of the site when a key changes, and this
 * page applies the theme, whatever it shows: the settings need not be open.
 * main.tsx installs it once for the app; what it returns removes it (for a test).
 */
export function followThemeElsewhere(): () => void {
  window.addEventListener("storage", changedElsewhere);
  return () => {
    window.removeEventListener("storage", changedElsewhere);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const current = (): ThemeChoice => unkept ?? readTheme();

/** The theme chosen on this device, and how to choose another. */
export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(subscribe, current, () => "auto" as const);
  return [choice, chooseTheme];
}
