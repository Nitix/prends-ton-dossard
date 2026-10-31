import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from "@tanstack/react-router";
import { ClientResponseError } from "pocketbase";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ToastProvider } from "../../components/Toast";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { EventPage } from "./EventPage";
import {
  aliceRunner,
  bobRunner,
  event2Record,
  eventRecord,
  f42,
  p1,
  samRunner,
  trailType,
} from "./testFixture";

// The tap targets and the dashes are a matter of the styles, which are not
// loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  user: null as Rec | null,
  getOne: vi.fn<(id: string, options: Rec) => Promise<unknown>>(),
  eventDelete: vi.fn<(id: string) => Promise<unknown>>(),
  runners: vi.fn<(options?: Rec) => Promise<unknown>>(),
  myRunner: vi.fn<(filter: string) => Promise<unknown>>(),
  create: vi.fn<(body: Rec) => Promise<unknown>>(),
  update: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
  remove: vi.fn<(id: string) => Promise<unknown>>(),
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
        events: { getOne: mocks.getOne, delete: mocks.eventDelete },
        runners: { getFullList: mocks.runners, getFirstListItem: mocks.myRunner },
        participations: { create: mocks.create, update: mocks.update, delete: mocks.remove },
      })[name],
  },
}));

const base = { created: "", updated: "", collectionId: "", collectionName: "" };

// Alice wrote the event; Bob is a member; the admin is a runner of the group too.
const adminRunner = { ...base, id: "adminRunner0000", name: "Admin", user: "u-admin" };
const newRunner = { ...base, id: "newRunner00000", name: "Nina", user: "u-nina" };

const users = {
  alice: { id: "u-alice", collectionName: "users", role: "member", runner: aliceRunner },
  bob: { id: "u-bob", collectionName: "users", role: "member", runner: bobRunner },
  admin: { id: "u-admin", collectionName: "users", role: "admin", runner: adminRunner },
  nina: { id: "u-nina", collectionName: "users", role: "member", runner: newRunner },
};

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(() => {
  for (const fn of [
    mocks.getOne,
    mocks.eventDelete,
    mocks.runners,
    mocks.myRunner,
    mocks.create,
    mocks.update,
    mocks.remove,
  ]) {
    fn.mockReset();
  }
  mocks.getOne.mockResolvedValue(eventRecord);
  mocks.runners.mockResolvedValue([aliceRunner, bobRunner, samRunner, adminRunner, newRunner]);
  mocks.create.mockResolvedValue({ id: "new" });
  mocks.update.mockResolvedValue({});
  mocks.remove.mockResolvedValue(true);
  mocks.eventDelete.mockResolvedValue(true);
  signIn("alice");
});

function signIn(who: keyof typeof users) {
  const { runner, ...user } = users[who];
  mocks.user = user;
  mocks.myRunner.mockResolvedValue(runner);
}

/** The page, as the route of the app gives it its `id`. */
function Routed() {
  const { id } = useParams({ strict: false });
  return <EventPage id={id ?? ""} />;
}

async function renderPage(
  options: {
    event?: Rec;
    /** The answer of the server to the request of the event, when it is an error, or none. */
    answer?: "pending" | Error;
    languages?: string[];
    id?: string;
  } = {},
) {
  const { event = eventRecord, answer, languages = ["fr"], id = String(event.id) } = options;
  if (answer === "pending") mocks.getOne.mockReturnValue(new Promise(() => {}));
  else if (answer) mocks.getOne.mockRejectedValue(answer);
  else mocks.getOne.mockResolvedValue(event);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: Outlet });
  const page = createRoute({
    getParentRoute: () => root,
    path: "/evenements/$id",
    component: Routed,
  });
  const edit = createRoute({
    getParentRoute: () => root,
    path: "/evenements/$id/modifier",
    component: () => <p>Page de modification</p>,
  });
  const list = createRoute({
    getParentRoute: () => root,
    path: "/liste",
    component: () => <p>Page de la liste</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([page, edit, list]),
    history: createMemoryHistory({ initialEntries: [`/evenements/${id}`] }),
  });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { screen, router, queryClient };
}

type Screen = Awaited<ReturnType<typeof renderPage>>["screen"];

/** Waits for the event to be on the page. */
async function loaded(screen: Screen, name = "Trail des Crêtes") {
  await expect.element(screen.getByRole("heading", { level: 1, name })).toBeVisible();
}

