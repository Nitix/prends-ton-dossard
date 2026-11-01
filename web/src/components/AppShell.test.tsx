import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { fr } from "../i18n/fr";
import { I18nProvider } from "../i18n/I18nProvider";

import "../styles.css";
import { AppShell } from "./AppShell";

const session = vi.hoisted(() => ({
  record: null as { id: string; collectionName: string; role: string } | null,
}));

const asUser = (role: "member" | "admin") => ({ id: "u1", collectionName: "users", role });

vi.mock("../lib/pb", () => ({
  pb: {
    authStore: {
      // A new object on every read, like the SDK's LocalAuthStore, which parses
      // the JSON of localStorage each time. useSession must cope with that.
      get record() {
        return session.record && { ...session.record };
      },
      onChange: () => () => {},
    },
    filter: (raw: string) => raw,
    collection: () => ({
      getFirstListItem: () => Promise.resolve({ id: "r1", name: "Alice", user: "u1" }),
    }),
  },
}));

beforeEach(() => {
  session.record = asUser("member");
});

afterEach(async () => {
  // Back to the default viewport for the other tests.
  await page.viewport(414, 896);
});

function renderShell() {
  const root = createRootRoute({
    component: () => (
      <AppShell>
        <Outlet />
      </AppShell>
    ),
  });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <p>Contenu de la page</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([home]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider languages={["fr"]}>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const link = (name: string) => ({ name, exact: true });

test("AppShell — onglet Admin absent pour un membre", async () => {
  const screen = await renderShell();

  await expect.element(screen.getByRole("link", link(fr.nav.home))).toBeVisible();
  await expect.element(screen.getByRole("link", link(fr.nav.list))).toBeVisible();
  await expect.element(screen.getByRole("link", link(fr.nav.calendar))).toBeVisible();
  await expect.element(screen.getByRole("link", link(fr.nav.profile))).toBeVisible();
  await expect.element(screen.getByRole("link", link(fr.nav.admin))).not.toBeInTheDocument();
});

test("AppShell — onglet Admin présent pour un admin", async () => {
  session.record = asUser("admin");

  const screen = await renderShell();

  await expect.element(screen.getByRole("link", link(fr.nav.admin))).toBeVisible();
  await expect
    .element(screen.getByRole("link", link(fr.nav.admin)))
    .toHaveAttribute("href", "/admin/membres");
});

test("AppShell — les onglets et le bouton + mènent aux bonnes pages, et la page est affichée", async () => {
  const screen = await renderShell();

  await expect.element(screen.getByText("Contenu de la page")).toBeVisible();
  const hrefs = {
    [fr.nav.home]: "/",
    [fr.nav.list]: "/liste",
    [fr.nav.calendar]: "/agenda",
    [fr.nav.profile]: "/profil",
    [fr.nav.createEvent]: "/evenements/nouveau",
  };
  for (const [name, href] of Object.entries(hrefs)) {
    await expect.element(screen.getByRole("link", link(name))).toHaveAttribute("href", href);
  }
});

test("AppShell — la page courante est marquée aria-current", async () => {
  const screen = await renderShell();

  await expect
    .element(screen.getByRole("link", link(fr.nav.home)))
    .toHaveAttribute("aria-current", "page");
  await expect
    .element(screen.getByRole("link", link(fr.nav.list)))
    .not.toHaveAttribute("aria-current");
});

test("AppShell — zones tactiles d'au moins 44 px", async () => {
  session.record = asUser("admin");
  const screen = await renderShell();
  await expect.element(screen.getByRole("link", link(fr.nav.admin))).toBeVisible();

  const targets = [
    fr.nav.home,
    fr.nav.list,
    fr.nav.calendar,
    fr.nav.profile,
    fr.nav.admin,
    fr.nav.createEvent,
  ];
  for (const name of targets) {
    const { width, height } = screen
      .getByRole("link", link(name))
      .element()
      .getBoundingClientRect();
    expect(width, `${name} width`).toBeGreaterThanOrEqual(44);
    expect(height, `${name} height`).toBeGreaterThanOrEqual(44);
  }
});

test("AppShell — barre d'onglets en bas sous md, en haut à partir de md", async () => {
  const screen = await renderShell();
  const nav = screen.getByRole("navigation", { name: fr.nav.main });
  await expect.element(nav).toBeVisible();

  await page.viewport(390, 844);
  expect(getComputedStyle(nav.element()).position).toBe("fixed");
  expect(nav.element().getBoundingClientRect().bottom).toBe(window.innerHeight);

  await page.viewport(1024, 768);
  expect(nav.element().getBoundingClientRect().top).toBe(0);
  expect(getComputedStyle(nav.element()).position).not.toBe("fixed");
});

test("AppShell — la barre d'onglets porte le nom du site à partir de md", async () => {
  const screen = await renderShell();
  const nav = screen.getByRole("navigation", { name: fr.nav.main });
  const name = nav.getByText("Prends ton dossard");

  // The name is only there from md: a phone has room for the tabs alone.
  await page.viewport(390, 844);
  await expect.element(name).not.toBeVisible();

  await page.viewport(1024, 768);
  await expect.element(name).toBeVisible();
});
