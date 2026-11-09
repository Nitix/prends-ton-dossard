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
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ToastProvider } from "../../components/Toast";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";
import { fontsReady } from "../../test/fontsReady";
import { pixelURL } from "../../test/images";
import { EventPage } from "./EventPage";
import {
  aliceRunner,
  bobRunner,
  event2Record,
  eventRecord,
  f15,
  f42,
  fLyon,
  ninaRunner,
  p1,
  p2,
  p3,
  pNinaSupporter,
  pNinaUndecided,
  roadType,
  samRunner,
  trailType,
  withParticipations,
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
  getURL: vi.fn<(record: Rec, filename: string, options: Rec) => string>(),
  // The weather of the event, a custom route: only asked for in the days before the race.
  send: vi.fn<(path: string, options: Rec) => Promise<unknown>>(),
  // The comments at the bottom of the page: it only asks for the list of the event.
  comments: {
    getFullList: vi.fn<(options: Rec) => Promise<unknown>>(),
    getList: vi.fn<(page: number, perPage: number, options: Rec) => Promise<unknown>>(),
    create: vi.fn<(body: Rec) => Promise<unknown>>(),
    update: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
    delete: vi.fn<(id: string) => Promise<unknown>>(),
  },
  // The carpooling and the lodging, before the comments: the offers of the event, and the places taken in them.
  offers: {
    getFullList: vi.fn<(options: Rec) => Promise<unknown>>(),
    delete: vi.fn<(id: string) => Promise<unknown>>(),
  },
  offerMembers: {
    create: vi.fn<(body: Rec) => Promise<unknown>>(),
    delete: vi.fn<(id: string) => Promise<unknown>>(),
  },
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
        comments: mocks.comments,
        offers: mocks.offers,
        offer_members: mocks.offerMembers,
      })[name],
    // Only called for a runner who has a photo: none has, unless a test says so.
    files: { getURL: mocks.getURL },
    send: mocks.send,
  },
}));

// The map of a track is the real one, with blank tiles: no test asks a tile server for a tile.
vi.mock("../route/TrackMap", async (importOriginal) => {
  const { blankTileModule } = await import("../../test/tiles");
  return blankTileModule(importOriginal);
});

const base = { created: "", updated: "", collectionId: "", collectionName: "" };

// Alice wrote the event; Bob is a member; the admin is a runner of the group too.
const adminRunner = { ...base, id: "adminRunner0000", name: "Admin", user: "u-admin" };
// Nina, a member who is on none of the formats of the fixture.
const newRunner = ninaRunner;

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
    mocks.getURL,
    mocks.send,
    ...Object.values(mocks.comments),
    ...Object.values(mocks.offers),
    ...Object.values(mocks.offerMembers),
  ]) {
    fn.mockReset();
  }
  mocks.comments.getFullList.mockResolvedValue([]);
  mocks.offers.getFullList.mockResolvedValue([]);
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

/** The day of the tests, unless one says otherwise: nine days before the deadline of the 10th. */
const TODAY = "2026-06-01";

/** The day of the 42 km, the second day of the event: every race of the event has started. */
const RACE_DAY = "2026-06-14";

/** The page, as the route of the app gives it its `id`. */
function Routed() {
  const { id } = useParams({ strict: false });
  return <EventPage id={id ?? ""} />;
}

