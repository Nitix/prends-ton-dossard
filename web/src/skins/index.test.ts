import { readdirSync, existsSync, readFileSync } from "node:fs";
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
} from ".";
import { THEME_KEY, chooseTheme } from "../lib/theme";
import { slots as creteSlots } from "./crete";
import { LOOKS } from "./looks";
import type { Skin, SlotName, Slots } from "./types";

// The skins of the app: found by their folders, one of them chosen on the
// device and put on <html> (`data-skin`), with the mode of a skin that has only
// one. Each skin but Crête has its look (its sheets and its motifs), loaded when
// it is chosen. Here, without a browser: <html>, the storage and the window are
// stand-ins, and the storage can refuse, as in some private windows; a look can
// be slow or fail to load, as offline. That the page is drawn in a skin is the
// browser's test (smoke.test.tsx).

/** How the looks load in a test: a gate that holds one back, a skin whose look fails (offline). */
const looks = vi.hoisted(() => ({
  gates: new Map<string, Promise<void>>(),
  failing: new Set<string>(),
}));

vi.mock("./looks", async (importOriginal) => {
  const { LOOKS: real } = await importOriginal<typeof import("./looks")>();
  return {
    LOOKS: Object.fromEntries(
      Object.entries(real).map(([path, load]) => [
        path,
        async () => {
          const id = /^\.\/([^/]+)\/look\.ts$/.exec(path)?.[1] ?? path;
          await looks.gates.get(id);
          if (looks.failing.has(id)) {
            throw new TypeError(`Failed to fetch dynamically imported module: ${path}`);
          }
          return load();
        },
      ]),
    ),
  };
});

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

beforeEach(async () => {
  root = { dataset: {}, style: {} };
  bar = { content: "#5e4ae3" };
  stored = new Map();
  refuse = false;
  storageListeners = [];
  looks.gates.clear();
  looks.failing.clear();
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
  await chooseSkin("crete");
  chooseTheme("auto");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const dir = fileURLToPath(new URL(".", import.meta.url));
const ids = () => SKINS.map((skin) => skin.id);

/** A skin with one mode only, a test of the registry has it (the example skin of the app is one). */
const lightOnly = SKINS.find((skin) => skin.modes.length === 1 && skin.modes[0] === "light");

/** The skins but Crête. */
const OTHERS = SKINS.filter((skin) => skin.id !== "crete");

/** A gate that holds the look of a skin back until it is opened. */
function hold(id: string): () => void {
  const { promise, resolve } = Promise.withResolvers<void>();
  looks.gates.set(id, promise);
  return () => {
    resolve();
  };
}

/**
 * A fresh registry, with no look loaded yet: the module of the skins as a page
 * has it when it opens (the stand-ins of the page stay).
 */
async function freshPage(): Promise<
  typeof import(".") & {
    creteSlots: Slots;
    /** The motifs that the look of a skin draws itself. */
    lookOf: (id: string) => Promise<Partial<Slots>>;
  }
> {
  vi.resetModules();
  const page = await import(".");
  const { slots } = await import("./crete");
  const { LOOKS: fresh } = await import("./looks");
  return {
    ...page,
    creteSlots: slots,
    lookOf: async (id) => (await fresh[`./${id}/look.ts`]?.())?.slots ?? {},
  };
}

const SLOTS: SlotName[] = [
  "HeaderArt",
  "BrandMark",
  "HeroArt",
  "Divider",
  "SectionMarker",
  "EmptyArt",
];

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
  expect(Object.keys(creteSlots).toSorted()).toEqual(SLOTS.toSorted());
  const crete = SKINS[0];
  expect(crete?.modes).toEqual(["light", "dark"]);
  // The violet of the sky, as index.html has it before any skin.
  expect(crete?.themeColor).toBe("#5e4ae3");
});

