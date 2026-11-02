import type { Skin } from "../types";

// « Piste »: the athletics track at golden hour, from the design variant of v4
// (design/v4-piste). A track red, a deep ink, a warm cream. Its motifs: the bend
// of a running track in the corner of the band, the wordmark with its skewed
// block, lane lines between the blocks, the finish-line checker of an empty
// list. Crête's stand in for the mark before a title.

export const skin: Skin = {
  id: "piste",
  label: { fr: "Piste", en: "Track" },
  modes: ["light"],
  // The ink of its band and the red of its track.
  swatches: ["#1b1f2a", "#d2452b"],
  fontSample:
    '"Barlow Condensed", "Arial Narrow", "Inter Variable", ui-sans-serif, system-ui, sans-serif',
  // The top of its header: the ink.
  themeColor: "#1b1f2a",
};
