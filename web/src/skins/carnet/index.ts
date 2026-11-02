import type { Skin } from "../types";

// « Carnet »: a training logbook drawn like a technical sheet: a warm paper,
// ink, a coral for what is done and an indigo, gold and teal for what is
// counted, in hairlines and dots (a bib, dotted France, the isometric arch of a
// start line, a fine grid of dots that fades out and in). By day only (the
// variant has no dark mode).

export const skin: Skin = {
  id: "carnet",
  label: { fr: "Carnet", en: "Logbook" },
  modes: ["light"],
  // The navy of its dark card and the coral of its main action.
  swatches: ["#161b2e", "#c24a3a"],
  fontSample:
    '"Geist Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  // The top of its header: the navy of its dark card.
  themeColor: "#161b2e",
};
