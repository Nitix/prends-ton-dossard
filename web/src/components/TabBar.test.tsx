import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { fr } from "../i18n/fr";
import { I18nProvider } from "../i18n/I18nProvider";
import { TabBar } from "./TabBar";

/** The tabs, on the page at `path`, in a router that knows every page they go to. */
async function renderTabs(path: string) {
  const root = createRootRoute({
    component: () => (
      <>
        <TabBar isAdmin={false} />
        <Outlet />
      </>
    ),
  });
  const page = (to: string) =>
    createRoute({ getParentRoute: () => root, path: to, component: () => <p>{to}</p> });
  const router = createRouter({
    routeTree: root.addChildren(
      ["/", "/liste", "/agenda", "/profil", "/profil/reglages"].map(page),
    ),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return render(
    <I18nProvider languages={["fr"]}>
      <RouterProvider router={router} />
    </I18nProvider>,
  );
}

const tab = (name: string) => ({ name, exact: true });

/** The tabs that say they are the current page. */
function current(screen: Awaited<ReturnType<typeof renderTabs>>): string[] {
  return screen
    .getByRole("link")
    .elements()
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent);
}

test("TabBar — « Profil » actif sur /profil", async () => {
  const screen = await renderTabs("/profil");

  await expect
    .element(screen.getByRole("link", tab(fr.nav.profile)))
    .toHaveAttribute("aria-current", "page");
  expect(current(screen)).toEqual([fr.nav.profile]);
});

test("TabBar — « Profil » actif sur /profil/reglages", async () => {
  const screen = await renderTabs("/profil/reglages");

  await expect
    .element(screen.getByRole("link", tab(fr.nav.profile)))
    .toHaveAttribute("aria-current", "page");
  // Only this one: the other tabs are not the current page.
  expect(current(screen)).toEqual([fr.nav.profile]);
});

test("TabBar — « Profil » n'est pas actif sur une autre page", async () => {
  const screen = await renderTabs("/liste");

  await expect
    .element(screen.getByRole("link", tab(fr.nav.list)))
    .toHaveAttribute("aria-current", "page");
  expect(current(screen)).toEqual([fr.nav.list]);
});