async function renderPage(
  options: {
    event?: Rec;
    /** The answer of the server to the request of the event, when it is an error or a pending one, or none. */
    answer?: "pending" | Error | Promise<unknown>;
    languages?: string[];
    id?: string;
    /** The `YYYY-MM-DD` day it is: the event of the fixture is on 13 and 14 June. */
    today?: string;
  } = {},
) {
  const {
    event = eventRecord,
    answer,
    languages = ["fr"],
    id = String(event.id),
    today = TODAY,
  } = options;
  if (answer === "pending") mocks.getOne.mockReturnValue(new Promise(() => {}));
  else if (answer instanceof Promise) mocks.getOne.mockReturnValue(answer);
  else if (answer) mocks.getOne.mockRejectedValue(answer);
  else mocks.getOne.mockResolvedValue(event);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: Outlet });
  const eventPage = createRoute({
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
  const runnerPage = createRoute({
    getParentRoute: () => root,
    path: "/coureurs/$id",
    component: () => <p>Page d'un coureur</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([eventPage, edit, list, runnerPage]),
    history: createMemoryHistory({ initialEntries: [`/evenements/${id}`] }),
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
// The row of a runner: the list item that has their name on a line of its own
// (and not the ones that only say "ajouté par Alice"). Its text starts with the
// initials of the runner, when they have no photo, so it is not matched on that.
const row = (screen: Screen, runner: string) =>
  screen.getByRole("listitem").filter({ has: page.getByText(runner, { exact: true }) });
const menuOf = (screen: Screen, runner: string) =>
  screen.getByRole("button", { name: fr.participation.actionsFor(runner) });

/** What a row says, without the items of its menu: they are on the page, hidden, until the menu opens. */
function textOfRow(element: Element): string {
  const copy = element.cloneNode(true);
  if (!(copy instanceof Element)) throw new Error("not an element");
  for (const menu of copy.querySelectorAll("[popover]")) menu.remove();
  return copy.textContent ?? "";
}

// --- The information ---

test("EventPage — une course au mois dit « juin 2027 · date à préciser », sans date sur ses épreuves", async () => {
  const { screen } = await renderPage({
    event: {
      ...eventRecord,
      start_date: "2027-06-01",
      end_date: "2027-06-30",
      date_precision: "month",
      expand: {
        ...eventRecord.expand,
        formats_via_event: [
          { ...f42, date: "", expand: { race_type: trailType } },
          { ...f15, date: "", expand: { race_type: roadType } },
        ],
      },
    },
  });

  await loaded(screen);
  await expect.element(screen.getByText("juin 2027 · date à préciser")).toBeVisible();
  expect(screen.container.querySelector(".format-date")).toBeNull();
  expect(screen.container.querySelector(".countdown-ring")).toBeNull();
});

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
  // (Not the weather's line, which says « à partir du » before the window.)
  const copy = screen.container.cloneNode(true);
  if (copy instanceof HTMLElement) copy.querySelector('[data-section="weather"]')?.remove();
  expect(copy.textContent).not.toContain("du ");
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

// --- The registration deadline and the reminder ---

const withDeadline = { ...eventRecord, registration_deadline: "2026-06-10" };
const registrationLine = (screen: Screen) => screen.getByText(/^Inscriptions (jusqu|closes)/);
const reminder = (screen: Screen) =>
  screen.getByRole("complementary", { name: fr.event.reminderTitle });
const top = (locator: { element(): Element }) => locator.element().getBoundingClientRect().top;

test("EventPage — la date limite, avec « plus que 3 jours »", async () => {
  const { screen } = await renderPage({ event: withDeadline, today: "2026-06-07" });

  await loaded(screen);
  await expect.element(registrationLine(screen)).toBeVisible();
  expect(plain(registrationLine(screen).element().textContent)).toBe(
    "Inscriptions jusqu'au mer. 10 juin · plus que 3 jours",
  );
});

test("EventPage — le décompte n'apparaît qu'à 7 jours ou moins, et dit « dernier jour » le jour même", async () => {
  // Eight days before: the date alone.
  const far = await renderPage({ event: withDeadline, today: "2026-06-02" });
  await loaded(far.screen);
  expect(plain(registrationLine(far.screen).element().textContent)).toBe(
    "Inscriptions jusqu'au mer. 10 juin",
  );
  await far.screen.unmount();

  // Seven days before: counted.
  const week = await renderPage({ event: withDeadline, today: "2026-06-03" });
  await loaded(week.screen);
  expect(plain(registrationLine(week.screen).element().textContent)).toBe(
    "Inscriptions jusqu'au mer. 10 juin · plus que 7 jours",
  );
  await week.screen.unmount();

  const tomorrow = await renderPage({ event: withDeadline, today: "2026-06-09" });
  await loaded(tomorrow.screen);
  expect(plain(registrationLine(tomorrow.screen).element().textContent)).toBe(
    "Inscriptions jusqu'au mer. 10 juin · plus qu'un jour",
  );
  await tomorrow.screen.unmount();

  // The day of the deadline one can still register: the last day.
  const last = await renderPage({ event: withDeadline, today: "2026-06-10" });
  await loaded(last.screen);
  expect(plain(registrationLine(last.screen).element().textContent)).toBe(
    "Inscriptions jusqu'au mer. 10 juin · dernier jour",
  );
});

test("EventPage — la date limite passée, avant l'événement : « Inscriptions closes », sans décompte", async () => {
  const { screen } = await renderPage({ event: withDeadline, today: "2026-06-11" });

  await loaded(screen);
  expect(plain(registrationLine(screen).element().textContent)).toBe("Inscriptions closes");
});

test("EventPage — sans date limite, ou une fois l'événement passé, pas de ligne d'inscription", async () => {
  const none = await renderPage();
  await loaded(none.screen);
  expect(none.screen.container.textContent).not.toContain("Inscriptions");
  await none.screen.unmount();

  const over = await renderPage({ event: withDeadline, today: "2026-06-15" });
  await loaded(over.screen);
  expect(over.screen.container.textContent).not.toContain("Inscriptions");
});

test("EventPage — en anglais, la date limite et le décompte suivent la langue", async () => {
  const { screen } = await renderPage({
    event: withDeadline,
    today: "2026-06-07",
    languages: ["en-GB"],
  });

  await loaded(screen);
  await expect
    .element(screen.getByText("Registration until Wed 10 Jun · 3 days left", { exact: true }))
    .toBeVisible();
});

test("EventPage — l'encadré de rappel pour un coureur intéressé, avec le lien d'inscription", async () => {
  // Bob is interested in F42 (and has not confirmed it, which does not matter).
  signIn("bob");
  const { screen } = await renderPage({
    event: { ...withDeadline, registration_url: "https://inscriptions.example.test/trail" },
    today: "2026-06-07",
  });

  await loaded(screen);
  const box = reminder(screen);
  await expect.element(box).toBeVisible();
  await expect.element(box.getByText(fr.event.reminder("mer. 10 juin"))).toBeVisible();
  expect(plain(box.element().textContent)).toContain("Pense à t'inscrire avant le mer. 10 juin.");
  const register = box.getByRole("link", { name: fr.event.register });
  await expect.element(register).toHaveAttribute("href", "https://inscriptions.example.test/trail");
  await expect.element(register).toHaveAttribute("target", "_blank");
  const rel = register.element().getAttribute("rel") ?? "";
  expect(rel.split(" ")).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
  expect(register.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  // Just after the information, before the buttons of the page and the formats.
  const info = screen.getByRole("heading", { level: 1, name: "Trail des Crêtes" });
  const firstFormat = screen.getByRole("heading", { level: 2, name: /^Trail 15/ });
  expect(top(box)).toBeGreaterThan(top(info));
  expect(top(box)).toBeLessThan(top(firstFormat));
  expect(top(box)).toBeLessThan(top(screen.getByRole("button", { name: fr.participation.join })));
  // The button of the information stays: the box adds a second one next to the reminder.
  expect(screen.getByRole("link", { name: fr.event.register }).elements()).toHaveLength(2);
});

test("EventPage — le rappel sans adresse d'inscription n'a pas de bouton, ni avec une adresse qui n'est pas http(s)", async () => {
  signIn("bob");
  const none = await renderPage({ event: withDeadline, today: "2026-06-07" });
  await loaded(none.screen);
  await expect.element(reminder(none.screen)).toBeVisible();
  await expect
    .element(none.screen.getByRole("link", { name: fr.event.register }))
    .not.toBeInTheDocument();
  await none.screen.unmount();

  const unsafe = await renderPage({
    event: { ...withDeadline, registration_url: "javascript:alert(1)" },
    today: "2026-06-07",
  });
  await loaded(unsafe.screen);
  await expect.element(reminder(unsafe.screen)).toBeVisible();
  await expect
    .element(unsafe.screen.getByRole("link", { name: fr.event.register }))
    .not.toBeInTheDocument();
});

test("EventPage — le rappel est aussi pour un intéressé sans épreuve, et dit son texte en anglais", async () => {
  signIn("nina");
  const { screen } = await renderPage({
    event: withParticipations(withDeadline, [pNinaUndecided]),
    today: "2026-06-07",
    languages: ["en-GB"],
  });

  await loaded(screen);
  const box = screen.getByRole("complementary", { name: "Reminder" });
  await expect.element(box).toBeVisible();
  await expect.element(box.getByText("Remember to register by Wed 10 Jun.")).toBeVisible();
});

test("EventPage — pas d'encadré pour un coureur inscrit, ni après la date limite", async () => {
  // Alice is registered: nothing to remind her of.
  const registered = await renderPage({ event: withDeadline, today: "2026-06-07" });
  await loaded(registered.screen);
  await expect.element(registrationLine(registered.screen)).toBeVisible();
  await expect.element(reminder(registered.screen)).not.toBeInTheDocument();
  await registered.screen.unmount();

  // Bob is interested, but the deadline is over.
  signIn("bob");
  const late = await renderPage({ event: withDeadline, today: "2026-06-11" });
  await loaded(late.screen);
  await expect.element(registrationLine(late.screen)).toBeVisible();
  await expect.element(reminder(late.screen)).not.toBeInTheDocument();
  await late.screen.unmount();

  // Bob is interested, and the event has no deadline.
  const none = await renderPage({ today: "2026-06-07" });
  await loaded(none.screen);
  await expect.element(reminder(none.screen)).not.toBeInTheDocument();
});

test("EventPage — pas d'encadré pour qui n'a aucune participation intéressée, ni pour un non partant", async () => {
  // Nina is on none of the formats.
  signIn("nina");
  const nobody = await renderPage({ event: withDeadline, today: "2026-06-07" });
  await loaded(nobody.screen);
  await expect.element(reminder(nobody.screen)).not.toBeInTheDocument();
  await nobody.screen.unmount();

  // Bob does not start.
  signIn("bob");
  const dnsBob = await renderPage({
    event: {
      ...withDeadline,
      expand: {
        ...withDeadline.expand,
        participations_via_event: [{ ...p2, status: "dns" }, p1, p3],
      },
    },
    today: "2026-06-07",
  });
  await loaded(dnsBob.screen);
  await expect.element(reminder(dnsBob.screen)).not.toBeInTheDocument();
});

// --- The formats and their participants ---

test("EventPage — chaque épreuve a son titre (type, mesures), dans l'ordre des jours, et dit son jour", async () => {
  const { screen } = await renderPage();
  await loaded(screen);

  const titles = screen
    .getByRole("heading", { level: 2 })
    .elements()
    .map((element) => plain(element.textContent));
  // The carpooling, the lodging and the comments come after the formats.
  // The weather comes first, after the actions (before the window it says when it will be there).
  expect(titles).toEqual([
    fr.weather.title,
    "Trail 15 km · 700 m D+",
    "Trail 42 km · 2 400 m D+ · max 10h",
    fr.offers.title.ride,
    fr.offers.title.lodging,
    fr.comments.title(0),
  ]);
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
  // Bob, whose adder is not there any more.
  const orphan = { ...p2, id: "pOrphan", expand: { runner: bobRunner } };
  const { screen } = await renderPage({
    event: {
      ...eventRecord,
      expand: { formats_via_event: [f42], participations_via_event: [orphan] },
    },
  });

  await loaded(screen);
  await expect.element(row(screen, "Bob").getByText(fr.event.unconfirmed)).toBeVisible();
  expect(row(screen, "Bob").element().textContent).not.toContain("ajouté par");
});

test("EventPage — une ligne de participant montre la photo à côté du nom, avec un alt vide", async () => {
  mocks.getURL.mockImplementation(() => pixelURL());
  const bob = { ...bobRunner, avatar: "bob_x1y2z3.webp" };
  const { screen } = await renderPage({
    event: {
      ...eventRecord,
      expand: {
        ...eventRecord.expand,
        participations_via_event: [
          { ...p2, expand: { runner: bob, added_by: aliceRunner } },
          p1,
          p3,
        ],
      },
    },
  });
  await loaded(screen);

  const bobRow = row(screen, "Bob");
  const image = bobRow.element().querySelector("img");
  expect(image).not.toBeNull();
  if (!image) return;
  expect(image.getAttribute("alt")).toBe("");
  expect(image.getAttribute("src")).toBe(pixelURL());
  expect(mocks.getURL).toHaveBeenCalledWith(
    expect.objectContaining({ id: bobRunner.id }),
    "bob_x1y2z3.webp",
    { thumb: "96x96" },
  );
  // The name is written next to it: the picture is decorative, nobody reads it out.
  await expect.element(bobRow.getByRole("img")).not.toBeInTheDocument();
  await expect.element(bobRow.getByText("Bob", { exact: true })).toBeVisible();
  // Before the name, in the reading order as on the screen, in a 44 px round.
  const name = bobRow.getByText("Bob", { exact: true }).element();
  expect(image.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(image.getBoundingClientRect().right).toBeLessThanOrEqual(
    name.getBoundingClientRect().left,
  );
  expect(image.getBoundingClientRect().width).toBe(44);
  expect(image.getBoundingClientRect().height).toBe(44);
  // The row still says that it is not confirmed, in words and in dashes.
  await expect.element(bobRow.getByText("ajouté par Alice · non confirmé")).toBeVisible();
  expect(getComputedStyle(bobRow.element()).borderStyle).toBe("dashed");
});

test("EventPage — le nom d'un participant mène à sa page", async () => {
  const { screen, router } = await renderPage();
  await loaded(screen);

  // Each runner of the formats is a link, on their name: a tap target of its own.
  const link = row(screen, "Alice").getByRole("link", { name: "Alice" });
  await expect.element(link).toHaveAttribute("href", `/coureurs/${aliceRunner.id}`);
  expect(link.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await expect
    .element(row(screen, "Bob").getByRole("link", { name: "Bob" }))
    .toHaveAttribute("href", `/coureurs/${bobRunner.id}`);
  // What the row says besides the name is not part of the link.
  await expect
    .element(row(screen, "Bob").getByRole("link", { name: /non confirmé/ }))
    .not.toBeInTheDocument();

  await link.click();

  await expect.element(screen.getByText("Page d'un coureur")).toBeVisible();
  expect(router.state.location.pathname).toBe(`/coureurs/${aliceRunner.id}`);
});

test("EventPage — le nom d'un participant est un lien dans chaque liste: intéressés, supporteurs et non partants", async () => {
  const dora = { ...base, id: "doraRunner00000", name: "Dora", user: "" };
  const pDora = {
    ...pNinaSupporter,
    id: "pDora",
    runner: dora.id,
    added_by: dora.id,
    expand: { runner: dora, added_by: dora },
  };
  const { screen } = await renderPage({
    event: {
      ...eventRecord,
      expand: {
        ...eventRecord.expand,
        // Sam does not start; Nina is interested with no format; Dora comes to cheer.
        participations_via_event: [p1, p2, { ...p3, status: "dns" }, pNinaUndecided, pDora],
      },
    },
  });
  await loaded(screen);

  // The list of those who do not start is closed: its links are in the page all the same.
  const hrefs = [...screen.container.querySelectorAll("a")]
    .map((link) => link.getAttribute("href") ?? "")
    .filter((href) => href.startsWith("/coureurs/"));
  // One link a runner, none twice.
  expect(hrefs).toHaveLength(5);
  expect(new Set(hrefs)).toEqual(
    new Set(
      [aliceRunner, bobRunner, samRunner, ninaRunner, dora].map(({ id }) => `/coureurs/${id}`),
    ),
  );
});

test("EventPage — sans photo, la ligne a les initiales avant le nom, cachées aux lecteurs d'écran", async () => {
  const { screen } = await renderPage();
  await loaded(screen);

  const initials = row(screen, "Alice").getByText("A", { exact: true });
  await expect.element(initials).toBeVisible();
  await expect.element(initials).toHaveAttribute("aria-hidden", "true");
  expect(mocks.getURL).not.toHaveBeenCalled();
});

test("EventPage — une épreuve sans participant le dit", async () => {
  const { screen } = await renderPage({ event: event2Record });

  await loaded(screen, "10 km de Lyon");
  await expect.element(screen.getByText(fr.event.nobody)).toBeVisible();
});

// --- Those who are interested with no format, and those who do not start ---

/** Zoe, interested with no format, added by Alice and not confirmed: Alice may act on it. */
const zoeRunner = { ...base, id: "zoeRunner00000", name: "Zoe", user: "" };
const pZoe = {
  ...base,
  id: "pZoe",
  runner: zoeRunner.id,
  event: "event",
  format: "",
  status: "interested",
  confirmed: false,
  added_by: aliceRunner.id,
  expand: { runner: zoeRunner, added_by: aliceRunner },
};

/** The participation of a runner who does not start. */
const dns = (participation: object) => ({ ...participation, status: "dns" });

/** The event of the fixture with exactly these participations. */
function eventWith(participations: unknown[]) {
  return {
    ...eventRecord,
    expand: { ...eventRecord.expand, participations_via_event: participations },
  };
}

const interestedSection = (screen: Screen) =>
  screen.getByRole("region", { name: fr.event.interestedTitle });
const nonStartersSummary = (screen: Screen) => screen.getByText(fr.event.nonStarters(1));

function detailsOf(screen: Screen): HTMLDetailsElement {
  const details = screen.container.querySelector("details");
  if (!details) throw new Error("no <details> on the page");
  return details;
}

test("EventPage — les intéressés sans épreuve sont en haut, sous « Intéressés, format à choisir », avant la première épreuve", async () => {
  const { screen } = await renderPage({ event: withParticipations(eventRecord, [pNinaUndecided]) });
  await loaded(screen);

  const section = interestedSection(screen);
  await expect.element(section).toBeVisible();
  await expect
    .element(screen.getByRole("heading", { level: 2, name: fr.event.interestedTitle }))
    .toBeVisible();
  await expect.element(section.getByText("Nina", { exact: true })).toBeVisible();
  // The order of the page: the interested come before the first format.
  const first = format(screen, /^Trail 15/).element();
  expect(section.element().compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  // Nina is not on a format: she is in none.
  await expect
    .element(format(screen, /^Trail 15/).getByText("Nina", { exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(format(screen, /^Trail 42/).getByText("Nina", { exact: true }))
    .not.toBeInTheDocument();
});

test("EventPage — la ligne d'un intéressé sans épreuve ne dit pas de statut, mais dit qu'elle n'est pas confirmée", async () => {
  const { screen } = await renderPage({ event: eventWith([p1, p2, p3, pZoe]) });
  await loaded(screen);

  const zoe = row(screen, "Zoe");
  await expect.element(zoe.getByText("ajouté par Alice · non confirmé")).toBeVisible();
  // The menu has « Intéressé » and « Supporteur », hidden: it is the text of the row that has no status.
  for (const status of Object.values(fr.status)) {
    expect(textOfRow(zoe.element())).not.toContain(status);
  }
  expect(getComputedStyle(zoe.element()).borderStyle).toBe("dashed");
});

test("EventPage — sans intéressé sans épreuve, pas de section pour eux", async () => {
  const { screen } = await renderPage();
  await loaded(screen);

  await expect.element(interestedSection(screen)).not.toBeInTheDocument();
});

test("EventPage — le menu d'un intéressé sans épreuve propose « Choisir l'épreuve » et les deux statuts de l'événement, pas ceux d'une épreuve", async () => {
  const { screen } = await renderPage({ event: eventWith([p1, p2, p3, pZoe]) });
  await loaded(screen);

  await menuOf(screen, "Zoe").click();

  await expect
    .element(screen.getByRole("button", { name: fr.participation.chooseFormat }))
    .toBeVisible();
  for (const status of ["interested", "supporter"] as const) {
    await expect.element(screen.getByRole("button", { name: fr.status[status] })).toBeVisible();
  }
  for (const status of ["registered", "finished", "dnf", "dns"] as const) {
    await expect
      .element(screen.getByRole("button", { name: fr.status[status] }))
      .not.toBeInTheDocument();
  }
});

test("EventPage — choisir l'épreuve d'un intéressé la lui donne : il passe dans l'épreuve, et le focus va au titre de cette épreuve", async () => {
  const { screen } = await renderPage({ event: eventWith([p1, p2, p3, pZoe, pNinaUndecided]) });
  await loaded(screen);
  // Once saved, the server has Zoe on F42, and Nina is still interested.
  mocks.update.mockImplementation(() => {
    mocks.getOne.mockResolvedValue(
      eventWith([p1, p2, p3, { ...pZoe, format: "f42", status: "registered" }, pNinaUndecided]),
    );
    return Promise.resolve({});
  });

  await menuOf(screen, "Zoe").click();
  await screen.getByRole("button", { name: fr.participation.chooseFormat }).click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.chooseFormatTitle });
  await dialog.getByLabelText(fr.participation.format).selectOptions("f42");
  await dialog.getByLabelText(fr.participation.status).selectOptions("registered");
  await dialog.getByRole("button", { name: fr.common.save }).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("pZoe", {
      format: "f42",
      status: "registered",
    });
  });
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(format(screen, /^Trail 42/).getByText("Zoe", { exact: true })).toBeVisible();
  await expect
    .element(interestedSection(screen).getByText("Zoe", { exact: true }))
    .not.toBeInTheDocument();
  // The row has gone: the focus is on the title of the format it is in now.
  const heading = screen.getByRole("heading", { level: 2, name: /^Trail 42/ });
  await vi.waitFor(() => {
    expect(focused()).toBe(heading.element());
  });
});

test("EventPage — un non partant n'est pas dans son épreuve mais dans « Non partants (1) », replié ; l'ouvrir le montre avec son épreuve", async () => {
  const { screen } = await renderPage({ event: eventWith([dns(p2), p1, p3]) });
  await loaded(screen);

  // Bob is not on F42 any more.
  await expect
    .element(format(screen, /^Trail 42/).getByText("Bob", { exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(format(screen, /^Trail 42/).getByText("Alice", { exact: true }))
    .toBeVisible();
  // He is in the list of those who do not start, closed.
  const details = detailsOf(screen);
  expect(details.open).toBe(false);
  const summary = nonStartersSummary(screen);
  await expect.element(summary).toBeVisible();
  expect(summary.element().tagName).toBe("SUMMARY");
  expect(summary.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  // The list is at the bottom of the page, after the formats.
  expect(
    format(screen, /^Trail 42/)
      .element()
      .compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

  await summary.click();

  expect(details.open).toBe(true);
  await expect.element(row(screen, "Bob")).toBeVisible();
  expect(plain(row(screen, "Bob").element().textContent)).toContain("Trail 42 km");
  // Not confirmed, and added by Alice: said as it is in the formats.
  await expect
    .element(row(screen, "Bob").getByText("ajouté par Alice · non confirmé"))
    .toBeVisible();
});

test("EventPage — un « Abandon » reste dans son épreuve, avec son statut", async () => {
  const { screen } = await renderPage({ event: eventWith([{ ...p2, status: "dnf" }, p1, p3]) });
  await loaded(screen);

  await expect.element(format(screen, /^Trail 42/).getByText("Bob", { exact: true })).toBeVisible();
  // In the row of Bob: the menus of the others also have a button called « Abandon ».
  await expect.element(row(screen, "Bob").getByText(fr.status.dnf)).toBeVisible();
  expect(
    format(screen, /^Trail 42/)
      .element()
      .contains(row(screen, "Bob").element()),
  ).toBe(true);
  // He started: nobody is left out of the race.
  expect(screen.container.querySelector("details")).toBeNull();
});

test("EventPage — une épreuve dont le seul participant est non partant dit « Personne pour l'instant. »", async () => {
  const { screen } = await renderPage({ event: eventWith([p2, p1, dns(p3)]) });
  await loaded(screen);

  await expect.element(format(screen, /^Trail 15/).getByText(fr.event.nobody)).toBeVisible();
  await expect
    .element(format(screen, /^Trail 15/).getByText("Sam", { exact: true }))
    .not.toBeInTheDocument();
  expect(detailsOf(screen).open).toBe(false);
});

test("EventPage — depuis « Non partants », le menu rend un autre statut : la ligne revient dans son épreuve, la section disparaît avec son seul non partant, le focus va au titre de l'épreuve", async () => {
  const { screen } = await renderPage({ event: eventWith([dns(p2), p1, p3]) });
  await loaded(screen);
  await nonStartersSummary(screen).click();
  mocks.update.mockImplementation(() => {
    mocks.getOne.mockResolvedValue(eventWith([{ ...p2, status: "registered" }, p1, p3]));
    return Promise.resolve({});
  });

  await menuOf(screen, "Bob").click();
  await screen.getByRole("button", { name: fr.status.registered }).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p2", { status: "registered" });
  });
  await expect.element(format(screen, /^Trail 42/).getByText("Bob", { exact: true })).toBeVisible();
  expect(screen.container.querySelector("details")).toBeNull();
  // The list of those who do not start is gone, with its title: the focus is where Bob is.
  const heading = screen.getByRole("heading", { level: 2, name: /^Trail 42/ });
  await vi.waitFor(() => {
    expect(focused()).toBe(heading.element());
  });
});

test("EventPage — passer quelqu'un en « Non partant » le sort de son épreuve, et le focus va au résumé « Non partants »", async () => {
  const { screen } = await renderPage();
  await loaded(screen);
  mocks.update.mockImplementation(() => {
    mocks.getOne.mockResolvedValue(eventWith([dns(p2), p1, p3]));
    return Promise.resolve({});
  });

  await menuOf(screen, "Bob").click();
  await screen.getByRole("button", { name: fr.status.dns }).click();

  await expect.element(nonStartersSummary(screen)).toBeVisible();
  await expect
    .element(format(screen, /^Trail 42/).getByText("Bob", { exact: true }))
    .not.toBeInTheDocument();
  // The focus goes where Bob is now: the list of those who do not start.
  await vi.waitFor(() => {
    expect(focused()).toBe(nonStartersSummary(screen).element());
  });
});

test("EventPage — si on a pris le focus ailleurs avant que la ligne ne change de liste, on ne le lui reprend pas", async () => {
  const { screen } = await renderPage();
  await loaded(screen);
  // The server answers when the test says so.
  const server: { answer?: () => void } = {};
  mocks.update.mockImplementation(
    () =>
      new Promise((resolve) => {
        server.answer = () => {
          mocks.getOne.mockResolvedValue(eventWith([dns(p2), p1, p3]));
          resolve({});
        };
      }),
  );
  await menuOf(screen, "Bob").click();
  await screen.getByRole("button", { name: fr.status.dns }).click();
  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledOnce();
  });
  // The user goes on with the page while it waits.
  const edit = screen.getByRole("link", { name: fr.common.edit }).element();
  if (!(edit instanceof HTMLElement)) throw new Error("not an element");
  edit.focus();

  server.answer?.();

  await expect.element(nonStartersSummary(screen)).toBeVisible();
  // Let the page react to the answer, if it were to.
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(focused()).toBe(edit);
});

// --- The actions of the page ---

test("EventPage — J'y vais est absent quand je suis déjà sur toutes les épreuves", async () => {
  // Alice is on F42, and on F15 too.
  const aliceOnF15 = { ...p1, id: "p1b", format: "f15", expand: p1.expand };
  const { screen } = await renderPage({ event: withParticipations(eventRecord, [aliceOnF15]) });
  await loaded(screen);

  await expect
    .element(screen.getByRole("button", { name: fr.participation.join }))
    .not.toBeInTheDocument();
  // Somebody else can still be added.
  await expect
    .element(screen.getByRole("button", { name: fr.participation.addSomeone }))
    .toBeVisible();
});

test("EventPage — J'y vais reste quand il me reste une épreuve", async () => {
  // Alice is on F42 only.
  const { screen } = await renderPage();
  await loaded(screen);

  await expect.element(screen.getByRole("button", { name: fr.participation.join })).toBeVisible();
});

test("EventPage — J'y vais d'une personne intéressée sans épreuve propose les épreuves, sans « Pas encore décidé »", async () => {
  // Nina has said she is interested: both formats are hers to take, but not « not decided yet ».
  signIn("nina");
  const { screen } = await renderPage({ event: withParticipations(eventRecord, [pNinaUndecided]) });
  await loaded(screen);

  await screen.getByRole("button", { name: fr.participation.join }).click();

  const dialog = screen.getByRole("dialog", { name: fr.participation.joinTitle });
  const select = dialog.getByLabelText(fr.participation.format).element();
  if (!(select instanceof HTMLSelectElement)) throw new Error("not a select");
  expect(Array.from(select.options).map((option) => option.value)).toEqual(["f15", "f42"]);
});

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

test("EventPage — Ajouter quelqu'un de la page est décrit par le titre de l'événement : les offres ont le leur", async () => {
  const { screen } = await renderPage();
  await loaded(screen);

  await expect
    .element(screen.getByRole("button", { name: fr.participation.addSomeone, exact: true }))
    .toHaveAccessibleDescription("Trail des Crêtes");
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

test("EventPage — tant que son coureur n'est pas connu, on ne propose que Modifier et l'agenda", async () => {
  mocks.myRunner.mockReturnValue(new Promise(() => {}));
  const { screen } = await renderPage();
  await loaded(screen);

  await expect.element(screen.getByRole("link", { name: fr.common.edit })).toBeVisible();
  // The file of the event is made of the event alone.
  await expect.element(screen.getByRole("button", { name: fr.event.addToCalendar })).toBeVisible();
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

/**
 * Stands in for the click that makes the browser save a file: nothing is
 * saved in the test, but the anchor is known (its name and its address, which is
 * the one of the Blob, still there to be read).
 */
function watchDownloads() {
  const downloads: { name: string; href: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ name: this.download, href: this.href });
  });
  return downloads;
}

test("EventPage — « Ajouter à mon agenda » télécharge un .ics", async () => {
  const downloads = watchDownloads();
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const { screen } = await renderPage();
  await loaded(screen);

  await screen.getByRole("button", { name: fr.event.addToCalendar }).click();

  // One file, named after the event.
  expect(downloads).toHaveLength(1);
  const [download] = downloads;
  expect(download?.name).toBe("Trail des Crêtes.ics");
  expect(download?.href).toMatch(/^blob:/);
  const response = await fetch(download?.href ?? "");
  expect(response.headers.get("content-type")).toBe("text/calendar;charset=utf-8");
  const lines = (await response.text()).split("\r\n");
  // The days of the event (the 13th and the 14th: the end is the day after), its place and its page.
  expect(lines).toEqual(
    expect.arrayContaining([
      "BEGIN:VCALENDAR",
      "PRODID:-//Prends ton dossard//FR",
      "BEGIN:VEVENT",
      "UID:event-event@prends-ton-dossard",
      "DTSTART;VALUE=DATE:20260613",
      "DTEND;VALUE=DATE:20260615",
      "SUMMARY:Trail des Crêtes",
      "LOCATION:Annecy",
      `URL:${location.origin}/evenements/event`,
      "END:VEVENT",
      "END:VCALENDAR",
    ]),
  );
  expect(lines.find((line) => line.startsWith("DTSTAMP:"))).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/);
  // The address of the file is let go a moment later, once the browser has had it.
  expect(revoke).not.toHaveBeenCalled();
  await vi.waitFor(
    () => {
      expect(revoke).toHaveBeenCalledExactlyOnceWith(download?.href);
    },
    { timeout: 3000 },
  );
});

test("EventPage — le fichier d'un événement dont le nom n'a rien d'utilisable s'appelle evenement.ics, ou event.ics en anglais", async () => {
  const downloads = watchDownloads();
  const nameless = { ...eventRecord, name: "???" };
  const { screen } = await renderPage({ event: nameless });
  await loaded(screen, "???");
  await screen.getByRole("button", { name: fr.event.addToCalendar }).click();
  expect(downloads.map(({ name }) => name)).toEqual(["evenement.ics"]);

  await screen.unmount();
  const english = await renderPage({ event: nameless, languages: ["en-GB"] });
  await loaded(english.screen, "???");
  await english.screen.getByRole("button", { name: "Add to my calendar" }).click();
  expect(downloads.map(({ name }) => name)).toEqual(["evenement.ics", "event.ics"]);
});

test("EventPage — en anglais, le fichier .ics a le PRODID //EN", async () => {
  const downloads = watchDownloads();
  const { screen } = await renderPage({ languages: ["en-GB"] });
  await loaded(screen);

  await screen.getByRole("button", { name: "Add to my calendar" }).click();

  expect(downloads).toHaveLength(1);
  const response = await fetch(downloads[0]?.href ?? "");
  expect((await response.text()).split("\r\n")).toContain("PRODID:-//Prends ton dossard//EN");
});

test("EventPage — « Partager » est après « Ajouter à mon agenda » et envoie le texte de la course", async () => {
  const share = vi.fn<(data: ShareData) => Promise<void>>().mockResolvedValue();
  Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
  Object.defineProperty(navigator, "canShare", {
    value: () => true,
    configurable: true,
    writable: true,
  });
  try {
    const { screen } = await renderPage();
    await loaded(screen);

    const calendar = screen.getByRole("button", { name: fr.event.addToCalendar }).element();
    const button = screen.getByRole("button", { name: fr.share.button }).element();
    expect(
      calendar.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(calendar.nextElementSibling).toBe(button);

    await screen.getByRole("button", { name: fr.share.button }).click();

    await vi.waitFor(() => {
      expect(share).toHaveBeenCalledOnce();
    });
    const [data] = share.mock.calls[0] ?? [];
    expect(data?.title).toBe("Trail des Crêtes");
    expect(data?.text).toContain(location.origin + "/evenements/event");
    expect(data?.text).not.toContain("Bob");
  } finally {
    for (const name of ["share", "canShare"]) Reflect.deleteProperty(navigator, name);
  }
});

test("EventPage — les boutons d'action font au moins 44 px", async () => {
  const { screen } = await renderPage();
  await loaded(screen);

  for (const element of [
    screen.getByRole("button", { name: fr.participation.join }),
    screen.getByRole("button", { name: fr.participation.addSomeone }),
    screen.getByRole("button", { name: fr.event.addToCalendar }),
    screen.getByRole("button", { name: fr.share.button }),
    screen.getByRole("link", { name: fr.common.edit }),
    screen.getByRole("button", { name: fr.common.delete }),
  ]) {
    expect(element.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
});

test("EventPage — sur un téléphone, « J'y vais » prend la ligne, les autres actions vont deux par deux, sans rien couper", async () => {
  try {
    // The room the page has between the gutters of the app shell (2 × 16 px) on a phone of 320 and of 390 px.
    for (const width of [288, 358]) {
      await page.viewport(width, 844);
      const { screen } = await renderPage();
      await loaded(screen);
      // Measured in the fonts of the site, not in those that stand in while they load.
      await fontsReady();

      const actions = [
        screen.getByRole("button", { name: fr.participation.join }),
        screen.getByRole("button", { name: fr.participation.addSomeone }),
        screen.getByRole("button", { name: fr.event.addToCalendar }),
        screen.getByRole("button", { name: fr.share.button }),
        screen.getByRole("link", { name: fr.common.edit }),
        screen.getByRole("button", { name: fr.common.delete }),
      ].map((action) => action.element());
      const [join, add, calendar, share, edit, remove] = actions.map((action) =>
        action.getBoundingClientRect(),
      );
      if (!join || !add || !calendar || !share || !edit || !remove) {
        throw new Error("an action is missing");
      }

      // The main one across, then the others two by two, side by side.
      expect(join.left).toBe(add.left);
      expect(join.right).toBe(calendar.right);
      expect(join.bottom).toBeLessThanOrEqual(add.top);
      expect(add.top).toBe(calendar.top);
      expect(add.right).toBeLessThan(calendar.left);
      expect(calendar.bottom).toBeLessThanOrEqual(share.top);
      expect(share.top).toBe(edit.top);
      expect(share.right).toBeLessThan(edit.left);
      // The last one is alone, across both columns.
      expect(edit.bottom).toBeLessThanOrEqual(remove.top);
      expect(remove.left).toBe(share.left);
      expect(remove.right).toBe(edit.right);
      // Each one a tap target, its words whole, and nothing that scrolls sideways.
      for (const action of actions) {
        const { width: w, height: h } = action.getBoundingClientRect();
        expect(w, `${action.textContent} at ${width} px`).toBeGreaterThanOrEqual(44);
        expect(h, `${action.textContent} at ${width} px`).toBeGreaterThanOrEqual(44);
        expect(action.scrollWidth, `${action.textContent} at ${width} px`).toBeLessThanOrEqual(
          action.clientWidth,
        );
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      await screen.unmount();
    }
  } finally {
    await page.viewport(414, 896);
  }
});

test("EventPage — sur un téléphone, une action seule au bout prend toute la ligne", async () => {
  // Its runner is not known yet: no "I'm in", no "Add someone", no "Delete", three actions.
  mocks.myRunner.mockReturnValue(new Promise(() => {}));
  try {
    // The room the page has between the gutters of the app shell (2 × 16 px) on a phone of 320 and of 390 px.
    for (const width of [288, 358]) {
      await page.viewport(width, 844);
      const { screen } = await renderPage();
      await loaded(screen);
      // Measured in the fonts of the site, not in those that stand in while they load.
      await fontsReady();
      await expect.element(screen.getByRole("link", { name: fr.common.edit })).toBeVisible();
      await expect
        .element(screen.getByRole("button", { name: fr.common.delete }))
        .not.toBeInTheDocument();

      const actions = [
        screen.getByRole("button", { name: fr.event.addToCalendar }),
        screen.getByRole("button", { name: fr.share.button }),
        screen.getByRole("link", { name: fr.common.edit }),
      ].map((action) => action.element());
      const [calendar, share, edit] = actions.map((action) => action.getBoundingClientRect());
      if (!calendar || !share || !edit) throw new Error("an action is missing");

      // Two side by side, then the last one alone, across both columns.
      expect(calendar.top).toBe(share.top);
      expect(calendar.right).toBeLessThan(share.left);
      expect(share.bottom).toBeLessThanOrEqual(edit.top);
      expect(edit.left).toBe(calendar.left);
      expect(edit.right).toBe(share.right);
      // Each one a tap target, its words whole, and nothing that scrolls sideways.
      for (const action of actions) {
        const { width: w, height: h } = action.getBoundingClientRect();
        expect(w, `${action.textContent} at ${width} px`).toBeGreaterThanOrEqual(44);
        expect(h, `${action.textContent} at ${width} px`).toBeGreaterThanOrEqual(44);
        expect(action.scrollWidth, `${action.textContent} at ${width} px`).toBeLessThanOrEqual(
          action.clientWidth,
        );
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      await screen.unmount();
    }
  } finally {
    await page.viewport(414, 896);
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

// --- « Terminé » and « Abandon » come with the day of the race ---
//
// Nobody finishes a race, or gives up on it, before its day: the menus of the page do not
// offer it, nor the result. The event runs on 13 and 14 June: F15 takes place on the first
// day (it has no day of its own; Sam is on it), F42 on the second (Alice and Bob are on it).

const finishedItem = (screen: Screen) => screen.getByRole("button", { name: fr.status.finished });
const dnfItem = (screen: Screen) => screen.getByRole("button", { name: fr.status.dnf });
const enterResultItem = (screen: Screen) =>
  screen.getByRole("button", { name: fr.results.enter, exact: true });

test("EventPage — avant le jour de l'épreuve, le menu n'offre ni Terminé, ni Abandon, ni Saisir le résultat", async () => {
  signIn("admin");
  const { screen } = await renderPage();
  await loaded(screen);

  await menuOf(screen, "Bob").click();

  await expect.element(screen.getByRole("button", { name: fr.status.dns })).toBeVisible();
  await expect.element(finishedItem(screen)).not.toBeInTheDocument();
  await expect.element(dnfItem(screen)).not.toBeInTheDocument();
  await expect.element(enterResultItem(screen)).not.toBeInTheDocument();
});

test("EventPage — le jour de l'épreuve, Terminé, Abandon et Saisir le résultat sont là, et le lendemain d'une autre épreuve de l'événement non", async () => {
  signIn("admin");
  const { screen } = await renderPage({ today: "2026-06-13" });
  await loaded(screen);

  // F15 is on the first day of the event, which is today.
  await menuOf(screen, "Sam").click();
  await expect.element(finishedItem(screen)).toBeVisible();
  await expect.element(dnfItem(screen)).toBeVisible();
  await expect.element(enterResultItem(screen)).toBeVisible();
  await screen.unmount();

  // F42 is on the second day: it has not started.
  const second = await renderPage({ today: "2026-06-13" });
  await loaded(second.screen);
  await menuOf(second.screen, "Bob").click();
  await expect.element(second.screen.getByRole("button", { name: fr.status.dns })).toBeVisible();
  await expect.element(finishedItem(second.screen)).not.toBeInTheDocument();
  await expect.element(dnfItem(second.screen)).not.toBeInTheDocument();
  await expect.element(enterResultItem(second.screen)).not.toBeInTheDocument();
});

test("EventPage — un non partant suit le jour de son épreuve : pas de Terminé avant, Terminé après", async () => {
  signIn("admin");
  const before = await renderPage({ event: eventWith([dns(p2), p1, p3]), today: "2026-06-13" });
  await loaded(before.screen);
  await nonStartersSummary(before.screen).click();

  await menuOf(before.screen, "Bob").click();

  await expect.element(before.screen.getByRole("button", { name: fr.status.dns })).toBeVisible();
  await expect.element(finishedItem(before.screen)).not.toBeInTheDocument();
  await expect.element(enterResultItem(before.screen)).not.toBeInTheDocument();
  await before.screen.unmount();

  const after = await renderPage({ event: eventWith([dns(p2), p1, p3]), today: RACE_DAY });
  await loaded(after.screen);
  await nonStartersSummary(after.screen).click();

  await menuOf(after.screen, "Bob").click();

  await expect.element(finishedItem(after.screen)).toBeVisible();
  await expect.element(enterResultItem(after.screen)).toBeVisible();
});

/** The statuses that the dialog of the formats offers, once opened from the menu of Zoe, who is interested in the event. */
async function statusesOfTheDialog(today: string) {
  const { screen } = await renderPage({ event: eventWith([p1, p2, p3, pZoe]), today });
  await loaded(screen);
  await menuOf(screen, "Zoe").click();
  await screen.getByRole("button", { name: fr.participation.chooseFormat }).click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.chooseFormatTitle });
  const select = dialog.getByLabelText(fr.participation.status).element();
  const statuses = Array.from(select.querySelectorAll("option")).map(
    (option) => option.textContent,
  );
  await screen.unmount();
  return statuses;
}

test("EventPage — « Choisir l'épreuve » ne propose Terminé et Abandon qu'à partir du jour de l'épreuve", async () => {
  // The format that is chosen first is F15, on the first day of the event.
  expect(await statusesOfTheDialog("2026-06-12")).toEqual([
    fr.status.interested,
    fr.status.registered,
    fr.status.dns,
  ]);
  expect(await statusesOfTheDialog("2026-06-13")).toEqual([
    fr.status.interested,
    fr.status.registered,
    fr.status.finished,
    fr.status.dnf,
    fr.status.dns,
  ]);
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
  const { screen } = await renderPage({ today: RACE_DAY });
  await loaded(screen);

  await menuOf(screen, "Bob").click();

  await expect.element(screen.getByRole("button", { name: fr.status.finished })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: fr.common.confirm }))
    .not.toBeInTheDocument();
});

// --- The dialogs ---

test("EventPage — J'y vais ouvre le dialogue qui crée une participation", async () => {
  const { screen } = await renderPage();
  await loaded(screen);

  await screen.getByRole("button", { name: fr.participation.join }).click();

  const dialog = screen.getByRole("dialog", { name: fr.participation.joinTitle });
  await expect.element(dialog).toBeVisible();
  // Alice is on F42 already: what is left to choose is F15.
  await expect.element(dialog.getByLabelText(fr.participation.format)).toHaveValue("f15");
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
    event: "event",
    format: "f42",
    status: "registered",
    confirmed: true,
    added_by: newRunner.id,
    expand: { runner: newRunner, added_by: newRunner },
  };
  mocks.getOne.mockResolvedValue(withParticipations(eventRecord, [nina]));

  await screen.getByRole("button", { name: fr.participation.join }).click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.joinTitle });
  await dialog.getByLabelText(fr.participation.format).selectOptions("f42");
  await dialog.getByLabelText(fr.participation.status).selectOptions("registered");
  await dialog.getByRole("button", { name: fr.common.save }).click();

  await expect.element(row(screen, "Nina")).toBeVisible();
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    runner: newRunner.id,
    event: "event",
    format: "f42",
    status: "registered",
  });
  expect(mocks.getOne).toHaveBeenCalledTimes(2);
  await expect.element(dialog).not.toBeInTheDocument();
});

// --- Where the focus goes ---

const focused = () => document.activeElement;

/** The participation of Alice that the server creates, with the answer to the next request of the event. */
const aliceNew = (formatId: string, event: string) => ({
  ...base,
  id: "pAliceNew",
  runner: aliceRunner.id,
  event,
  format: formatId,
  status: "interested",
  confirmed: true,
  added_by: aliceRunner.id,
  expand: { runner: aliceRunner, added_by: aliceRunner },
});

test("EventPage — J'y vais sur un événement à une seule épreuve : le bouton disparaît, le focus va au titre de l'épreuve rejointe", async () => {
  const { screen } = await renderPage({ event: event2Record });
  await loaded(screen, "10 km de Lyon");
  mocks.create.mockResolvedValue({ id: "pAliceNew" });
  mocks.getOne.mockResolvedValue({
    ...event2Record,
    expand: {
      ...event2Record.expand,
      participations_via_event: [aliceNew("fLyon", "event2")],
    },
  });

  await screen.getByRole("button", { name: fr.participation.join }).click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.joinTitle });
  await dialog.getByRole("button", { name: fr.common.save }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: fr.participation.join }))
    .not.toBeInTheDocument();
  const heading = screen.getByRole("heading", { level: 2, name: /^Route 10/ });
  await vi.waitFor(() => {
    expect(focused()).toBe(heading.element());
  });
  expect(focused()).not.toBe(document.body);
});

test("EventPage — J'y vais pour la dernière épreuve qu'il me reste : le focus va au titre de cette épreuve", async () => {
  // Alice is on F42; F15 is the last one she can take.
  const { screen } = await renderPage();
  await loaded(screen);
  mocks.create.mockResolvedValue({ id: "pAliceNew" });
  mocks.getOne.mockResolvedValue(withParticipations(eventRecord, [aliceNew("f15", "event")]));

  await screen.getByRole("button", { name: fr.participation.join }).click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.joinTitle });
  await dialog.getByRole("button", { name: fr.common.save }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: fr.participation.join }))
    .not.toBeInTheDocument();
  const heading = screen.getByRole("heading", { level: 2, name: /^Trail 15/ });
  await vi.waitFor(() => {
    expect(focused()).toBe(heading.element());
  });
});

