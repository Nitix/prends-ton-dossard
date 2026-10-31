import { useId } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import { sortEvents, type EventView } from "../events/api";
import { EventCard } from "../events/EventCard";

/** How many events the block shows. */
const COUNT = 5;

/** The next events that somebody is down for, whoever they are, the nearest first. */
function soonOf(views: EventView[]): EventView[] {
  const withRunners = views.filter(({ formats }) =>
    formats.some(({ participations }) => participations.length > 0),
  );
  return sortEvents(withRunners, "asc").slice(0, COUNT);
}

/**
 * « Bientôt dans le groupe »: the next 5 events that have at least one
 * participation, as the cards of the list, with their chips.
 */
export function GroupSoon({ views }: { views: EventView[] }) {
  const { t } = useI18n();
  const headingId = useId();
  const soon = soonOf(views);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {t.home.groupTitle}
      </h2>
      {soon.length === 0 ? (
        <p className="text-sm text-neutral-600">{t.home.groupEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {soon.map((view) => (
            <li key={view.event.id}>
              <EventCard view={view} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
