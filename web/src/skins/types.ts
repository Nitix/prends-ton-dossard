import type { ComponentType, ReactNode, RefObject } from "react";

import type { EventView } from "../features/events/api.ts";
import type { RunnerRecord } from "../lib/types.ts";

// What a skin is: a way to dress the app, chosen on the device (see index.ts
// and README.md). These types are also read by plugin.ts, in Node: nothing
// here may need a browser. The types of the app it names are imported as types
// only, with their extension, as Vite's loader of the config asks.

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
 * The list an event card is in: the next events of the group on the home page,
 * the events to come or the past ones of the list, the events of a day of the
 * agenda. Crête draws them alike; a variant may tell them apart (« Dossard »:
 * the band of its bib in coral for what is to come, in sun for the results, in
 * sky in the agenda), never by colour alone.
 */
export type EventCardList = "home" | "upcoming" | "past" | "agenda";

/** The props of features/events/EventCard.tsx: an event in a list. */
export type EventCardProps = {
  /** The event, its formats and who is on them, its days. */
  view: EventView;
  /** The list it is in. */
  list: EventCardList;
};

/**
 * The props of `DateChip` (components/Dawn.tsx): the day or days of an event as
 * a picture, hidden from screen readers, which read `label`.
 */
export type DateChipProps = {
  start: Temporal.PlainDate;
  /** The last day, for an event of several days. */
  end?: Temporal.PlainDate;
  /** The date in words, read instead of the picture. */
  label: string;
  size?: "md" | "lg";
};

/** The props of features/events/EventHero.tsx: the top of the page of an event. */
export type EventHeroProps = {
  /** The event, its formats and who is on them, its days. */
  view: EventView;
  /**
   * What the title of the page (the `h1` of the hero) carries, to spread on it:
   * its id, which the actions of the page name (`aria-describedby`), and what
   * lets the page give it the focus (`data-focus`, `tabIndex`).
   */
  heading: { id: string; "data-focus": string; tabIndex: -1 };
};

/** The props of features/runners/RunnerHero.tsx: the top of the page of a runner. */
export type RunnerHeroProps = {
  /** The runner, once known: until then, the title says « Coureur » and there is no photo. */
  runner: RunnerRecord | undefined;
  /**
   * What the title of the page (the `h1` of the hero) carries, to spread on it:
   * the ref by which a failure gives it the focus (`LoadFailure`), and `tabIndex`.
   */
  heading: { ref: RefObject<HTMLHeadingElement | null>; tabIndex: -1 };
};

/**
 * The components that a skin may replace at a depth beyond palette, by name,
 * with their props: a component made skinnable (`skinnable` in components.tsx)
 * adds its line here. A name that is not here does not typecheck, in a skin's
 * `variants` as at the call.
 */
export type VariantProps = {
  EmptyState: EmptyStateProps;
  EventCard: EventCardProps;
  EventHero: EventHeroProps;
  DateChip: DateChipProps;
  RunnerHero: RunnerHeroProps;
};

export type VariantName = keyof VariantProps;

/**
 * What a variant is given: the props of the piece it replaces, and that piece
 * as Crête draws it, `Base` (with the skin's motifs in its slots), so that it
 * can frame or wrap it rather than draw it again. `Base` takes the props alone:
 * `({ Base, ...props }) => <div className="frame"><Base {...props} /></div>`.
 */
export type VariantPropsOf<N extends VariantName> = VariantProps[N] & {
  Base: ComponentType<VariantProps[N]>;
};

/**
 * What a skin's `mix.tsx` or `full.tsx` exports as `variants`: the components
 * it replaces at that depth, each taking the props of the one it replaces, and
 * that one as `Base`.
 */
export type Variants = { readonly [N in VariantName]?: ComponentType<VariantPropsOf<N>> };
