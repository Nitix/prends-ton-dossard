// The classes of the buttons, at least 44 px tall (a tap target).

/** The main action of a screen or a dialog. */
export const PRIMARY =
  "min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white disabled:opacity-60";

/** An action next to the main one: cancel, and the actions of a bar. */
export const SECONDARY = "min-h-11 rounded-lg border border-neutral-300 bg-white px-4 font-medium";

/** The action that deletes something, in a dialog that asks first. */
export const DANGER =
  "min-h-11 rounded-lg bg-red-700 px-4 font-medium text-white disabled:opacity-60";

/** The colour of the text of an action that deletes something: it goes with a button style above. */
export const DANGER_TEXT = "text-red-700";
