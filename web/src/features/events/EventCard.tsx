import { Link } from "@tanstack/react-router";

import { useI18n } from "../../i18n/I18nProvider";
import { useToday } from "../../lib/useToday";
import type { EventView, FormatView } from "./api";
import { formatMeasures } from "./formatName";
import { ParticipantChips } from "./ParticipantChips";
import { starters } from "./participants";
import { registrationLabel, registrationState } from "./registration";

const SEPARATOR = " · ";

/**
 * An event in a list: its day or days, its name (the link to its page, a bar
 * as wide as the card and tall enough to tap), its place, the runners who are
 * interested with no format chosen yet, and each of its formats with its
 * measures and its participants. Those who do not start are not on the card.
 * Under the place, the registration deadline, if the event has one, and
 * "Inscriptions closes" once it has passed.
 */
export function EventCard({ view }: { view: EventView }) {
  const { t, f } = useI18n();
  const { event, formats, start, end } = view;
  const severalDays = !start.equals(end);
  const interested = starters(view.interested);
  const registration = registrationState(event, useToday());

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
      {registration && (
        <p className="text-sm text-neutral-600">{registrationLabel(registration, f, t)}</p>
      )}
      {/* Before the formats, since there is something left to choose. The words say it, not the place. */}
      {interested.length > 0 && (
        <div className="mt-1 flex flex-col gap-1">
          <p className="text-sm">{t.event.formatToChoose}</p>
          <ParticipantChips participations={interested} label={t.event.interestedTitle} />
        </div>
      )}
      {formats.length > 0 && (
        <ul className="mt-1 flex flex-col gap-2">
          {formats.map((formatView) => (
            <li key={formatView.format.id} className="flex flex-col gap-1">
              <FormatLine formatView={formatView} showDate={severalDays} />
              <ParticipantChips participations={starters(formatView.participations)} />
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
