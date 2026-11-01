import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { ClientResponseError } from "pocketbase";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ToastProvider } from "../../components/Toast";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";
import {
  aliceRunner,
  bobRunner,
  event2Record,
  eventRecord,
  f42,
  fLyon,
  p1,
  p2,
  p3,
  roadType,
  trailType,
  withParticipations,
} from "../events/testFixture";
import { HomePage } from "./HomePage";

// The tap targets and the dashes are a matter of the styles, which are not
// loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  user: null as Rec | null,
  pending: vi.fn<(options: Rec) => Promise<unknown>>(),
  update: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
  remove: vi.fn<(id: string) => Promise<unknown>>(),
  events: vi.fn<(options: Rec) => Promise<unknown>>(),
  myRunner: vi.fn<(filter: string) => Promise<unknown>>(),
  passkeys: vi.fn<(page: number, perPage: number, options: Rec) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: {
      // A new object on every read, like the SDK's LocalAuthStore.
      get record() {
        return mocks.user && { ...mocks.user };
      },
      onChange: () => () => {},
    },
    filter: (raw: string, params: Rec) => `${raw} ${JSON.stringify(params)}`,
    collection: (name: string) =>
      ({
        participations: { getFullList: mocks.pending, update: mocks.update, delete: mocks.remove },
        events: { getFullList: mocks.events },
        runners: { getFirstListItem: mocks.myRunner },
        passkeys: { getList: mocks.passkeys },
      })[name],
  },
}));

const DISMISSED_KEY = "courses.passkeyBanner.dismissed";
const TODAY = "2026-04-30";

// What the server sends for the participations to confirm: each one with its
// format, and the event and the race type of the format.
const f42Expanded = { ...f42, expand: { event: eventRecord, race_type: trailType } };
const fLyonExpanded = { ...fLyon, expand: { event: event2Record, race_type: roadType } };

/** Bob, added by Alice on F42. */
const pendingP2 = {
  ...p2,
  expand: { runner: bobRunner, added_by: aliceRunner, format: f42Expanded },
};
/** Bob again, added by Alice on the 10 km of Lyon. */
const pendingLyon = {
  ...p2,
  id: "p-lyon",
  event: "event2",
  format: "fLyon",
  expand: { runner: bobRunner, added_by: aliceRunner, format: fLyonExpanded },
};

const users = {
  alice: { id: "u-alice", collectionName: "users", role: "member", runner: aliceRunner },
  bob: { id: "u-bob", collectionName: "users", role: "member", runner: bobRunner },
};

function signIn(who: keyof typeof users) {
  const { runner, ...user } = users[who];
  mocks.user = user;
  mocks.myRunner.mockResolvedValue(runner);
}

