import { useEffect, useRef } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import { usePageTitle } from "../../lib/usePageTitle";
import { useToday } from "../../lib/useToday";
import { useEvents, useRunners } from "../events/api";
import { UpcomingSection } from "../home/MyUpcoming";
import { RunnerProfile } from "./RunnerProfile";

/**
 * The page of a runner, at `/coureurs/<id>`: their profile (`RunnerProfile`),
 * with what they are down for in the events to come under their name. The
 * runners come from the list the filters use, which everybody may read; this is
 * the page that says there is no such runner. The app shell around it owns the
 * page's `<main>`.
 */
export function RunnerPage({ id }: { id: string }) {
  const { t } = useI18n();
  const runners = useRunners();
  const runner = runners.data?.find((candidate) => candidate.id === id);
  usePageTitle(runner?.name ?? t.titles.runner);

  // The list is kept for a few minutes (see `useRunners`): a runner who joined
  // since is not in the copy that was kept, and every name on the site is a link
  // to their page. Ask again once before saying there is no such runner, unless
  // the copy was fetched for this page, which makes it as fresh as it gets.
  const outdated = runners.data !== undefined && !runner && !runners.isFetchedAfterMount;
  const asked = useRef<string | null>(null);
  const refetch = runners.refetch;
  const fetching = runners.isFetching;
  useEffect(() => {
    // A copy that is too old is asked for as the page opens: that one is the request.
    if (!outdated || fetching || asked.current === id) return;
    asked.current = id;
    void refetch();
  }, [outdated, fetching, id, refetch]);

  // The list is there and the runner is not in it: gone, or never was.
  if (runners.data && !runner && !outdated && !runners.isError) {
    return (
      <p role="alert" className="text-sm font-medium text-red-700">
        {t.errors.not_found}
      </p>
    );
  }

  return <RunnerProfile runnerId={id} extra={runner && <RunnerUpcoming runnerId={id} />} />;
}

/** What the runner is down for in the events to come: the one thing that their page adds to their profile. */
function RunnerUpcoming({ runnerId }: { runnerId: string }) {
  const { t } = useI18n();
  const today = useToday();
  // The same request as the home page's: the events that are to come, shared.
  const events = useEvents({ period: "a-venir", today });

  // Not worth a message when it fails: the races to come are on the pages of their events all the same.
  if (!events.data) return null;
  return <UpcomingSection views={events.data} runnerId={runnerId} title={t.runner.upcoming} />;
}
