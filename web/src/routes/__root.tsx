import { Outlet, createRootRoute, useLocation } from "@tanstack/react-router";

import { AppShell } from "../components/AppShell";
import { OfflineBanner } from "../components/OfflineBanner";
import { Provisional } from "../components/Provisional";
import { BrandMark, HeaderArt } from "../components/Slots";
import { isPublicPath, requireSession } from "../features/auth/session";
import { useFocusOnNavigation } from "../lib/useFocusOnNavigation";
import { MotifDefs } from "../skins/crete/Alpenglow";

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
  // On the login page as on the others, a new page starts at its title.
  useFocusOnNavigation();
  return (
    <>
      {/* The paths of Crête's motifs, once for every page (they stand in for a skin's own). */}
      <MotifDefs />
      <Page />
    </>
  );
}

function Page() {
  const pathname = useLocation({ select: (location) => location.pathname });

  // The login and invitation pages have no tabs: nobody is signed in yet. The
  // name of the app is in the sky of a map, the page on a frosted card that
  // floats over the ridges, where the sun is rising (the skin's `HeaderArt`).
  if (isPublicPath(pathname)) {
    return (
      <div className="welcome relative flex min-h-dvh flex-col overflow-hidden bg-dawn-sky">
        <HeaderArt place="welcome" />
        <OfflineBanner />
        <div className="welcome-head on-dawn relative pt-[max(3rem,env(safe-area-inset-top))] pb-8 text-white md:pt-20 md:pb-10">
          <div className="relative mx-auto flex max-w-md justify-center px-4">
            <BrandMark size="lg" />
          </div>
        </div>
        <main className="relative z-10 mx-4 mb-56 rounded-[1.75rem] border border-(--welcome-rim) glass welcome-card p-6 shadow-[0_30px_80px_-24px_var(--shade-welcome)] sm:mx-auto sm:w-full sm:max-w-md md:mb-64 md:p-8">
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
