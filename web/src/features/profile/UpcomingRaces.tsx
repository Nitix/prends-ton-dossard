import { useRef } from "react";

import { LoadFailure } from "../../components/LoadFailure";
import { useI18n } from "../../i18n/I18nProvider";
import { useToday } from "../../lib/useToday";
import { useEvents } from "../events/api";
import { UpcomingRow, upcomingOf } from "../home/MyUpcoming";
import { Section } from "./Section";

/**
 * « Mes prochaines courses »: what a runner is down for in the events that are
 * to come, from the nearest to the farthest, each with its day, its status and
 * a link to its event; or that there is nothing planned. The list is the home
 * page's (`upcomingOf`, and its row, with the long date and no countdown), and
 * so are the events, shared with it.
 *
 * If they do not load, it says so and offers to ask again, rather than say
 * there is nothing planned: the title takes the focus when it is asked again
 * (see `LoadFailure`).
 */
export function UpcomingRaces({ runnerId }: { runnerId: string }) {
  const { t } = useI18n();
  const today = useToday();
  const events = useEvents({ period: "a-venir", today });
  const heading = useRef<HTMLHeadingElement>(null);
  const races = events.data && upcomingOf(events.data, runnerId, today);

  return (
    <Section title={t.profile.upcoming} headingRef={heading} boxed={false}>
      {/* A refresh that fails keeps what the page already shows. */}
      {races === undefined ? (
        events.isError ? (
          <LoadFailure onRetry={events.refetch} heading={heading} />
        ) : (
          <output>{t.common.loading}</output>
        )
      ) : races.length === 0 ? (
        <p className="text-sm text-neutral-600">{t.profile.noUpcoming}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {races.map((race) => (
            <UpcomingRow key={race.participation.id} row={race} today={today} dateStyle="long" />
          ))}
        </ul>
      )}
    </Section>
  );
}
