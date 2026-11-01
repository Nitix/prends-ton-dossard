import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { fr } from "../i18n/fr";
import { I18nProvider } from "../i18n/I18nProvider";

import "../styles.css";
import { emulateMedia, resetMedia } from "../test/media";
import { AppShell } from "./AppShell";
import { DANGER, PRIMARY } from "./buttons";

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
  // Back to the top and to the default viewport for the other tests.
  window.scrollTo(0, 0);
  await page.viewport(414, 896);
});

function renderShell(content: ReactNode = <p>Contenu de la page</p>) {
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
    component: () => content,
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

/** Two boxes that do not cover each other. */
const apart = (a: DOMRect, b: DOMRect) =>
  a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left;

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

test("AppShell — le nom de l'appli dans l'en-tête mène à l'accueil, avec une zone de 44 px", async () => {
  const screen = await renderShell();

  const name = screen.getByRole("banner").getByRole("link", link(fr.common.appName));
  await expect.element(name).toHaveAttribute("href", "/");
  const box = name.element().getBoundingClientRect();
  expect(box.height).toBeGreaterThanOrEqual(44);
});

// --- Forced colours (a high contrast mode of Windows) ---
//
// The browser drops what the dawn paints (a gradient is a background image)
// and puts its own few colours instead: what was a pill of sunrise must still
// be seen as one, by an edge.

/** The edge of an element, as it is drawn. */
function edge(element: Element) {
  const style = getComputedStyle(element);
  return { style: style.borderTopStyle, width: Number.parseFloat(style.borderTopWidth) };
}

/** A system colour, as the browser paints it now. */
function systemColour(name: string) {
  const probe = document.createElement("span");
  probe.style.color = name;
  document.body.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}

test("AppShell — en couleurs forcées, l'onglet courant et le bouton + ont un bord, l'icône du + se voit", async () => {
  await emulateMedia({ forcedColors: "active" });
  try {
    const screen = await renderShell();
    const home = screen.getByRole("link", link(fr.nav.home));
    const list = screen.getByRole("link", link(fr.nav.list));
    const create = screen.getByRole("link", link(fr.nav.createEvent));
    await expect.element(create).toBeVisible();
    expect(matchMedia("(forced-colors: active)").matches).toBe(true);

    // The current tab has an edge that the others have not: not its bold text alone.
    expect(edge(home.element()).style).not.toBe("none");
    expect(edge(home.element()).width).toBeGreaterThanOrEqual(2);
    expect(edge(list.element()).width).toBe(0);

    // The « + » is a button with an edge, and its icon is in the colour of a button's text.
    expect(edge(create.element()).style).not.toBe("none");
    expect(edge(create.element()).width).toBeGreaterThanOrEqual(1);
    expect(getComputedStyle(create.element()).color).toBe(systemColour("ButtonText"));
  } finally {
    await resetMedia();
  }
});

test("AppShell — en couleurs forcées, un bouton principal en dégradé et un bouton qui supprime gardent un bord", async () => {
  await emulateMedia({ forcedColors: "active" });
  try {
    const screen = await renderShell(
      <>
        <button type="button" className={PRIMARY}>
          Enregistrer
        </button>
        <button type="button" className={DANGER}>
          Supprimer
        </button>
      </>,
    );
    for (const name of ["Enregistrer", "Supprimer"]) {
      const button = screen.getByRole("button", { name });
      await expect.element(button).toBeVisible();
      expect(edge(button.element()).style, `${name}: its edge`).not.toBe("none");
      expect(edge(button.element()).width, `${name}: its edge`).toBeGreaterThanOrEqual(1);
    }
  } finally {
    await resetMedia();
  }
});

test("AppShell — sans couleurs forcées, rien ne change : pas de bord au + ni à l'onglet courant", async () => {
  const screen = await renderShell();
  const create = screen.getByRole("link", link(fr.nav.createEvent));
  await expect.element(create).toBeVisible();
  expect(edge(create.element()).width).toBe(0);
  expect(edge(screen.getByRole("link", link(fr.nav.home)).element()).width).toBe(0);
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

test("AppShell — barre d'onglets en bas sous md, qui flotte ; en haut à partir de md, dans l'en-tête", async () => {
  // A page longer than the screen, to see where the bar is once the page scrolls.
  const screen = await renderShell(<div className="h-[3000px]">Contenu de la page</div>);
  const nav = screen.getByRole("navigation", { name: fr.nav.main });
  await expect.element(nav).toBeVisible();

  // On a phone, fixed at the bottom of the screen, within reach of a thumb: it
  // floats a little above the edge (not more than 16 px), wherever the page is.
  await page.viewport(390, 844);
  expect(getComputedStyle(nav.element()).position).toBe("fixed");
  const gap = window.innerHeight - nav.element().getBoundingClientRect().bottom;
  expect(gap).toBeGreaterThan(0);
  expect(gap).toBeLessThanOrEqual(16);
  window.scrollTo(0, 1000);
  expect(window.innerHeight - nav.element().getBoundingClientRect().bottom).toBe(gap);

  // From md, at the top, over the sky of the header; it stays at the top as the page scrolls.
  window.scrollTo(0, 0);
  await page.viewport(1024, 768);
  expect(getComputedStyle(nav.element()).position).toBe("sticky");
  const header = screen.getByRole("banner").element().getBoundingClientRect();
  const bar = nav.element().getBoundingClientRect();
  expect(bar.top).toBeGreaterThanOrEqual(0);
  expect(bar.bottom).toBeLessThanOrEqual(header.bottom);
  window.scrollTo(0, 1000);
  const top = nav.element().getBoundingClientRect().top;
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThanOrEqual(16);
});

test("AppShell — le nom du site est dans l'en-tête à toutes les tailles, pas en double dans les onglets", async () => {
  // An admin has the most tabs: the widest bar.
  session.record = asUser("admin");
  const screen = await renderShell();
  const name = screen.getByRole("banner").getByRole("link", link(fr.common.appName));
  const nav = screen.getByRole("navigation", { name: fr.nav.main });

  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1024, 768],
  ] as const) {
    await page.viewport(width, height);
    await expect.element(name).toBeVisible();
    await expect.element(name).toHaveAttribute("href", "/");
    await expect.element(nav.getByText(fr.common.appName)).not.toBeInTheDocument();
  }
  // From md the tabs share the header with the name, at its right: they do not cover it.
  await page.viewport(768, 1024);
  const tabs = nav.getByRole("list").element().getBoundingClientRect();
  expect(name.element().getBoundingClientRect().right).toBeLessThanOrEqual(tabs.left);
});

