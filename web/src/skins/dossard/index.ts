import type { Skin } from "../types";

// « Dossard »: the morning of a race, from the design variant of v4
// (design/v4-dossard). A sand page, navy ink, white cards; coral, sun and sky.
// Its motifs: the garland of pennants, the little bib of the mark, the safety
// pins and punched holes of a bib, a tear-off line, confetti in an empty list.
// Crête's stand in for the mark before a title.

export const skin: Skin = {
  id: "dossard",
  label: { fr: "Dossard", en: "Bib" },
  modes: ["light"],
  // The navy of its ink and the coral of its registrations.
  swatches: ["#14213d", "#ff5a5f"],
  fontSample: '"Archivo Variable", "Arial Black", ui-sans-serif, system-ui, sans-serif',
  // The top of its header: the navy ink.
  themeColor: "#14213d",
};
