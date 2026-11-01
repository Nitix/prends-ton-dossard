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
import { en } from "../../i18n/en";
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
  ninaRunner,
  p1,
  p2,
  p3,
  pNinaSupporter,
  pNinaUndecided,
  roadType,
  trailType,
  withParticipations,
  withStatus,
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
// event, and, when it has one, its format with the race type of the format.
const f42Expanded = { ...f42, expand: { race_type: trailType } };
const fLyonExpanded = { ...fLyon, expand: { race_type: roadType } };

/** Bob, added by Alice on F42. */
const pendingP2 = {
  ...p2,
  expand: { runner: bobRunner, added_by: aliceRunner, event: eventRecord, format: f42Expanded },
};
/** Bob again, added by Alice on the 10 km of Lyon. */
const pendingLyon = {
  ...p2,
  id: "p-lyon",
  event: "event2",
  format: "fLyon",
  expand: { runner: bobRunner, added_by: aliceRunner, event: event2Record, format: fLyonExpanded },
};
/** Bob, added by Alice on the event alone: no format yet. */
const pendingUndecided = {
  ...p2,
  id: "p-undecided",
  format: "",
  expand: { runner: bobRunner, added_by: aliceRunner, event: eventRecord },
};

const users = {
  alice: { id: "u-alice", collectionName: "users", role: "member", runner: aliceRunner },
  bob: { id: "u-bob", collectionName: "users", role: "member", runner: bobRunner },
  nina: { id: "u-nina", collectionName: "users", role: "member", runner: ninaRunner },
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

test("PendingConfirmations — demande les participations avec l'expand event,format.race_type,added_by,runner", async () => {
  mocks.pending.mockResolvedValue([pendingP2]);

  const { screen, queryClient } = await renderHome();
  await expect.element(pendingBlock(screen)).toBeVisible();

  expect(mocks.pending).toHaveBeenCalledOnce();
  const options = mocks.pending.mock.calls[0]?.[0];
  expect(options?.expand).toBe("event,format.race_type,added_by,runner");
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
    { ...pendingP2, expand: { runner: bobRunner, event: eventRecord, format: f42Expanded } },
  ]);

  const { screen } = await renderHome();

  await expect.element(pendingBlock(screen)).toBeVisible();
  const row = pendingBlock(screen).getByRole("listitem");
  expect(plain(row.element().textContent)).toContain(`Trail 42 km · ${fr.event.unconfirmed}`);
});

test("PendingConfirmations — une participation sans épreuve : nom de l'événement, date de début et « Format à choisir »", async () => {
  mocks.pending.mockResolvedValue([pendingUndecided]);

  const { screen } = await renderHome();

  await expect.element(pendingBlock(screen)).toBeVisible();
  const block = pendingBlock(screen);
  // The event stands where the name of the format stood.
  const line = block.getByText(/Alice/);
  expect(plain(line.element().textContent)).toBe(fr.home.addedYou("Alice", "Trail des Crêtes"));
  // The day is the start of the event (the event runs from the 13th to the 14th).
  await expect.element(block.getByText("sam. 13 juin", { exact: true })).toBeVisible();
  await expect.element(block.getByText("dim. 14 juin")).not.toBeInTheDocument();
  await expect.element(block.getByText(fr.event.formatToChoose, { exact: true })).toBeVisible();
  const link = block.getByRole("link", { name: "Trail des Crêtes" });
  expect(link.element().getAttribute("href")).toBe("/evenements/event");

  await confirmButton(screen).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p-undecided", { confirmed: true });
  });
  await expect.element(screen.getByText(fr.home.confirmed)).toBeVisible();
});

test("PendingConfirmations — une participation sans épreuve, dont on ne sait plus qui l'a ajoutée, dit « non confirmé »", async () => {
  mocks.pending.mockResolvedValue([
    { ...pendingUndecided, expand: { runner: bobRunner, event: eventRecord } },
  ]);

  const { screen } = await renderHome();

  await expect.element(pendingBlock(screen)).toBeVisible();
  const row = pendingBlock(screen).getByRole("listitem");
  expect(plain(row.element().textContent)).toContain(`Trail des Crêtes · ${fr.event.unconfirmed}`);
  await expect.element(row.getByText(fr.event.formatToChoose, { exact: true })).toBeVisible();
});