test("EventPage — J'y vais qui laisse le bouton : le focus lui revient, la page n'y touche pas", async () => {
  // Nina is on none of the formats: after taking F42 she can still take F15.
  signIn("nina");
  const { screen } = await renderPage();
  await loaded(screen);
  mocks.create.mockResolvedValue({ id: "pNinaNew" });
  mocks.getOne.mockResolvedValue(
    withParticipations(eventRecord, [
      { ...pNinaUndecided, id: "pNinaNew", format: "f42", status: "interested" },
    ]),
  );
  const join = screen.getByRole("button", { name: fr.participation.join });

  await join.click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.joinTitle });
  await dialog.getByLabelText(fr.participation.format).selectOptions("f42");
  await dialog.getByRole("button", { name: fr.common.save }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(row(screen, "Nina")).toBeVisible();
  await vi.waitFor(() => {
    expect(focused()).toBe(join.element());
  });
});

test("EventPage — J'y vais en « Pas encore décidé » : la participation arrive chez les intéressés, et le bouton reste, avec le focus", async () => {
  // Both formats are still Nina's to take: the button stays, and gets the focus back.
  signIn("nina");
  const { screen } = await renderPage();
  await loaded(screen);
  mocks.create.mockResolvedValue({ id: "pNinaUndecided" });
  mocks.getOne.mockResolvedValue(withParticipations(eventRecord, [pNinaUndecided]));
  const join = screen.getByRole("button", { name: fr.participation.join });

  await join.click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.joinTitle });
  await dialog.getByLabelText(fr.participation.format).selectOptions("undecided");
  await dialog.getByRole("button", { name: fr.common.save }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(interestedSection(screen)).toBeVisible();
  await vi.waitFor(() => {
    expect(focused()).toBe(join.element());
  });
});

