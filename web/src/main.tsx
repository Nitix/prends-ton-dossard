import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ToastProvider } from "./components/Toast";
import { restoreSession } from "./features/auth/session";
import { I18nProvider } from "./i18n/I18nProvider";
import { pb } from "./lib/pb";
import { ensureTemporal } from "./lib/temporal";
import { TodayProvider } from "./lib/useToday";
import { routeTree } from "./routeTree.gen";

import "./styles.css";

const queryClient = new QueryClient();
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("The #root element is missing from index.html");
}

// Temporal must exist before any code that uses it runs.
await ensureTemporal();

// The router checks the session when it loads the first page.
await restoreSession();

// The session ended (sign-out, or the server refused the token): forget what
// the last user saw, and run the root route's check again, which sends the
// app to the login page.
pb.authStore.onChange((token) => {
  if (token) return;
  queryClient.clear();
  void router.invalidate();
});

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <TodayProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </TodayProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
