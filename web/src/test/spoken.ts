/**
 * The text of an element as a screen reader has it: without what is hidden
 * from it (`aria-hidden="true"`), such as the title of its column that a tile
 * of a table of totals repeats on a phone. What is only for a screen reader
 * (`sr-only`) stays.
 */
export function spokenText(element: Element): string {
  const copy = element.cloneNode(true);
  if (!(copy instanceof Element)) return "";
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return copy.textContent ?? "";
}
