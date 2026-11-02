import type { Skin } from "../types";

// « Aurore »: a run at dawn. A violet sky that warms into coral pink and peach
// at the horizon, the sun rising on it with its arcs of light, white cards on a
// light lilac, a deep plum ink, Plus Jakarta Sans for the titles. Its small sun
// before the title of a block is Crête's, which took it from it; the variant had
// no divider, and Crête's stands in. By day only.

export const skin: Skin = {
  id: "aurore",
  label: { fr: "Aurore", en: "Dawn" },
  modes: ["light"],
  // The violet of its sky and the peach of its horizon.
  swatches: ["#5e4ae3", "#ffb38a"],
  fontSample:
    '"Plus Jakarta Sans Variable", "Inter Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  // The top of its header: the violet of the sky.
  themeColor: "#5e4ae3",
};
