import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  SKIN_KEY,
  SKINS,
  applySkin,
  chooseSkin,
  currentSkin,
  followSkinElsewhere,
  readSkin,
  registry,
  slotOf,
} from ".";
import { THEME_KEY, chooseTheme } from "../lib/theme";
import type { Skin, SlotName } from "./types";

// The skins of the app: found by their folders, one of them chosen on the
// device and put on <html> (`data-skin`), with the mode of a skin that has only
// one. Here, without a browser: <html>, the storage and the window are
// stand-ins, and the storage can refuse, as in some private windows. That the
// page is drawn in a skin is the browser's test (smoke.test.tsx).

type Root = { dataset: Record<string, string | undefined>; style: { colorScheme?: string } };

let root: Root;
/** The colour of the bar of the browser, as `<meta name="theme-color">` has it. */
let bar: { content: string };
let stored: Map<string, string>;
let refuse: boolean;
let storageListeners: ((event: Pick<StorageEvent, "key">) => void)[];

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
  bar = { content: "#5e4ae3" };
  stored = new Map();
  refuse = false;
  storageListeners = [];
  vi.stubGlobal("document", {
    documentElement: root,
    querySelector: (selector: string) => (selector === 'meta[name="theme-color"]' ? bar : null),
  });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", {
    addEventListener: (_type: string, listener: (event: Pick<StorageEvent, "key">) => void) => {
      storageListeners.push(listener);
    },
    removeEventListener: (_type: string, listener: (event: Pick<StorageEvent, "key">) => void) => {
      storageListeners = storageListeners.filter((one) => one !== listener);
    },
  });
  // Every test starts on Crête, with « Auto ».
  chooseSkin("crete");
  chooseTheme("auto");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const dir = fileURLToPath(new URL(".", import.meta.url));
const ids = () => SKINS.map((skin) => skin.id);

/** A skin with one mode only, a test of the registry has it (the example skin of the app is one). */
const lightOnly = SKINS.find((skin) => skin.modes.length === 1 && skin.modes[0] === "light");

test("skins — le registre trouve chaque dossier qui a un index.ts, Crête en premier", () => {
  const folders = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "index.ts")))
    .map((entry) => entry.name);
  // Not an empty search: Crête, and the example skin of a test.
  expect(folders).toContain("crete");
  expect(folders).toContain("_example");
  expect(ids().toSorted()).toEqual(folders.toSorted());
  expect(ids()[0]).toBe("crete");
});