const noPasskey = { items: [], page: 1, perPage: 1, totalItems: -1, totalPages: -1 };
const onePasskey = { ...noPasskey, items: [{ id: "k1" }] };

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(() => {
  for (const fn of [
    mocks.pending,
    mocks.update,
    mocks.remove,
    mocks.events,
    mocks.myRunner,
    mocks.passkeys,
  ]) {
    fn.mockReset();
  }
  mocks.pending.mockResolvedValue([]);
  mocks.update.mockResolvedValue({});
  mocks.remove.mockResolvedValue(true);
  mocks.events.mockResolvedValue([eventRecord, event2Record]);
  mocks.passkeys.mockResolvedValue(onePasskey);
  signIn("bob");
  try {
    localStorage.removeItem(DISMISSED_KEY);
  } catch {
    // Nothing to clear.
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderHome(options: { languages?: string[]; today?: string } = {}) {
  const { languages = ["fr"], today = TODAY } = options;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: Outlet });
  const home = createRoute({ getParentRoute: () => root, path: "/", component: HomePage });
  const eventPage = createRoute({
    getParentRoute: () => root,
    path: "/evenements/$id",
    component: () => <p>Fiche</p>,
  });
  const profile = createRoute({
    getParentRoute: () => root,
    path: "/profil",
    component: () => <p>Profil</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, eventPage, profile]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        <TodayProvider value={Temporal.PlainDate.from(today)}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </TodayProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { screen, queryClient };
}

type Screen = Awaited<ReturnType<typeof renderHome>>["screen"];

// Intl separates a number from its unit with a no-break space: tests read the
// text as it looks.
const plain = (s: string | null) => (s ?? "").replace(/\p{Zs}/gu, " ");

const pendingBlock = (screen: Screen) => screen.getByRole("region", { name: fr.home.pendingTitle });
const upcomingBlock = (screen: Screen) =>
  screen.getByRole("region", { name: fr.home.upcomingTitle });
const groupBlock = (screen: Screen) => screen.getByRole("region", { name: fr.home.groupTitle });
const banner = (screen: Screen) => screen.getByRole("region", { name: fr.home.passkeyTitle });

/** What the storage does in a private window with blocked site data. */
function storageDenied(): never {
  throw new DOMException("denied", "SecurityError");
}

/** A click of the DOM, which a disabled button ignores (the click of the locator waits for it to be enabled). */
function domClick(locator: { element(): Element }) {
  const element = locator.element();
  if (element instanceof HTMLElement) element.click();
}

// The names of the buttons of a row say which event they are about.
const confirmButton = (screen: Screen, event = "Trail des Crêtes") =>
  screen.getByRole("button", { name: fr.home.confirmFor(event) });
const removeButton = (screen: Screen, event = "Trail des Crêtes") =>
  screen.getByRole("button", { name: fr.home.removeFor(event) });

// ---- À confirmer

test("PendingConfirmations — demande les participations de l'utilisateur à confirmer, avec leur expand", async () => {
  mocks.pending.mockResolvedValue([pendingP2]);

  const { screen, queryClient } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  expect(mocks.pending).toHaveBeenCalledOnce();
  const options = mocks.pending.mock.calls[0]?.[0];
  expect(options?.expand).toBe("format.event,format.race_type,added_by,runner");
  // The user is a parameter of the filter, never written into it.
  expect(options?.filter).toContain("runner.user = {:me} && confirmed = false");
  expect(options?.filter).toContain('"me":"u-bob"');
  // It is the query the participations refresh after a change (`["pending"]`).
  expect(queryClient.getQueryData(["pending"])).toHaveLength(1);
});

test('PendingConfirmations — affiche t.home.addedYou("Alice", "Trail 42 km") pour P2 vu par Bob', async () => {
  mocks.pending.mockResolvedValue([pendingP2]);

  const { screen } = await renderHome();

  await expect.element(pendingBlock(screen)).toBeVisible();
  const line = pendingBlock(screen).getByText(/Alice/);
  expect(plain(line.element().textContent)).toBe(fr.home.addedYou("Alice", "Trail 42 km"));
  // The event is a link to its page, with its day.
  const link = pendingBlock(screen).getByRole("link", { name: "Trail des Crêtes" });
  expect(link.element().getAttribute("href")).toBe("/evenements/event");
  await expect.element(pendingBlock(screen).getByText("dim. 14 juin")).toBeVisible();
});

test("PendingConfirmations — le bloc n'est pas affiché quand il n'y a rien à confirmer", async () => {
  const { screen } = await renderHome();

  await expect.element(upcomingBlock(screen)).toBeVisible();
  await expect.element(screen.getByText(fr.home.pendingTitle)).not.toBeInTheDocument();
});

test("PendingConfirmations — une ligne non confirmée est en pointillés, et le titre du bloc et la phrase le disent en mots", async () => {
  mocks.pending.mockResolvedValue([pendingP2]);

  const { screen } = await renderHome();

  await expect.element(pendingBlock(screen)).toBeVisible();
  const row = pendingBlock(screen).getByRole("listitem");
  expect(getComputedStyle(row.element()).borderStyle).toBe("dashed");
  // An added-by that is gone leaves the words « non confirmé » instead of the sentence.
  expect(row.element().textContent).toContain("Alice");
});

test("PendingConfirmations — sans le coureur qui l'a ajoutée, la ligne dit « non confirmé »", async () => {
  mocks.pending.mockResolvedValue([
    { ...pendingP2, expand: { runner: bobRunner, format: f42Expanded } },
  ]);

  const { screen } = await renderHome();

  await expect.element(pendingBlock(screen)).toBeVisible();
  const row = pendingBlock(screen).getByRole("listitem");
  expect(plain(row.element().textContent)).toContain(`Trail 42 km · ${fr.event.unconfirmed}`);
});

test("PendingConfirmations — Confirmer appelle updateParticipation(P2.id, {confirmed: true})", async () => {
  mocks.pending.mockResolvedValue([pendingP2]);
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  await confirmButton(screen).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p2", { confirmed: true });
  });
  await expect.element(screen.getByText(fr.home.confirmed)).toBeVisible();
});

test("PendingConfirmations — Retirer appelle deleteParticipation(P2.id), sans demander confirmation", async () => {
  mocks.pending.mockResolvedValue([pendingP2]);
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  await removeButton(screen).click();

  await vi.waitFor(() => {
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("p2");
  });
  await expect.element(screen.getByText(fr.home.removed)).toBeVisible();
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
});

