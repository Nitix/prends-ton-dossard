import type { ComponentType } from "react";

// What a skin is: a way to dress the app, chosen on the device (see index.ts
// and README.md). These types are also read by plugin.ts, in Node: nothing
// here may need a browser.

/** The two modes of a skin: by day and at night. */
export type Mode = "light" | "dark";

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
  /**
   * The art behind the content of a page: the first child of its sheet (`.sheet`,
   * in components/AppShell.tsx), as tall as the sheet, under the page's `main`.
   * Crête draws nothing there. It must never be in the way of a tap
   * (`pointer-events: none`) and, being behind the words, must keep them legible
   * (4.5:1 over it).
   */
  PageArt: NoProps;
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
  /** Two colours that say it in the picker (`#rrggbb`). */
  swatches: readonly [string, string];
  /**
   * The `font-family` of its titles: the picker draws its sample « Aa » in it,
   * with the face that skins/samples.css declares for its letters (or Crête's).
   */
  fontSample: string;
  /**
   * The colour of the browser's bar around the page (`<meta name="theme-color">`,
   * `#rrggbb`): the colour of the top of its header. index.html and `applySkin` set it.
   */
  themeColor: string;
  /**
   * Whether its motifs move, endlessly (an orbit that turns, a patch that fades
   * out and in; see README.md, « Motion »). A person can stop that, so the
   * settings offer « Animer le fond » for a skin that says so (lib/ambient.ts).
   * `motion.css` of its folder is its animation, and a skin with that file says it.
   */
  animatedBackground?: true;
};

/**
 * The look of a skin: what its `look.ts` exports, loaded when the skin is
 * chosen. Importing it brings the skin's stylesheets (its `fonts.css` and its
 * `palette.css`, which it imports) and its motifs, the slots it draws itself;
 * Crête's stand in for the others (see `useSlot`).
 */
export type Look = { slots?: Partial<Slots> };
