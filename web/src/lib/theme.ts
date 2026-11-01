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
 * Puts a choice on the page: `data-theme` on <html> for a forced theme, none
 * for auto, and the colour scheme that the native controls (a date, a select,
 * the scroll bars) follow.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "auto") delete root.dataset.theme;
  else root.dataset.theme = choice;
  root.style.colorScheme = choice === "auto" ? "light dark" : choice;
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

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // A choice made in another tab of the app.
  const changedElsewhere = (event: StorageEvent) => {
    if (event.key !== THEME_KEY && event.key !== null) return;
    unkept = null;
    applyTheme(readTheme());
    listener();
  };
  window.addEventListener("storage", changedElsewhere);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", changedElsewhere);
  };
}

const current = (): ThemeChoice => unkept ?? readTheme();

/** The theme chosen on this device, and how to choose another. */
export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(subscribe, current, () => "auto" as const);
  return [choice, chooseTheme];
}
