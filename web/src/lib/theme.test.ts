import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { THEME_KEY, applyTheme, chooseTheme, readTheme } from "./theme";

// The theme of the app: « Auto » follows the setting of the phone, « Clair » and
// « Sombre » are kept on the device. Here, without a browser: <html> and the
// storage are stand-ins, and the storage can refuse, as it does in some private
// windows. That a stylesheet follows the phone is the browser's test
// (src/theme.test.tsx).

type Root = { dataset: Record<string, string | undefined>; style: { colorScheme?: string } };

let root: Root;
let stored: Map<string, string>;
let refuse: boolean;

const storage = {
  getItem: (key: string) => {
    if (refuse) throw new DOMException("The storage is off", "SecurityError");
    return stored.get(key) ?? null;
  },
  setItem: (key: string, value: string) => {
    if (refuse) throw new DOMException("The storage is full", "QuotaExceededError");
    stored.set(key, value);
  },
  removeItem: (key: string) => {
    if (refuse) throw new DOMException("The storage is off", "SecurityError");
    stored.delete(key);
  },
};

beforeEach(() => {
  root = { dataset: {}, style: {} };
  stored = new Map();
  refuse = false;
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("theme — auto suit le réglage du système", () => {
  // Nothing kept: auto.
  expect(readTheme()).toBe("auto");

  // Auto puts no theme on the page: the stylesheet takes the phone's (its
  // dark colours are under `prefers-color-scheme: dark`), and the native
  // controls follow it too.
  root.dataset.theme = "dark";
  applyTheme("auto");
  expect(root.dataset.theme).toBeUndefined();
  expect(root.style.colorScheme).toBe("light dark");

  // A choice wins over the phone's setting, both ways.
  applyTheme("dark");
  expect(root.dataset.theme).toBe("dark");
  expect(root.style.colorScheme).toBe("dark");
  applyTheme("light");
  expect(root.dataset.theme).toBe("light");
  expect(root.style.colorScheme).toBe("light");
});

test("theme — le choix est gardé sur l'appareil", () => {
  chooseTheme("dark");
  expect(stored.get(THEME_KEY)).toBe("dark");
  expect(readTheme()).toBe("dark");
  expect(root.dataset.theme).toBe("dark");

  chooseTheme("light");
  expect(readTheme()).toBe("light");
  expect(root.dataset.theme).toBe("light");

  // Auto is what there is when nothing is kept.
  chooseTheme("auto");
  expect(stored.has(THEME_KEY)).toBe(false);
  expect(readTheme()).toBe("auto");
  expect(root.dataset.theme).toBeUndefined();
});

test("theme — une valeur inconnue dans le stockage, c'est auto", () => {
  for (const value of ["", "night", "DARK", "auto", '"dark"']) {
    stored.set(THEME_KEY, value);
    expect(readTheme(), `kept: ${value}`).toBe("auto");
  }
});

test("theme — un stockage qui refuse ne casse rien : auto à la lecture, le choix vaut pour la page", () => {
  refuse = true;
  expect(readTheme()).toBe("auto");
  expect(() => {
    chooseTheme("dark");
  }).not.toThrow();
  // Not kept, but the page has it.
  expect(root.dataset.theme).toBe("dark");
  expect(() => {
    chooseTheme("auto");
  }).not.toThrow();
  expect(root.dataset.theme).toBeUndefined();
});

// --- The script of index.html, which runs before the page is first drawn ---

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const head = html.slice(0, html.indexOf("</head>"));
const inline = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");

/** Runs the inline script of the page against a root and a storage (which refuses when `kept` is an error). */
function runInline(kept: string | null | Error): Root {
  const page: Root = { dataset: {}, style: {} };
  const local = {
    getItem: () => {
      if (kept instanceof Error) throw kept;
      return kept;
    },
  };
  runInNewContext(inline[0] ?? "", { document: { documentElement: page }, localStorage: local });
  return page;
}

test("theme — index.html applique un choix gardé avant le premier dessin de la page", () => {
  // One script, in the head, which the browser runs before it draws the body:
  // a forced theme does not flash the other one first.
  expect(inline).toHaveLength(1);
  expect(inline[0]).toContain(THEME_KEY);

  expect(runInline("dark")).toEqual({ dataset: { theme: "dark" }, style: { colorScheme: "dark" } });
  expect(runInline("light")).toEqual({
    dataset: { theme: "light" },
    style: { colorScheme: "light" },
  });
  // Auto, nothing, something else or a storage that refuses: the page is left to the phone.
  const refused = new DOMException("The storage is off", "SecurityError");
  for (const kept of [null, "auto", "night", refused]) {
    expect(runInline(kept), `kept: ${String(kept)}`).toEqual({ dataset: {}, style: {} });
  }
});

test("theme — l'appli suit les autres onglets dès son démarrage, pas seulement sur la page des réglages", () => {
  // main.tsx installs the listener of the storage once, for every page.
  const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
  expect(main).toMatch(/^followThemeElsewhere\(\);$/m);
});
