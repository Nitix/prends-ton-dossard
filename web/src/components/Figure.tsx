/**
 * A space of a figure: the tight tracking of the figure is taken off it, and it
 * gets a little room on each side (in ems of its letters).
 */
const SPACE = "tracking-normal px-[0.065em]";

/**
 * A figure in big letters: a number of a track, a total. French writes the
 * groups of thousands and the unit apart with a narrow no-break space (U+202F,
 * as Intl gives it), which the display font draws about 1 px wide at this size,
 * less with a tight tracking: « 10 040 m » would read « 10040m ». Each space of
 * the figure is widened, so that the eye sees a gap of a fifth of the size of
 * the letters or more (about 0.22 em: src/test/gaps.ts measures it). The text
 * itself is the same, for a screen reader, a copy or a search, and a no-break
 * space still keeps the figure on one line: the room is padding on an inline
 * box, which adds no place to break.
 */
export function Figure({ children, className }: { children: string; className?: string }) {
  // With a capturing group, the spaces are the odd parts.
  const parts = children.split(/(\s)/u);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          // The parts of one text, always in the same order: their place is their key.
          <span key={i} className={SPACE}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </span>
  );
}