async function openRemovalDialog(screen: Screen, runner: string) {
  await menuOf(screen, runner).click();
  await screen.getByRole("button", { name: fr.common.remove }).click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.removeTitle });
  // Not toBeVisible(): for WebKit it asks of an element inside a <details> (the
  // list of the non starters) that its offsetParent is not null, and the
  // offsetParent of a modal dialog, which is fixed, is null there.
  await vi.waitFor(() => {
    expect(
      dialog.element().checkVisibility({ visibilityProperty: true, opacityProperty: true }),
    ).toBe(true);
  });
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
      expand: { ...eventRecord.expand, participations_via_event: [p1, p3] },
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

test("EventPage — après le retrait d'un intéressé, le focus va au titre « Intéressés, format à choisir »", async () => {
  // Nina stays interested; Zoe, whom Alice may remove, goes.
  const { screen } = await renderPage({ event: eventWith([p1, p2, p3, pNinaUndecided, pZoe]) });
  await loaded(screen);
  mocks.remove.mockImplementation(() => {
    mocks.getOne.mockResolvedValue(eventWith([p1, p2, p3, pNinaUndecided]));
    return Promise.resolve(true);
  });
  const dialog = await openRemovalDialog(screen, "Zoe");
  // This participation is on no format: the dialog names the event.
  await expect
    .element(dialog.getByText(fr.participation.removeWarning("Zoe", "Trail des Crêtes")))
    .toBeVisible();

  await dialog.getByRole("button", { name: fr.common.remove }).click();

  await expect.element(menuOf(screen, "Zoe")).not.toBeInTheDocument();
  await expect.element(dialog).not.toBeInTheDocument();
  const heading = screen.getByRole("heading", { level: 2, name: fr.event.interestedTitle });
  await vi.waitFor(() => {
    expect(focused()).toBe(heading.element());
  });
});

