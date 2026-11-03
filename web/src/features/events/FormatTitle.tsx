const SEPARATOR = " · ";

/**
 * The words of the title of a format's section, on the page of an event: its
 * name in ink, then its measures after it in grey, one text read as one line
 * (« Trail 42 km · 2 400 m D+ · max 10 h »). The page puts them in the title
 * of the section (`BlockTitle`, which gives the focus and the mark). `parts`
 * are its words as `formatMeasures` gives them: its name, then its measures.
 */
export function FormatTitle({ parts }: { parts: readonly string[] }) {
  const [first, ...rest] = parts;
  return (
    <span className="format-title min-w-0">
      {first}
      {rest.length > 0 && (
        <span className="format-measures font-semibold text-neutral-600">{`${SEPARATOR}${rest.join(SEPARATOR)}`}</span>
      )}
    </span>
  );
}
