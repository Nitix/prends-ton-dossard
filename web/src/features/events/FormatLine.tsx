import { useI18n } from "../../i18n/I18nProvider";
import type { FormatView } from "./api";
import { formatMeasures } from "./formatName";

const SEPARATOR = " · ";

/**
 * The parts of a format, as `formatMeasures` gives them: its name in bold, in
 * ink, then its measures after their separators, in the text.
 */
function FormatParts({ parts }: { parts: readonly string[] }) {
  const [name = "", ...measures] = parts;
  return (
    <>
      <span className="format-name font-semibold text-ink">{name}</span>
      {measures.length > 0 && `${SEPARATOR}${measures.join(SEPARATOR)}`}
    </>
  );
}

/**
 * A format on an event card: its first measure in bold, then the others, and
 * its day above them on an event of several days. The line has its semantic
 * class, `.format-line`, and its day `.format-date`.
 */
export function FormatLine({
  formatView,
  showDate,
}: {
  formatView: FormatView;
  showDate: boolean;
}) {
  const { t, f } = useI18n();
  const { format, raceType, date } = formatView;
  const parts = formatMeasures(format, raceType.label, f, t);

  return (
    <>
      {/* On an event of several days, the day of each format is worth knowing. */}
      {showDate && <p className="format-date eyebrow">{f.date(date)}</p>}
      <p className="format-line text-sm text-neutral-700">
        <FormatParts parts={parts} />
      </p>
    </>
  );
}
