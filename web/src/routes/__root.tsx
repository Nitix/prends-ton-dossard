import { Outlet, createRootRoute, useLocation } from "@tanstack/react-router";

import { AppShell } from "../components/AppShell";
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

  // The login and invitation pages have no tabs: nobody is signed in yet.
  if (isPublicPath(pathname)) {
    return (
      <>
        <OfflineBanner />
        <main className="mx-auto max-w-md p-4">
          <Outlet />
        </main>
      </>
    );
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