// Intl separates a number from its unit with a no-break space: tests read the
// text as it looks.
const plain = (s: string | null) => (s ?? "").replace(/\p{Zs}/gu, " ");

const format = (screen: Screen, name: RegExp) => screen.getByRole("region", { name });
// The row of a runner: the list item that starts with their name (and not the
// ones that only say "ajouté par Alice").
const row = (screen: Screen, runner: string) =>
  screen.getByRole("listitem").filter({ hasText: new RegExp(`^${runner}`) });
const menuOf = (screen: Screen, runner: string) =>
  screen.getByRole("button", { name: fr.participation.actionsFor(runner) });

// --- The information ---

test("EventPage — montre le nom, les dates, le lieu et les notes de l'événement", async () => {
  const { screen } = await renderPage({
    event: { ...eventRecord, notes: "Parking à l'arrivée.\nNavette à 7h." },
  });

  await loaded(screen);
  await expect.element(screen.getByText("du sam. 13 juin 2026 au dim. 14 juin 2026")).toBeVisible();
  await expect.element(screen.getByText("Annecy")).toBeVisible();
  const notes = screen.getByText(/Parking à l'arrivée\./);
  await expect.element(notes).toBeVisible();
  // The line break of the notes is kept.
  expect(notes.element().textContent).toContain("\n");
  expect(getComputedStyle(notes.element()).whiteSpace).toBe("pre-line");
});

test("EventPage — un événement d'un jour n'a qu'une date, et sans notes il n'en montre pas", async () => {
  const { screen } = await renderPage({ event: event2Record });

  await loaded(screen, "10 km de Lyon");
  await expect.element(screen.getByText("lun. 22 juin 2026")).toBeVisible();
  expect(screen.container.textContent).not.toContain("du ");
});

test("EventPage — en anglais, les dates et les textes suivent la langue", async () => {
  const { screen } = await renderPage({ languages: ["en-GB"] });

  await loaded(screen);
  await expect.element(screen.getByText("Sat, 13 Jun 2026 to Sun, 14 Jun 2026")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "I'm in" })).toBeVisible();
});

// --- The registration link ---