test("skins — l'index d'un skin ne dit que ce que le registre et le choix en lisent : rien de son look", () => {
  // The registry is in the entry of the app, for everyone: an index that
  // imported a motif or a sheet would bring it to every page.
  for (const skin of OTHERS) {
    const source = readFileSync(join(dir, skin.id, "index.ts"), "utf8");
    const imports = [...source.matchAll(/^import (type )?[^;]*? from "([^"]+)";$/gm)];
    expect(
      imports.filter(([, type]) => type === undefined).map(([, , from]) => from),
      `skins/${skin.id}/index.ts imports more than types`,
    ).toEqual([]);
    expect(source, `skins/${skin.id}/index.ts`).not.toMatch(/^import "/m);
  }
});

test("skins — chaque skin sauf Crête a son look : un look.ts qui importe sa palette et ses polices", () => {
  const paths = Object.keys(LOOKS).toSorted();
  expect(paths).toEqual(OTHERS.map((skin) => `./${skin.id}/look.ts`).toSorted());
  expect(paths).not.toContain("./crete/look.ts");
  for (const skin of OTHERS) {
    const source = readFileSync(join(dir, skin.id, "look.ts"), "utf8");
    const sheets = [...source.matchAll(/^import "(\.[^"]+\.css)";$/gm)].map(([, sheet]) => sheet);
    expect(sheets, `skins/${skin.id}/look.ts`).toContain("./palette.css");
    expect(sheets.includes("./fonts.css"), `skins/${skin.id}/look.ts: its fonts.css`).toBe(
      existsSync(join(dir, skin.id, "fonts.css")),
    );
    // The utilities of its motifs, when it draws with classes (styles.css does not scan its folder).
    expect(sheets.includes("./utilities.css"), `skins/${skin.id}/look.ts: its utilities.css`).toBe(
      existsSync(join(dir, skin.id, "utilities.css")),
    );
    const shares = /from "\.\.\/shared\/[^"]+";$/m.test(source);
    expect(
      !shares || sheets.includes("../shared/utilities.css"),
      `skins/${skin.id}/look.ts: the utilities of what it shares`,
    ).toBe(true);
    // What it shares, it takes from a folder that is not a skin, never from another skin.
    const from = [
      ...source.matchAll(/ from "([^"]+)";$/gm),
      ...source.matchAll(/^import "([^"]+)";$/gm),
    ];
    for (const [, path = ""] of from) {
      const folder = /^\.\.\/([^/]+)\//.exec(path)?.[1];
      expect(
        folder === undefined || folder === "shared" || folder === "crete",
        `skins/${skin.id}/look.ts imports ${path}`,
      ).toBe(true);
    }
  }
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

test("skins — le skin choisi est sur <html> et gardé sur l'appareil ; Crête, c'est rien", async () => {
  await chooseSkin("_example");
  expect(stored.get(SKIN_KEY)).toBe("_example");
  expect(root.dataset.skin).toBe("_example");
  expect(readSkin()).toBe("_example");

  await chooseSkin("crete");
  expect(stored.has(SKIN_KEY)).toBe(false);
  expect(root.dataset.skin).toBeUndefined();
  expect(readSkin()).toBe("crete");

  // A skin that is not there is Crête.
  await chooseSkin("gone");
  expect(root.dataset.skin).toBeUndefined();
  expect(stored.has(SKIN_KEY)).toBe(false);
});

test("chooseSkin — le look du skin est chargé avant qu'il soit sur la page : ses motifs y sont dès qu'il y est", async () => {
  const { chooseSkin: choose, slotOf: slotIn, creteSlots: crete, lookOf } = await freshPage();
  for (const skin of OTHERS) {
    const open = hold(skin.id);
    const choosing = choose(skin.id);
    // While it loads, the page stays as it was, and so does the device.
    await Promise.resolve();
    expect(root.dataset.skin, `${skin.id} while its look loads`).toBeUndefined();
    expect(stored.has(SKIN_KEY), `${skin.id} while its look loads`).toBe(false);
    open();
    await choosing;
    expect(root.dataset.skin).toBe(skin.id);
    expect(stored.get(SKIN_KEY)).toBe(skin.id);
    // Its motifs, those of its look, and Crête's where it draws none.
    const own = await lookOf(skin.id);
    for (const name of SLOTS) {
      const expected = own[name] ?? crete[name];
      expect(slotIn(skin, name), `${skin.id}: ${name}`).toBe(expected);
    }
    await choose("crete");
  }
});

