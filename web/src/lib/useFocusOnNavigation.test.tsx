import {
  Link,
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { pressFocused } from "../test/pressFocused";
import { useFocusOnNavigation } from "./useFocusOnNavigation";

/**
 * A small app: a header with a link and a search change that sit outside
 * `<main>` (like the tabs of the app), and pages in `<main>`, under a menu that
 * stays on screen from one page to another (like the one of the admin pages).
 * The pages have paths of the app, so that the links type-check against its
 * router: `/agenda` is the page that loads, `/stats` the one with no title,
 * `/profil` the one whose title is there but not shown yet.
 */
function Shell() {
  useFocusOnNavigation();
  const navigate = useNavigate();
  return (
    <>
      <header>
        <Link to="/">Onglet accueil</Link>
        <button
          type="button"
          onClick={() => void navigate({ to: "/liste", search: { type: "trail" } })}
        >
          Filtrer depuis l'en-tête
        </button>
        <Link to="/liste" hash="fin">
          Aller en bas de la liste
        </Link>
      </header>
      <main>
        <nav>
          <Link to="/liste">Lien resté dans la page</Link>
          <Link to="/agenda">Lien resté vers la page qui charge</Link>
        </nav>
        <Outlet />
      </main>
    </>
  );
}

function Home() {
  return (
    <>
      <h1 tabIndex={-1}>Accueil</h1>
      <Link to="/liste">Voir la liste</Link>
      <Link to="/agenda">Voir la page qui charge</Link>
      <Link to="/stats">Voir la page sans titre</Link>
      <Link to="/profil">Voir la page au titre caché</Link>
    </>
  );
}

function List() {
  const navigate = useNavigate();
  return (
    <>
      <h1 tabIndex={-1}>Liste</h1>
      <button
        type="button"
        onClick={() => void navigate({ to: ".", search: { type: "trail" }, replace: true })}
      >
        Filtrer dans la page
      </button>
      <p id="fin">Fin de la liste</p>
    </>
  );
}

/** A page that asks for its data: its title only comes once the test lets the data come. */
function Loading({ data }: { data: Promise<void> }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void data.then(() => setReady(true));
  }, [data]);
  return (
    <div style={{ height: "3000px" }}>
      <input aria-label="Recherche" />
      {ready ? <h1 tabIndex={-1}>Chargée</h1> : <output>Chargement</output>}
    </div>
  );
}

/** A page whose title is in the page from the start, but cannot take the focus until the data are there. */
function HiddenTitle({ data }: { data: Promise<void> }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void data.then(() => setReady(true));
  }, [data]);
  return ready ? (
    <h1 key="shown" tabIndex={-1}>
      Affichée
    </h1>
  ) : (
    <h1 key="hidden" hidden>
      Pas encore affichée
    </h1>
  );
}

/** The data of the page that loads: `arrive()` is the moment they come. */
function pendingData() {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { data: promise, arrive: resolve };
}

async function renderApp(
  path = "/",
  data: Promise<void> = Promise.resolve(),
  {
    viewTransition = false,
    listData = Promise.resolve(),
  }: { viewTransition?: boolean; listData?: Promise<void> } = {},
) {
  const root = createRootRoute({ component: Shell });
  const home = createRoute({ getParentRoute: () => root, path: "/", component: Home });
  const list = createRoute({
    getParentRoute: () => root,
    path: "/liste",
    validateSearch: (search: Record<string, unknown>) => ({
      type: typeof search.type === "string" ? search.type : undefined,
    }),
    // The navigation to this page is on its way until the test lets the data come.
    loader: () => listData,
    component: List,
  });
  const loading = createRoute({
    getParentRoute: () => root,
    path: "/agenda",
    component: () => <Loading data={data} />,
  });
  const hidden = createRoute({
    getParentRoute: () => root,
    path: "/profil",
    component: () => <HiddenTitle data={data} />,
  });
  const untitled = createRoute({
    getParentRoute: () => root,
    path: "/stats",
    component: () => <p>Une page sans titre</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, list, loading, hidden, untitled]),
    history: createMemoryHistory({ initialEntries: [path] }),
    // A view transition that another one skips rejects a promise that nobody
    // listens to, which fails the run: only the test that wants it has them.
    defaultViewTransition: viewTransition,
  });
  const screen = await render(<RouterProvider router={router} />);
  return { router, screen };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Longer than a frame, and than the hook would take to move the focus. */