test("EventPage — le lien d'inscription s'ouvre dans un autre onglet, sans donner l'accès à la page", async () => {
  const { screen } = await renderPage({
    event: { ...eventRecord, registration_url: "https://inscriptions.example.test/trail?x=1" },
  });

  await loaded(screen);
  const link = screen.getByRole("link", { name: fr.event.register });
  await expect.element(link).toBeVisible();
  await expect.element(link).toHaveAttribute("href", "https://inscriptions.example.test/trail?x=1");
  await expect.element(link).toHaveAttribute("target", "_blank");
  const rel = link.element().getAttribute("rel") ?? "";
  expect(rel.split(" ")).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
  expect(link.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});

test("EventPage — sans adresse d'inscription, pas de lien", async () => {
  const { screen } = await renderPage();

  await loaded(screen);
  await expect
    .element(screen.getByRole("link", { name: fr.event.register }))
    .not.toBeInTheDocument();
});

test("EventPage — une adresse qui n'est pas http(s) n'est jamais un lien", async () => {
  const { screen } = await renderPage({
    event: { ...eventRecord, registration_url: "javascript:alert(1)" },
  });

  await loaded(screen);
  await expect
    .element(screen.getByRole("link", { name: fr.event.register }))
    .not.toBeInTheDocument();
});

// --- The formats and their participants ---

test("EventPage — chaque épreuve a son titre (type, mesures), dans l'ordre des jours, et dit son jour", async () => {
  const { screen } = await renderPage();
  await loaded(screen);

  const titles = screen
    .getByRole("heading", { level: 2 })
    .elements()
    .map((element) => plain(element.textContent));
  expect(titles).toEqual(["Trail 15 km · 700 m D+", "Trail 42 km · 2 400 m D+ · max 10h"]);
  await expect.element(format(screen, /^Trail 15/).getByText("sam. 13 juin")).toBeVisible();
  await expect.element(format(screen, /^Trail 42/).getByText("dim. 14 juin")).toBeVisible();
});

test("EventPage — les participants sont nommés, avec leur statut", async () => {
  const { screen } = await renderPage();
  await loaded(screen);

  const f42Section = format(screen, /^Trail 42/);
  await expect.element(f42Section.getByText("Alice", { exact: true })).toBeVisible();
  await expect.element(row(screen, "Alice").getByText(fr.status.registered)).toBeVisible();
  await expect.element(f42Section.getByText("Bob", { exact: true })).toBeVisible();
  await expect.element(row(screen, "Bob").getByText(fr.status.interested)).toBeVisible();
  await expect.element(format(screen, /^Trail 15/).getByText("Sam", { exact: true })).toBeVisible();
});

test("EventPage — une participation non confirmée dit « ajouté par X · non confirmé », et pas seulement en pointillés", async () => {
  const { screen } = await renderPage();
  await loaded(screen);

  await expect
    .element(row(screen, "Bob").getByText("ajouté par Alice · non confirmé"))
    .toBeVisible();
  await expect
    .element(row(screen, "Sam").getByText("ajouté par Alice · non confirmé"))
    .toBeVisible();
  // Alice confirmed her own: nothing to say.
  expect(row(screen, "Alice").element().textContent).not.toContain("non confirmé");
  expect(row(screen, "Alice").element().textContent).not.toContain("ajouté par");
  // And the border is dashed for the one that is not confirmed.
  expect(getComputedStyle(row(screen, "Bob").element()).borderStyle).toBe("dashed");
  expect(getComputedStyle(row(screen, "Alice").element()).borderStyle).toBe("solid");
});

test("EventPage — la mention porte le nom de qui a ajouté, et « non confirmé » seul si on ne le sait plus", async () => {
  const orphan = {
    ...f42,
    expand: {
      ...f42.expand,
      participations_via_format: [
        {
          ...f42.expand.participations_via_format[0],
          id: "pOrphan",
          expand: { runner: bobRunner },
        },
      ],
    },
  };
  const { screen } = await renderPage({
    event: { ...eventRecord, expand: { formats_via_event: [orphan] } },
  });

  await loaded(screen);
  await expect.element(row(screen, "Bob").getByText(fr.event.unconfirmed)).toBeVisible();
  expect(row(screen, "Bob").element().textContent).not.toContain("ajouté par");
});

test("EventPage — une épreuve sans participant le dit", async () => {
  const { screen } = await renderPage({ event: event2Record });

  await loaded(screen, "10 km de Lyon");
  await expect.element(screen.getByText(fr.event.nobody)).toBeVisible();
});

// --- The actions of the page ---

test("EventPage — Alice, auteur de l'événement : J'y vais, Ajouter quelqu'un, Modifier et Supprimer", async () => {
  const { screen } = await renderPage();
  await loaded(screen);

  await expect.element(screen.getByRole("button", { name: fr.participation.join })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: fr.participation.addSomeone }))
    .toBeVisible();
  const edit = screen.getByRole("link", { name: fr.common.edit });
  await expect.element(edit).toHaveAttribute("href", "/evenements/event/modifier");
  await expect.element(screen.getByRole("button", { name: fr.common.delete })).toBeVisible();
});

test("EventPage — Bob, qui n'est pas l'auteur, n'a pas Supprimer mais le reste", async () => {
  signIn("bob");
  const { screen } = await renderPage();
  await loaded(screen);

  await expect.element(screen.getByRole("button", { name: fr.participation.join })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: fr.participation.addSomeone }))
    .toBeVisible();
  await expect.element(screen.getByRole("link", { name: fr.common.edit })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: fr.common.delete }))
    .not.toBeInTheDocument();
});

test("EventPage — l'admin peut supprimer l'événement des autres", async () => {
  signIn("admin");
  const { screen } = await renderPage();
  await loaded(screen);

  await expect.element(screen.getByRole("button", { name: fr.common.delete })).toBeVisible();
});

test("EventPage — tant que son coureur n'est pas connu, on ne propose que Modifier", async () => {
  mocks.myRunner.mockReturnValue(new Promise(() => {}));
  const { screen } = await renderPage();
  await loaded(screen);

  await expect.element(screen.getByRole("link", { name: fr.common.edit })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: fr.participation.join }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: fr.participation.addSomeone }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: fr.common.delete }))
    .not.toBeInTheDocument();
});

test("EventPage — un événement sans épreuve n'a ni J'y vais ni Ajouter quelqu'un", async () => {
  const { screen } = await renderPage({
    event: { ...eventRecord, expand: { formats_via_event: [] } },
  });
  await loaded(screen);

  await expect
    .element(screen.getByRole("button", { name: fr.participation.join }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: fr.participation.addSomeone }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByRole("link", { name: fr.common.edit })).toBeVisible();
});