test("EventPage — après le retrait d'un non partant, le focus va au résumé « Non partants »", async () => {
  // Bob and Sam do not start; Bob goes, Sam stays.
  const { screen } = await renderPage({ event: eventWith([dns(p2), p1, dns(p3)]) });
  await loaded(screen);
  await screen.getByText(fr.event.nonStarters(2)).click();
  mocks.remove.mockImplementation(() => {
    mocks.getOne.mockResolvedValue(eventWith([p1, dns(p3)]));
    return Promise.resolve(true);
  });
  const dialog = await openRemovalDialog(screen, "Bob");

  await dialog.getByRole("button", { name: fr.common.remove }).click();

  await expect.element(menuOf(screen, "Bob")).not.toBeInTheDocument();
  await expect.element(dialog).not.toBeInTheDocument();
  const summary = nonStartersSummary(screen);
  await expect.element(summary).toBeVisible();
  await vi.waitFor(() => {
    expect(focused()).toBe(summary.element());
  });
});

test("EventPage — après le retrait du seul intéressé, la section disparaît et le focus va au titre de la page", async () => {
  const { screen } = await renderPage({ event: eventWith([p1, p2, p3, pZoe]) });
  await loaded(screen);
  mocks.remove.mockImplementation(() => {
    mocks.getOne.mockResolvedValue(eventWith([p1, p2, p3]));
    return Promise.resolve(true);
  });
  const dialog = await openRemovalDialog(screen, "Zoe");

  await dialog.getByRole("button", { name: fr.common.remove }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(interestedSection(screen)).not.toBeInTheDocument();
  const title = screen.getByRole("heading", { level: 1, name: "Trail des Crêtes" });
  await vi.waitFor(() => {
    expect(focused()).toBe(title.element());
  });
});

test("EventPage — après le retrait du seul non partant, la section disparaît et le focus va au titre de la page", async () => {
  const { screen } = await renderPage({ event: eventWith([dns(p2), p1, p3]) });
  await loaded(screen);
  await nonStartersSummary(screen).click();
  mocks.remove.mockImplementation(() => {
    mocks.getOne.mockResolvedValue(eventWith([p1, p3]));
    return Promise.resolve(true);
  });
  const dialog = await openRemovalDialog(screen, "Bob");

  await dialog.getByRole("button", { name: fr.common.remove }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  // The page asks for the event again: the section goes when the answer is there.
  await vi.waitFor(() => {
    expect(screen.container.querySelector("details")).toBeNull();
  });
  const title = screen.getByRole("heading", { level: 1, name: "Trail des Crêtes" });
  await vi.waitFor(() => {
    expect(focused()).toBe(title.element());
  });
});

test("EventPage — choisir l'épreuve du seul intéressé : la section disparaît, le focus va au titre de l'épreuve", async () => {
  const { screen } = await renderPage({ event: eventWith([p1, p2, p3, pZoe]) });
  await loaded(screen);
  mocks.update.mockImplementation(() => {
    mocks.getOne.mockResolvedValue(
      eventWith([p1, p2, p3, { ...pZoe, format: "f15", status: "interested" }]),
    );
    return Promise.resolve({});
  });

  await menuOf(screen, "Zoe").click();
  await screen.getByRole("button", { name: fr.participation.chooseFormat }).click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.chooseFormatTitle });
  await dialog.getByRole("button", { name: fr.common.save }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(interestedSection(screen)).not.toBeInTheDocument();
  const heading = screen.getByRole("heading", { level: 2, name: /^Trail 15/ });
  await vi.waitFor(() => {
    expect(focused()).toBe(heading.element());
  });
});

// --- The supporters ---

/** Zoe, supporter of the event, added by Alice and not confirmed: Alice may act on it. */
const pZoeSupporter = { ...pZoe, id: "pZoeSupporter", status: "supporter" };
/** Léa, supporter of the event, confirmed: she is added by herself. */
const leaRunner = { ...base, id: "leaRunner00000", name: "Léa", user: "" };
const pLeaSupporter = {
  ...pNinaSupporter,
  id: "pLeaSupporter",
  runner: leaRunner.id,
  added_by: leaRunner.id,
  expand: { runner: leaRunner, added_by: leaRunner },
};

const supportersSection = (screen: Screen) =>
  screen.getByRole("region", { name: fr.event.supportersTitle });

/** Whether `a` is before `b` on the page. */
const before = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ===
  Node.DOCUMENT_POSITION_FOLLOWING;

test("EventPage — la section Supporteurs, après les épreuves et avant les non partants", async () => {
  const { screen } = await renderPage({ event: eventWith([p1, dns(p2), p3, pNinaSupporter]) });
  await loaded(screen);
  await nonStartersSummary(screen).click();

  const section = supportersSection(screen);
  await expect.element(section).toBeVisible();
  await expect
    .element(screen.getByRole("heading", { level: 2, name: fr.event.supportersTitle }))
    .toBeVisible();
  await expect.element(section.getByText("Nina", { exact: true })).toBeVisible();
  // The title says it, not a colour: the row has no status of its own, as for the interested.
  expect(textOfRow(row(screen, "Nina").element())).not.toContain(fr.status.supporter);
  // After the formats and before those who do not start.
  expect(before(format(screen, /^Trail 15/).element(), section.element())).toBe(true);
  expect(before(format(screen, /^Trail 42/).element(), section.element())).toBe(true);
  expect(before(section.element(), nonStartersSummary(screen).element())).toBe(true);
  // A supporter starts nothing: she is in no format, nor among the interested.
  await expect
    .element(format(screen, /^Trail 15/).getByText("Nina", { exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(format(screen, /^Trail 42/).getByText("Nina", { exact: true }))
    .not.toBeInTheDocument();
  await expect.element(interestedSection(screen)).not.toBeInTheDocument();
});

test("EventPage — les supporteurs sont rangés par nom, et la section vient après celle des intéressés", async () => {
  // Zoe comes first in what the server sends; Nina is interested, not a supporter.
  const { screen } = await renderPage({
    event: eventWith([p1, p2, p3, pZoeSupporter, pLeaSupporter, pNinaUndecided]),
  });
  await loaded(screen);

  const names = supportersSection(screen)
    .getByRole("listitem")
    .elements()
    .map((item) => item.querySelector("p")?.textContent);
  expect(names).toEqual(["Léa", "Zoe"]);
  expect(before(interestedSection(screen).element(), supportersSection(screen).element())).toBe(
    true,
  );
});

test("EventPage — la ligne d'un supporteur non confirmé le dit en texte, comme celle d'un intéressé", async () => {
  const { screen } = await renderPage({ event: eventWith([p1, p2, p3, pZoeSupporter]) });
  await loaded(screen);

  const zoe = row(screen, "Zoe");
  await expect.element(zoe.getByText("ajouté par Alice · non confirmé")).toBeVisible();
  expect(getComputedStyle(zoe.element()).borderStyle).toBe("dashed");
});

test("EventPage — sans supporteur, pas de section pour eux", async () => {
  const { screen } = await renderPage({ event: eventWith([p1, p2, p3, pZoe]) });
  await loaded(screen);

  await expect.element(supportersSection(screen)).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("heading", { level: 2, name: fr.event.supportersTitle }))
    .not.toBeInTheDocument();
});

test("EventPage — en anglais, la section s'appelle « Supporters »", async () => {
  const { screen } = await renderPage({
    event: eventWith([p1, p2, p3, pNinaSupporter]),
    languages: ["en-GB"],
  });

  await expect.element(screen.getByRole("heading", { level: 2, name: "Supporters" })).toBeVisible();
});

test("EventPage — le menu d'un supporteur propose « Choisir l'épreuve » et les deux statuts de l'événement, avec Supporteur pour statut actuel", async () => {
  signIn("nina");
  const { screen } = await renderPage({ event: eventWith([p1, p2, p3, pNinaSupporter]) });
  await loaded(screen);

  await menuOf(screen, "Nina").click();

  await expect
    .element(screen.getByRole("button", { name: fr.participation.chooseFormat }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: fr.status.supporter }))
    .toHaveAttribute("aria-current", "true");
  await expect
    .element(screen.getByRole("button", { name: fr.status.interested }))
    .not.toHaveAttribute("aria-current");
  for (const status of ["registered", "finished", "dnf", "dns"] as const) {
    await expect
      .element(screen.getByRole("button", { name: fr.status[status] }))
      .not.toBeInTheDocument();
  }
});

test("EventPage — retirer le seul supporteur nomme l'événement, et le focus va au titre de la page", async () => {
  const { screen } = await renderPage({ event: eventWith([p1, p2, p3, pZoeSupporter]) });
  await loaded(screen);
  mocks.remove.mockImplementation(() => {
    mocks.getOne.mockResolvedValue(eventWith([p1, p2, p3]));
    return Promise.resolve(true);
  });
  const dialog = await openRemovalDialog(screen, "Zoe");
  // This participation is on no format: the dialog names the event.
  await expect
    .element(dialog.getByText(fr.participation.removeWarning("Zoe", "Trail des Crêtes")))
    .toBeVisible();

  await dialog.getByRole("button", { name: fr.common.remove }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(supportersSection(screen)).not.toBeInTheDocument();
  const title = screen.getByRole("heading", { level: 1, name: "Trail des Crêtes" });
  await vi.waitFor(() => {
    expect(focused()).toBe(title.element());
  });
});

test("EventPage — après le retrait d'un supporteur, le focus va au titre « Supporteurs » quand il en reste", async () => {
  const { screen } = await renderPage({
    event: eventWith([p1, p2, p3, pNinaSupporter, pZoeSupporter]),
  });
  await loaded(screen);
  mocks.remove.mockImplementation(() => {
    mocks.getOne.mockResolvedValue(eventWith([p1, p2, p3, pNinaSupporter]));
    return Promise.resolve(true);
  });
  const dialog = await openRemovalDialog(screen, "Zoe");

  await dialog.getByRole("button", { name: fr.common.remove }).click();

  await expect.element(menuOf(screen, "Zoe")).not.toBeInTheDocument();
  const heading = screen.getByRole("heading", { level: 2, name: fr.event.supportersTitle });
  await vi.waitFor(() => {
    expect(focused()).toBe(heading.element());
  });
});

test("EventPage — choisir l'épreuve du seul supporteur : le focus va sur le titre de l'épreuve", async () => {
  const { screen } = await renderPage({ event: eventWith([p1, p2, p3, pZoeSupporter]) });
  await loaded(screen);
  // Once saved, the server has Zoe on F15, as interested: a supporter who is given a format is not one any more.
  mocks.update.mockImplementation(() => {
    mocks.getOne.mockResolvedValue(
      eventWith([p1, p2, p3, { ...pZoeSupporter, format: "f15", status: "interested" }]),
    );
    return Promise.resolve({});
  });

  await menuOf(screen, "Zoe").click();
  await screen.getByRole("button", { name: fr.participation.chooseFormat }).click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.chooseFormatTitle });
  await dialog.getByRole("button", { name: fr.common.save }).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("pZoeSupporter", {
      format: "f15",
      status: "interested",
    });
  });
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(supportersSection(screen)).not.toBeInTheDocument();
  await expect.element(format(screen, /^Trail 15/).getByText("Zoe", { exact: true })).toBeVisible();
  const heading = screen.getByRole("heading", { level: 2, name: /^Trail 15/ });
  await vi.waitFor(() => {
    expect(focused()).toBe(heading.element());
  });
});

