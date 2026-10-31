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
