import { pb } from "../../lib/pb";

/** How far from the date of an event another one may be to be taken for its duplicate. */
const WINDOW_DAYS = 30;
const MIN_LETTERS = 4;

/**
 * The words of a name that are worth looking for: four letters or more, in
 * lowercase, each once. Figures do not count, and an apostrophe or a hyphen
 * separates two words.
 */
export function significantWords(name: string): string[] {
  const words =
    name
      .normalize("NFC")
      .toLowerCase()
      .match(/\p{L}+/gu) ?? [];
  return [...new Set(words.filter((word) => word.length >= MIN_LETTERS))];
}

/**
 * The filter that finds the events that may be the one being typed: those
 * that start within 30 days of `date` and whose name has one of the
 * significant words of `name`. `excludeId` is the event being edited, which
 * is no duplicate of itself. `null` when the name has no word to look for.
 *
 * The words and the dates are bound as parameters, never written into the
 * filter. A word is made of letters only, so it has no wildcard.
 */
export function duplicateFilter(
  name: string,
  date: Temporal.PlainDate,
  excludeId?: string,
): string | null {
  const words = significantWords(name);
  if (words.length === 0) return null;

  const params: Record<string, string> = {
    from: date.subtract({ days: WINDOW_DAYS }).toString(),
    to: date.add({ days: WINDOW_DAYS }).toString(),
  };
  const names = words.map((word, i) => {
    params[`w${i}`] = word;
    return `name ~ {:w${i}}`;
  });
  let filter = `(${names.join(" || ")}) && start_date >= {:from} && start_date <= {:to}`;
  if (excludeId !== undefined) {
    filter += " && id != {:exclude}";
    params.exclude = excludeId;
  }
  return pb.filter(filter, params);
}
