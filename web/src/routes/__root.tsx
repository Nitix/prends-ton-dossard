import { Outlet, createRootRoute, useLocation } from "@tanstack/react-router";

import { Contours, MotifDefs, Ridges } from "../components/Alpenglow";
import { AppShell } from "../components/AppShell";
import { BrandMark } from "../components/Brand";
import { OfflineBanner } from "../components/OfflineBanner";
import { Provisional } from "../components/Provisional";
import { isPublicPath, requireSession } from "../features/auth/session";
import { useFocusOnNavigation } from "../lib/useFocusOnNavigation";

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
      {/* The paths of the motifs, once for every page. */}
      <MotifDefs />
      <Page />
    </>
  );
}

function Page() {
  const pathname = useLocation({ select: (location) => location.pathname });

  // The login and invitation pages have no tabs: nobody is signed in yet. The
  // name of the app is in the sky of a map, the page on a frosted card that
  // floats over the ridges, where the sun is rising.
  if (isPublicPath(pathname)) {
    return (
      <div className="relative flex min-h-dvh flex-col overflow-hidden bg-dawn-sky">
        <span aria-hidden="true" className="pointer-events-none absolute inset-0">
          <span className="absolute -top-16 -left-20 size-72 animate-glow rounded-full bg-iris-400/40 blur-3xl" />
          <Contours className="text-white opacity-[0.16]" />
          <Ridges
            className="h-[15.75rem] md:hidden"
            center={1330}
            sun={1500}
            sunSize={30}
            steep={2.2}
            sky={300}
          />
          <Ridges
            className="hidden h-[24rem] md:block"
            center={1560}
            sun={1500}
            sunSize={34}
            steep={2.2}
            sky={300}
          />
        </span>
        <OfflineBanner />
        <div className="on-dawn relative pt-[max(3rem,env(safe-area-inset-top))] pb-8 text-white md:pt-20 md:pb-10">
          <div className="relative mx-auto flex max-w-md justify-center px-4">
            <BrandMark size="lg" />
          </div>
        </div>
        <main className="relative z-10 mx-4 mb-56 rounded-[1.75rem] border border-rim/70 glass p-6 shadow-[0_30px_80px_-24px_rgb(42_32_112/0.6)] sm:mx-auto sm:w-full sm:max-w-md md:mb-64 md:p-8">
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
