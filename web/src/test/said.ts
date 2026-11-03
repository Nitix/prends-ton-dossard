// What a piece says to a screen reader, for the tests that check it: the line
// of a format (features/events/FormatLine.test.tsx), the motifs of the skins,
// which say nothing but the name of the app (skins/components.test.tsx).

/** Text with its whitespace gathered: Intl's non-breaking spaces and the line breaks of the markup are one space. */
export const plain = (text: string | null | undefined) => (text ?? "").replace(/\s+/gu, " ").trim();

/** What a screen reader has of an element: what is hidden from it (`aria-hidden`) left out. */
function heard(element: Element): Element {
  const copy = element.cloneNode(true);
  if (!(copy instanceof Element)) throw new Error("not an element");
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return copy;
}

/** What a piece says to a screen reader. */
export type Said = {
  /** Each of its texts, in order (a text node each), whitespace gathered. */
  texts: string[];
  /** All its text as one line. */
  flat: string;
  /** Its links, as « words → address ». */
  links: string[];
  /** The names it gives (`aria-label`): its lists of runners, its regions. */
  names: string[];
  /** The words of its buttons. */
  buttons: string[];
};

/**
 * What a piece says to a screen reader: each of its texts, its links (their
 * words and their address), the names it gives, its buttons; never what is
 * hidden from it (`aria-hidden`: a big number that repeats a date, a ring).
 */
export function said(box: Element): Said {
  const copy = heard(box);
  const texts: string[] = [];
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = plain(node.textContent);
    if (text !== "") texts.push(text);
  }
  return {
    texts,
    flat: plain(copy.textContent),
    links: [...copy.querySelectorAll("a[href]")].map(
      (link) => `${plain(link.textContent)} → ${link.getAttribute("href")}`,
    ),
    names: [...copy.querySelectorAll("[aria-label]")].map(
      (named) => named.getAttribute("aria-label") ?? "",
    ),
    buttons: [...copy.querySelectorAll("button")].map((button) => plain(button.textContent)),
  };
}
