import { Link, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useSession } from "../features/auth/session";
import { useI18n } from "../i18n/I18nProvider";
import { BrandMark, DawnSky } from "./Brand";
import { OfflineBanner } from "./OfflineBanner";
import { TabBar } from "./TabBar";

/**
 * The frame of every signed-in page: the offline banner, the sky of the header
 * with the name of the app, the tabs, the page itself on a sheet that rises
 * over the sky, and the floating button that creates an event. It owns the
 * page's `<main>`, so the pages inside must not render another one.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { isAdmin } = useSession();
  const onEvent = useLocation({
    select: ({ pathname }) => /^\/evenements\/(?!nouveau)[^/]+\/?$/.test(pathname),
  });

  return (
    <div className="min-h-dvh">
      <OfflineBanner />
      <header className="on-dawn relative overflow-hidden bg-dawn-sky text-white">
        {/* The page of an event has its own sun, in its hero. */}
        <DawnSky sun={!onEvent} />
        <div className="relative mx-auto flex max-w-5xl items-center px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-12 md:h-28 md:pt-0 md:pb-6">
          <BrandMark />
        </div>
      </header>
      <TabBar isAdmin={isAdmin} />
      {/* The sheet of the page, over the sky. On a phone, room under the content for the tab bar and the floating button. */}
      <div className="relative z-10 -mt-7 rounded-t-[1.75rem] bg-neutral-50 md:mt-0 md:rounded-t-[2rem]">
        <main className="mx-auto max-w-3xl px-4 pt-6 pb-44 md:px-5 md:pt-8 md:pb-12 lg:max-w-4xl">
          {children}
        </main>
      </div>
      <Link
        to="/evenements/nouveau"
        aria-label={t.nav.createEvent}
        className="press group fixed right-4 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+5rem)] z-30 flex size-14 items-center justify-center rounded-full bg-dawn-deep text-white shadow-glow ring-4 ring-white/70 hover:brightness-110 md:right-6 md:bottom-6"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-6 transition-transform duration-300 group-hover:rotate-90"
        >
          <path
            d="M12 5v14M5 12h14"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </Link>
    </div>
  );
}
