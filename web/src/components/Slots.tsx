import { useSlot } from "../skins";
import type { BrandMarkProps, DividerProps, HeaderArtProps, HeroArtProps } from "../skins/types";

// The motifs of the skin of the page, in their places (see skins/README.md):
// each component draws the motif of the skin in its slot, or Crête's when the
// skin has none of its own. They are decoration, hidden from screen readers.
//
// Each draws a component that `useSlot` gives during the render: one of the
// registry, the same for as long as the skin is, never one made in the render.
// The rule that guards against those cannot see it.
/* oxlint-disable react/static-components */

/** The art of the sky behind the name of the app: the header of a page, or the pages to sign in. */
export function HeaderArt(props: HeaderArtProps) {
  const Art = useSlot("HeaderArt");
  return <Art {...props} />;
}

/** The name of the app after its mark, on the sky. */
export function BrandMark(props: BrandMarkProps) {
  const Mark = useSlot("BrandMark");
  return <Mark {...props} />;
}

/** The art behind a hero: the top of the page of an event, or of a runner. */
export function HeroArt(props: HeroArtProps) {
  const Art = useSlot("HeroArt");
  return <Art {...props} />;
}

/** A line between two blocks of a page. */
export function Divider(props: DividerProps) {
  const Line = useSlot("Divider");
  return <Line {...props} />;
}

/** The mark before the title of a block, as the first child of its `h2.section-title`. */
export function SectionMarker() {
  const Marker = useSlot("SectionMarker");
  return <Marker />;
}

/** The art of a list with nothing in it, over its words. */
export function EmptyArt() {
  const Art = useSlot("EmptyArt");
  return <Art />;
}