const SETTLE_MS = 250;

afterEach(() => {
  // A test that scrolled the page leaves it for the next.
  window.scrollTo(0, 0);
});

test("navigation — un lien vers une autre page met le focus sur son titre", async () => {
  const { router, screen } = await renderApp();
  await expect.element(screen.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();

  // The link is in the old page: it goes with it, and the focus with it.
  await screen.getByRole("link", { name: "Voir la liste" }).click();

  await expect.element(screen.getByRole("heading", { level: 1, name: "Liste" })).toHaveFocus();
  expect(router.state.location.pathname).toBe("/liste");
});

test("navigation — un onglet hors de la page mène aussi au titre de la nouvelle page", async () => {
  const { screen } = await renderApp("/liste");
  await expect.element(screen.getByRole("heading", { level: 1, name: "Liste" })).toBeVisible();

  // The tab stays where it is, with the focus: the title takes it.
  await screen.getByRole("link", { name: "Onglet accueil" }).click();

  await expect.element(screen.getByRole("heading", { level: 1, name: "Accueil" })).toHaveFocus();
});

test("navigation — le premier affichage ne déplace pas le focus", async () => {
  const { screen } = await renderApp("/liste");
  await expect.element(screen.getByRole("heading", { level: 1, name: "Liste" })).toBeVisible();

  await pause(SETTLE_MS);

  expect(document.activeElement).toBe(document.body);
});

test("navigation — changer un filtre (même page, autre recherche) ne déplace pas le focus", async () => {
  const { router, screen } = await renderApp("/liste");
  await expect.element(screen.getByRole("heading", { level: 1, name: "Liste" })).toBeVisible();

  // From the page: the filter keeps the focus.
  const inPage = screen.getByRole("button", { name: "Filtrer dans la page" });
  await pressFocused(inPage);
  await vi.waitFor(() => expect(router.state.location.search).toEqual({ type: "trail" }));
  await pause(SETTLE_MS);
  await expect.element(inPage).toHaveFocus();

  // From outside the page, so that the focus is not in `<main>` to begin with: it stays too.
  await router.navigate({ to: "/liste", search: { type: undefined } });
  const outside = screen.getByRole("button", { name: "Filtrer depuis l'en-tête" });
  await pressFocused(outside);
  await vi.waitFor(() => expect(router.state.location.search).toEqual({ type: "trail" }));
  await pause(SETTLE_MS);
  await expect.element(outside).toHaveFocus();
});

test("navigation — aller à une ancre de la même page ne déplace pas le focus", async () => {
  const { router, screen } = await renderApp("/liste");
  await expect.element(screen.getByRole("heading", { level: 1, name: "Liste" })).toBeVisible();

  const anchor = screen.getByRole("link", { name: "Aller en bas de la liste" });
  await pressFocused(anchor);
  await vi.waitFor(() => expect(router.state.location.hash).toBe("fin"));
  await pause(SETTLE_MS);

  await expect.element(anchor).toHaveFocus();
});

test("navigation — une page qui charge reçoit le focus quand son titre apparaît", async () => {
  const { data, arrive } = pendingData();
  const { screen } = await renderApp("/", data);
  await expect.element(screen.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();

  await screen.getByRole("link", { name: "Voir la page qui charge" }).click();

  // No title yet, and the old page is gone: nothing has the focus.
  await expect.element(screen.getByText("Chargement")).toBeVisible();
  await pause(SETTLE_MS);
  expect(document.activeElement).toBe(document.body);
  // Then the data come, and the title with them.
  arrive();
  await expect.element(screen.getByRole("heading", { level: 1, name: "Chargée" })).toHaveFocus();
});

test("navigation — le focus que l'utilisateur a déjà mis dans la page n'est pas volé", async () => {
  const { data, arrive } = pendingData();
  const { screen } = await renderApp("/", data);
  await expect.element(screen.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();
  await screen.getByRole("link", { name: "Voir la page qui charge" }).click();
  await expect.element(screen.getByText("Chargement")).toBeVisible();

  // The user goes on without waiting for the title.
  const search = screen.getByRole("textbox", { name: "Recherche" });
  await search.click();
  await expect.element(search).toHaveFocus();
  arrive();
  await expect.element(screen.getByRole("heading", { level: 1, name: "Chargée" })).toBeVisible();
  await pause(SETTLE_MS);

  await expect.element(search).toHaveFocus();
});

test("navigation — le titre qui arrive pendant que l'on lit ne fait pas défiler la page", async () => {
  const { data, arrive } = pendingData();
  const { screen } = await renderApp("/", data);
  await expect.element(screen.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();
  await screen.getByRole("link", { name: "Voir la page qui charge" }).click();
  await expect.element(screen.getByText("Chargement")).toBeVisible();

  // The router scrolls a new page to its top; the reader goes down while it loads.
  window.scrollTo(0, 800);
  arrive();
  await expect.element(screen.getByRole("heading", { level: 1, name: "Chargée" })).toHaveFocus();

  expect(window.scrollY).toBe(800);
});

test("navigation — une page sans titre donne le focus à <main>", async () => {
  const { screen } = await renderApp();
  await expect.element(screen.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();

  await screen.getByRole("link", { name: "Voir la page sans titre" }).click();

  await expect.element(screen.getByText("Une page sans titre")).toBeVisible();
  // Given about a second for a title, then the whole page.
  await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector("main")), {
    timeout: 3000,
  });
});

test("navigation — une page qui charge trop longtemps donne le focus à <main>, que son titre ne reprend pas", async () => {
  const { data, arrive } = pendingData();
  const { screen } = await renderApp("/", data);
  await expect.element(screen.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();

  await screen.getByRole("link", { name: "Voir la page qui charge" }).click();

  await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector("main")), {
    timeout: 3000,
  });
  // The user has been told about the page: a title that comes later would be a second move.
  arrive();
  await expect.element(screen.getByRole("heading", { level: 1, name: "Chargée" })).toBeVisible();
  await pause(SETTLE_MS);
  expect(document.activeElement).toBe(document.querySelector("main"));
});

test("navigation — une page qui charge trop longtemps ne prend pas le focus d'un champ où l'utilisateur écrit", async () => {
  const { data } = pendingData();
  const { screen } = await renderApp("/", data);
  await expect.element(screen.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();
  await screen.getByRole("link", { name: "Voir la page qui charge" }).click();
  const search = screen.getByRole("textbox", { name: "Recherche" });
  await search.click();

  // Past the second that the page had.
  await pause(1300);

  await expect.element(search).toHaveFocus();
});

test("navigation — le focus passe aussi quand la page change par une transition de vue, comme dans l'appli", async () => {
  const { screen } = await renderApp("/", Promise.resolve(), { viewTransition: true });
  await expect.element(screen.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();

  await screen.getByRole("link", { name: "Voir la liste" }).click();

  await expect.element(screen.getByRole("heading", { level: 1, name: "Liste" })).toHaveFocus();
});

test("navigation — un lien resté affiché dans la page, comme le menu de l'admin, ne garde pas le focus", async () => {
  const { router, screen } = await renderApp("/");
  await expect.element(screen.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();

  // The link is still there once the new page is: the tap left the focus on it, in `<main>`.
  const menu = screen.getByRole("link", { name: "Lien resté dans la page" });
  await menu.click();

  await expect.element(screen.getByRole("heading", { level: 1, name: "Liste" })).toHaveFocus();
  expect(router.state.location.pathname).toBe("/liste");
  await expect.element(menu).toBeVisible();
});

test("navigation — après le repli sur <main>, la page suivante a le focus sur son titre, et <main> n'a plus de tabindex", async () => {
  const { router, screen } = await renderApp("/");
  await expect.element(screen.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();
  await screen.getByRole("link", { name: "Voir la page sans titre" }).click();
  const main = document.querySelector("main");
  await vi.waitFor(() => expect(document.activeElement).toBe(main), { timeout: 3000 });
  expect(main?.getAttribute("tabindex")).toBe("-1");

  // Back, with nothing tapped: the focus is still on <main>, which is not the user's.
  router.history.back();

  await expect.element(screen.getByRole("heading", { level: 1, name: "Accueil" })).toHaveFocus();
  expect(main?.hasAttribute("tabindex")).toBe(false);
});

test("navigation — un titre déjà là mais pas encore affichable n'arrête pas l'attente", async () => {
  const { data, arrive } = pendingData();
  const { screen } = await renderApp("/", data);
  await expect.element(screen.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();

  await screen.getByRole("link", { name: "Voir la page au titre caché" }).click();
  await pause(SETTLE_MS);
  expect(document.activeElement).toBe(document.body);
  arrive();

  await expect.element(screen.getByRole("heading", { level: 1, name: "Affichée" })).toHaveFocus();
});

test("navigation — l'attente d'une page que l'on a quittée ne reprend pas le focus", async () => {
  const { data, arrive } = pendingData();
  const { screen } = await renderApp("/", data);
  await expect.element(screen.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();
  // A page that loads, which the user leaves for one with a title before its own comes.
  await screen.getByRole("link", { name: "Voir la page qui charge" }).click();
  await expect.element(screen.getByText("Chargement")).toBeVisible();
  await screen.getByRole("link", { name: "Onglet accueil" }).click();
  await expect.element(screen.getByRole("heading", { level: 1, name: "Accueil" })).toHaveFocus();

  // The user moves on to the header, then the page changes: a wait that was not stopped
  // would take the focus back to the title.
  const header = screen.getByRole("button", { name: "Filtrer depuis l'en-tête" });
  header.element().focus();
  arrive();
  document.querySelector("main")?.append(document.createElement("p"));
  await pause(SETTLE_MS);

  await expect.element(header).toHaveFocus();
});

test("navigation — le focus que le hook a mis sur <main> pendant qu'une autre navigation charge n'est pas celui de l'utilisateur", async () => {
  const list = pendingData();
  const { screen } = await renderApp("/", undefined, { listData: list.data });
  await expect.element(screen.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();
  await screen.getByRole("link", { name: "Voir la page sans titre" }).click();
  // The user goes on to the next page, which takes its time: the page with no title is still
  // there when its wait is over, and <main> takes the focus.
  await screen.getByRole("link", { name: "Aller en bas de la liste" }).click();
  const main = document.querySelector("main");
  await vi.waitFor(() => expect(document.activeElement).toBe(main), { timeout: 3000 });

  list.arrive();

  await expect.element(screen.getByRole("heading", { level: 1, name: "Liste" })).toHaveFocus();
});

test("navigation — l'attente d'une page que l'on a quittée ne prend pas le focus que l'utilisateur a remis sur son lien", async () => {
  const { data, arrive } = pendingData();
  const { router, screen } = await renderApp("/", data);
  await expect.element(screen.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();
  // A page that loads, reached by a link of the menu that stays: the wait for its title starts
  // with the focus on that link.
  const menu = screen.getByRole("link", { name: "Lien resté vers la page qui charge" });
  await menu.click();
  await expect.element(screen.getByText("Chargement")).toBeVisible();

  // Then another page whose title is not shown yet, from the header. The user comes back to the
  // link of the first page; the title shows. That wait is the one of the page on screen: the
  // wait of the page that was left is over, and has nothing to say about that focus.
  const header = screen.getByRole("button", { name: "Filtrer depuis l'en-tête" });
  header.element().focus();
  await router.navigate({ to: "/profil" });
  menu.element().focus();
  arrive();
  await expect.element(screen.getByRole("heading", { level: 1, name: "Affichée" })).toBeVisible();
  await pause(SETTLE_MS);

  await expect.element(menu).toHaveFocus();
});
