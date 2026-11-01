/**
 * The gaps that the spaces of a text leave on the screen, each in ems of the
 * size of its letters: from the right edge of the character before a space to
 * the left edge of the character after it, as they are drawn. A figure such as
 * « 10 040 m » must keep a gap that the eye sees between its groups of digits
 * and before its unit (French writes them with a narrow space, which a display
 * font may draw 1 px wide).
 */
export function spaceGaps(element: Element): { text: string; em: number }[] {
  const characters: { node: Text; at: number; char: string }[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue;
    const text = node.data;
    for (let at = 0; at < text.length; at++) characters.push({ node, at, char: text.charAt(at) });
  }
  const box = (index: number) => {
    const character = characters[index];
    if (character === undefined) throw new Error(`no character at ${index}`);
    const range = document.createRange();
    range.setStart(character.node, character.at);
    range.setEnd(character.node, character.at + 1);
    return range.getBoundingClientRect();
  };
  const all = characters.map(({ char }) => char).join("");
  const size = Number.parseFloat(getComputedStyle(element).fontSize);
  return characters.flatMap(({ char }, i) => {
    if (!/\s/u.test(char) || i === 0 || i === characters.length - 1) return [];
    return [{ text: all, em: (box(i + 1).left - box(i - 1).right) / size }];
  });
}
