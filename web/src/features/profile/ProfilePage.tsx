import { Link } from "@tanstack/react-router";
import { useRef } from "react";

import { SECONDARY } from "../../components/buttons";
import { LoadFailure } from "../../components/LoadFailure";
import { useI18n } from "../../i18n/I18nProvider";
import { useSession } from "../auth/session";
import { RunnerProfile } from "../runners/RunnerProfile";
import { UpcomingRaces } from "./UpcomingRaces";

const LINK = `${SECONDARY} inline-flex items-center self-start`;

/**
 * The profile of the signed-in user: their runner, as the others see it on
 * `/coureurs/<id>` (see `RunnerProfile`), with, under the name, the link to the
 * settings (`SettingsPage`: everything about the account), the races they are
 * down for, and the link to the statistics of the group. The app shell around
 * it owns the page's `<main>`.
 *
 * While the runner of the session is not there, the page has its own title, which
 * takes the focus when a failure to find it is asked for again (see `LoadFailure`).
 */
export function ProfilePage() {
  const { t } = useI18n();
  const { runner, runnerMissing, runnerFailed, refetchRunner, signedIn } = useSession();
  const heading = useRef<HTMLHeadingElement>(null);

  // The pages behind the sign-in are only shown to somebody signed in: this
  // is the instant between a sign-out and the move to the login page.
  if (!signedIn) return null;

  // No runner to show: the one of the account is on its way, could not be
  // found, or there is none (the super-admin of PocketBase). The settings are
  // there all the same.
  if (runner === null) {
    return (
      <div className="flex flex-col gap-8">
        <h1 ref={heading} tabIndex={-1} className="page-title">
          {t.nav.profile}
        </h1>
        <Link to="/profil/reglages" className={LINK}>
          {t.profile.settings}
        </Link>
        {runnerMissing ? (
          <p className="text-sm text-neutral-600">{t.profile.noRunner}</p>
        ) : runnerFailed ? (
          <LoadFailure onRetry={refetchRunner} heading={heading} />
        ) : (
          <output>{t.common.loading}</output>
        )}
      </div>
    );
  }

  return (
    <RunnerProfile
      runnerId={runner.id}
      extra={
        <>
          <Link to="/profil/reglages" className={LINK}>
            {t.profile.settings}
          </Link>
          <UpcomingRaces runnerId={runner.id} />
          <Link to="/stats" className={LINK}>
            {t.stats.link}
          </Link>
        </>
      }
    />
  );
}
