import { slotted } from "../skins/components";

// The motifs of the skin of the page, in their places (see skins/README.md):
// each component draws the motif of the skin in its slot, or Crête's when the
// skin has none of its own. They are decoration, hidden from screen readers.

/** The art of the sky behind the name of the app: the header of a page, or the pages to sign in. */
export const HeaderArt = slotted("HeaderArt");

/** The name of the app after its mark, on the sky. */
export const BrandMark = slotted("BrandMark");

/** The art behind a hero: the top of the page of an event, or of a runner. */
export const HeroArt = slotted("HeroArt");

/** A line between two blocks of a page. */
export const Divider = slotted("Divider");

/** The mark before the title of a block, as the first child of its `h2` (see BlockTitle). */
export const SectionMarker = slotted("SectionMarker");

/** The art of a list with nothing in it, over its words. */
export const EmptyArt = slotted("EmptyArt");