test("PendingConfirmations — après un changement, la liste et les événements sont demandés de nouveau", async () => {
  let rows: Rec[] = [pendingP2];
  mocks.pending.mockImplementation(() => Promise.resolve(rows));
  mocks.update.mockImplementation(() => {
    rows = [];
    return Promise.resolve({});
  });
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();
  const eventsBefore = mocks.events.mock.calls.length;

  await confirmButton(screen).click();

  // The row goes away with the new answer of the server, and the lists
  // (here, the events the block of the group is made of) are fresh.
  await expect.element(screen.getByText(fr.home.pendingTitle)).not.toBeInTheDocument();
  expect(mocks.pending).toHaveBeenCalledTimes(2);
  expect(mocks.events.mock.calls.length).toBeGreaterThan(eventsBefore);
});

test("PendingConfirmations — les deux boutons sont désactivés pendant la requête: pas de double envoi", async () => {
  mocks.pending.mockResolvedValue([pendingP2]);
  mocks.update.mockReturnValue(new Promise(() => {}));
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  await confirmButton(screen).click();

  await expect.element(confirmButton(screen)).toBeDisabled();
  await expect.element(removeButton(screen)).toBeDisabled();
  // A second tap, or a click that gets through anyway, changes nothing.
  domClick(confirmButton(screen));
  domClick(removeButton(screen));
  expect(mocks.update).toHaveBeenCalledOnce();
  expect(mocks.remove).not.toHaveBeenCalled();
});

test("PendingConfirmations — Retirer désactive aussi les deux boutons pendant la requête", async () => {
  mocks.pending.mockResolvedValue([pendingP2]);
  mocks.remove.mockReturnValue(new Promise(() => {}));
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  await removeButton(screen).click();

  await expect.element(confirmButton(screen)).toBeDisabled();
  await expect.element(removeButton(screen)).toBeDisabled();
  expect(mocks.remove).toHaveBeenCalledOnce();
});

test("PendingConfirmations — la requête d'une ligne ne bloque pas les autres lignes", async () => {
  mocks.pending.mockResolvedValue([pendingP2, pendingLyon]);
  mocks.update.mockReturnValue(new Promise(() => {}));
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  await confirmButton(screen).click();

  await expect.element(confirmButton(screen)).toBeDisabled();
  await expect.element(confirmButton(screen, "10 km de Lyon")).toBeEnabled();
  await expect.element(removeButton(screen, "10 km de Lyon")).toBeEnabled();
});

test("PendingConfirmations — un échec se dit dans un message, redemande la liste et rend les boutons", async () => {
  mocks.pending.mockResolvedValue([pendingP2]);
  mocks.remove.mockRejectedValue(new Error("network"));
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();
  const eventsBefore = mocks.events.mock.calls.length;

  await removeButton(screen).click();

  await expect.element(screen.getByText(fr.errors.generic)).toBeVisible();
  await expect.element(removeButton(screen)).toBeEnabled();
  await expect.element(confirmButton(screen)).toBeEnabled();
  // The row is still there, and nothing has been announced as done.
  await expect.element(screen.getByText(fr.home.removed)).not.toBeInTheDocument();
  // What the screen shows may be what is wrong: the lists are asked for again.
  expect(mocks.pending).toHaveBeenCalledTimes(2);
  expect(mocks.events.mock.calls.length).toBeGreaterThan(eventsBefore);
});

/** What PocketBase answers for a record that is not there any more. */
function notFound() {
  return new ClientResponseError({
    status: 404,
    response: { status: 404, message: "The requested resource wasn't found.", data: {} },
  });
}

test("PendingConfirmations — Retirer une participation déjà supprimée (404) compte comme réussi: la ligne part et le focus est rendu", async () => {
  let rows: Rec[] = [pendingP2];
  mocks.pending.mockImplementation(() => Promise.resolve(rows));
  // Alice took it back while Bob had the page open.
  mocks.remove.mockImplementation(() => {
    rows = [];
    return Promise.reject(notFound());
  });
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  await removeButton(screen).click();

  // The row is gone from the server already, which is what was asked for.
  await expect.element(screen.getByText(fr.home.removed)).toBeVisible();
  await expect.element(screen.getByText(fr.home.pendingTitle)).not.toBeInTheDocument();
  await expect.element(screen.getByText(fr.errors.not_found)).not.toBeInTheDocument();
  await expect.element(screen.getByText(fr.errors.generic)).not.toBeInTheDocument();
  expect(mocks.pending).toHaveBeenCalledTimes(2);
  expect(mocks.remove).toHaveBeenCalledOnce();
  await expect.element(screen.getByRole("heading", { level: 1, name: fr.nav.home })).toHaveFocus();
});

