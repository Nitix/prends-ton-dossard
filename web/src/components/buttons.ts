// The classes of the buttons, at least 44 px tall (a tap target): round pills
// that sink a little when pressed.

/** The main action of a screen or a dialog: a pill of sunrise, white text (4.6:1 at least). */
export const PRIMARY =
  "press min-h-11 rounded-full bg-dawn-deep px-5 text-[0.9375rem] font-semibold text-white shadow-glow hover:brightness-110 disabled:opacity-60 disabled:shadow-none";

/** An action next to the main one: cancel, and the actions of a bar. */
export const SECONDARY =
  "press min-h-11 rounded-full border border-neutral-200 bg-card px-4 text-[0.9375rem] font-medium shadow-[0_1px_2px_rgb(36_27_53/0.05)] hover:border-iris-200 hover:bg-iris-50 disabled:opacity-60";

/** A white pill on the sky (a hero): the main action there. The sky keeps the colours of the day (see `.on-dawn`). */
export const ON_DAWN =
  "press min-h-11 rounded-full bg-white px-5 text-[0.9375rem] font-semibold text-iris-700 shadow-[0_8px_24px_-10px_rgb(36_27_53/0.5)] hover:bg-iris-50";

/**
 * The action that deletes something, in a dialog that asks first. Its text has
 * the colour of a card: white on a deep red by day, the night on a coral red at
 * night (6:1 at least either way).
 */
export const DANGER =
  "press min-h-11 rounded-full bg-red-700 px-5 text-[0.9375rem] font-semibold text-card hover:bg-red-800 disabled:opacity-60";

/** The colour of the text of an action that deletes something: it goes with a button style above. */
export const DANGER_TEXT = "text-red-700 hover:border-red-200! hover:bg-red-50!";
