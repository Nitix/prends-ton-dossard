import { useSyncExternalStore } from "react";

import { forceMode } from "../lib/theme";
import { skin as crete, slots as creteSlots } from "./crete";
import { LOOKS } from "./looks";
import type { Skin, SlotName, Slots } from "./types";

/**
 * The skins of the app: the ways it can be dressed, one of them chosen on the
 * device. A skin is a folder of this one, found here by its `index.ts` (no list
 * to edit: see README.md). « Crête » is the default: styles.css draws it, and a
 * page without `data-skin` on <html> is in it. Another skin is put on <html>
 * (`data-skin="<id>"`), where its stylesheets take over the colours, and its
 * motifs replace Crête's in the slots of the app (`useSlot`). Its stylesheets
 * and its motifs are its look (`look.ts`), loaded when it is chosen: a person
 * who stays on Crête loads none. The choice is kept on the device, in the local
 * storage; index.html applies it, and links its stylesheets, before the page is
 * first drawn, so that the page never flashes Crête first.
 */

/** Where the device keeps the skin chosen. index.html reads the same key. */
export const SKIN_KEY = "ptd-skin";

type SkinModule = { skin?: Skin };

/**
 * The skins, from the modules of their folders (`./<id>/index.ts`): Crête first,
 * then the others by their French name. A folder whose name starts with `_` is
 * a skin of development, left out of the app unless `dev`. Each module exports
 * its skin as `skin`, with the name of its folder as `id`: a folder that does
 * not is a mistake, said at once rather than shown as Crête.
 */
export function registry(
  modules: Readonly<Record<string, SkinModule>>,
  { dev }: { dev: boolean },
): Skin[] {
  const found = Object.entries(modules).flatMap(([path, module]) => {
    const folder = /([^/]+)\/index\.ts$/.exec(path)?.[1] ?? path;
    // A build makes the module of a skin of development empty (see plugin.ts).
    if (folder.startsWith("_") && (!dev || module.skin === undefined)) return [];
    if (module.skin?.id !== folder) {
      throw new Error(
        `skins/${folder}/index.ts must export its skin as \`skin\`, with the id "${folder}"`,
      );
    }
    return [module.skin];
  });
  const first = found.find((skin) => skin.id === crete.id);
  if (first === undefined) throw new Error(`The skins have no "${crete.id}": it is the default`);
  const others = found
    .filter((skin) => skin !== first)
    .toSorted((a, b) => a.label.fr.localeCompare(b.label.fr, "fr"));
  return [first, ...others];
}

/**
 * Every skin of the app, Crête first: what the picker shows, and what the page
 * needs to put one on <html>. Their looks are not in it.
 */
export const SKINS: readonly Skin[] = registry(
  import.meta.glob<SkinModule>("./*/index.ts", { eager: true }),
  { dev: import.meta.env.DEV },
);

const byId = (id: string | null): Skin | undefined => SKINS.find((skin) => skin.id === id);

/** The default skin: Crête, as registered. */
const DEFAULT: Skin = byId(crete.id) ?? crete;

/** Its id: what the device keeps as nothing, and what an account that chose Crête keeps. */
export const DEFAULT_SKIN = DEFAULT.id;

/**
 * The skin kept on the device, by its id. Nothing kept, a skin that is not (or
 * no longer) in the app, or a storage that refuses (some private windows): Crête.
 */
export function readSkin(): string {
  try {
    return byId(localStorage.getItem(SKIN_KEY))?.id ?? DEFAULT.id;
  } catch {
    return DEFAULT.id;
  }
}

/** How to load the look of each skin, by its id (the name of its folder). */
const LOOK_OF = new Map(
  Object.entries(LOOKS).map(([path, load]) => [/([^/]+)\/look\.ts$/.exec(path)?.[1] ?? path, load]),
);

/** The motifs of each skin whose look is loaded, by its id. */
const loaded = new Map<string, Partial<Slots>>();

/** The looks on their way, by the id of their skin: each is asked for once at a time. */
const loading = new Map<string, Promise<void>>();

/**
 * Loads the look of a skin (see looks.ts): its stylesheets, which are then in
 * the page, and its motifs, which `useSlot` then draws. Crête, or a skin that
 * is not (or no longer) in the app, has nothing to load: Crête. A look is
 * loaded once; one that fails (offline, never loaded before) is asked for again
 * next time. It rejects when the look could not be loaded.
 */
export async function loadSkin(id: string): Promise<Skin> {
  const skin = byId(id) ?? DEFAULT;
  const load = LOOK_OF.get(skin.id);
  if (skin === DEFAULT || load === undefined || loaded.has(skin.id)) return skin;
  let pending = loading.get(skin.id);
  if (pending === undefined) {
    pending = (async () => {
      try {
        const look = await load();
        loaded.set(skin.id, look.slots ?? {});
      } finally {
        loading.delete(skin.id);
      }
    })();
    loading.set(skin.id, pending);
  }
  await pending;
  return skin;
}

const listeners = new Set<() => void>();

/**
 * The skin of the page: the one applied last (by main.tsx at start, by a
 * choice, from another tab). Until one is, the one kept on the device, read
 * once. A choice that the storage refused stays here until the page is closed.
 */