test("PendingConfirmations — Retirer (404) avec d'autres lignes: le focus va sur le titre du bloc", async () => {
  let rows: Rec[] = [pendingP2, pendingLyon];
  mocks.pending.mockImplementation(() => Promise.resolve(rows));
  mocks.remove.mockImplementation((id) => {
    rows = rows.filter((row) => row.id !== id);
    return Promise.reject(notFound());
  });
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  await removeButton(screen).click();

  await expect
    .element(pendingBlock(screen).getByRole("heading", { level: 2, name: fr.home.pendingTitle }))
    .toHaveFocus();
  await expect.element(removeButton(screen)).not.toBeInTheDocument();
  await expect.element(removeButton(screen, "10 km de Lyon")).toBeEnabled();
});

test("PendingConfirmations — Confirmer une participation supprimée (404) dit « Introuvable », la ligne part après le rafraîchissement, et le focus va au titre de la page", async () => {
  let rows: Rec[] = [pendingP2];
  mocks.pending.mockImplementation(() => Promise.resolve(rows));
  mocks.update.mockImplementation(() => {
    rows = [];
    return Promise.reject(notFound());
  });
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  await confirmButton(screen).click();

  await expect.element(screen.getByText(fr.errors.not_found)).toBeVisible();
  await expect.element(screen.getByText(fr.home.pendingTitle)).not.toBeInTheDocument();
  expect(mocks.pending).toHaveBeenCalledTimes(2);
  // Nothing is announced as confirmed.
  await expect.element(screen.getByText(fr.home.confirmed)).not.toBeInTheDocument();
  // The button that had the focus went with the row: the focus must not fall to the body.
  await expect.element(screen.getByRole("heading", { level: 1, name: fr.nav.home })).toHaveFocus();
});

test("PendingConfirmations — Confirmer (404) avec d'autres lignes: le focus va sur le titre du bloc", async () => {
  let rows: Rec[] = [pendingP2, pendingLyon];
  mocks.pending.mockImplementation(() => Promise.resolve(rows));
  mocks.update.mockImplementation((id) => {
    rows = rows.filter((row) => row.id !== id);
    return Promise.reject(notFound());
  });
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  await confirmButton(screen).click();

  await expect
    .element(pendingBlock(screen).getByRole("heading", { level: 2, name: fr.home.pendingTitle }))
    .toHaveFocus();
  await expect.element(confirmButton(screen)).not.toBeInTheDocument();
});

test("PendingConfirmations — une autre erreur de Confirmer qui laisse la ligne partir au rafraîchissement rend aussi le focus", async () => {
  // The server answered with a failure, but the participation has changed in the meantime.
  let rows: Rec[] = [pendingP2];
  mocks.pending.mockImplementation(() => Promise.resolve(rows));
  mocks.update.mockImplementation(() => {
    rows = [];
    return Promise.reject(new Error("network"));
  });
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  await confirmButton(screen).click();

  await expect.element(screen.getByText(fr.errors.generic)).toBeVisible();
  await expect.element(screen.getByText(fr.home.pendingTitle)).not.toBeInTheDocument();
  await expect.element(screen.getByRole("heading", { level: 1, name: fr.nav.home })).toHaveFocus();
});

test("PendingConfirmations — une autre erreur de Retirer qui laisse la ligne partir au rafraîchissement rend aussi le focus", async () => {
  let rows: Rec[] = [pendingP2, pendingLyon];
  mocks.pending.mockImplementation(() => Promise.resolve(rows));
  mocks.remove.mockImplementation((id) => {
    rows = rows.filter((row) => row.id !== id);
    return Promise.reject(new Error("network"));
  });
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  await removeButton(screen).click();

  await expect.element(screen.getByText(fr.errors.generic)).toBeVisible();
  await expect.element(removeButton(screen)).not.toBeInTheDocument();
  await expect
    .element(pendingBlock(screen).getByRole("heading", { level: 2, name: fr.home.pendingTitle }))
    .toHaveFocus();
});

test("PendingConfirmations — après un échec qui laisse la ligne, le bouton pressé reprend le focus que sa désactivation lui avait pris", async () => {
  mocks.pending.mockResolvedValue([pendingP2]);
  // A real request takes longer than a frame: the browser drops the focus of a
  // button that is disabled (to the body) once it has had the time to.
  mocks.update.mockImplementation(
    () => new Promise((_, reject) => setTimeout(() => reject(new Error("network")), 150)),
  );
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  await confirmButton(screen).click();

  await expect.element(screen.getByText(fr.errors.generic)).toBeVisible();
  await expect.element(confirmButton(screen)).toBeEnabled();
  await expect.element(confirmButton(screen)).toHaveFocus();
});

