import { Link } from "@tanstack/react-router";

import { useI18n } from "../../i18n/I18nProvider";
import type { EventView, FormatView } from "./api";
import { formatMeasures } from "./formatName";
import { ParticipantChips } from "./ParticipantChips";

const SEPARATOR = " · ";

/**
 * An event in a list: its day or days, its name (the link to its page, a bar
 * as wide as the card and tall enough to tap), its place, and each of its
 * formats with its measures and its participants.
 */
export function EventCard({ view }: { view: EventView }) {
  const { t, f } = useI18n();
  const { event, formats, start, end } = view;
  const severalDays = !start.equals(end);

  return (
    <article className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-3">
      <p className="text-sm text-neutral-600">
        {severalDays ? t.event.dateRange(f.date(start), f.date(end)) : f.date(start)}
      </p>
      <h3 className="text-base font-semibold">
        <Link
          to="/evenements/$id"
          params={{ id: event.id }}
          className="flex min-h-11 items-center underline-offset-2 hover:underline"
        >
          {event.name}
        </Link>
      </h3>
      <p className="text-sm text-neutral-600">{event.location}</p>
      {formats.length > 0 && (
        <ul className="mt-1 flex flex-col gap-2">
          {formats.map((formatView) => (
            <li key={formatView.format.id} className="flex flex-col gap-1">
              <FormatLine formatView={formatView} showDate={severalDays} />
              <ParticipantChips participations={formatView.participations} />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function FormatLine({ formatView, showDate }: { formatView: FormatView; showDate: boolean }) {
  const { t, f } = useI18n();
  const { format, raceType, date } = formatView;

  return (
    <>
      {/* On an event of several days, the day of each format is worth knowing. */}
      {showDate && <p className="text-xs text-neutral-600">{f.date(date)}</p>}
      <p className="text-sm">{formatMeasures(format, raceType.label, f, t).join(SEPARATOR)}</p>
    </>
  );
}
