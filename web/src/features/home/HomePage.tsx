import { useRef } from "react";

import { SECONDARY } from "../../components/buttons";
import { RidgeDivider } from "../../components/RidgeDivider";
import { useI18n } from "../../i18n/I18nProvider";
import { useToday } from "../../lib/useToday";
import { useSession } from "../auth/session";
import { LatestComments } from "../comments/LatestComments";
import { useEvents } from "../events/api";
import { ResultsToEnter } from "../results/ResultsToEnterBlock";
import { GroupSoon } from "./GroupSoon";
import { MyUpcoming } from "./MyUpcoming";
import { PasskeyBanner } from "./PasskeyBanner";
import { PendingConfirmations } from "./PendingConfirmations";
import { RegistrationTodoBlock } from "./RegistrationTodoBlock";

/**
 * The home page: the invitation to add a passkey, what the user has to
 * confirm, the results they have to enter, the registrations they have to
 * make, their next races, what the group is up to, and what has been said
 * lately. The app shell around it owns the page's `<main>`.
 *
 * The events that are to come are asked for once, for the three blocks that are
 * made of them; the last comments, the participations to confirm and the
 * results to enter ask for themselves. The title of the page can
 * take the focus (it is not in the tab order): it is where the focus goes when
 * a block that had it goes away.
 */
export function HomePage() {
  const { t } = useI18n();
  const today = useToday();
  const { runner } = useSession();
  const events = useEvents({ period: "a-venir", today });
  const title = useRef<HTMLHeadingElement>(null);

  return (
    <div className="flex flex-col gap-6">
      <h1 ref={title} tabIndex={-1} className="page-title">
        {t.nav.home}
      </h1>
      <PasskeyBanner pageHeading={title} />
      <PendingConfirmations pageHeading={title} />
      {/* The races that are over are not among the events to come: the block asks for its own rows. */}
      <ResultsToEnter pageHeading={title} />
      {/* A refresh that fails keeps what the blocks already show. */}
      {events.data ? (
        <>
          <RegistrationTodoBlock views={events.data} runnerId={runner?.id} pageHeading={title} />
          <MyUpcoming views={events.data} runnerId={runner?.id} />
          <RidgeDivider />
          <GroupSoon views={events.data} />
        </>
      ) : events.isError ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm font-medium text-red-700">
            {t.errors.generic}
          </p>
          <button
            type="button"
            onClick={() => void events.refetch()}
            disabled={events.isFetching}
            className={`${SECONDARY} self-start disabled:opacity-60`}
          >
            {t.common.retry}
          </button>
        </div>
      ) : (
        <output>{t.common.loading}</output>
      )}
      {/* They are asked for with the events, not after them, and do not wait for them. */}
      <LatestComments />
    </div>
  );
}