test("EventPage — passer un supporteur en « Intéressé » le fait passer chez les intéressés, et le focus va au titre « Intéressés, format à choisir »", async () => {
  const { screen } = await renderPage({ event: eventWith([p1, p2, p3, pZoeSupporter]) });
  await loaded(screen);
  mocks.update.mockImplementation(() => {
    mocks.getOne.mockResolvedValue(
      eventWith([p1, p2, p3, { ...pZoeSupporter, status: "interested" }]),
    );
    return Promise.resolve({});
  });

  await menuOf(screen, "Zoe").click();
  await screen.getByRole("button", { name: fr.status.interested }).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("pZoeSupporter", {
      status: "interested",
    });
  });
  await expect.element(interestedSection(screen).getByText("Zoe", { exact: true })).toBeVisible();
  await expect.element(supportersSection(screen)).not.toBeInTheDocument();
  // The row has left the supporters, whose section went with it: the focus is where Zoe is.
  const heading = screen.getByRole("heading", { level: 2, name: fr.event.interestedTitle });
  await vi.waitFor(() => {
    expect(focused()).toBe(heading.element());
  });
});

test("EventPage — passer un intéressé en « Supporteur » le fait passer chez les supporteurs, et le focus va au titre « Supporteurs »", async () => {
  const { screen } = await renderPage({ event: eventWith([p1, p2, p3, pZoe]) });
  await loaded(screen);
  mocks.update.mockImplementation(() => {
    mocks.getOne.mockResolvedValue(eventWith([p1, p2, p3, { ...pZoe, status: "supporter" }]));
    return Promise.resolve({});
  });

  await menuOf(screen, "Zoe").click();
  await screen.getByRole("button", { name: fr.status.supporter }).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("pZoe", { status: "supporter" });
  });
  await expect.element(supportersSection(screen).getByText("Zoe", { exact: true })).toBeVisible();
  await expect.element(interestedSection(screen)).not.toBeInTheDocument();
  const heading = screen.getByRole("heading", { level: 2, name: fr.event.supportersTitle });
  await vi.waitFor(() => {
    expect(focused()).toBe(heading.element());
  });
});

test("EventPage — passer un supporteur en « Intéressé » quand il en reste d'autres : le focus va au titre « Intéressés, format à choisir », jamais sur le corps de la page", async () => {
  // Nina stays a supporter, and Zoe is the only one who is interested after it.
  const { screen } = await renderPage({
    event: eventWith([p1, p2, p3, pNinaSupporter, pZoeSupporter]),
  });
  await loaded(screen);
  mocks.update.mockImplementation(() => {
    mocks.getOne.mockResolvedValue(
      eventWith([p1, p2, p3, pNinaSupporter, { ...pZoeSupporter, status: "interested" }]),
    );
    return Promise.resolve({});
  });

  await menuOf(screen, "Zoe").click();
  await screen.getByRole("button", { name: fr.status.interested }).click();

  await expect.element(interestedSection(screen).getByText("Zoe", { exact: true })).toBeVisible();
  // The supporters are still there, with Nina: the focus is where Zoe is now.
  await expect.element(supportersSection(screen).getByText("Nina", { exact: true })).toBeVisible();
  const heading = screen.getByRole("heading", { level: 2, name: fr.event.interestedTitle });
  await vi.waitFor(() => {
    expect(focused()).toBe(heading.element());
  });
  expect(focused()).not.toBe(document.body);
});

test("EventPage — passer un intéressé en « Supporteur » quand il en reste d'autres : le focus va au titre « Supporteurs », jamais sur le corps de la page", async () => {
  // Nina stays interested, and Zoe is the only supporter after it.
  const { screen } = await renderPage({ event: eventWith([p1, p2, p3, pNinaUndecided, pZoe]) });
  await loaded(screen);
  mocks.update.mockImplementation(() => {
    mocks.getOne.mockResolvedValue(
      eventWith([p1, p2, p3, pNinaUndecided, { ...pZoe, status: "supporter" }]),
    );
    return Promise.resolve({});
  });

  await menuOf(screen, "Zoe").click();
  await screen.getByRole("button", { name: fr.status.supporter }).click();

  await expect.element(supportersSection(screen).getByText("Zoe", { exact: true })).toBeVisible();
  await expect.element(interestedSection(screen).getByText("Nina", { exact: true })).toBeVisible();
  const heading = screen.getByRole("heading", { level: 2, name: fr.event.supportersTitle });
  await vi.waitFor(() => {
    expect(focused()).toBe(heading.element());
  });
  expect(focused()).not.toBe(document.body);
});

test("EventPage — J'y vais en « Je viens encourager » : la participation arrive chez les supporteurs, et le bouton reste, avec le focus", async () => {
  // Both formats are still Nina's to take: the button stays, and gets the focus back.
  signIn("nina");
  const { screen } = await renderPage();
  await loaded(screen);
  mocks.create.mockResolvedValue({ id: "pNinaSupporter" });
  mocks.getOne.mockResolvedValue(withParticipations(eventRecord, [pNinaSupporter]));
  const join = screen.getByRole("button", { name: fr.participation.join });

  await join.click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.joinTitle });
  await dialog.getByLabelText(fr.participation.format).selectOptions("support");
  await dialog.getByRole("button", { name: fr.common.save }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(supportersSection(screen).getByText("Nina", { exact: true })).toBeVisible();
  await vi.waitFor(() => {
    expect(focused()).toBe(join.element());
  });
});

// --- The carpooling and the lodging ---

test("EventPage — Covoiturage puis Logement, avant les commentaires", async () => {
  mocks.offers.getFullList.mockResolvedValue([
    {
      ...base,
      collectionName: "offers",
      id: "ride1",
      event: "event",
      kind: "ride",
      owner: bobRunner.id,
      place: "Lyon, Part-Dieu",
      seats: 3,
      date: "2026-06-13",
      time: "06:30",
      end_date: "",
      url: "",
      notes: "",
      expand: { owner: bobRunner },
    },
    {
      ...base,
      collectionName: "offers",
      id: "lodging1",
      event: "event",
      kind: "lodging",
      owner: aliceRunner.id,
      place: "Gîte des Crêtes, Valloire",
      seats: 0,
      date: "2026-06-13",
      time: "",
      end_date: "2026-06-14",
      url: "",
      notes: "",
      expand: { owner: aliceRunner },
    },
  ]);
  // A format, the supporters and those who do not start, all open: the offers come after them.
  const { screen } = await renderPage({ event: eventWith([p1, dns(p2), p3, pNinaSupporter]) });
  await loaded(screen);
  await nonStartersSummary(screen).click();

  const rides = screen.getByRole("region", { name: fr.offers.title.ride });
  const lodgings = screen.getByRole("region", { name: fr.offers.title.lodging });
  const comments = screen.getByRole("region", { name: fr.comments.title(0) });
  await expect.element(rides).toBeVisible();
  await expect.element(lodgings).toBeVisible();
  // Each offer is in the section of its kind.
  await expect.element(rides.getByRole("article", { name: "Bob" })).toBeVisible();
  await expect.element(rides.getByText("0 place prise sur 3")).toBeVisible();
  await expect.element(lodgings.getByRole("article", { name: "Alice" })).toBeVisible();
  await expect.element(lodgings.getByText("0 personne, places non précisées")).toBeVisible();
  await expect.element(rides.getByRole("article", { name: "Alice" })).not.toBeInTheDocument();
  await expect.element(lodgings.getByRole("article", { name: "Bob" })).not.toBeInTheDocument();
  // The carpooling after those who do not start, the lodging after the carpooling, then the comments.
  expect(before(nonStartersSummary(screen).element(), rides.element())).toBe(true);
  expect(before(supportersSection(screen).element(), rides.element())).toBe(true);
  expect(before(format(screen, /^Trail 42/).element(), rides.element())).toBe(true);
  expect(before(rides.element(), lodgings.element())).toBe(true);
  expect(before(lodgings.element(), comments.element())).toBe(true);
  // Both sections share one request: the offers of this event.
  expect(mocks.offers.getFullList).toHaveBeenCalledTimes(1);
  expect(mocks.offers.getFullList).toHaveBeenCalledWith(
    expect.objectContaining({ filter: expect.stringContaining("event"), sort: "created" }),
  );
});

