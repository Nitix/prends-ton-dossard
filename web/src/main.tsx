import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ToastProvider } from "./components/Toast";
import { connectSession, restoreSession } from "./features/auth/session";
import { captureInstallPrompt } from "./features/pwa/installPrompt";
import { registerServiceWorker } from "./features/pwa/register";
import { I18nProvider } from "./i18n/I18nProvider";
import { reloadOnStaleChunks } from "./lib/staleChunks";
import { ensureTemporal } from "./lib/temporal";
import { TodayProvider } from "./lib/useToday";
import { routeTree } from "./routeTree.gen";

import "./styles.css";

const queryClient = new QueryClient();
// Moving between pages is a view transition (a cross-fade) where the browser
// has them; the others change page at once.
const router = createRouter({ routeTree, defaultViewTransition: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("The #root element is missing from index.html");
}

// A tab opened before a deploy reloads when the chunks it asks for are gone.
reloadOnStaleChunks();

// The site can be installed: the service worker is what makes it so, and the
// browser makes its offer once, early, which the profile page shows later.
registerServiceWorker();
captureInstallPrompt();

// Temporal must exist before any code that uses it runs.
await ensureTemporal();

// The router checks the session when it loads the first page.
await restoreSession();

// From now on, the end of the session (sign-out, a token that the server
// refused or that expired) forgets what the last user saw and sends the app to
// the login page; the session is checked again whenever the app comes back to
// the foreground.
connectSession(router, queryClient);

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