test("chooseSkin — deux choix coup sur coup : le dernier l'emporte, même si le premier finit de charger après", async () => {
  const { chooseSkin: choose } = await freshPage();
  const [first, second] = OTHERS;
  if (first === undefined || second === undefined) throw new Error("two skins besides Crête");
  const open = hold(first.id);
  const slow = choose(first.id);
  await choose(second.id);
  expect(root.dataset.skin).toBe(second.id);
  open();
  await slow;
  expect(root.dataset.skin).toBe(second.id);
  expect(stored.get(SKIN_KEY)).toBe(second.id);
});

test("chooseSkin — un look qui ne se charge pas (hors ligne, jamais chargé) : la page garde son skin, et l'appareil son choix", async () => {
  const { chooseSkin: choose, currentSkin: current } = await freshPage();
  const [skin] = OTHERS;
  if (skin === undefined) throw new Error("a skin besides Crête");
  looks.failing.add(skin.id);
  await expect(choose(skin.id)).resolves.toBeUndefined();
  expect(root.dataset.skin).toBeUndefined();
  expect(stored.has(SKIN_KEY)).toBe(false);
  expect(current().id).toBe("crete");
});

test("showKeptSkin — au démarrage, le skin gardé tout de suite (son mode, la barre), puis son look avant le premier dessin", async () => {
  const page = await freshPage();
  stored.set(SKIN_KEY, "_example");
  const example = SKINS.find((skin) => skin.id === "_example");
  const open = hold("_example");
  const showing = page.showKeptSkin();
  // At once, what index.html has already put on the page: its mode and the colour of the bar.
  expect(root.dataset.skin).toBe("_example");
  expect(root.dataset.theme).toBe("light");
  expect(bar.content).toBe(example?.themeColor);
  open();
  await showing;
  expect(root.dataset.skin).toBe("_example");
  const own = await page.lookOf("_example");
  expect(own.SectionMarker).toBeDefined();
  expect(page.slotOf(page.currentSkin(), "SectionMarker")).toBe(own.SectionMarker);
});

test("showKeptSkin — un skin gardé qui n'est plus dans l'appli, ou dont le look ne se charge pas : Crête, sans erreur", async () => {
  for (const kept of ["gone", "__proto__"]) {
    const page = await freshPage();
    stored.set(SKIN_KEY, kept);
    await expect(page.showKeptSkin()).resolves.toBeUndefined();
    expect(root.dataset.skin, `kept: ${kept}`).toBeUndefined();
    expect(bar.content).toBe("#5e4ae3");
  }
  const page = await freshPage();
  stored.set(SKIN_KEY, "_example");
  looks.failing.add("_example");
  await expect(page.showKeptSkin()).resolves.toBeUndefined();
  expect(root.dataset.skin).toBeUndefined();
  expect(page.currentSkin().id).toBe("crete");
  // The choice stays on the device: online again, the next visit has it.
  expect(stored.get(SKIN_KEY)).toBe("_example");
});

test("loadSkin — Crête et un skin inconnu n'ont rien à charger ; un look se charge une fois", async () => {
  const page = await freshPage();
  await expect(page.loadSkin("crete")).resolves.toMatchObject({ id: "crete" });
  await expect(page.loadSkin("gone")).resolves.toMatchObject({ id: "crete" });
  const load = vi.fn<() => void>();
  looks.gates.set("_example", Promise.resolve().then(load));
  await page.loadSkin("_example");
  await page.loadSkin("_example");
  expect(load).toHaveBeenCalledTimes(1);
});

