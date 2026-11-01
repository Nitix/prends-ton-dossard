/** How many characters the beginning of a comment keeps on the home page. */
const EXCERPT_LENGTH = 140;

const ELLIPSIS = "…";

/** Whether the code unit is the first half of a character that takes two (an emoji, for instance). */
function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

/**
 * The beginning of a text, for a list: every run of white space (a line break
 * too) becomes a single space, and a text longer than `max` is cut at the last
 * space that lets it fit, with « … » after it. What comes before the dots is
 * at most `max` characters. A word that is longer than `max` is cut in the
 * word, but never in the middle of a character.
 */
export function excerpt(text: string, max: number = EXCERPT_LENGTH): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;

  // One character more than the limit is looked at: a space right after it
  // means the last word fits.
  const lastSpace = flat.slice(0, max + 1).lastIndexOf(" ");
  let end = lastSpace > 0 ? lastSpace : max;
  if (lastSpace <= 0 && isHighSurrogate(flat.charCodeAt(end - 1))) end -= 1;
  return `${flat.slice(0, end)}${ELLIPSIS}`;
}