test("PendingConfirmations — le focus n'est pas repris au bouton si l'utilisateur est allé ailleurs", async () => {
  let answers = 0;
  const refreshed = Promise.withResolvers<void>();
  mocks.pending.mockImplementation(async () => {
    answers += 1;
    // The refresh that follows the failure waits for the test.
    if (answers > 1) await refreshed.promise;
    return [pendingP2];
  });
  mocks.update.mockRejectedValue(new Error("network"));
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  await confirmButton(screen).click();
  await vi.waitFor(() => {
    expect(mocks.pending).toHaveBeenCalledTimes(2);
  });
  // While the lists load, the user moves to the link of the event.
  const link = pendingBlock(screen).getByRole("link", { name: "Trail des Crêtes" });
  const element = link.element();
  if (element instanceof HTMLElement) element.focus();
  refreshed.resolve();

  await expect.element(confirmButton(screen)).toBeEnabled();
  await expect.element(link).toHaveFocus();
});

test("PendingConfirmations — pendant le rafraîchissement qui suit un échec, les boutons restent désactivés", async () => {
  let answers = 0;
  mocks.pending.mockImplementation(() => {
    answers += 1;
    // The first answer is the first load; the second one, after the failure, never comes.
    return answers === 1 ? Promise.resolve([pendingP2]) : new Promise(() => {});
  });
  mocks.update.mockRejectedValue(new Error("network"));
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  await confirmButton(screen).click();

  await expect.element(screen.getByText(fr.errors.generic)).toBeVisible();
  await vi.waitFor(() => {
    expect(mocks.pending).toHaveBeenCalledTimes(2);
  });
  await expect.element(confirmButton(screen)).toBeDisabled();
  await expect.element(removeButton(screen)).toBeDisabled();
});

test("PendingConfirmations — après Retirer, le focus va sur le titre « À confirmer », qui reste", async () => {
  let rows: Rec[] = [pendingP2, pendingLyon];
  mocks.pending.mockImplementation(() => Promise.resolve(rows));
  mocks.remove.mockImplementation((id) => {
    rows = rows.filter((row) => row.id !== id);
    return Promise.resolve(true);
  });
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  await removeButton(screen).click();

  await expect
    .element(pendingBlock(screen).getByRole("heading", { level: 2, name: fr.home.pendingTitle }))
    .toHaveFocus();
  expect(document.activeElement?.textContent).toBe(fr.home.pendingTitle);
  // The other row is still there.
  await expect.element(removeButton(screen, "10 km de Lyon")).toBeVisible();
  await expect.element(removeButton(screen)).not.toBeInTheDocument();
});

test("PendingConfirmations — après Confirmer, le focus va aussi sur le titre « À confirmer »", async () => {
  let rows: Rec[] = [pendingP2, pendingLyon];
  mocks.pending.mockImplementation(() => Promise.resolve(rows));
  mocks.update.mockImplementation((id) => {
    rows = rows.filter((row) => row.id !== id);
    return Promise.resolve({});
  });
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  await confirmButton(screen).click();

  await expect.element(pendingBlock(screen).getByRole("heading", { level: 2 })).toHaveFocus();
});

test("PendingConfirmations — retirer la dernière ligne fait disparaître le bloc, et le focus va au titre de la page", async () => {
  let rows: Rec[] = [pendingP2];
  mocks.pending.mockImplementation(() => Promise.resolve(rows));
  mocks.remove.mockImplementation(() => {
    rows = [];
    return Promise.resolve(true);
  });
  const { screen } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  await removeButton(screen).click();

  await expect.element(screen.getByText(fr.home.pendingTitle)).not.toBeInTheDocument();
  await expect.element(screen.getByRole("heading", { level: 1, name: fr.nav.home })).toHaveFocus();
  expect(document.activeElement).not.toBe(document.body);
});

test("PendingConfirmations — une erreur de chargement se signale et se retente", async () => {
  mocks.pending.mockRejectedValueOnce(new Error("network"));
  mocks.pending.mockResolvedValue([pendingP2]);
  const { screen } = await renderHome();

  const alert = screen.getByRole("alert");
  await expect.element(alert).toHaveTextContent(fr.errors.generic);
  await screen.getByRole("button", { name: fr.common.retry }).click();

  await expect.element(pendingBlock(screen)).toBeVisible();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});

// ---- Mes prochaines courses