test("applySkin — met un skin sur la page, et sa couleur sur la barre du navigateur, sans rien garder sur l'appareil", () => {
  const example = SKINS.find((skin) => skin.id === "_example");
  applySkin("_example");
  expect(root.dataset.skin).toBe("_example");
  expect(bar.content).toBe(example?.themeColor);
  expect(stored.has(SKIN_KEY)).toBe(false);
  applySkin("not-a-skin");
  expect(root.dataset.skin).toBeUndefined();
  expect(bar.content).toBe("#5e4ae3");
});

test("useSkin — le skin de la page est gardé en mémoire : le stockage n'est pas relu à chaque dessin", async () => {
  const getItem = vi.spyOn(storage, "getItem");
  await chooseSkin("_example");
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

test("skins — un skin à un seul mode est dessiné dans ce mode, et le choix Clair / Sombre revient avec Crête", async () => {
  expect(lightOnly, "a registered skin with a light mode only").toBeDefined();
  const id = lightOnly?.id ?? "";

  chooseTheme("dark");
  expect(root.dataset.theme).toBe("dark");
  await chooseSkin(id);
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
  await chooseSkin("crete");
  expect(root.dataset.theme).toBe("dark");
  expect(root.style.colorScheme).toBe("dark");
  chooseTheme("auto");
  expect(root.dataset.theme).toBeUndefined();
  expect(root.style.colorScheme).toBe("light dark");
});

test("skins — un stockage qui refuse ne casse rien : le choix vaut pour la page", async () => {
  refuse = true;
  await expect(chooseSkin("_example")).resolves.toBeUndefined();
  expect(root.dataset.skin).toBe("_example");
  await expect(chooseSkin("crete")).resolves.toBeUndefined();
  expect(root.dataset.skin).toBeUndefined();
});

test("skins — un choix fait dans un autre onglet s'applique ici, son look chargé", async () => {
  const stop = followSkinElsewhere();
  expect(storageListeners).toHaveLength(1);
  const tell = (key: string | null) => {
    for (const listener of storageListeners) listener({ key });
  };

  stored.set(SKIN_KEY, "_example");
  tell(SKIN_KEY);
  await vi.waitFor(() => {
    expect(root.dataset.skin).toBe("_example");
  });
  expect(root.dataset.theme).toBe("light");

  // Another key changes nothing; the storage emptied (key null) is Crête again.
  stored.delete(SKIN_KEY);
  tell("something-else");
  await Promise.resolve();
  expect(root.dataset.skin).toBe("_example");
  tell(null);
  await vi.waitFor(() => {
    expect(root.dataset.skin).toBeUndefined();
  });
  expect(root.dataset.theme).toBeUndefined();

  stop();
  expect(storageListeners).toHaveLength(0);
});

test("useSlot — un motif que le skin ne dessine pas est celui de Crête, et celui d'un skin dont le look n'est pas chargé aussi", async () => {
  const page = await freshPage();
  const [skin] = OTHERS;
  if (skin === undefined) throw new Error("a skin besides Crête");
  // Not loaded yet: Crête's, in every slot.
  for (const name of SLOTS) expect(page.slotOf(skin, name)).toBe(page.creteSlots[name]);
  for (const one of SKINS) {
    await page.loadSkin(one.id);
    const own = one.id === "crete" ? page.creteSlots : await page.lookOf(one.id);
    for (const name of SLOTS) {
      expect(page.slotOf(one, name), `${one.id}: ${name}`).toBe(own[name] ?? page.creteSlots[name]);
    }
  }
  // The example skin draws a motif of its own, and leaves the others to Crête.
  const example = await page.lookOf("_example");
  expect(Object.keys(example).length).toBeGreaterThan(0);
  expect(Object.keys(example).length).toBeLessThan(SLOTS.length);
});
