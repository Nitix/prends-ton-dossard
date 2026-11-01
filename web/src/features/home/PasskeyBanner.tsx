import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState, type RefObject } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { useI18n } from "../../i18n/I18nProvider";
import { pb } from "../../lib/pb";
import { passkeysSupported } from "../auth/passkeys";
import { useSession } from "../auth/session";

/** Where the choice to hide the banner is kept, in this browser. */
const DISMISSED_KEY = "courses.passkeyBanner.dismissed";

/** Whether to know a passkey exists is worth asking again: a key added elsewhere is not urgent news. */
const PASSKEY_STALE_MS = 5 * 60_000;

// The storage may be unavailable or refuse (a private window, blocked site
// data): neither is a reason to break the page. Not being able to read means
// the banner was not hidden, not being able to write means it is hidden for
// this visit only.
function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) !== null;
  } catch {
    return false;
  }
}

function rememberDismissal(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Hidden for this visit, not for the next.
  }
}

/**
 * The invitation to add a passkey, until the user has one or hides it. It
 * only sends to the settings, where passkeys are made: it never calls WebAuthn
 * itself (a prompt out of nowhere on the home page would be a surprise).
 *
 * Nothing is shown, and nothing asked of the server, in a browser that has no
 * passkeys, once the banner is hidden, and while it is not known whether the
 * user has one (or when finding out failed: the banner is a nicety).
 *
 * Hiding it takes it away together with the button that was pressed, so the
 * focus goes to the title of the page, which the page passes as `pageHeading`.
 */
export function PasskeyBanner({
  pageHeading,
}: {
  pageHeading: RefObject<HTMLHeadingElement | null>;
}) {
  const { t } = useI18n();
  const { user } = useSession();
  const userId = user?.id ?? "";
  const headingId = useId();
  const [dismissed, setDismissed] = useState(wasDismissed);
  const enabled = passkeysSupported() && !dismissed && userId !== "";

  const hasPasskey = useQuery({
    // Under the key of the list of the settings, which refreshes it when a key
    // is added or deleted.
    queryKey: ["passkeys", userId, "any"],
    queryFn: async () => {
      // Only the keys of the user: an admin may read everybody's.
      const { items } = await pb.collection("passkeys").getList(1, 1, {
        filter: pb.filter("user = {:me}", { me: userId }),
        fields: "id",
        skipTotal: true,
      });
      return items.length > 0;
    },
    enabled,
    staleTime: PASSKEY_STALE_MS,
  });

  if (!enabled || hasPasskey.data !== false) return null;

  const dismiss = () => {
    rememberDismissal();
    setDismissed(true);
    pageHeading.current?.focus();
  };

  return (
    <section
      aria-labelledby={headingId}
      className="relative flex flex-col gap-2 overflow-hidden rounded-[1.25rem] bg-iris-50 p-4 ring-1 ring-iris-100"
    >
      {/* A glow of sunrise in the corner. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-12 -right-10 size-36 rounded-full bg-blush-200/60 blur-2xl"
      />
      <h2 id={headingId} className="card-title relative">
        {t.home.passkeyTitle}
      </h2>
      <p className="relative text-sm text-neutral-700">{t.passkeys.intro}</p>
      <div className="relative mt-1 flex flex-wrap gap-2">
        <Link to="/profil/reglages" className={`${PRIMARY} inline-flex items-center`}>
          {t.home.passkeyLink}
        </Link>
        <button type="button" onClick={dismiss} className={SECONDARY}>
          {t.home.passkeyDismiss}
        </button>
      </div>
    </section>
  );
}
