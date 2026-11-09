import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ToastProvider } from "../components/Toast";
import { fr } from "../i18n/fr";
import { I18nProvider } from "../i18n/I18nProvider";
import { ensureTemporal } from "../lib/temporal";
import { TodayProvider } from "../lib/useToday";
import { routeTree } from "../routeTree.gen";

import "../styles.css";

const session = vi.hoisted(() => ({
  record: null as { id: string; collectionName: string; role: string } | null,
}));

// The real tree of routes runs here, so the pages it opens ask for their data:
// every list is empty, which is enough to tell which page is on screen.
vi.mock("../lib/pb", () => ({
  pb: {
    authStore: {
      isValid: true,
      // A new object on every read, like the SDK's LocalAuthStore.
      get record() {
        return session.record && { ...session.record };
      },
      onChange: () => () => {},
    },
    filter: (raw: string) => raw,
    send: () => Promise.resolve({}),
    collection: () => ({
      getFullList: () => Promise.resolve([]),
      getList: () => Promise.resolve({ items: [] }),
      getFirstListItem: () => Promise.resolve({ id: "r1", name: "Alice", user: "u1" }),
    }),
  },
}));

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(() => {
  session.record = { id: "u1", collectionName: "users", role: "member" };
});

async function openApp(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const screen = await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider languages={["fr"]}>
        <TodayProvider value={Temporal.PlainDate.from("2026-10-31")}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </TodayProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { router, screen };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const heading = (name: string) => ({ level: 1, name, exact: true }) as const;

test("root — un onglet mène au titre de la page, d'une page à l'autre", async () => {
  const { router, screen } = await openApp("/");
  await expect.element(screen.getByRole("heading", heading(fr.nav.home))).toBeVisible();
  const tabs = screen.getByRole("navigation", { name: fr.nav.main });

  await tabs.getByRole("link", { name: fr.nav.list, exact: true }).click();
  await expect.element(screen.getByRole("heading", heading(fr.nav.list))).toHaveFocus();
  expect(router.state.location.pathname).toBe("/liste");

  await tabs.getByRole("link", { name: fr.nav.calendar, exact: true }).click();
  await expect.element(screen.getByRole("heading", heading(fr.nav.calendar))).toHaveFocus();
  expect(router.state.location.pathname).toBe("/agenda");
});

test("root — le premier affichage d'une page ne déplace pas le focus", async () => {
  const { screen } = await openApp("/liste");
  await expect.element(screen.getByRole("heading", heading(fr.nav.list))).toBeVisible();

  await pause(250);

  expect(document.activeElement).toBe(document.body);
});

test("root — un filtre de la liste garde le focus, d'un champ de la page comme de la barre d'onglets", async () => {
  const { router, screen } = await openApp("/liste");
  await expect.element(screen.getByRole("heading", heading(fr.nav.list))).toBeVisible();

  // The real filter, in the page: the search of the address changes, the user keeps it.
  const period = screen.getByRole("combobox", { name: fr.filters.period, exact: true });
  // The user is on the filter: a script only chooses the option, it does not focus the field.
  period.element().focus();
  await period.selectOptions(fr.filters.past);
  await vi.waitFor(() =>
    expect(router.state.location.search).toMatchObject({ periode: "passees" }),
  );
  await pause(250);
  expect(router.state.location.pathname).toBe("/liste");
  await expect.element(period).toHaveFocus();

  // The same change of search with the focus outside of `<main>`, where nothing but the
  // change of the pathname could be told from it: on a tab of the bar.
  const tab = screen
    .getByRole("navigation", { name: fr.nav.main })
    .getByRole("link", { name: fr.nav.list, exact: true });
  tab.element().focus();
  await router.navigate({ to: "/liste", search: { periode: undefined }, replace: true });
  await vi.waitFor(() => expect(router.state.location.search).not.toHaveProperty("periode"));
  await pause(250);
  await expect.element(tab).toHaveFocus();
});

test("root — le menu de l'admin, qui reste affiché, mène au titre de la sous-page", async () => {
  session.record = { id: "u1", collectionName: "users", role: "admin" };
  const { router, screen } = await openApp("/admin/membres");
  await expect.element(screen.getByRole("heading", heading(fr.admin.membersTitle))).toBeVisible();
  const menu = screen.getByRole("navigation", { name: fr.admin.adminNav, exact: true });

  // The menu is in `<main>` and stays there: the tap leaves the focus on the link.
  await menu.getByRole("link", { name: fr.admin.typesTitle, exact: true }).click();
  await expect.element(screen.getByRole("heading", heading(fr.admin.typesTitle))).toHaveFocus();
  expect(router.state.location.pathname).toBe("/admin/types");

  await menu.getByRole("link", { name: fr.admin.duplicatesTitle, exact: true }).click();
  await expect
    .element(screen.getByRole("heading", heading(fr.admin.duplicatesTitle)))
    .toHaveFocus();
  expect(router.state.location.pathname).toBe("/admin/doublons");
});
