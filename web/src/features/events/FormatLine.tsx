import { useI18n } from "../../i18n/I18nProvider";
import type { FormatView } from "./api";
import { formatMeasures } from "./formatName";

const SEPARATOR = " · ";

/**
 * A format on an event card: its first measure in bold, then the others, and
 * its day above them on an event of several days. Crête's card and a skin's
 * variant of it draw a format alike.
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
  const [first, ...rest] = formatMeasures(format, raceType.label, f, t);

  return (
    <>
      {/* On an event of several days, the day of each format is worth knowing. */}
      {showDate && <p className="eyebrow">{f.date(date)}</p>}
      <p className="text-sm text-neutral-700">
        <span className="font-semibold text-ink">{first}</span>
        {rest.length > 0 && `${SEPARATOR}${rest.join(SEPARATOR)}`}
      </p>
    </>
  );
}
