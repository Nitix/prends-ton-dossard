import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useSession } from "../features/auth/session";
import { useI18n } from "../i18n/I18nProvider";
import { OfflineBanner } from "./OfflineBanner";
import { TabBar } from "./TabBar";

/**
 * The frame of every signed-in page: the offline banner, the tabs, the page
 * itself, and the floating button that creates an event. It owns the page's
 * `<main>`, so the pages inside must not render another one.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { isAdmin } = useSession();

  return (
    <div className="min-h-dvh">
      <OfflineBanner />
      <TabBar isAdmin={isAdmin} />
      {/* On a phone, room under the content for the tab bar and the floating button. */}
      <main className="mx-auto max-w-3xl px-4 pt-4 pb-40 md:pb-8">{children}</main>
      <Link
        to="/evenements/nouveau"
        aria-label={t.nav.createEvent}
        className="fixed right-4 bottom-20 z-30 flex size-14 items-center justify-center rounded-full bg-neutral-900 text-3xl leading-none text-white shadow-lg hover:bg-neutral-700 md:bottom-6"
      >
        <span aria-hidden="true">+</span>
      </Link>
    </div>
  );
}