test("EventPage — les boutons d'action font au moins 44 px", async () => {
  const { screen } = await renderPage();
  await loaded(screen);

  for (const element of [
    screen.getByRole("button", { name: fr.participation.join }),
    screen.getByRole("button", { name: fr.participation.addSomeone }),
    screen.getByRole("link", { name: fr.common.edit }),
    screen.getByRole("button", { name: fr.common.delete }),
  ]) {
    expect(element.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
});

// --- Who gets a menu on a participation ---

test("EventPage — Alice : un menu sur sa participation et sur celles, non confirmées, de Bob et de Sam", async () => {
  const { screen } = await renderPage();
  await loaded(screen);

  await expect.element(menuOf(screen, "Alice")).toBeVisible();
  await expect.element(menuOf(screen, "Bob")).toBeVisible();
  await expect.element(menuOf(screen, "Sam")).toBeVisible();
});

test("EventPage — Bob : pas de menu sur la participation confirmée d'Alice, mais sur la sienne et sur celle de Sam", async () => {
  signIn("bob");
  const { screen } = await renderPage();
  await loaded(screen);
  await expect.element(menuOf(screen, "Bob")).toBeVisible();

  await expect.element(menuOf(screen, "Alice")).not.toBeInTheDocument();
  await expect.element(menuOf(screen, "Sam")).toBeVisible();
});

test("EventPage — Nina, sur aucune épreuve : rien sur la participation confirmée d'Alice", async () => {
  signIn("nina");
  const { screen } = await renderPage();
  await loaded(screen);
  await expect.element(menuOf(screen, "Bob")).toBeVisible();

  await expect.element(menuOf(screen, "Alice")).not.toBeInTheDocument();
});

test("EventPage — l'admin a un menu sur toutes les participations", async () => {
  signIn("admin");
  const { screen } = await renderPage();
  await loaded(screen);

  await expect.element(menuOf(screen, "Alice")).toBeVisible();
  await expect.element(menuOf(screen, "Bob")).toBeVisible();
  await expect.element(menuOf(screen, "Sam")).toBeVisible();
});

test("EventPage — Confirmer n'apparaît que pour Bob lui-même, sur sa participation non confirmée", async () => {
  signIn("bob");
  const { screen } = await renderPage();
  await loaded(screen);

  // Bob's own: he can confirm it.
  await menuOf(screen, "Bob").click();
  await expect.element(screen.getByRole("button", { name: fr.common.confirm })).toBeVisible();
  await screen.getByRole("button", { name: fr.common.confirm }).click();
  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p2", { confirmed: true });
  });
});

test("EventPage — l'admin ne peut pas confirmer à la place de Bob", async () => {
  signIn("admin");
  const { screen } = await renderPage();
  await loaded(screen);

  await menuOf(screen, "Bob").click();

  await expect.element(screen.getByRole("button", { name: fr.status.finished })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: fr.common.confirm }))
    .not.toBeInTheDocument();
});

// --- The dialogs ---

test("EventPage — J'y vais ouvre le dialogue de ma participation", async () => {
  const { screen } = await renderPage();
  await loaded(screen);

  await screen.getByRole("button", { name: fr.participation.join }).click();

  const dialog = screen.getByRole("dialog", { name: fr.participation.joinTitle });
  await expect.element(dialog).toBeVisible();
  // Alice is on F42 already: the dialog is about that participation.
  await expect.element(dialog.getByLabelText(fr.participation.format)).toHaveValue("f42");
});

test("EventPage — Ajouter quelqu'un ouvre le dialogue qui choisit le coureur", async () => {
  const { screen } = await renderPage();
  await loaded(screen);

  await screen.getByRole("button", { name: fr.participation.addSomeone }).click();

  const dialog = screen.getByRole("dialog", { name: fr.participation.addSomeoneTitle });
  await expect.element(dialog).toBeVisible();
  await expect.element(dialog.getByLabelText(fr.participation.runner)).toBeVisible();
});

test("EventPage — Supprimer ouvre la confirmation, qui cite les participants", async () => {
  const { screen } = await renderPage();
  await loaded(screen);

  await screen.getByRole("button", { name: fr.common.delete }).click();

  const dialog = screen.getByRole("dialog", { name: fr.event.deleteTitle });
  await expect.element(dialog).toBeVisible();
  await expect.element(dialog.getByText("Alice, Bob et Sam")).toBeVisible();
});

