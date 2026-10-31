import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
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

const session = vi.hoisted(() => ({
  record: null as { id: string; collectionName: string; role: string } | null,
}));

const asUser = (role: "member" | "admin") => ({ id: "u1", collectionName: "users", role });

// The real tree of routes runs here, so the pages it opens ask for their data:
// every list is empty, which is enough to tell which page is on screen.
vi.mock("../../lib/pb", () => ({
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
  session.record = asUser("member");
});

async function openAdmin(path: string) {
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

test("admin/route — un membre est redirigé vers /", async () => {
  const { router, screen } = await openAdmin("/admin/membres");

  await vi.waitFor(() => {
    expect(router.state.location.pathname).toBe("/");
  });
  await expect.element(screen.getByRole("heading", { level: 1, name: fr.nav.home })).toBeVisible();
  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.admin.membersTitle }))
    .not.toBeInTheDocument();
});

test("admin/route — /admin mène à la page des membres pour un admin, et à / pour un membre", async () => {
  session.record = asUser("admin");
  const asAdmin = await openAdmin("/admin");
  await vi.waitFor(() => {
    expect(asAdmin.router.state.location.pathname).toBe("/admin/membres");
  });
  await asAdmin.screen.unmount();

  session.record = asUser("member");
  const asMember = await openAdmin("/admin");
  await vi.waitFor(() => {
    expect(asMember.router.state.location.pathname).toBe("/");
  });
});

test("admin/route — un admin arrive sur la page des membres", async () => {
  session.record = asUser("admin");

  const { router, screen } = await openAdmin("/admin/membres");

  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.admin.membersTitle }))
    .toBeVisible();
  expect(router.state.location.pathname).toBe("/admin/membres");
});

test("admin/route — le menu de l'admin mène aux trois pages et marque la page courante", async () => {
  session.record = asUser("admin");
  const { router, screen } = await openAdmin("/admin/membres");

  const nav = screen.getByRole("navigation", { name: fr.admin.adminNav, exact: true });
  const link = (name: string) => nav.getByRole("link", { name, exact: true });
  await expect.element(link(fr.admin.membersTitle)).toHaveAttribute("href", "/admin/membres");
  await expect.element(link(fr.admin.typesTitle)).toHaveAttribute("href", "/admin/types");
  await expect.element(link(fr.admin.duplicatesTitle)).toHaveAttribute("href", "/admin/doublons");
  await expect.element(link(fr.admin.membersTitle)).toHaveAttribute("aria-current", "page");
  await expect.element(link(fr.admin.typesTitle)).not.toHaveAttribute("aria-current");

  await link(fr.admin.typesTitle).click();
  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.admin.typesTitle }))
    .toBeVisible();
  expect(router.state.location.pathname).toBe("/admin/types");
  await expect.element(link(fr.admin.typesTitle)).toHaveAttribute("aria-current", "page");
  await expect.element(link(fr.admin.membersTitle)).not.toHaveAttribute("aria-current");

  await link(fr.admin.duplicatesTitle).click();
  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.admin.duplicatesTitle }))
    .toBeVisible();
  expect(router.state.location.pathname).toBe("/admin/doublons");
  await expect.element(link(fr.admin.duplicatesTitle)).toHaveAttribute("aria-current", "page");
});

test("admin/route — les liens du menu de l'admin font au moins 44 px", async () => {
  session.record = asUser("admin");
  const { screen } = await openAdmin("/admin/membres");

  const nav = screen.getByRole("navigation", { name: fr.admin.adminNav, exact: true });
  await expect.element(nav).toBeVisible();
  for (const name of [fr.admin.membersTitle, fr.admin.typesTitle, fr.admin.duplicatesTitle]) {
    const { width, height } = nav
      .getByRole("link", { name, exact: true })
      .element()
      .getBoundingClientRect();
    expect(height, `${name} height`).toBeGreaterThanOrEqual(44);
    expect(width, `${name} width`).toBeGreaterThanOrEqual(44);
  }
});

test("admin/route — un membre n'arrive sur aucune des pages des types et des doublons", async () => {
  for (const path of ["/admin/types", "/admin/doublons"]) {
    session.record = asUser("member");
    const { router, screen } = await openAdmin(path);
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    await screen.unmount();
  }
});
