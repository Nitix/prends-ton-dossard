import { useRef } from "react";

import { SECONDARY } from "../../components/buttons";
import { useI18n } from "../../i18n/I18nProvider";
import { useToday } from "../../lib/useToday";
import { useSession } from "../auth/session";
import { useEvents } from "../events/api";
import { GroupSoon } from "./GroupSoon";
import { MyUpcoming } from "./MyUpcoming";
import { PasskeyBanner } from "./PasskeyBanner";
import { PendingConfirmations } from "./PendingConfirmations";

/**
 * The home page: the invitation to add a passkey, what the user has to
 * confirm, their next races, and what the group is up to. The app shell around
 * it owns the page's `<main>`.
 *
 * The events that are to come are asked for once, for the two blocks that are
 * made of them. The title of the page can take the focus (it is not in the tab
 * order): it is where the focus goes when a block that had it goes away.
 */
export function HomePage() {
  const { t } = useI18n();
  const today = useToday();
  const { runner } = useSession();
  const events = useEvents({ period: "a-venir", today });
  const title = useRef<HTMLHeadingElement>(null);

  return (
    <div className="flex flex-col gap-6">
      <h1 ref={title} tabIndex={-1} className="text-2xl font-semibold">
        {t.nav.home}
      </h1>
      <PasskeyBanner pageHeading={title} />
      <PendingConfirmations pageHeading={title} />
      {/* A refresh that fails keeps what the blocks already show. */}
      {events.data ? (
        <>
          <MyUpcoming views={events.data} runnerId={runner?.id} />
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
    </div>
  );
}
