import { useId } from "react";

import { BlockTitle } from "../../components/BlockTitle";
import { useI18n } from "../../i18n/I18nProvider";
import type { EventView } from "../events/api";
import { EventCard } from "../events/EventCard";

/**
 * Under the grid, on a phone: the events of the day that was touched, as the
 * list shows them, or a word on what to do when no day was. From `md` the
 * names are in the cells of the grid, and this is not there.
 */
export function DayList({
  day,
  views,
}: {
  day: Temporal.PlainDate | undefined;
  views: EventView[];
}) {
  const { t, f } = useI18n();
  const headingId = useId();

  if (!day) {
    return <p className="text-sm text-neutral-600 md:hidden">{t.agenda.selectDay}</p>;
  }
  return (
    <section aria-labelledby={headingId} className="day-list flex flex-col gap-3 md:hidden">
      <BlockTitle id={headingId}>{f.dateLong(day)}</BlockTitle>
      {views.length === 0 ? (
        <p>{t.agenda.dayEmpty}</p>
      ) : (
        <ul className="event-list flex flex-col gap-3">
          {views.map((view) => (
            <li key={view.event.id}>
              <EventCard view={view} list="agenda" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
