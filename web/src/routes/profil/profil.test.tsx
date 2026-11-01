import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { beforeAll, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ToastProvider } from "../../components/Toast";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";
import { routeTree } from "../../routeTree.gen";

// The tap targets and the tab bar are a matter of the styles, which are not
// loaded otherwise.
import "../../styles.css";

const alice = { id: "r1", name: "Alice", user: "u1" };

// The real tree of routes runs here, so the pages it opens ask for their data:
// Alice is the only runner, and every other list is empty.
vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: {
      isValid: true,
      // A new object on every read, like the SDK's LocalAuthStore.
      get record() {
        return { id: "u1", collectionName: "users", role: "member", email: "alice@example.test" };
      },
      onChange: () => () => {},
    },
    filter: (raw: string) => raw,
    send: () => Promise.resolve({ exists: false }),
    collection: (name: string) => ({
      getFullList: () => Promise.resolve(name === "runners" ? [alice] : []),
      getList: () => Promise.resolve({ items: [] }),
      getFirstListItem: () => Promise.resolve(alice),
    }),
    files: { getURL: () => "" },
  },
}));

beforeAll(async () => {
  await ensureTemporal();
});

async function open(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const screen = await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider languages={["fr"]}>
        <TodayProvider value={Temporal.PlainDate.from("2026-11-01")}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </TodayProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { router, screen };
}

test("routes/profil — /profil est le profil de son coureur, et /profil/reglages sa page de réglages, l'onglet « Profil » reste actif sur les deux", async () => {
  const { router, screen } = await open("/profil");
  const tab = screen.getByRole("link", { name: fr.nav.profile, exact: true });

  await expect.element(screen.getByRole("heading", { level: 1, name: "Alice" })).toBeVisible();
  await expect.element(tab).toHaveAttribute("aria-current", "page");

  await screen.getByRole("link", { name: fr.profile.settings }).click();

  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.profile.settings }))
    .toBeVisible();
  expect(router.state.location.pathname).toBe("/profil/reglages");
  await expect.element(tab).toHaveAttribute("aria-current", "page");

  await screen.getByRole("link", { name: fr.profile.backToProfile }).click();

  await expect.element(screen.getByRole("heading", { level: 1, name: "Alice" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/profil");
  await expect.element(tab).toHaveAttribute("aria-current", "page");
});

test("routes/profil — /profil/reglages s'ouvre directement, avec son onglet actif", async () => {
  const { screen } = await open("/profil/reglages");

  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.profile.settings }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: fr.nav.profile, exact: true }))
    .toHaveAttribute("aria-current", "page");
});
