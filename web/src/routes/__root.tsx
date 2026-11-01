import { Outlet, createRootRoute, useLocation } from "@tanstack/react-router";

import { AppShell } from "../components/AppShell";
import { BrandMark, DawnSky } from "../components/Brand";
import { SunArc } from "../components/Dawn";
import { OfflineBanner } from "../components/OfflineBanner";
import { Provisional } from "../components/Provisional";
import { isPublicPath, requireSession } from "../features/auth/session";

export const Route = createRootRoute({
  // Without a session, every page but the public ones sends to the login
  // page, which brings the user back here once signed in.
  beforeLoad: ({ location }) => requireSession(location),
  component: Root,
  // Only a few pages exist, so every other path shows the provisional one
  // too: that lets the server's fallback to index.html be seen.
  notFoundComponent: Provisional,
});

function Root() {
  const pathname = useLocation({ select: (location) => location.pathname });

  // The login and invitation pages have no tabs: nobody is signed in yet. The
  // name of the app is on the sky, the page on a frosted card that rises over it.
  if (isPublicPath(pathname)) {
    return (
      <div className="relative flex min-h-dvh flex-col overflow-hidden bg-dawn-sky">
        <DawnSky sun={false} />
        <OfflineBanner />
        <div className="on-dawn relative pt-[max(3rem,env(safe-area-inset-top))] pb-36 text-white md:pt-20 md:pb-44">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-8 left-1/2 w-[min(34rem,140%)] -translate-x-1/2 animate-rise"
          >
            <SunArc className="block w-full" />
          </span>
          <div className="relative mx-auto flex max-w-md justify-center px-4">
            <BrandMark size="lg" />
          </div>
        </div>
        <main className="relative z-10 mx-4 -mt-24 mb-10 rounded-[1.75rem] border border-white/70 glass p-6 shadow-[0_30px_80px_-24px_rgb(42_32_112/0.6)] sm:mx-auto sm:w-full sm:max-w-md md:-mt-28 md:p-8">
          <Outlet />
        </main>
      </div>
    );
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
