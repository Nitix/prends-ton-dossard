import { useSyncExternalStore, type ComponentType } from "react";
import { variants as depthVariants } from "virtual:skin-depth";

import { forceMode } from "../lib/theme";
import { skin as crete, slots as creteSlots } from "./crete";
import type { Depth, Skin, SlotName, Slots, Variants } from "./types";

/**
 * The skins of the app: the ways it can be dressed, one of them chosen on the
 * device. A skin is a folder of this one, found here by its `index.ts` (no list
 * to edit: see README.md). « Crête » is the default: styles.css draws it, and a
 * page without `data-skin` on <html> is in it. Another skin is put on <html>
 * (`data-skin="<id>"`), where its stylesheet takes over the colours, and its
 * motifs replace Crête's in the slots of the app (`useSlot`). The choice is kept
 * on the device, in the local storage; index.html applies it before the page is
 * first drawn, so that the page never flashes Crête first.
 */

/** Where the device keeps the skin chosen. index.html reads the same key. */
export const SKIN_KEY = "ptd-skin";

/** How deep the skins go in this build (`VITE_SKIN_DEPTH`, see plugin.ts): a constant of the build. */
export const SKIN_DEPTH: Depth = BUILD_SKIN_DEPTH;

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

/** Every skin of the app, Crête first. */
export const SKINS: readonly Skin[] = registry(
  import.meta.glob<SkinModule>("./*/index.ts", { eager: true }),
  { dev: import.meta.env.DEV },
);

const byId = (id: string | null): Skin | undefined => SKINS.find((skin) => skin.id === id);

/** The default skin: Crête, as registered. */
const DEFAULT: Skin = byId(crete.id) ?? crete;

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

/**
 * Puts a skin on the page: `data-skin` on <html>, none for Crête (or a skin
 * that is not in the app), and the mode of a skin that has one only.
 */
export function applySkin(id: string): void {
  const skin = byId(id) ?? DEFAULT;
  const root = document.documentElement;
  if (skin === DEFAULT) delete root.dataset.skin;
  else root.dataset.skin = skin.id;
  forceMode(skin.modes.length === 1 ? (skin.modes[0] ?? null) : null);
}

/** Keeps a skin on the device (Crête is kept as nothing); false when the storage refuses. */
function keepSkin(skin: Skin): boolean {
  try {
    if (skin === DEFAULT) localStorage.removeItem(SKIN_KEY);
    else localStorage.setItem(SKIN_KEY, skin.id);
    return true;
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();

/** The skin of this page, when the storage could not keep it: the page has it until it is closed. */
let unkept: Skin | null = null;

function tell(): void {
  for (const listener of listeners) listener();
}

/** Chooses a skin: kept on the device, applied at once, told to whoever shows it. */
export function chooseSkin(id: string): void {
  const skin = byId(id) ?? DEFAULT;
  unkept = keepSkin(skin) ? null : skin;
  applySkin(skin.id);
  tell();
}

/** A change of the storage made by another page of the site: the skin, if it was its key. */
function changedElsewhere(event: Pick<StorageEvent, "key">): void {
  // `null`: the whole storage was emptied.
  if (event.key !== SKIN_KEY && event.key !== null) return;
  unkept = null;
  applySkin(readSkin());
  tell();
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

const current = (): Skin => unkept ?? byId(readSkin()) ?? DEFAULT;

/** The skin chosen on this device, and how to choose another (by its id). */
export function useSkin(): [Skin, (id: string) => void] {
  const skin = useSyncExternalStore(subscribe, current, () => DEFAULT);
  return [skin, chooseSkin];
}

/** The motif of a skin in a slot: its own, or Crête's when it does not draw that one. */
export function slotOf<N extends SlotName>(skin: Skin, name: N): Slots[N] {
  return skin.slots?.[name] ?? creteSlots[name];
}

/**
 * The motif of the skin of the page in a slot of the app, as a component:
 * `const Divider = useSlot("Divider")`, then `<Divider />`.
 */
export function useSlot<N extends SlotName>(name: N): Slots[N] {
  const [skin] = useSkin();
  return slotOf(skin, name);
}

/** The order of the files of variants: mix, then full. */
const level = (path: string) => (path.endsWith("/full.tsx") ? 1 : 0);

/**
 * The components that each skin replaces at the depth of the build, from the
 * modules of its `mix.tsx` and `full.tsx` (by the path of their file): the
 * variants of full win over those of mix.
 */
export function variantsBySkin(modules: Readonly<Record<string, Variants>>): Map<string, Variants> {
  const bySkin = new Map<string, Variants>();
  for (const [path, variants] of Object.entries(modules).toSorted(
    ([a], [b]) => level(a) - level(b),
  )) {
    const id = /([^/]+)\/(?:mix|full)\.tsx$/.exec(path)?.[1];
    if (id !== undefined) bySkin.set(id, { ...bySkin.get(id), ...variants });
  }
  return bySkin;
}

const VARIANTS = variantsBySkin(depthVariants);

/**
 * A component that a skin may replace at a depth beyond palette (the bib of
 * « Dossard », the ticket of « Rétro »…): `const Card = useSkinVariant("EventCard",
 * EventCard)`, then `<Card … />`. It is the variant that the skin of the page
 * exports under that name from its `mix.tsx` or `full.tsx`, when the build is
 * deep enough to have that file, and `fallback` otherwise. A variant takes the
 * props of the component it replaces.
 */
export function useSkinVariant<P extends object>(
  name: string,
  fallback: ComponentType<P>,
): ComponentType<P> {
  const [skin] = useSkin();
  const variant = VARIANTS.get(skin.id)?.[name];
  return variant ?? fallback;
}