test("EventPage — supprimer l'événement renvoie vers la liste", async () => {
  const { screen, router } = await renderPage();
  await loaded(screen);
  await screen.getByRole("button", { name: fr.common.delete }).click();

  await screen
    .getByRole("dialog", { name: fr.event.deleteTitle })
    .getByRole("button", { name: fr.common.delete })
    .click();

  await vi.waitFor(() => {
    expect(router.state.location.pathname).toBe("/liste");
  });
  expect(mocks.eventDelete).toHaveBeenCalledExactlyOnceWith("event");
});

test("EventPage — après J'y vais, la page recharge l'événement et montre la nouvelle participation", async () => {
  signIn("nina");
  const { screen } = await renderPage();
  await loaded(screen);
  expect(mocks.getOne).toHaveBeenCalledTimes(1);
  const nina = {
    ...base,
    id: "pNina",
    runner: newRunner.id,
    format: "f42",
    status: "registered",
    confirmed: true,
    added_by: newRunner.id,
    expand: { runner: newRunner, added_by: newRunner },
  };
  mocks.getOne.mockResolvedValue({
    ...eventRecord,
    expand: {
      formats_via_event: [
        {
          ...f42,
          expand: {
            race_type: trailType,
            participations_via_format: [...f42.expand.participations_via_format, nina],
          },
        },
        eventRecord.expand.formats_via_event[1],
      ],
    },
  });

  await screen.getByRole("button", { name: fr.participation.join }).click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.joinTitle });
  await dialog.getByLabelText(fr.participation.format).selectOptions("f42");
  await dialog.getByLabelText(fr.participation.status).selectOptions("registered");
  await dialog.getByRole("button", { name: fr.common.save }).click();

  await expect.element(row(screen, "Nina")).toBeVisible();
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    runner: newRunner.id,
    format: "f42",
    status: "registered",
  });
  expect(mocks.getOne).toHaveBeenCalledTimes(2);
  await expect.element(dialog).not.toBeInTheDocument();
});

// --- Where the focus goes ---

const focused = () => document.activeElement;

async function openRemovalDialog(screen: Screen, runner: string) {
  await menuOf(screen, runner).click();
  await screen.getByRole("button", { name: fr.common.remove }).click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.removeTitle });
  await expect.element(dialog).toBeVisible();
  return dialog;
}

test("EventPage — annuler un retrait rend le focus au bouton du menu de la ligne", async () => {
  const { screen } = await renderPage();
  await loaded(screen);
  const dialog = await openRemovalDialog(screen, "Bob");

  await dialog.getByRole("button", { name: fr.common.cancel }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  await vi.waitFor(() => {
    expect(focused()).toBe(menuOf(screen, "Bob").element());
  });
});

test("EventPage — après un retrait réussi, la ligne disparaît et le focus va au titre de l'épreuve", async () => {
  const { screen } = await renderPage();
  await loaded(screen);
  // Once Bob is removed, the server no longer has his participation.
  mocks.remove.mockImplementation(() => {
    mocks.getOne.mockResolvedValue({
      ...eventRecord,
      expand: {
        formats_via_event: [
          { ...f42, expand: { ...f42.expand, participations_via_format: [p1] } },
          eventRecord.expand.formats_via_event[1],
        ],
      },
    });
    return Promise.resolve(true);
  });
  const dialog = await openRemovalDialog(screen, "Bob");

  await dialog.getByRole("button", { name: fr.common.remove }).click();

  await expect.element(menuOf(screen, "Bob")).not.toBeInTheDocument();
  await expect.element(dialog).not.toBeInTheDocument();
  const heading = screen.getByRole("heading", { level: 2, name: /^Trail 42/ });
  await vi.waitFor(() => {
    expect(focused()).toBe(heading.element());
  });
});

// --- Loading and failures ---

test("EventPage — pendant le chargement, elle le dit", async () => {
  const { screen } = await renderPage({ answer: "pending" });

  await expect.element(screen.getByText(fr.common.loading)).toBeVisible();
});

test("EventPage — un événement introuvable (404) le dit", async () => {
  const { screen } = await renderPage({
    answer: new ClientResponseError({
      status: 404,
      response: { status: 404, message: "The requested resource wasn't found.", data: {} },
    }),
    id: "gone",
  });

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.not_found);
});

test("EventPage — une autre erreur donne le message générique, et on peut réessayer", async () => {
  const { screen } = await renderPage({ answer: new TypeError("Failed to fetch") });
  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);

  mocks.getOne.mockResolvedValue(eventRecord);
  await screen.getByRole("button", { name: fr.common.retry }).click();

  await loaded(screen);
});
