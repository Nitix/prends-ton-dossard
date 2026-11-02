import { Fragment, type ReactNode } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import type { FormatView } from "./api";
import { formatMeasures } from "./formatName";

const SEPARATOR = " · ";

/**
 * How a skin marks the parts of a format (see `FormatLine`, `FormatParts`):
 * each is optional, and what it leaves is drawn as Crête draws it.
 */
export type FormatMarks = {
  /**
   * A picture before the parts (the square of its kind, the bar of its zone):
   * decoration, hidden from screen readers by whoever draws it. The parts are
   * then in one box after it (`.format-parts`), so that a line of flex items
   * keeps them together.
   */
  before?: ReactNode;
  /** The name of the format, its first part. Crête's: in bold, in ink. */
  name?: (name: string) => ReactNode;
  /**
   * Each measure after the name (« 15 km », « 700 m D+ », « 30 € »), with its
   * place among them. Given, each is drawn by it (a tag, a chip), and the
   * separators « · » stay in the text for a screen reader and for a copy,
   * hidden from the eye. Crête's: the measures as text, after their separators.
   */
  measure?: (measure: string, index: number) => ReactNode;
};

/**
 * The parts of a format, as `formatMeasures` gives them (its name, then its
 * measures), drawn as `marks` says: the line of a card (`FormatLine`), or the
 * words of a variant's own title of a format. The words and their order are
 * those of Crête's line, whatever the marks.
 */
export function FormatParts({
  parts,
  marks = {},
}: {
  parts: readonly string[];
  marks?: FormatMarks;
}) {
  const [name = "", ...measures] = parts;
  const drawn = (
    <>
      {marks.name ? (
        marks.name(name)
      ) : (
        <span className="format-name font-semibold text-ink">{name}</span>
      )}
      {marks.measure
        ? measures.map((measure, index) => (
            // The parts of a format may repeat: the place is part of the key.
            // oxlint-disable-next-line react/no-array-index-key
            <Fragment key={`${index}:${measure}`}>
              <span className="sr-only">{SEPARATOR}</span>
              {marks.measure?.(measure, index)}
            </Fragment>
          ))
        : measures.length > 0 && `${SEPARATOR}${measures.join(SEPARATOR)}`}
    </>
  );
  if (marks.before === undefined) return drawn;
  return (
    <>
      {marks.before}
      <span className="format-parts">{drawn}</span>
    </>
  );
}

/**
 * A format on an event card: its first measure in bold, then the others, and
 * its day above them on an event of several days. Crête's card and a skin's
 * variant of it draw a format alike; a variant marks its parts its own way
 * (`marks`: a picture before them, its name, each measure as a tag), and gives
 * the classes of the line (`className`, Crête's by default). The line keeps its
 * semantic class, `.format-line`, and its day `.format-date`.
 */
export function FormatLine({
  formatView,
  showDate,
  marks,
  className = "text-sm text-neutral-700",
}: {
  formatView: FormatView;
  showDate: boolean;
  marks?: FormatMarks;
  className?: string;
}) {
  const { t, f } = useI18n();
  const { format, raceType, date } = formatView;
  const parts = formatMeasures(format, raceType.label, f, t);

  return (
    <>
      {/* On an event of several days, the day of each format is worth knowing. */}
      {showDate && <p className="format-date eyebrow">{f.date(date)}</p>}
      <p className={`format-line ${className}`}>
        <FormatParts parts={parts} marks={marks} />
      </p>
    </>
  );
}
