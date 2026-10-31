import { Outlet, createRootRoute } from "@tanstack/react-router";

import { Provisional } from "../components/Provisional";

export const Route = createRootRoute({
  component: Outlet,
  // Only the provisional page exists, so every other path shows it too: that
  // lets the server's fallback to index.html (/agenda, /liste...) be seen.
  notFoundComponent: Provisional,
});