let shown: Skin | undefined;

/**
 * How many times a skin was asked for: a choice whose look finishes loading
 * after a later one was asked for is not applied.
 */
let asked = 0;

/**
 * Puts a skin on the page: `data-skin` on <html>, none for Crête (or a skin
 * that is not in the app), the mode of a skin that has one only, and its
 * colour for the bar of the browser. Whoever shows the skin is told. Its look
 * is not loaded here: until it is, Crête's motifs stand in for its own (the
 * app puts a skin on the page once its look is loaded, see `chooseSkin`).
 */
export function applySkin(id: string): void {
  asked++;
  const skin = byId(id) ?? DEFAULT;
  shown = skin;
  const root = document.documentElement;
  if (skin === DEFAULT) delete root.dataset.skin;
  else root.dataset.skin = skin.id;
  forceMode(skin.modes.length === 1 ? (skin.modes[0] ?? null) : null);
  const bar = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (bar !== null) bar.content = skin.themeColor;
  for (const listener of listeners) listener();
}

/** Keeps a skin on the device (Crête is kept as nothing); nothing when the storage refuses. */
function keepSkin(skin: Skin): void {
  try {
    if (skin === DEFAULT) localStorage.removeItem(SKIN_KEY);
    else localStorage.setItem(SKIN_KEY, skin.id);
  } catch {
    // Not kept, but the page has it (`shown`) until it is closed.
  }
}

/**
 * What came of asking for a skin: it is on the page (`chosen`); another one was
 * asked for in the meantime, and wins (`replaced`); its look could not be loaded,
 * and the page is as it was (`failed`).
 */
export type Choice = "chosen" | "replaced" | "failed";

/**
 * Puts a skin on the page once its look is loaded, unless another one was
 * asked for in the meantime: the page is never in a skin without its
 * stylesheets. `before` runs just before (to keep the choice). A look that
 * cannot be loaded leaves the page as it was.
 */
async function showLoaded(id: string, before: (skin: Skin) => void = () => {}): Promise<Choice> {
  const ask = ++asked;
  let skin: Skin;
  try {
    skin = await loadSkin(id);
  } catch {
    // A look that fails after another skin was asked for is of no concern.
    return ask === asked ? "failed" : "replaced";
  }
  if (ask !== asked) return "replaced";
  before(skin);
  applySkin(skin.id);
  return "chosen";
}

/**
 * Chooses a skin: its look loaded, then kept on the device, applied, told to
 * whoever shows it. Two choices in a row (the arrows of the picker): the last
 * one wins, whichever loads first. A look that cannot be loaded (offline, never
 * loaded before) leaves the page and the device as they were. What came of the
 * choice is told (`Choice`), for whoever has more to do when it worked (the
 * account keeps it) or something to say when it did not (the picker).
 */
export function chooseSkin(id: string): Promise<Choice> {
  return showLoaded(id, keepSkin);
}

/**
 * The skin kept on the device, on the page at start (main.tsx, before the app
 * is first drawn). At once, what index.html has already done: `data-skin`, the
 * mode of a skin that has one only, the colour of the bar (in a build,
 * index.html has linked its stylesheets too). Then its look, so that its motifs
 * are drawn from the first render. A skin kept that is no longer in the app,
 * or whose look cannot be loaded, is Crête; the device keeps the choice.
 */
export async function showKeptSkin(): Promise<void> {
  const id = readSkin();
  applySkin(id);
  const ask = asked;
  try {
    await loadSkin(id);
  } catch {
    if (ask === asked) applySkin(DEFAULT.id);
  }
}

/** A change of the storage made by another page of the site: the skin, if it was its key. */
function changedElsewhere(event: Pick<StorageEvent, "key">): void {
  // `null`: the whole storage was emptied.
  if (event.key !== SKIN_KEY && event.key !== null) return;
  void showLoaded(readSkin());
}

/**
 * Follows a skin chosen in another tab or window of the app on this device,
 * whatever this page shows, as `followThemeElsewhere` does for the theme.
 * main.tsx installs it once for the app; what it returns removes it (for a test).
 */
export function followSkinElsewhere(): () => void {
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

/** The skin of the page, as `useSkin` reads it: without reading the storage again on every render. */
export const currentSkin = (): Skin => (shown ??= byId(readSkin()) ?? DEFAULT);

/** The skin of the page, and how to choose another (by its id). */
export function useSkin(): [Skin, (id: string) => Promise<Choice>] {
  const skin = useSyncExternalStore(subscribe, currentSkin, () => DEFAULT);
  return [skin, chooseSkin];
}

/** The motif of a skin in a slot: its own, once its look is loaded, or Crête's. */
export function slotOf<N extends SlotName>(skin: Skin, name: N): Slots[N] {
  return loaded.get(skin.id)?.[name] ?? creteSlots[name];
}

/**
 * The motif of the skin of the page in a slot of the app, as a component. The
 * app draws it through `slotted` (components.tsx), as components/Slots.tsx does.
 */
export function useSlot<N extends SlotName>(name: N): Slots[N] {
  const [skin] = useSkin();
  return slotOf(skin, name);
}