test("MyUpcoming — affiche « dans 45 jours » pour F42", async () => {
  signIn("alice");

  const { screen } = await renderHome();

  await expect.element(upcomingBlock(screen)).toBeVisible();
  const row = upcomingBlock(screen).getByRole("listitem");
  await expect.element(row.getByText("dans 45 jours")).toBeVisible();
  await expect.element(row.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();
  expect(plain(row.element().textContent)).toContain("Trail 42 km");
  expect(row.element().textContent).toContain(fr.status.registered);
});

test("MyUpcoming — ne garde que mes participations, triées par date effective", async () => {
  signIn("alice");
  // Alice is on F42 (the 14th) and on F15 (no date of its own: the 13th), and
  // on the 10 km of Lyon (the 22nd), which the server may give first.
  const lyonWithAlice = withParticipations(event2Record, [
    { ...p1, id: "p-lyon", event: "event2", format: "fLyon", expand: { runner: aliceRunner } },
  ]);
  const trailWithAlice = withParticipations(eventRecord, [
    {
      ...p3,
      id: "p-15",
      runner: aliceRunner.id,
      confirmed: true,
      expand: { runner: aliceRunner },
    },
  ]);
  mocks.events.mockResolvedValue([lyonWithAlice, trailWithAlice]);

  const { screen } = await renderHome();

  await expect.element(upcomingBlock(screen)).toBeVisible();
  const rows = upcomingBlock(screen).getByRole("listitem");
  await expect.element(rows.first()).toBeVisible();
  expect(rows.elements().map((row) => plain(row.textContent))).toEqual([
    expect.stringContaining("dans 44 jours"),
    expect.stringContaining("dans 45 jours"),
    expect.stringContaining("dans 53 jours"),
  ]);
  // Not Bob's, not Sam's.
  expect(upcomingBlock(screen).element().textContent).not.toContain("Bob");
});

test("MyUpcoming — une participation que je n'ai pas confirmée est dite « non confirmé », en pointillés", async () => {
  // Bob, on F42, added by Alice.
  const { screen } = await renderHome();

  await expect.element(upcomingBlock(screen)).toBeVisible();
  const row = upcomingBlock(screen).getByRole("listitem");
  expect(row.element().textContent).toContain(fr.event.unconfirmed);
  expect(getComputedStyle(row.element()).borderStyle).toBe("dashed");
});

test("MyUpcoming — « aujourd’hui » le jour de l'épreuve, et pas les épreuves déjà passées d'un événement en cours", async () => {
  signIn("alice");
  // The event lasts from the 13th to the 14th of June: on the 14th, F15 (the
  // 13th) is behind, F42 is today.
  const aliceOnBoth = withParticipations(eventRecord, [
    { ...p1, id: "p-15", format: "f15", expand: { runner: aliceRunner } },
  ]);
  mocks.events.mockResolvedValue([aliceOnBoth]);

  const { screen } = await renderHome({ today: "2026-06-14" });

  await expect.element(upcomingBlock(screen)).toBeVisible();
  const rows = upcomingBlock(screen).getByRole("listitem");
  expect(rows.elements()).toHaveLength(1);
  await expect.element(rows.getByText("aujourd’hui")).toBeVisible();
  expect(plain(rows.element().textContent)).toContain("Trail 42 km");
});

test("MyUpcoming — un état vide quand je n'ai aucune course à venir", async () => {
  signIn("alice");
  mocks.events.mockResolvedValue([{ ...event2Record }]);

  const { screen } = await renderHome();

  await expect.element(upcomingBlock(screen).getByText(fr.home.upcomingEmpty)).toBeVisible();
});

// ---- Bientôt dans le groupe

test("GroupSoon — les événements qui ont au moins une participation, avec leurs pastilles", async () => {
  const { screen } = await renderHome();

  await expect.element(groupBlock(screen)).toBeVisible();
  const cards = groupBlock(screen).getByRole("article");
  expect(cards.elements()).toHaveLength(1);
  await expect.element(cards.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();
  // The 10 km of Lyon has nobody on it.
  await expect.element(groupBlock(screen).getByText("10 km de Lyon")).not.toBeInTheDocument();
  await expect
    .element(cards.getByRole("list", { name: fr.event.participants }).first())
    .toBeVisible();
});

test("GroupSoon — les 5 prochains, du plus proche au plus lointain", async () => {
  // Seven events, from the farthest to the nearest, each with a runner on it.
  const manyEvents = Array.from({ length: 7 }, (_, i) => {
    const day = String(20 - i).padStart(2, "0");
    return {
      ...event2Record,
      id: `ev${i}`,
      name: `Course ${day}`,
      start_date: `2026-06-${day}`,
      expand: {
        formats_via_event: [{ ...fLyon, id: `fv${i}`, event: `ev${i}` }],
        participations_via_event: [{ ...p1, id: `pv${i}`, event: `ev${i}`, format: `fv${i}` }],
      },
    };
  });
  mocks.events.mockResolvedValue(manyEvents);

  const { screen } = await renderHome();

  await expect.element(groupBlock(screen)).toBeVisible();
  const names = groupBlock(screen)
    .getByRole("heading", { level: 3 })
    .elements()
    .map((heading) => heading.textContent);
  expect(names).toEqual(["Course 14", "Course 15", "Course 16", "Course 17", "Course 18"]);
});

test("GroupSoon — un état vide quand personne n'est inscrit", async () => {
  mocks.events.mockResolvedValue([event2Record]);

  const { screen } = await renderHome();

  await expect.element(groupBlock(screen).getByText(fr.home.groupEmpty)).toBeVisible();
});

test("HomePage — demande les événements à venir une seule fois pour les deux blocs", async () => {
  const { screen } = await renderHome();
  await expect.element(groupBlock(screen)).toBeVisible();

  expect(mocks.events).toHaveBeenCalledOnce();
  expect(mocks.events.mock.calls[0]?.[0]?.filter).toContain(`"t":"${TODAY}"`);
  expect(mocks.events.mock.calls[0]?.[0]?.filter).toContain("start_date >= {:t}");
});

test("HomePage — une erreur de chargement des événements se signale et se retente", async () => {
  mocks.events.mockRejectedValueOnce(new Error("network"));
  const { screen } = await renderHome();

  const alert = screen.getByRole("alert");
  await expect.element(alert).toHaveTextContent(fr.errors.generic);
  await screen.getByRole("button", { name: fr.common.retry }).click();

  await expect.element(groupBlock(screen)).toBeVisible();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});

test("HomePage — en attendant les événements, « Chargement… »", async () => {
  mocks.events.mockReturnValue(new Promise(() => {}));
  const { screen } = await renderHome();

  await expect.element(screen.getByText(fr.common.loading)).toBeVisible();
  await expect.element(screen.getByRole("heading", { level: 1, name: fr.nav.home })).toBeVisible();
});

// ---- Bandeau « Ajoute une clé d'accès »

test("PasskeyBanner — propose d'ajouter une clé quand je n'en ai aucune, avec un lien vers le profil", async () => {
  mocks.passkeys.mockResolvedValue(noPasskey);

  const { screen } = await renderHome();

  await expect.element(banner(screen)).toBeVisible();
  const link = banner(screen).getByRole("link", { name: fr.home.passkeyLink });
  expect(link.element().getAttribute("href")).toBe("/profil");
  // Only my own keys count, one is enough to know: an admin sees them all.
  expect(mocks.passkeys).toHaveBeenCalledOnce();
  const [pageNumber, perPage, options] = mocks.passkeys.mock.calls[0] ?? [];
  expect([pageNumber, perPage]).toEqual([1, 1]);
  expect(options?.filter).toContain("user = {:me}");
  expect(options?.filter).toContain('"me":"u-bob"');
});

test("PasskeyBanner — n'est pas affichée quand j'ai déjà une clé", async () => {
  mocks.passkeys.mockResolvedValue(onePasskey);

  const { screen } = await renderHome();

  await vi.waitFor(() => {
    expect(mocks.passkeys).toHaveBeenCalled();
  });
  await expect.element(upcomingBlock(screen)).toBeVisible();
  await expect.element(screen.getByText(fr.home.passkeyTitle)).not.toBeInTheDocument();
});

test("PasskeyBanner — n'est pas affichée quand le navigateur n'a pas les clés d'accès", async () => {
  mocks.passkeys.mockResolvedValue(noPasskey);
  vi.stubGlobal("PublicKeyCredential", undefined);

  const { screen } = await renderHome();

  await expect.element(upcomingBlock(screen)).toBeVisible();
  await expect.element(screen.getByText(fr.home.passkeyTitle)).not.toBeInTheDocument();
  // No need to ask the server either.
  expect(mocks.passkeys).not.toHaveBeenCalled();
});

test("PasskeyBanner — ne dit rien quand la requête des clés échoue", async () => {
  mocks.passkeys.mockRejectedValue(new Error("network"));

  const { screen } = await renderHome();

  await vi.waitFor(() => {
    expect(mocks.passkeys).toHaveBeenCalled();
  });
  await expect.element(upcomingBlock(screen)).toBeVisible();
  await expect.element(screen.getByText(fr.home.passkeyTitle)).not.toBeInTheDocument();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});

test("PasskeyBanner — disparaît après « Masquer » et reste masquée au rendu suivant", async () => {
  mocks.passkeys.mockResolvedValue(noPasskey);
  const get = vi.spyOn(navigator.credentials, "get");
  const create = vi.spyOn(navigator.credentials, "create");
  const first = await renderHome();
  await expect.element(banner(first.screen)).toBeVisible();

  await banner(first.screen).getByRole("button", { name: fr.home.passkeyDismiss }).click();

  await expect.element(first.screen.getByText(fr.home.passkeyTitle)).not.toBeInTheDocument();
  expect(localStorage.getItem(DISMISSED_KEY)).not.toBeNull();
  // The banner never touches WebAuthn: it only sends to the profile.
  expect(get).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();

  // The next time the home page is shown, it stays hidden.
  await first.screen.unmount();
  mocks.passkeys.mockClear();
  const second = await renderHome();
  await expect.element(upcomingBlock(second.screen)).toBeVisible();
  await expect.element(second.screen.getByText(fr.home.passkeyTitle)).not.toBeInTheDocument();
  expect(mocks.passkeys).not.toHaveBeenCalled();
});

test("PasskeyBanner — « Masquer » donne le focus au titre de la page, qui reste", async () => {
  mocks.passkeys.mockResolvedValue(noPasskey);
  const { screen } = await renderHome();
  await expect.element(banner(screen)).toBeVisible();

  await banner(screen).getByRole("button", { name: fr.home.passkeyDismiss }).click();

  await expect.element(screen.getByRole("heading", { level: 1, name: fr.nav.home })).toHaveFocus();
});

test("PasskeyBanner — marche quand le stockage du navigateur lève une erreur (lecture et écriture)", async () => {
  mocks.passkeys.mockResolvedValue(noPasskey);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(storageDenied);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(storageDenied);
  const { screen } = await renderHome();

  // Reading failed: the banner is there, as if it had never been hidden.
  await expect.element(banner(screen)).toBeVisible();

  // Writing fails too: it still goes away for this visit.
  await banner(screen).getByRole("button", { name: fr.home.passkeyDismiss }).click();

  await expect.element(screen.getByText(fr.home.passkeyTitle)).not.toBeInTheDocument();
  await expect.element(screen.getByRole("heading", { level: 1, name: fr.nav.home })).toBeVisible();
});

// ---- La page

test("HomePage — les blocs ont chacun leur titre, sous le titre de la page", async () => {
  mocks.pending.mockResolvedValue([pendingP2]);
  mocks.passkeys.mockResolvedValue(noPasskey);

  const { screen } = await renderHome();

  await expect.element(groupBlock(screen)).toBeVisible();
  await expect.element(pendingBlock(screen)).toBeVisible();
  await expect.element(banner(screen)).toBeVisible();
  const titles = screen
    .getByRole("heading", { level: 2 })
    .elements()
    .map((heading) => heading.textContent);
  expect(titles).toEqual([
    fr.home.passkeyTitle,
    fr.home.pendingTitle,
    fr.home.upcomingTitle,
    fr.home.groupTitle,
  ]);
  await expect.element(screen.getByRole("heading", { level: 1, name: fr.nav.home })).toBeVisible();
});

test("HomePage — en anglais, les textes et le décompte suivent la langue", async () => {
  mocks.pending.mockResolvedValue([pendingP2]);

  const { screen } = await renderHome({ languages: ["en-GB"] });

  await expect.element(screen.getByRole("heading", { level: 2, name: "To confirm" })).toBeVisible();
  const line = screen.getByRole("region", { name: "To confirm" }).getByText(/Alice/);
  expect(plain(line.element().textContent)).toBe("Alice added you to “Trail 42 km”");
  await expect.element(screen.getByText("in 45 days")).toBeVisible();
  await expect
    .element(screen.getByRole("heading", { level: 2, name: "Upcoming races" }))
    .toBeVisible();
});

test("HomePage — zones tactiles d'au moins 44 px", async () => {
  await page.viewport(390, 844);
  mocks.pending.mockResolvedValue([pendingP2]);
  mocks.passkeys.mockResolvedValue(noPasskey);
  const { screen } = await renderHome();
  await expect.element(banner(screen)).toBeVisible();
  await expect.element(pendingBlock(screen)).toBeVisible();

  const targets = [
    confirmButton(screen),
    removeButton(screen),
    pendingBlock(screen).getByRole("link", { name: "Trail des Crêtes" }),
    banner(screen).getByRole("link", { name: fr.home.passkeyLink }),
    banner(screen).getByRole("button", { name: fr.home.passkeyDismiss }),
    upcomingBlock(screen).getByRole("link", { name: "Trail des Crêtes" }),
    groupBlock(screen).getByRole("link", { name: "Trail des Crêtes" }),
  ];
  for (const target of targets) {
    const { width, height } = target.element().getBoundingClientRect();
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
  }
  await page.viewport(414, 896);
});