test("AppShell — du téléphone au grand écran, la fin de la page ne passe ni sous la barre d'onglets ni sous le bouton +", async () => {
  // Both float over the page: the room under the content must clear them once
  // the page is scrolled to the bottom.
  const screen = await renderShell(
    <div className="flex flex-col gap-4">
      {Array.from({ length: 30 }, (_, i) => (
        <p key={i} className="rounded-xl bg-white p-4">
          Élément {i + 1}
        </p>
      ))}
    </div>,
  );
  const nav = screen.getByRole("navigation", { name: fr.nav.main });
  const plus = screen.getByRole("link", link(fr.nav.createEvent));
  const last = screen.getByText("Élément 30", { exact: true });

  // Phones, where the bar and the + button float over the whole width at the
  // bottom; tablets, where the + button floats over the right of the column;
  // wide screens, where it is beside the column.
  for (const [width, height] of [
    [390, 844],
    [320, 568],
    [768, 1024],
    [834, 1194],
    [1024, 768],
    [1280, 800],
  ] as const) {
    await page.viewport(width, height);
    window.scrollTo(0, document.documentElement.scrollHeight);
    // At the bottom of the page, or the test would prove nothing.
    expect(window.scrollY + window.innerHeight).toBeGreaterThanOrEqual(
      document.documentElement.scrollHeight - 1,
    );

    const item = last.element().getBoundingClientRect();
    const bar = nav.getByRole("list").element().getBoundingClientRect();
    const button = plus.element().getBoundingClientRect();
    expect(item.top, `${width} px: on the screen`).toBeGreaterThanOrEqual(0);
    expect(apart(item, bar), `${width} px: not under the tab bar`).toBe(true);
    expect(apart(item, button), `${width} px: not under the + button`).toBe(true);
  }
});