test("EventPage — le propriétaire d'une offre peut la supprimer ; un autre membre peut y prendre une place", async () => {
  mocks.offers.getFullList.mockResolvedValue([
    {
      ...base,
      collectionName: "offers",
      id: "ride1",
      event: "event",
      kind: "ride",
      owner: bobRunner.id,
      place: "Lyon",
      seats: 3,
      date: "",
      time: "",
      end_date: "",
      url: "",
      notes: "",
      expand: { owner: bobRunner },
    },
  ]);
  const { screen } = await renderPage();
  await loaded(screen);

  // Alice is signed in: she is not the owner, and she may take a place.
  const offer = screen.getByRole("article", { name: "Bob", exact: true });
  await expect.element(offer.getByRole("button", { name: fr.offers.take.ride })).toBeVisible();
  await expect
    .element(offer.getByRole("button", { name: fr.offers.delete }))
    .not.toBeInTheDocument();
  await screen.unmount();

  signIn("bob");
  const owner = await renderPage();
  await loaded(owner.screen);
  const mine = owner.screen.getByRole("article", { name: "Bob", exact: true });
  await expect.element(mine.getByRole("button", { name: fr.offers.delete })).toBeVisible();
  await expect
    .element(mine.getByRole("button", { name: fr.offers.take.ride }))
    .not.toBeInTheDocument();
});

// --- The comments ---

test("EventPage — la section Commentaires vient en dernier", async () => {
  mocks.comments.getFullList.mockResolvedValue([
    {
      ...base,
      collectionName: "comments",
      id: "c1",
      event: "event",
      author: bobRunner.id,
      body: "Je prends la voiture.",
      created: "2026-05-30 09:00:00.000Z",
      updated: "2026-05-30 09:00:00.000Z",
      expand: { author: bobRunner },
    },
  ]);
  // A format, the supporters and those who do not start, all open: the comments come after them.
  const { screen } = await renderPage({ event: eventWith([p1, dns(p2), p3, pNinaSupporter]) });
  await loaded(screen);
  await nonStartersSummary(screen).click();

  const comments = screen.getByRole("region", { name: fr.comments.title(1) });
  await expect.element(comments).toBeVisible();
  await expect.element(comments.getByText("Je prends la voiture.")).toBeVisible();
  expect(before(supportersSection(screen).element(), comments.element())).toBe(true);
  expect(before(nonStartersSummary(screen).element(), comments.element())).toBe(true);
  expect(before(format(screen, /^Trail 42/).element(), comments.element())).toBe(true);
  // Nothing of the page comes after it, and it is the comments of this event that were asked for.
  const sections = screen.container.querySelectorAll("article section, article details");
  expect(sections[sections.length - 1]).toBe(comments.element());
  expect(mocks.comments.getFullList).toHaveBeenCalledWith(
    expect.objectContaining({ filter: expect.stringContaining("event"), sort: "created" }),
  );
});

test("EventPage — un membre peut écrire un commentaire ; tant que son coureur charge, on lit sans écrire", async () => {
  const { screen: member } = await renderPage();
  await loaded(member);
  await expect.element(member.getByLabelText(fr.comments.newLabel)).toBeVisible();
  await member.unmount();

  mocks.myRunner.mockReturnValue(new Promise(() => {}));
  const { screen } = await renderPage();
  await loaded(screen);

  await expect.element(screen.getByRole("region", { name: fr.comments.title(0) })).toBeVisible();
  await expect.element(screen.getByLabelText(fr.comments.newLabel)).not.toBeInTheDocument();
});

// --- Loading and failures ---

test("EventPage — pendant le chargement, elle le dit", async () => {
  const { screen } = await renderPage({ answer: "pending" });

  await expect.element(screen.getByText(fr.common.loading)).toBeVisible();
});

test("EventPage — les commentaires et les offres sont demandés en même temps que l'événement, pas une fois qu'il est arrivé", async () => {
  const event = Promise.withResolvers<unknown>();
  const { screen } = await renderPage({ answer: event.promise });

  // The event has not answered, and both lists are on their way already.
  await vi.waitFor(() => {
    expect(mocks.comments.getFullList).toHaveBeenCalledTimes(1);
    expect(mocks.offers.getFullList).toHaveBeenCalledTimes(1);
  });
  await expect.element(screen.getByText(fr.common.loading)).toBeVisible();
  for (const list of [mocks.comments.getFullList, mocks.offers.getFullList]) {
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ filter: expect.stringContaining("event") }),
    );
  }

  // The sections read what the page already has: nothing is asked a second time.
  event.resolve(eventRecord);
  await loaded(screen);
  await expect.element(screen.getByRole("region", { name: fr.comments.title(0) })).toBeVisible();
  expect(mocks.comments.getFullList).toHaveBeenCalledTimes(1);
  expect(mocks.offers.getFullList).toHaveBeenCalledTimes(1);
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

// --- The result of a participation ---

/** Bob, finished: with his time, his rank, how many were ranked, and a note. */
const bobFinished = {
  ...p2,
  status: "finished",
  finish_time_s: 15150,
  rank: 12,
  rank_of: 340,
  result_note: "3e V1H",
};

test("EventPage — une ligne terminée montre son temps, son rang et sa note", async () => {
  const { screen } = await renderPage({ event: eventWith([bobFinished, p1, p3]) });
  await loaded(screen);

  // Under the name, after the status, with the separator of the page.
  expect(plain(textOfRow(row(screen, "Bob").element()))).toContain(
    "Terminé · 4h 12min 30s · 12e sur 340 · 3e V1H",
  );
  // The others have nothing to add.
  expect(plain(textOfRow(row(screen, "Alice").element()))).not.toContain("·");
});

test("EventPage — le résultat suit la langue : temps, rang en lettres et « out of »", async () => {
  const { screen } = await renderPage({
    event: eventWith([bobFinished, p1, p3]),
    languages: ["en-GB"],
  });
  await loaded(screen);

  expect(plain(textOfRow(row(screen, "Bob").element()))).toContain(
    "Finished · 4h 12m 30s · 12th out of 340 · 3e V1H",
  );
});

test("EventPage — un rang sans nombre de classés, un temps seul, une note seule", async () => {
  const { screen } = await renderPage({
    event: eventWith([
      { ...p2, status: "finished", rank: 1 },
      { ...p1, status: "finished", finish_time_s: 2520 },
      { ...p3, status: "dnf", result_note: "abandon au km 30" },
    ]),
  });
  await loaded(screen);

  expect(plain(textOfRow(row(screen, "Bob").element()))).toContain("Terminé · 1er");
  expect(plain(textOfRow(row(screen, "Alice").element()))).toContain("Terminé · 42min");
  expect(plain(textOfRow(row(screen, "Sam").element()))).toContain("Abandon · abandon au km 30");
});

test("EventPage — une ligne terminée sans résultat ne dit que son statut", async () => {
  // PocketBase sends 0 and "" for what is not given.
  const empty = { status: "finished", finish_time_s: 0, rank: 0, rank_of: 0, result_note: "" };
  const { screen } = await renderPage({ event: eventWith([p2, { ...p1, ...empty }, p3]) });
  await loaded(screen);

  await expect.element(row(screen, "Alice").getByText(fr.status.finished)).toBeVisible();
  expect(plain(textOfRow(row(screen, "Alice").element()))).not.toContain("·");
});

test("EventPage — le résultat n'est montré qu'aux statuts Terminé et Abandon", async () => {
  // The server clears a result when the status changes: a record that still has one is not shown.
  const stale = { finish_time_s: 3600, rank: 3, rank_of: 10, result_note: "ancien" };
  const { screen } = await renderPage({
    event: eventWith([{ ...p2, ...stale }, { ...p1, ...stale }, p3]),
  });
  await loaded(screen);

  expect(plain(textOfRow(row(screen, "Bob").element()))).not.toContain("ancien");
  expect(plain(textOfRow(row(screen, "Bob").element()))).not.toContain("1h");
  expect(plain(textOfRow(row(screen, "Alice").element()))).not.toContain("ancien");
});

test("EventPage — la note d'un résultat s'affiche telle quelle, balises comprises", async () => {
  const { screen } = await renderPage({
    event: eventWith([{ ...p2, status: "finished", result_note: "<b>V1H</b>" }, p1, p3]),
  });
  await loaded(screen);

  expect(textOfRow(row(screen, "Bob").element())).toContain("<b>V1H</b>");
  expect(row(screen, "Bob").element().querySelector("b")).toBeNull();
});

test("EventPage — Saisir le résultat : la page recharge, la ligne montre le résultat, et le focus reste sur le bouton du menu", async () => {
  const { screen } = await renderPage({ today: RACE_DAY });
  await loaded(screen);
  mocks.update.mockImplementation(() => {
    mocks.getOne.mockResolvedValue(
      eventWith([
        { ...p2, status: "finished", finish_time_s: 2520, result_note: "3e V1H" },
        p1,
        p3,
      ]),
    );
    return Promise.resolve({});
  });

  await menuOf(screen, "Bob").click();
  await screen.getByRole("button", { name: fr.results.enter, exact: true }).click();
  const dialog = screen.getByRole("dialog", { name: fr.results.title });
  await dialog.getByLabelText(`${fr.results.time}, ${fr.results.minutesName}`).fill("42");
  await dialog.getByLabelText(fr.results.note, { exact: true }).fill("3e V1H");
  await dialog.getByRole("button", { name: fr.results.save }).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p2", {
      status: "finished",
      finish_time_s: 2520,
      rank: 0,
      rank_of: 0,
      result_note: "3e V1H",
    });
  });
  await expect.element(dialog).not.toBeInTheDocument();
  await vi.waitFor(() => {
    expect(plain(textOfRow(row(screen, "Bob").element()))).toContain("Terminé · 42min · 3e V1H");
  });
  // The row stays in its format: the button of its menu has the focus.
  await vi.waitFor(() => {
    expect(focused()).toBe(menuOf(screen, "Bob").element());
  });
  // And the menu now offers to edit it.
  await menuOf(screen, "Bob").click();
  await expect
    .element(screen.getByRole("button", { name: fr.results.edit, exact: true }))
    .toBeVisible();
});

test("EventPage — le résultat d'un non partant le remet dans son épreuve, et le focus va au titre de l'épreuve", async () => {
  const { screen } = await renderPage({ event: eventWith([dns(p2), p1, p3]), today: RACE_DAY });
  await loaded(screen);
  await nonStartersSummary(screen).click();
  mocks.update.mockImplementation(() => {
    mocks.getOne.mockResolvedValue(
      eventWith([{ ...p2, status: "finished", finish_time_s: 2520 }, p1, p3]),
    );
    return Promise.resolve({});
  });

  await menuOf(screen, "Bob").click();
  await screen.getByRole("button", { name: fr.results.enter, exact: true }).click();
  const dialog = screen.getByRole("dialog", { name: fr.results.title });
  await dialog.getByLabelText(`${fr.results.time}, ${fr.results.minutesName}`).fill("42");
  await dialog.getByRole("button", { name: fr.results.save }).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p2", {
      status: "finished",
      finish_time_s: 2520,
      rank: 0,
      rank_of: 0,
      result_note: "",
    });
  });
  await expect.element(format(screen, /^Trail 42/).getByText("Bob", { exact: true })).toBeVisible();
  expect(screen.container.querySelector("details")).toBeNull();
  // The list of those who do not start is gone with its only runner: the focus is where Bob is.
  const heading = screen.getByRole("heading", { level: 2, name: /^Trail 42/ });
  await vi.waitFor(() => {
    expect(focused()).toBe(heading.element());
  });
});

