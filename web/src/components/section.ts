// The box of a section of the page of an event: the interested, a format, the
// supporters, those who do not start, the comments...

export const SECTION = "event-section card p-4";

/** A row of a list in a card: a person, a race. A dashed border says « not confirmed » with the words. */
export const ROW = "rounded-2xl border border-neutral-200 bg-card";

/** What is not confirmed yet: a dashed edge on the white of a card (the words say it too). */
export const UNCONFIRMED = "border-2 border-dashed border-neutral-500 bg-card";

/** A row, not confirmed yet. */
export const UNCONFIRMED_ROW = `rounded-2xl ${UNCONFIRMED}`;

/** A soft panel inside a card. */
export const INNER = "rounded-2xl bg-neutral-50";
