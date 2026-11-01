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
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useFocusOnNavigation } from "./useFocusOnNavigation";

/**
 * A small app: a header with a link and a search change that sit outside
 * `<main>` (like the tabs of the app), and pages in `<main>`. The pages have
 * paths of the app, so that the links type-check against its router:
 * `/agenda` is the page that loads, `/stats` the one with no title.
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

/** The data of the page that loads: `arrive()` is the moment they come. */
function pendingData() {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { data: promise, arrive: resolve };
}

async function renderApp(
  path = "/",
  data: Promise<void> = Promise.resolve(),
  { viewTransition = false }: { viewTransition?: boolean } = {},
) {
  const root = createRootRoute({ component: Shell });
  const home = createRoute({ getParentRoute: () => root, path: "/", component: Home });
  const list = createRoute({
    getParentRoute: () => root,
    path: "/liste",
    validateSearch: (search: Record<string, unknown>) => ({
      type: typeof search.type === "string" ? search.type : undefined,
    }),
    component: List,
  });
  const loading = createRoute({
    getParentRoute: () => root,
    path: "/agenda",
    component: () => <Loading data={data} />,
  });
  const untitled = createRoute({
    getParentRoute: () => root,
    path: "/stats",
    component: () => <p>Une page sans titre</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, list, loading, untitled]),
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
  await inPage.click();
  await vi.waitFor(() => expect(router.state.location.search).toEqual({ type: "trail" }));
  await pause(SETTLE_MS);
  await expect.element(inPage).toHaveFocus();

  // From outside the page, so that the focus is not in `<main>` to begin with: it stays too.
  await router.navigate({ to: "/liste", search: { type: undefined } });
  const outside = screen.getByRole("button", { name: "Filtrer depuis l'en-tête" });
  await outside.click();
  await vi.waitFor(() => expect(router.state.location.search).toEqual({ type: "trail" }));
  await pause(SETTLE_MS);
  await expect.element(outside).toHaveFocus();
});

test("navigation — aller à une ancre de la même page ne déplace pas le focus", async () => {
  const { router, screen } = await renderApp("/liste");
  await expect.element(screen.getByRole("heading", { level: 1, name: "Liste" })).toBeVisible();

  const anchor = screen.getByRole("link", { name: "Aller en bas de la liste" });
  await anchor.click();
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
  window.scrollTo(0, 0);
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