test("EventPage — pas de Saisir le résultat sur la participation d'un autre qui est confirmée, ni dans le menu d'un intéressé sans épreuve", async () => {
  signIn("bob");
  const { screen } = await renderPage({ event: withParticipations(eventRecord, [pZoe]) });
  await loaded(screen);

  // Bob has no menu on Alice's participation, which she has confirmed.
  await expect.element(menuOf(screen, "Alice")).not.toBeInTheDocument();
  // Zoe is on the event alone: her menu has no result.
  await menuOf(screen, "Zoe").click();
  await expect
    .element(screen.getByRole("button", { name: fr.participation.chooseFormat }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: fr.results.enter, exact: true }))
    .not.toBeInTheDocument();
});

// --- The course of a format ---

const TRACK_URL = "https://pb.example.test/api/files/formats/f42/trace_ab12cd.gpx";
const COURSE_URL = "https://www.openrunner.com/route-details/123";

/** 2.2 km, 200 m up then 50 m down, between 450 and 650 m. */
const CLIMB = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
  <trkpt lat="45.00" lon="6"><ele>450</ele></trkpt>
  <trkpt lat="45.01" lon="6"><ele>650</ele></trkpt>
  <trkpt lat="45.02" lon="6"><ele>600</ele></trkpt>
</trkseg></trk></gpx>`;

/** The event of the fixture, where the 42 km has what the test says of its course. */
function withCourse(course: { gpx?: string; route_url?: string }) {
  const formats = eventRecord.expand.formats_via_event.map((one) =>
    one.id === "f42" ? { ...one, ...course } : one,
  );
  return { ...eventRecord, expand: { ...eventRecord.expand, formats_via_event: formats } };
}

/** What the server answers when a file is asked for: the text, as a new answer every time. */
function serveTrack(text: string, status = 200) {
  mocks.getURL.mockImplementation((_record, filename) =>
    filename.endsWith(".gpx") ? TRACK_URL : pixelURL(),
  );
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(new Response(text, { status })));
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("EventPage — la partie Parcours est dans l'épreuve qui a une trace, après les participants, et pas dans l'autre", async () => {
  const fetching = serveTrack(CLIMB);
  const { screen } = await renderPage({
    event: withCourse({ gpx: "trace_ab12cd.gpx", route_url: COURSE_URL }),
  });
  await loaded(screen);

  const trail42 = format(screen, /^Trail 42/);
  await expect.element(trail42.getByRole("heading", { name: fr.route.title })).toBeVisible();
  await expect.element(trail42.getByRole("region", { name: fr.route.map })).toBeVisible();
  await expect
    .element(trail42.getByRole("img", { name: new RegExp(`^${fr.route.profileLabel}`) }))
    .toBeVisible();
  await expect
    .element(trail42.getByRole("link", { name: fr.route.download }))
    .toHaveAttribute("href", TRACK_URL);
  await expect
    .element(trail42.getByRole("link", { name: fr.route.open }))
    .toHaveAttribute("href", COURSE_URL);
  // After the runners of the format.
  const participants = trail42.getByRole("list", { name: fr.event.participants }).element();
  const course = trail42.getByRole("heading", { name: fr.route.title }).element();
  expect(
    participants.compareDocumentPosition(course) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  // The 15 km has neither: no title, and only the one file was asked for.
  await expect
    .element(format(screen, /^Trail 15/).getByRole("heading", { name: fr.route.title }))
    .not.toBeInTheDocument();
  expect(fetching).toHaveBeenCalledOnce();
});

test("EventPage — une trace illisible affiche un message, pas d'erreur", async () => {
  serveTrack("ceci n'est pas une trace");
  const { screen } = await renderPage({
    event: withCourse({ gpx: "trace_ab12cd.gpx", route_url: COURSE_URL }),
  });
  await loaded(screen);

  const trail42 = format(screen, /^Trail 42/);
  await expect.element(trail42.getByText(fr.route.unreadable)).toBeVisible();
  // No drawing (the icons of the links are not one), but the links stay.
  expect([...trail42.element().querySelectorAll("svg")].filter((svg) => !svg.closest("a"))).toEqual(
    [],
  );
  await expect.element(trail42.getByRole("link", { name: fr.route.download })).toBeVisible();
  await expect.element(trail42.getByRole("link", { name: fr.route.open })).toBeVisible();
  // The rest of the page is there, and says nothing went wrong.
  await expect.element(trail42.getByText("Alice", { exact: true })).toBeVisible();
  await expect.element(format(screen, /^Trail 15/).getByText("Sam", { exact: true })).toBeVisible();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  expect(screen.container.textContent).not.toContain(fr.errors.generic);
});

test("EventPage — un fichier de trace que le serveur ne donne pas n'empêche pas la page", async () => {
  serveTrack("not found", 404);
  const { screen } = await renderPage({ event: withCourse({ gpx: "trace_ab12cd.gpx" }) });
  await loaded(screen);

  await expect.element(format(screen, /^Trail 42/).getByText(fr.route.unreadable)).toBeVisible();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});

test("EventPage — un lien de parcours sans trace s'affiche seul, et rien n'est demandé au serveur de fichiers", async () => {
  const fetching = serveTrack(CLIMB);
  const { screen } = await renderPage({ event: withCourse({ route_url: COURSE_URL }) });
  await loaded(screen);

  const trail42 = format(screen, /^Trail 42/);
  await expect
    .element(trail42.getByRole("link", { name: fr.route.open }))
    .toHaveAttribute("href", COURSE_URL);
  await expect
    .element(trail42.getByRole("link", { name: fr.route.download }))
    .not.toBeInTheDocument();
  expect(fetching).not.toHaveBeenCalled();
});

test("EventPage — sans trace ni lien, aucune partie Parcours", async () => {
  const fetching = serveTrack(CLIMB);
  const { screen } = await renderPage();
  await loaded(screen);

  await expect
    .element(screen.getByRole("heading", { name: fr.route.title }))
    .not.toBeInTheDocument();
  expect(fetching).not.toHaveBeenCalled();
});

// --- The opening of the registration ---

const withOpening = {
  ...withDeadline,
  registration_opening: "2026-05-12",
  registration_opening_time: "10:00",
};

test("EventHero — l'ouverture et la date limite sur une ligne", async () => {
  const { screen } = await renderPage({ event: withOpening, today: "2026-05-01" });

  await loaded(screen);
  const line = screen.getByText(/^Ouverture des inscriptions/);
  await expect.element(line).toBeVisible();
  expect(plain(line.element().textContent)).toBe(
    "Ouverture des inscriptions le mar. 12 mai à 10:00 · jusqu'au mer. 10 juin",
  );
  expect(line.element().closest("[data-kind]")?.getAttribute("data-kind")).toBe("soon");
  await screen.unmount();

  // The day itself: « aujourd'hui », and still one line.
  const same = await renderPage({ event: withOpening, today: "2026-05-12" });
  await loaded(same.screen);
  expect(plain(same.screen.getByText(/^Ouverture des inscriptions/).element().textContent)).toBe(
    "Ouverture des inscriptions aujourd'hui à 10:00 · jusqu'au mer. 10 juin",
  );
  await same.screen.unmount();

  // Once it is open, the line is the deadline's.
  const open = await renderPage({ event: withOpening, today: "2026-05-13" });
  await loaded(open.screen);
  expect(plain(registrationLine(open.screen).element().textContent)).toBe(
    "Inscriptions jusqu'au mer. 10 juin",
  );
});

test("EventPage — un intéressé voit « Les inscriptions ouvrent le … »", async () => {
  signIn("bob");
  const { screen } = await renderPage({
    event: { ...withOpening, registration_url: "https://inscriptions.example.test/trail" },
    today: "2026-05-01",
  });

  await loaded(screen);
  const box = reminder(screen);
  await expect.element(box).toBeVisible();
  expect(plain(box.element().textContent)).toContain(
    "Les inscriptions ouvrent le mar. 12 mai à 10:00.",
  );
  expect(box.element().textContent).not.toContain("Pense à t'inscrire");
  await expect.element(box.getByRole("link", { name: fr.event.register })).toBeVisible();
});

/** The requests for the weather of an event (the page asks for the reminders by the same way). */
const weatherRequests = () =>
  mocks.send.mock.calls.map(([path]) => path).filter((path) => path.endsWith("/weather"));

// The weather (see features/weather): asked for from seven days before the race to its last day, never beyond.
test("EventPage — hors de la fenêtre, pas de requête : une ligne avant, rien après", async () => {
  // The event is on 13 and 14 June: on the 5th it is 8 days away, on the 15th it is over.
  const early = await renderPage({ today: "2026-06-05" });
  await loaded(early.screen);
  await expect.element(early.screen.getByText(fr.weather.notYet("sam. 6 juin"))).toBeVisible();
  await early.screen.unmount();

  const late = await renderPage({ today: "2026-06-15" });
  await loaded(late.screen);
  expect(late.screen.getByRole("heading", { name: fr.weather.title }).elements()).toHaveLength(0);
  await late.screen.unmount();
  expect(weatherRequests()).toEqual([]);
});

test("EventPage — la météo, après les actions", async () => {
  mocks.send.mockResolvedValue({
    status: "ok",
    place: { source: "place", name: "Annecy", detail: "Auvergne-Rhône-Alpes, France" },
    days: [
      {
        date: "2026-06-13",
        code: 80,
        tMin: 9.1,
        tMax: 17.3,
        rainChance: 60,
        rainMm: 2.1,
        windKmh: 20,
        gustKmh: 35,
      },
    ],
    fetchedAt: "2026-06-08T12:05:00Z",
    stale: false,
  });
  const { screen } = await renderPage({ today: "2026-06-08" });
  await loaded(screen);
  const title = screen.getByRole("heading", { level: 2, name: fr.weather.title });
  await expect.element(title).toBeVisible();
  expect(weatherRequests()).toEqual(["/api/app/events/event/weather"]);
  // After the actions, before the formats.
  const actions = document.querySelector(".event-actions");
  const section = title.element().closest("section");
  const firstFormat = document.querySelector(".format-section");
  expect(actions?.compareDocumentPosition(section ?? document) ?? 0).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(section?.compareDocumentPosition(firstFormat ?? document) ?? 0).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
});

test("EventPage — une épreuve qui a une heure de départ la dit près de son jour", async () => {
  const { screen } = await renderPage({
    event: {
      ...eventRecord,
      expand: {
        ...eventRecord.expand,
        formats_via_event: [
          { ...f42, start_time: "07:30", expand: { race_type: trailType } },
          { ...f15, expand: { race_type: roadType } },
        ],
      },
    },
  });

  await loaded(screen);
  const days = [...screen.container.querySelectorAll(".format-date")].map((element) =>
    (element.textContent ?? "").replaceAll(/\s+/g, " "),
  );
  expect(days).toHaveLength(2);
  expect(days.filter((text) => text.includes("départ à 7 h 30"))).toHaveLength(1);
  expect(days.find((text) => text.includes("départ"))).toMatch(/dim\. 14 juin · départ à 7 h 30/);
});

test("EventPage — le jour d'une course d'un jour n'est pas répété, mais l'heure de départ est dite", async () => {
  const { screen } = await renderPage({
    event: {
      ...event2Record,
      expand: {
        ...event2Record.expand,
        formats_via_event: [{ ...fLyon, start_time: "09:00", expand: { race_type: roadType } }],
      },
    },
  });

  await loaded(screen, "10 km de Lyon");
  const line = screen.container.querySelector(".format-date");
  expect((line?.textContent ?? "").replaceAll(/\s+/g, " ")).toBe("départ à 9 h 00");
});

test("EventPage — une course au mois ne dit aucune heure de départ", async () => {
  const { screen } = await renderPage({
    event: {
      ...eventRecord,
      start_date: "2027-06-01",
      end_date: "2027-06-30",
      date_precision: "month",
      expand: {
        ...eventRecord.expand,
        formats_via_event: [
          { ...f42, date: "", start_time: "07:30", expand: { race_type: trailType } },
          { ...f15, date: "", expand: { race_type: roadType } },
        ],
      },
    },
  });

  await loaded(screen);
  expect(screen.container.textContent).not.toContain("départ à");
});