test("PendingConfirmations — une participation supporter affiche « Supporteur »", async () => {
  // Bob, added by Alice as a supporter of the event: no format to pick, so no « Format à choisir ».
  mocks.pending.mockResolvedValue([{ ...pendingUndecided, status: "supporter" }]);

  const { screen } = await renderHome();

  await expect.element(pendingBlock(screen)).toBeVisible();
  const row = pendingBlock(screen).getByRole("listitem");
  await expect.element(row.getByText(fr.status.supporter, { exact: true })).toBeVisible();
  await expect.element(row.getByText(fr.event.formatToChoose)).not.toBeInTheDocument();
  // It is dealt with as any other: the sentence names the event, and Confirmer confirms it.
  const line = row.getByText(/Alice/);
  expect(plain(line.element().textContent)).toBe(fr.home.addedYou("Alice", "Trail des Crêtes"));

  await confirmButton(screen).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p-undecided", { confirmed: true });
  });
});

test("PendingConfirmations — une participation à une épreuve n'a pas de ligne « Format à choisir »", async () => {
  mocks.pending.mockResolvedValue([pendingP2]);

  const { screen } = await renderHome();

  await expect.element(pendingBlock(screen)).toBeVisible();
  await expect.element(screen.getByText(fr.event.formatToChoose)).not.toBeInTheDocument();
});

test("PendingConfirmations — en anglais, une participation sans épreuve dit « Race to pick »", async () => {
  mocks.pending.mockResolvedValue([pendingUndecided]);

  const { screen } = await renderHome({ languages: ["en-GB"] });

  const block = screen.getByRole("region", { name: en.home.pendingTitle });
  await expect.element(block).toBeVisible();
  const line = block.getByText(/Alice/);
  expect(plain(line.element().textContent)).toBe(en.home.addedYou("Alice", "Trail des Crêtes"));
  await expect.element(block.getByText("Race to pick", { exact: true })).toBeVisible();
});

test("PendingConfirmations — une réponse dont l'événement manque fait échouer le bloc", async () => {
  mocks.pending.mockResolvedValue([
    { ...pendingUndecided, expand: { runner: bobRunner, added_by: aliceRunner } },
  ]);

  const { screen } = await renderHome();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await expect.element(pendingBlock(screen)).not.toBeInTheDocument();
});

