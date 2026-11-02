import type { ComponentType, ReactNode } from "react";

// What a skin is: a way to dress the app, chosen on the device (see index.ts
// and README.md). These types are also read by plugin.ts, in Node: nothing
// here may need a browser.

/** The two modes of a skin: by day and at night. */
export type Mode = "light" | "dark";

/**
 * How deep the skins go, set at build time by `VITE_SKIN_DEPTH`: only their
 * colours, fonts and motifs on the structure of « Crête » (palette), the
 * signature pieces too (mix), or the whole variant (full). Each level has the
 * ones before it.
 */
export const DEPTHS = ["palette", "mix", "full"] as const;
export type Depth = (typeof DEPTHS)[number];

/** The art in the sky behind the name of the app: the header of a page, or the whole page to sign in. */
export type HeaderArtProps = {
  place: "header" | "welcome";
  /** In the header: whether the sun rises there (a page with a hero has its own). */
  sun?: boolean;
};

/** The name of the app after its mark, on the sky. */
export type BrandMarkProps = { size?: "md" | "lg" };

/** The art behind a hero: the top of the page of an event, or of a runner. */
export type HeroArtProps = { place: "event" | "runner" };

/** A line between two blocks of a page. */
export type DividerProps = { className?: string };

/** A motif with no props. */
export type NoProps = { children?: never };

/** The props of the motif of each slot. */
export type SlotProps = {
  HeaderArt: HeaderArtProps;
  BrandMark: BrandMarkProps;
  HeroArt: HeroArtProps;
  Divider: DividerProps;
  /** The mark before the title of a block (`BlockTitle`, an `h2.section-title`): its first child. */
  SectionMarker: NoProps;
  /** The art of a list with nothing in it, over its words (see components/EmptyState.tsx). */
  EmptyArt: NoProps;
};

export type SlotName = keyof SlotProps;

/**
 * The motifs of a skin, each in a named place of the app. They are decoration:
 * hidden from screen readers (`aria-hidden`), they never say what the words
 * around them do not. Crête has them all; another skin gives those it draws
 * differently, and Crête's stand in for the others (see `useSlot`).
 */
export type Slots = { [N in SlotName]: ComponentType<SlotProps[N]> };

/** A skin: what its folder's `index.ts` exports as `skin`. */
export type Skin = {
  /** The name of its folder, and what `<html data-skin>` and the device keep. */
  id: string;
  /** Its name in the picker of the settings. */
  label: { fr: string; en: string };
  /**
   * Its modes. A skin with one only is always drawn in it: the choice of « Clair »,
   * « Sombre » or « Auto » is kept for the skins that have both.
   */
  modes: readonly Mode[];
  /** The motifs it draws itself. */
  slots?: Partial<Slots>;
  /** Two colours that say it in the picker (`#rrggbb`). */
  swatches: readonly [string, string];
  /**
   * The `font-family` of its titles: the picker draws a sample in it once the
   * font is loaded (it never loads a font to show it), else in the app's.
   */
  fontSample: string;
  /**
   * The colour of the browser's bar around the page (`<meta name="theme-color">`,
   * `#rrggbb`): the colour of the top of its header. index.html and `applySkin` set it.
   */
  themeColor: string;
};

/** The props of components/EmptyState.tsx. */
export type EmptyStateProps = { title: ReactNode; hint: ReactNode };

/**
 * The components that a skin may replace at a depth beyond palette, by name,
 * with their props: a component made skinnable (`skinnable` in components.tsx)
 * adds its line here. A name that is not here does not typecheck, in a skin's
 * `variants` as at the call.
 */
export type VariantProps = {
  EmptyState: EmptyStateProps;
};

export type VariantName = keyof VariantProps;

/**
 * What a skin's `mix.tsx` or `full.tsx` exports as `variants`: the components
 * it replaces at that depth, each taking the props of the one it replaces.
 */
export type Variants = { readonly [N in VariantName]?: ComponentType<VariantProps[N]> };