test("skins — chacun a un nom, ses modes, deux couleurs et une police ; Crête a tous les motifs", () => {
  for (const skin of SKINS) {
    expect(skin.label.fr.trim(), `skin ${skin.id}`).not.toBe("");
    expect(skin.label.en.trim(), `skin ${skin.id}`).not.toBe("");
    expect(skin.modes.length, `skin ${skin.id}`).toBeGreaterThan(0);
    expect(new Set(skin.modes).size, `skin ${skin.id}`).toBe(skin.modes.length);
    for (const mode of skin.modes) expect(["light", "dark"], `skin ${skin.id}`).toContain(mode);
    for (const colour of skin.swatches)
      expect(colour, `skin ${skin.id}`).toMatch(/^#[0-9a-f]{6}$/i);
    expect(skin.fontSample.trim(), `skin ${skin.id}`).not.toBe("");
    expect(skin.themeColor, `skin ${skin.id}`).toMatch(/^#[0-9a-f]{6}$/i);
  }
  const crete = SKINS[0];
  expect(Object.keys(crete?.slots ?? {}).toSorted()).toEqual(
    ["BrandMark", "Divider", "EmptyArt", "HeaderArt", "HeroArt", "SectionMarker"].toSorted(),
  );
  expect(crete?.modes).toEqual(["light", "dark"]);
  // The violet of the sky, as index.html has it before any skin.
  expect(crete?.themeColor).toBe("#5e4ae3");
});

const fake = (id: string, extra: Partial<Skin> = {}): { skin: Skin } => ({
  skin: {
    id,
    label: { fr: id, en: id },
    modes: ["light"],
    swatches: ["#000000", "#ffffff"],
    fontSample: "serif",
    themeColor: "#000000",
    ...extra,
  },
});

test("registry — Crête d'abord, puis les autres dans l'ordre de leur nom ; un dossier dont l'index n'exporte pas son skin est une erreur", () => {
  const crete = fake("crete");
  const found = registry(
    {
      "./sentier/index.ts": fake("sentier", { label: { fr: "Sentier", en: "Trail" } }),
      "./crete/index.ts": crete,
      "./aurore/index.ts": fake("aurore", { label: { fr: "Aurore", en: "Dawn" } }),
      "./_essai/index.ts": fake("_essai", { label: { fr: "Essai", en: "Test" } }),
    },
    { dev: true },
  );
  expect(found.map((skin) => skin.id)).toEqual(["crete", "aurore", "_essai", "sentier"]);
  // A build has no dev-only skin.
  expect(
    registry(
      { "./crete/index.ts": crete, "./_essai/index.ts": fake("_essai") },
      { dev: false },
    ).map((skin) => skin.id),
  ).toEqual(["crete"]);
  // The id is the name of the folder: what the page and the device keep.
  expect(() =>
    registry({ "./crete/index.ts": crete, "./nuit/index.ts": fake("night") }, { dev: true }),
  ).toThrow(/nuit/);
  expect(() =>
    registry({ "./crete/index.ts": crete, "./nuit/index.ts": {} }, { dev: true }),
  ).toThrow(/nuit/);
  // Crête is the default: without it there is none.
  expect(() => registry({ "./nuit/index.ts": fake("nuit") }, { dev: true })).toThrow(/crete/);
});

test("skins — rien de gardé, un skin inconnu ou un stockage qui refuse : Crête", () => {
  expect(readSkin()).toBe("crete");
  for (const value of ["", "night", "CRETE", '"crete"', "__proto__", "toString"]) {
    stored.set(SKIN_KEY, value);
    expect(readSkin(), `kept: ${value}`).toBe("crete");
  }
  stored.set(SKIN_KEY, "_example");
  expect(readSkin()).toBe("_example");
  refuse = true;
  expect(readSkin()).toBe("crete");
});

test("skins — le skin choisi est sur <html> et gardé sur l'appareil ; Crête, c'est rien", () => {
  chooseSkin("_example");
  expect(stored.get(SKIN_KEY)).toBe("_example");
  expect(root.dataset.skin).toBe("_example");
  expect(readSkin()).toBe("_example");

  chooseSkin("crete");
  expect(stored.has(SKIN_KEY)).toBe(false);
  expect(root.dataset.skin).toBeUndefined();
  expect(readSkin()).toBe("crete");

  // A skin that is not there is Crête.
  chooseSkin("gone");
  expect(root.dataset.skin).toBeUndefined();
  expect(stored.has(SKIN_KEY)).toBe(false);
});

test("applySkin — met un skin sur la page, et sa couleur sur la barre du navigateur, sans rien garder sur l'appareil", () => {
  const example = SKINS.find((skin) => skin.id === "_example");
  applySkin("_example");
  expect(root.dataset.skin).toBe("_example");
  expect(bar.content).toBe(example?.themeColor);
  expect(stored.has(SKIN_KEY)).toBe(false);
  // What main.tsx does at start: the skin kept, on the page.
  stored.set(SKIN_KEY, "_example");
  applySkin("crete");
  applySkin(readSkin());
  expect(root.dataset.skin).toBe("_example");
  applySkin("not-a-skin");
  expect(root.dataset.skin).toBeUndefined();
  expect(bar.content).toBe("#5e4ae3");
});

test("useSkin — le skin de la page est gardé en mémoire : le stockage n'est pas relu à chaque dessin", () => {
  const getItem = vi.spyOn(storage, "getItem");
  chooseSkin("_example");
  getItem.mockClear();
  // What the hook reads, many times: the skin applied last, not the storage.
  const [shown] = SKINS.filter((skin) => skin.id === "_example");
  expect(currentSkin()).toBe(shown);
  expect(currentSkin()).toBe(shown);
  expect(getItem).not.toHaveBeenCalled();
  // The storage changed by hand, without an event: the page keeps what it shows.
  stored.set(SKIN_KEY, "crete");
  expect(currentSkin()).toBe(shown);
  getItem.mockRestore();
});

test("skins — un skin à un seul mode est dessiné dans ce mode, et le choix Clair / Sombre revient avec Crête", () => {
  expect(lightOnly, "a registered skin with a light mode only").toBeDefined();
  const id = lightOnly?.id ?? "";

  chooseTheme("dark");
  expect(root.dataset.theme).toBe("dark");
  chooseSkin(id);
  expect(root.dataset.theme).toBe("light");
  expect(root.style.colorScheme).toBe("light");
  // The choice of the device is kept as it was.
  expect(stored.get(THEME_KEY)).toBe("dark");

  // Choosing a mode under a skin that has one only changes nothing on the page.
  chooseTheme("auto");
  expect(root.dataset.theme).toBe("light");
  chooseTheme("dark");
  expect(root.dataset.theme).toBe("light");

  // Back on a skin with both modes: the choice applies again.
  chooseSkin("crete");
  expect(root.dataset.theme).toBe("dark");
  expect(root.style.colorScheme).toBe("dark");
  chooseTheme("auto");
  expect(root.dataset.theme).toBeUndefined();
  expect(root.style.colorScheme).toBe("light dark");
});

test("skins — un stockage qui refuse ne casse rien : le choix vaut pour la page", () => {
  refuse = true;
  expect(() => {
    chooseSkin("_example");
  }).not.toThrow();
  expect(root.dataset.skin).toBe("_example");
  expect(() => {
    chooseSkin("crete");
  }).not.toThrow();
  expect(root.dataset.skin).toBeUndefined();
});

test("skins — un choix fait dans un autre onglet s'applique ici", () => {
  const stop = followSkinElsewhere();
  expect(storageListeners).toHaveLength(1);
  const tell = (key: string | null) => {
    for (const listener of storageListeners) listener({ key });
  };

  stored.set(SKIN_KEY, "_example");
  tell(SKIN_KEY);
  expect(root.dataset.skin).toBe("_example");
  expect(root.dataset.theme).toBe("light");

  // Another key changes nothing; the storage emptied (key null) is Crête again.
  stored.delete(SKIN_KEY);
  tell("something-else");
  expect(root.dataset.skin).toBe("_example");
  tell(null);
  expect(root.dataset.skin).toBeUndefined();
  expect(root.dataset.theme).toBeUndefined();

  stop();
  expect(storageListeners).toHaveLength(0);
});

test("useSlot — un motif que le skin ne dessine pas est celui de Crête", () => {
  const crete = SKINS[0];
  const slots: SlotName[] = [
    "HeaderArt",
    "BrandMark",
    "HeroArt",
    "Divider",
    "SectionMarker",
    "EmptyArt",
  ];
  for (const skin of SKINS) {
    for (const name of slots) {
      const own = skin.slots?.[name];
      expect(slotOf(skin, name), `${skin.id}: ${name}`).toBe(own ?? crete?.slots?.[name]);
      expect(slotOf(skin, name), `${skin.id}: ${name}`).toBeDefined();
    }
  }
  // The example skin draws a motif of its own, and leaves the others to Crête.
  const example = SKINS.find((skin) => skin.id === "_example");
  expect(Object.keys(example?.slots ?? {}).length).toBeGreaterThan(0);
  expect(Object.keys(example?.slots ?? {}).length).toBeLessThan(slots.length);
});