test("PendingConfirmations — une réponse dont l'épreuve annoncée est incomplète fait échouer le bloc", async () => {
  // The participation says it is on a format, but the race type of the format is missing.
  mocks.pending.mockResolvedValue([
    {
      ...pendingP2,
      expand: { runner: bobRunner, event: eventRecord, format: { ...f42, expand: {} } },
    },
  ]);

  const { screen } = await renderHome();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await expect.element(pendingBlock(screen)).not.toBeInTheDocument();
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

// ---- Inscriptions à faire

const todoBlock = (screen: Screen) => screen.getByRole("region", { name: fr.home.todoTitle });
const todoRows = (screen: Screen) => todoBlock(screen).getByRole("listitem");
const doneButton = (row: ReturnType<typeof todoRows>) =>
  row.getByRole("button", { name: fr.home.todoDone });

/** The event with a registration deadline, and the address of its official site. */
function withDeadline<E extends object>(event: E, deadline: string, url = "") {
  return { ...event, registration_deadline: deadline, registration_url: url };
}

/** Bob, interested (and confirmed: he added himself) in the 10 km of Lyon. */
const bobLyon = {
  ...p2,
  id: "p-lyon",
  event: "event2",
  format: "fLyon",
  confirmed: true,
  added_by: bobRunner.id,
  expand: { runner: bobRunner },
};

/** The trail (deadline 10 June, Bob on F42) and Lyon (deadline 20 May, Bob on its 10 km). */
const trailAndLyon = () => [
  withDeadline(eventRecord, "2026-06-10"),
  withParticipations(withDeadline(event2Record, "2026-05-20"), [bobLyon]),
];

test("Inscriptions à faire — mes participations intéressées, triées par date limite", async () => {
  // Bob is interested on F42 and on the 10 km of Lyon, whose deadline comes
  // first, though the server gives the trail first. Alice has registered and
  // Sam is interested: not Bob's.
  mocks.events.mockResolvedValue(trailAndLyon());

  const { screen } = await renderHome();

  await expect.element(todoBlock(screen)).toBeVisible();
  const rows = todoRows(screen);
  await expect.element(rows.first()).toBeVisible();
  expect(rows.elements().map((row) => row.querySelector("h3")?.textContent)).toEqual([
    "10 km de Lyon",
    "Trail des Crêtes",
  ]);
  const [lyon, trail] = rows.elements().map((row) => plain(row.textContent));
  expect(lyon).toContain("Route 10 km");
  expect(lyon).toContain("avant le mer. 20 mai");
  expect(lyon).toContain("dans 20 jours");
  expect(trail).toContain("Trail 42 km");
  expect(trail).toContain("avant le mer. 10 juin");
  expect(trail).toContain("dans 41 jours");
  expect(todoBlock(screen).element().textContent).not.toContain("Trail 15 km");
  // The event is a link to its page.
  const link = todoBlock(screen).getByRole("link", { name: "Trail des Crêtes" });
  expect(link.element().getAttribute("href")).toBe("/evenements/event");
  // Each row has « Je suis inscrit »; the site is not known here, so no « S'inscrire ».
  expect(doneButton(rows).elements()).toHaveLength(2);
  await expect
    .element(todoBlock(screen).getByRole("link", { name: fr.home.todoRegister }))
    .not.toBeInTheDocument();
});

test("Inscriptions à faire — le bloc est entre « À confirmer » et « Mes prochaines courses »", async () => {
  mocks.pending.mockResolvedValue([pendingP2]);
  mocks.events.mockResolvedValue(trailAndLyon());

  const { screen } = await renderHome();

  await expect.element(todoBlock(screen)).toBeVisible();
  await expect.element(pendingBlock(screen)).toBeVisible();
  const titles = screen
    .getByRole("heading", { level: 2 })
    .elements()
    .map((heading) => heading.textContent);
  expect(titles).toEqual([
    fr.home.pendingTitle,
    fr.home.todoTitle,
    fr.home.upcomingTitle,
    fr.home.groupTitle,
  ]);
});

test("Inscriptions à faire — le jour de la date limite, « aujourd'hui »", async () => {
  // Review Focus 2: on the day of the deadline one can still register.
  mocks.events.mockResolvedValue([withDeadline(eventRecord, "2026-06-10")]);

  const { screen } = await renderHome({ today: "2026-06-10" });

  await expect.element(todoBlock(screen)).toBeVisible();
  const row = todoRows(screen);
  await expect.element(row.getByText("aujourd’hui")).toBeVisible();
  expect(plain(row.element().textContent)).toContain("avant le mer. 10 juin");
});

test("Inscriptions à faire — une participation sans épreuve affiche « Format à choisir », sans « Je suis inscrit »", async () => {
  signIn("nina");
  mocks.events.mockResolvedValue([
    withParticipations(withDeadline(eventRecord, "2026-06-10", "https://example.org/inscription"), [
      pNinaUndecided,
    ]),
  ]);

  const { screen } = await renderHome();

  await expect.element(todoBlock(screen)).toBeVisible();
  const row = todoRows(screen);
  await expect.element(row.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();
  expect(plain(row.element().textContent)).toContain(fr.event.formatToChoose);
  expect(plain(row.element().textContent)).toContain("dans 41 jours");
  // There is no format to say one is registered for: the page of the event
  // is where one chooses it. The official site is still one tap away.
  await expect.element(doneButton(row)).not.toBeInTheDocument();
  await expect.element(row.getByRole("link", { name: fr.home.todoRegister })).toBeVisible();
});

test("Inscriptions à faire — « Je suis inscrit » passe la participation en Inscrit, la ligne disparaît et le focus va sur un titre", async () => {
  let events: { expand: object }[] = trailAndLyon();
  mocks.events.mockImplementation(() => Promise.resolve(events));
  mocks.update.mockImplementation((id, body) => {
    events = events.map((event) => withStatus(event, id, String(body.status)));
    return Promise.resolve({});
  });
  const { screen } = await renderHome();
  await expect.element(todoBlock(screen)).toBeVisible();
  const eventsAsked = mocks.events.mock.calls.length;

  // Lyon is the first row, and its button the first.
  await doneButton(todoRows(screen).first()).click();

  expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p-lyon", { status: "registered" });
  // The events are asked for again, and the row is gone.
  await expect
    .element(todoBlock(screen).getByRole("link", { name: "10 km de Lyon" }))
    .not.toBeInTheDocument();
  expect(mocks.events.mock.calls.length).toBeGreaterThan(eventsAsked);
  // The other row is still there, and the title of the block has the focus.
  await expect
    .element(todoBlock(screen).getByRole("link", { name: "Trail des Crêtes" }))
    .toBeVisible();
  await expect
    .element(todoBlock(screen).getByRole("heading", { level: 2, name: fr.home.todoTitle }))
    .toHaveFocus();

  // The last row takes the block with it: the focus goes to the title of the page.
  await doneButton(todoRows(screen)).click();

  expect(mocks.update).toHaveBeenLastCalledWith("p2", { status: "registered" });
  await expect.element(screen.getByText(fr.home.todoTitle)).not.toBeInTheDocument();
  await expect.element(screen.getByRole("heading", { level: 1, name: fr.nav.home })).toHaveFocus();
  expect(document.activeElement).not.toBe(document.body);
});

test("Inscriptions à faire — « Je suis inscrit » refusé : message, événements redemandés, la ligne reste et le bouton reprend le focus", async () => {
  mocks.events.mockResolvedValue([withDeadline(eventRecord, "2026-06-10")]);
  // A real request takes longer than a frame: the browser drops the focus of a
  // button that is disabled once it has had the time to.
  mocks.update.mockImplementation(
    () => new Promise((_, reject) => setTimeout(() => reject(new Error("network")), 150)),
  );
  const { screen } = await renderHome();
  await expect.element(todoBlock(screen)).toBeVisible();
  const eventsAsked = mocks.events.mock.calls.length;

  await doneButton(todoRows(screen)).click();

  await expect.element(screen.getByText(fr.errors.generic)).toBeVisible();
  await expect.element(doneButton(todoRows(screen))).toBeEnabled();
  await expect.element(doneButton(todoRows(screen))).toHaveFocus();
  // What the screen shows may be what is wrong: the events are asked for again.
  expect(mocks.events.mock.calls.length).toBeGreaterThan(eventsAsked);
});

test("Inscriptions à faire — « Je suis inscrit » sur une participation supprimée (404) : « Introuvable », la ligne part et le focus va au titre de la page", async () => {
  let events: { expand: object }[] = [withDeadline(eventRecord, "2026-06-10")];
  mocks.events.mockImplementation(() => Promise.resolve(events));
  mocks.update.mockImplementation(() => {
    // Somebody deleted it meanwhile.
    events = [eventRecord];
    return Promise.reject(
      new ClientResponseError({
        status: 404,
        response: { status: 404, message: "The requested resource wasn't found.", data: {} },
      }),
    );
  });
  const { screen } = await renderHome();
  await expect.element(todoBlock(screen)).toBeVisible();

  await doneButton(todoRows(screen)).click();

  await expect.element(screen.getByText(fr.errors.not_found)).toBeVisible();
  await expect.element(screen.getByText(fr.home.todoTitle)).not.toBeInTheDocument();
  await expect.element(screen.getByRole("heading", { level: 1, name: fr.nav.home })).toHaveFocus();
});

test("Inscriptions à faire — « S'inscrire » ouvre le site officiel dans un nouvel onglet", async () => {
  // The address of the second event is not a web address: no link for it.
  mocks.events.mockResolvedValue([
    withDeadline(eventRecord, "2026-06-10", "https://example.org/inscription?course=42"),
    withParticipations(withDeadline(event2Record, "2026-06-12", "javascript:alert(1)"), [bobLyon]),
  ]);

  const { screen } = await renderHome();

  await expect.element(todoBlock(screen)).toBeVisible();
  const links = todoBlock(screen).getByRole("link", { name: fr.home.todoRegister });
  await expect.element(links).toBeVisible();
  expect(links.elements()).toHaveLength(1);
  const link = links.element();
  expect(link.getAttribute("href")).toBe("https://example.org/inscription?course=42");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  // It is in the row of the trail (deadline the 10th), the first.
  const trail = todoRows(screen).first();
  await expect.element(trail.getByRole("link", { name: fr.home.todoRegister })).toBeVisible();
  expect(trail.element().querySelector("h3")?.textContent).toBe("Trail des Crêtes");
});

test("Inscriptions à faire — pas de bloc sans rien à faire", async () => {
  // Bob has registered on the trail, is not starting the 10 km of Lyon, and
  // is interested in an event whose deadline has passed.
  const lyonDns = { ...bobLyon, status: "dns" };
  const paris = {
    ...event2Record,
    id: "event3",
    name: "Marathon de Paris",
    start_date: "2026-06-20",
    expand: { formats_via_event: [{ ...fLyon, id: "fParis", event: "event3" }] },
  };
  const parisClosed = { ...bobLyon, id: "p-paris", event: "event3", format: "fParis" };
  mocks.events.mockResolvedValue([
    withDeadline(withStatus(eventRecord, "p2", "registered"), "2026-06-10"),
    withParticipations(withDeadline(event2Record, "2026-05-20"), [lyonDns]),
    withParticipations(withDeadline(paris, "2026-04-29"), [parisClosed]),
  ]);

  const { screen } = await renderHome();

  await expect.element(upcomingBlock(screen)).toBeVisible();
  await expect.element(screen.getByText(fr.home.todoTitle)).not.toBeInTheDocument();
});

test("Inscriptions à faire — en anglais, les textes et le décompte suivent la langue", async () => {
  mocks.events.mockResolvedValue(trailAndLyon());

  const { screen } = await renderHome({ languages: ["en-GB"] });

  const block = screen.getByRole("region", { name: "Registrations to do" });
  await expect.element(block).toBeVisible();
  const rows = block.getByRole("listitem");
  await expect.element(rows.first()).toBeVisible();
  const first = plain(rows.first().element().textContent);
  expect(first).toContain("in 20 days");
  expect(first).toContain(en.home.todoBefore("Wed 20 May"));
  expect(en.home.todoBefore("Wed 20 May")).toBe("by Wed 20 May");
  await expect.element(rows.first().getByRole("button", { name: "I'm registered" })).toBeVisible();
});

test("Inscriptions à faire — zones tactiles d'au moins 44 px", async () => {
  await page.viewport(390, 844);
  mocks.events.mockResolvedValue([
    withDeadline(eventRecord, "2026-06-10", "https://example.org/inscription"),
  ]);
  const { screen } = await renderHome();
  await expect.element(todoBlock(screen)).toBeVisible();

  const targets = [
    todoBlock(screen).getByRole("link", { name: "Trail des Crêtes" }),
    todoBlock(screen).getByRole("link", { name: fr.home.todoRegister }),
    doneButton(todoRows(screen)),
  ];
  for (const target of targets) {
    const { width, height } = target.element().getBoundingClientRect();
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
  }
  await page.viewport(414, 896);
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

test("MyUpcoming — une participation sans épreuve compte, à la date de début de l'événement, avec « Format à choisir »", async () => {
  signIn("nina");
  mocks.events.mockResolvedValue([withParticipations(eventRecord, [pNinaUndecided])]);

  const { screen } = await renderHome();

  await expect.element(upcomingBlock(screen)).toBeVisible();
  const row = upcomingBlock(screen).getByRole("listitem");
  await expect.element(row.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();
  // The event starts on the 13th of June: 44 days after the 30th of April.
  await expect.element(row.getByText("dans 44 jours")).toBeVisible();
  await expect.element(row.getByText("sam. 13 juin", { exact: true })).toBeVisible();
  const text = plain(row.element().textContent);
  expect(text).toContain(`${fr.event.formatToChoose} · ${fr.status.interested}`);
  // Nina added herself: nothing to confirm.
  expect(text).not.toContain(fr.event.unconfirmed);
  expect(getComputedStyle(row.element()).borderStyle).toBe("solid");
});

test("MyUpcoming — les épreuves et les événements sans épreuve sont triés ensemble par date", async () => {
  signIn("alice");
  // Alice is on F42 (the 14th) and on the 10 km of Lyon (the 22nd), and
  // interested in an event of the 20th with no format yet.
  const alicesLyon = {
    ...p1,
    id: "p-lyon",
    event: "event2",
    format: "fLyon",
    expand: { runner: aliceRunner },
  };
  const parisUndecided = {
    ...pNinaUndecided,
    id: "p-paris",
    runner: aliceRunner.id,
    event: "event3",
    added_by: aliceRunner.id,
    expand: { runner: aliceRunner, added_by: aliceRunner },
  };
  const paris = {
    ...event2Record,
    id: "event3",
    name: "Marathon de Paris",
    start_date: "2026-06-20",
    expand: { formats_via_event: [{ ...fLyon, id: "fParis", event: "event3" }] },
  };
  mocks.events.mockResolvedValue([
    withParticipations(event2Record, [alicesLyon]),
    withParticipations(paris, [parisUndecided]),
    eventRecord,
  ]);

  const { screen } = await renderHome();

  await expect.element(upcomingBlock(screen)).toBeVisible();
  const rows = upcomingBlock(screen).getByRole("listitem");
  await expect.element(rows.first()).toBeVisible();
  expect(rows.elements().map((row) => plain(row.textContent))).toEqual([
    expect.stringContaining("dans 45 jours"),
    expect.stringContaining("dans 51 jours"),
    expect.stringContaining("dans 53 jours"),
  ]);
  expect(rows.elements().map((row) => row.querySelector("h3")?.textContent)).toEqual([
    "Trail des Crêtes",
    "Marathon de Paris",
    "10 km de Lyon",
  ]);
});

test("MyUpcoming — une participation sans épreuve d'un événement déjà commencé n'y est plus", async () => {
  signIn("nina");
  // The event runs from the 13th to the 14th of June: on the 14th it has started.
  mocks.events.mockResolvedValue([withParticipations(eventRecord, [pNinaUndecided])]);

  const { screen } = await renderHome({ today: "2026-06-14" });

  await expect.element(upcomingBlock(screen).getByText(fr.home.upcomingEmpty)).toBeVisible();
});

test("MyUpcoming — mes participations « Non partant » n'y sont pas", async () => {
  signIn("alice");
  mocks.events.mockResolvedValue([withStatus(eventRecord, "p1", "dns")]);

  const { screen } = await renderHome();

  await expect.element(upcomingBlock(screen).getByText(fr.home.upcomingEmpty)).toBeVisible();
  await expect.element(upcomingBlock(screen).getByRole("listitem")).not.toBeInTheDocument();
});

test("MyUpcoming — une participation supporter compte, à la date de début de l'événement, avec « Supporteur »", async () => {
  signIn("nina");
  mocks.events.mockResolvedValue([withParticipations(eventRecord, [pNinaSupporter])]);

  const { screen } = await renderHome();

  await expect.element(upcomingBlock(screen)).toBeVisible();
  const row = upcomingBlock(screen).getByRole("listitem");
  await expect.element(row.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();
  // The event starts on the 13th of June: 44 days after the 30th of April.
  await expect.element(row.getByText("dans 44 jours")).toBeVisible();
  await expect.element(row.getByText("sam. 13 juin", { exact: true })).toBeVisible();
  // The status alone: a supporter has no format to choose.
  await expect.element(row.getByText(fr.status.supporter, { exact: true })).toBeVisible();
  const text = plain(row.element().textContent);
  expect(text).not.toContain(fr.event.formatToChoose);
  expect(text).not.toContain(" · ");
  // Nina added herself: nothing to confirm.
  expect(text).not.toContain(fr.event.unconfirmed);
  expect(getComputedStyle(row.element()).borderStyle).toBe("solid");
});

test("MyUpcoming — une participation supporter que je n'ai pas confirmée est dite « non confirmé », en pointillés", async () => {
  signIn("nina");
  mocks.events.mockResolvedValue([
    withParticipations(eventRecord, [{ ...pNinaSupporter, confirmed: false }]),
  ]);

  const { screen } = await renderHome();

  const row = upcomingBlock(screen).getByRole("listitem");
  await expect.element(row.getByText(fr.event.unconfirmed)).toBeVisible();
  expect(getComputedStyle(row.element()).borderStyle).toBe("dashed");
});

test("MyUpcoming — un supporteur est trié avec les épreuves, à la date de début de l'événement", async () => {
  signIn("alice");
  // Alice is on F42 (the 14th), and supports an event of the 20th, with no format of hers.
  const parisSupporter = {
    ...pNinaSupporter,
    id: "p-paris",
    runner: aliceRunner.id,
    event: "event3",
    added_by: aliceRunner.id,
    expand: { runner: aliceRunner, added_by: aliceRunner },
  };
  const paris = {
    ...event2Record,
    id: "event3",
    name: "Marathon de Paris",
    start_date: "2026-06-20",
    expand: { formats_via_event: [{ ...fLyon, id: "fParis", event: "event3" }] },
  };
  mocks.events.mockResolvedValue([withParticipations(paris, [parisSupporter]), eventRecord]);

  const { screen } = await renderHome();

  const rows = upcomingBlock(screen).getByRole("listitem");
  await expect.element(rows.first()).toBeVisible();
  expect(rows.elements().map((row) => row.querySelector("h3")?.textContent)).toEqual([
    "Trail des Crêtes",
    "Marathon de Paris",
  ]);
  expect(plain(rows.elements()[1]?.textContent ?? "")).toContain("dans 51 jours");
});

test("MyUpcoming — un supporteur d'un événement déjà commencé n'y est plus", async () => {
  signIn("nina");
  // The event runs from the 13th to the 14th of June: on the 14th it has started.
  mocks.events.mockResolvedValue([withParticipations(eventRecord, [pNinaSupporter])]);

  const { screen } = await renderHome({ today: "2026-06-14" });

  await expect.element(upcomingBlock(screen).getByText(fr.home.upcomingEmpty)).toBeVisible();
});

test("MyUpcoming — en anglais, une participation supporter dit « Supporter »", async () => {
  signIn("nina");
  mocks.events.mockResolvedValue([withParticipations(eventRecord, [pNinaSupporter])]);

  const { screen } = await renderHome({ languages: ["en-GB"] });

  const row = screen.getByRole("region", { name: en.home.upcomingTitle }).getByRole("listitem");
  await expect.element(row.getByText("Supporter", { exact: true })).toBeVisible();
  expect(plain(row.element().textContent)).not.toContain(en.event.formatToChoose);
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

test("GroupSoon — un événement dont les seuls participants sont non partants n'est pas proposé", async () => {
  // Alice, Bob and Sam, none of whom starts.
  mocks.events.mockResolvedValue([
    withStatus(withStatus(withStatus(eventRecord, "p1", "dns"), "p2", "dns"), "p3", "dns"),
  ]);

  const { screen } = await renderHome();

  await expect.element(groupBlock(screen).getByText(fr.home.groupEmpty)).toBeVisible();
  await expect.element(groupBlock(screen).getByRole("article")).not.toBeInTheDocument();
});

test("GroupSoon — un événement avec un seul partant parmi des non partants est proposé, sans la pastille des non partants", async () => {
  mocks.events.mockResolvedValue([withStatus(withStatus(eventRecord, "p2", "dns"), "p3", "dns")]);

  const { screen } = await renderHome();

  const card = groupBlock(screen).getByRole("article");
  await expect.element(card.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();
  await expect.element(card.getByText("Alice", { exact: true })).toBeInTheDocument();
  await expect.element(card.getByText("Bob", { exact: true })).not.toBeInTheDocument();
  await expect.element(card.getByText("Sam", { exact: true })).not.toBeInTheDocument();
});

test("GroupSoon — un événement avec seulement des intéressés sans épreuve est proposé", async () => {
  mocks.events.mockResolvedValue([
    withParticipations(event2Record, [{ ...pNinaUndecided, event: "event2" }]),
  ]);

  const { screen } = await renderHome();

  const card = groupBlock(screen).getByRole("article");
  await expect.element(card.getByRole("link", { name: "10 km de Lyon" })).toBeVisible();
  await expect.element(card.getByText(fr.event.formatToChoose, { exact: true })).toBeVisible();
  await expect
    .element(card.getByRole("list", { name: fr.event.interestedTitle }).getByText("Nina"))
    .toBeInTheDocument();
  await expect.element(groupBlock(screen).getByText(fr.home.groupEmpty)).not.toBeInTheDocument();
});

test("GroupSoon — un événement dont les seuls participants sont supporteurs n'est pas proposé", async () => {
  // Nina only comes to cheer: nobody starts anything.
  mocks.events.mockResolvedValue([
    withParticipations(event2Record, [{ ...pNinaSupporter, event: "event2" }]),
  ]);

  const { screen } = await renderHome();

  await expect.element(groupBlock(screen).getByText(fr.home.groupEmpty)).toBeVisible();
  await expect.element(groupBlock(screen).getByRole("article")).not.toBeInTheDocument();
});

test("GroupSoon — un événement avec un partant et un supporteur est proposé, avec la ligne Supporteurs", async () => {
  mocks.events.mockResolvedValue([withParticipations(eventRecord, [pNinaSupporter])]);

  const { screen } = await renderHome();

  const card = groupBlock(screen).getByRole("article");
  await expect.element(card.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();
  await expect.element(card.getByText(fr.event.supportersTitle, { exact: true })).toBeVisible();
  await expect
    .element(card.getByRole("list", { name: fr.event.supportersTitle }).getByText("Nina"))
    .toBeInTheDocument();
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
