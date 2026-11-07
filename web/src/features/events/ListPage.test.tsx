import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";
import { pixelURL } from "../../test/images";
import { EVENT_EXPAND } from "./api";
import { ListPage } from "./ListPage";
import { validateListSearch } from "./search";
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
  samRunner,
  trailType,
  withParticipations,
  withStatus,
} from "./testFixture";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  user: null as Rec | null,
  events: vi.fn<(options: Rec) => Promise<unknown>>(),
  runners: vi.fn<(options: Rec) => Promise<unknown>>(),
  raceTypes: vi.fn<(options: Rec) => Promise<unknown>>(),
  myRunner: vi.fn<(filter: string) => Promise<unknown>>(),
  getURL: vi.fn<(record: Rec, filename: string, options: Rec) => string>(),
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
        events: { getFullList: mocks.events },
        runners: { getFullList: mocks.runners, getFirstListItem: mocks.myRunner },
        race_types: { getFullList: mocks.raceTypes },
      })[name],
    // Only called for a runner who has a photo: none has, unless a test says so.
    files: { getURL: mocks.getURL },
  },
}));

// A third event, in July, with a format of its own.
const julyEvent = {
  ...event2Record,
  id: "event3",
  name: "Marathon de Paris",
  location: "Paris",
  start_date: "2026-07-05",
  expand: { formats_via_event: [{ ...fLyon, id: "fParis", event: "event3", distance_km: 42.195 }] },
};
// An event that is over by the first of June.
const pastEvent = {
  ...event2Record,
  id: "event0",
  name: "Cross de Mai",
  location: "Grenoble",
  start_date: "2026-05-10",
  expand: { formats_via_event: [{ ...fLyon, id: "fCross", event: "event0", distance_km: 6 }] },
};

const aliceUser = { id: "u-alice", collectionName: "users", role: "member" };

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(() => {
  for (const fn of [mocks.events, mocks.runners, mocks.raceTypes, mocks.myRunner, mocks.getURL]) {
    fn.mockReset();
  }
  mocks.user = aliceUser;
  mocks.events.mockResolvedValue([eventRecord, event2Record]);
  mocks.runners.mockResolvedValue([aliceRunner, bobRunner, samRunner]);
  mocks.raceTypes.mockResolvedValue([trailType, roadType]);
  mocks.myRunner.mockResolvedValue(aliceRunner);
});

/** The `YYYY-MM-DD` day of the tests: events are over or to come from there. */
const TODAY = "2026-06-01";

async function renderList(url = "/liste", languages = ["fr"], today = TODAY) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: Outlet });
  const list = createRoute({
    getParentRoute: () => root,
    path: "/liste",
    validateSearch: validateListSearch,
    component: () => <ListPage search={list.useSearch()} />,
  });
  const eventPage = createRoute({
    getParentRoute: () => root,
    path: "/evenements/$id",
    component: () => <p>Fiche</p>,
  });
  const stats = createRoute({
    getParentRoute: () => root,
    path: "/stats",
    component: () => <p>Page des statistiques</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([list, eventPage, stats]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        <TodayProvider value={Temporal.PlainDate.from(today)}>
          <RouterProvider router={router} />
        </TodayProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { screen, router, queryClient };
}

// Intl separates a number from its unit with a no-break space: tests read the
// text as it looks.
const plain = (s: string | null) => (s ?? "").replace(/\p{Zs}/gu, " ");

type Screen = Awaited<ReturnType<typeof renderList>>["screen"];

const headings = (screen: Screen) =>
  screen
    .getByRole("heading", { level: 2 })
    .elements()
    .map((element) => element.textContent);

const eventNames = (screen: Screen) =>
  screen
    .getByRole("heading", { level: 3 })
    .elements()
    .map((element) => element.textContent);

test("ListPage — groupe les événements par mois, avec le titre « juin 2026 »", async () => {
  const { screen } = await renderList();

  await expect.element(screen.getByRole("heading", { level: 1, name: fr.nav.list })).toBeVisible();
  await expect.element(screen.getByRole("heading", { level: 2, name: "juin 2026" })).toBeVisible();
  expect(headings(screen)).toEqual(["juin 2026"]);
  expect(eventNames(screen)).toEqual(["Trail des Crêtes", "10 km de Lyon"]);
});

test("ListPage — demande au serveur les événements à venir, avec leur expand", async () => {
  const { screen, queryClient } = await renderList();
  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();

  expect(mocks.events).toHaveBeenCalledOnce();
  const options = mocks.events.mock.calls[0]?.[0];
  expect(options).toMatchObject({ sort: "start_date", expand: EVENT_EXPAND });
  expect(options?.filter).toContain(`"t":"${TODAY}"`);
  expect(options?.filter).toContain("start_date >= {:t} || end_date >= {:t}");
  // The key of the query is ["events", query].
  const key = ["events", { period: "a-venir", today: Temporal.PlainDate.from(TODAY) }];
  expect(queryClient.getQueryData(key)).toHaveLength(2);
});

test("ListPage — trie les événements avant de les grouper, même si le serveur les donne en désordre", async () => {
  // July, June (the 22nd), June (the 13th): the groups must come in order, and
  // so must the cards in a group.
  mocks.events.mockResolvedValue([julyEvent, event2Record, eventRecord]);

  const { screen } = await renderList();

  await expect.element(screen.getByRole("heading", { level: 2, name: "juin 2026" })).toBeVisible();
  expect(headings(screen)).toEqual(["juin 2026", "juillet 2026"]);
  expect(eventNames(screen)).toEqual(["Trail des Crêtes", "10 km de Lyon", "Marathon de Paris"]);
});

test("ListPage — les événements passés vont du plus récent au plus ancien", async () => {
  // Given from the oldest to the latest.
  mocks.events.mockResolvedValue([pastEvent, { ...event2Record, start_date: "2026-05-30" }]);

  const { screen } = await renderList("/liste?periode=passees");

  await expect.element(screen.getByRole("heading", { level: 2, name: "mai 2026" })).toBeVisible();
  expect(headings(screen)).toEqual(["mai 2026"]);
  expect(eventNames(screen)).toEqual(["10 km de Lyon", "Cross de Mai"]);
  const options = mocks.events.mock.calls[0]?.[0];
  expect(options?.sort).toBe("-start_date");
  expect(options?.filter).toContain("start_date < {:t}");
});

test("ListPage — le lien « Statistiques » est en haut de la vue « passées », et pas dans la vue à venir", async () => {
  mocks.events.mockResolvedValue([pastEvent]);

  const past = await renderList("/liste?periode=passees");
  await expect.element(past.screen.getByText("Cross de Mai")).toBeVisible();
  const link = past.screen.getByRole("link", { name: fr.stats.link });
  expect(link.element().getAttribute("href")).toBe("/stats");
  expect(link.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  // At the top: before the filters and the events.
  const title = past.screen.getByRole("heading", { level: 1 }).element();
  const filters = past.screen.getByRole("group").element();
  expect(
    title.compareDocumentPosition(link.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    link.element().compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await link.click();
  await expect.element(past.screen.getByText("Page des statistiques")).toBeVisible();
  await past.screen.unmount();

  // The events to come have nothing to count yet.
  mocks.events.mockResolvedValue([eventRecord, event2Record]);
  const upcoming = await renderList();
  await expect.element(upcoming.screen.getByText("Trail des Crêtes")).toBeVisible();
  await expect
    .element(upcoming.screen.getByRole("link", { name: fr.stats.link }))
    .not.toBeInTheDocument();
});

test("ListPage — les mois passés sont du plus récent au plus ancien", async () => {
  mocks.events.mockResolvedValue([
    pastEvent,
    { ...pastEvent, id: "event-1", name: "Trail d'Avril", start_date: "2026-04-12" },
  ]);

  const { screen } = await renderList("/liste?periode=passees");

  await expect.element(screen.getByRole("heading", { level: 2, name: "mai 2026" })).toBeVisible();
  expect(headings(screen)).toEqual(["mai 2026", "avril 2026"]);
});

test("ListPage — une carte montre la date, le lieu, le nom et un lien vers la fiche", async () => {
  const { screen } = await renderList();

  const link = screen.getByRole("link", { name: "Trail des Crêtes" });
  await expect.element(link).toBeVisible();
  expect(link.element().getAttribute("href")).toBe("/evenements/event");
  await expect.element(screen.getByText("Annecy")).toBeVisible();
  await expect.element(screen.getByText("du sam. 13 juin au dim. 14 juin")).toBeVisible();
  // A single day has a single date.
  await expect.element(screen.getByText("lun. 22 juin")).toBeVisible();
});

test("ListPage — chaque épreuve montre ses mesures: distance, D+, et temps max avec une distance", async () => {
  const { screen } = await renderList();
  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();

  const text = (pattern: RegExp) => screen.getByText(pattern);
  await expect.element(text(/^Trail 42\s+km · 2\s400\s+m D\+ · max 10h$/)).toBeVisible();
  await expect.element(text(/^Trail 15\s+km · 700\s+m D\+$/)).toBeVisible();
  await expect.element(text(/^Route 10\s+km$/)).toBeVisible();
});

test("EventCard — affiche le temps max d'une épreuve qui a aussi une distance : « Trail 42 km · max 10h »", async () => {
  const noElevation = { ...f42, elevation_gain_m: 0 };
  mocks.events.mockResolvedValue([
    { ...eventRecord, expand: { formats_via_event: [noElevation] } },
  ]);

  const { screen } = await renderList();

  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();
  const measures = screen.getByText(/^Trail 42\s+km · max/);
  expect(plain(measures.element().textContent)).toBe("Trail 42 km · max 10h");
});

test("EventCard — le temps max d'une épreuve qui n'a que lui n'est dit qu'une fois", async () => {
  const backyard = {
    ...fLyon,
    distance_km: 0,
    time_limit_min: 2880,
    expand: { race_type: { ...roadType, label: "Backyard" } },
  };
  mocks.events.mockResolvedValue([{ ...event2Record, expand: { formats_via_event: [backyard] } }]);

  const { screen } = await renderList();

  await expect.element(screen.getByText("10 km de Lyon")).toBeVisible();
  expect(plain(screen.getByText(/^Backyard/).element().textContent)).toBe("Backyard max 48h");
});

test("EventCard — une épreuve nommée garde son nom et montre sa mesure", async () => {
  const named = { ...fLyon, name: "Foulées de Lyon" };
  mocks.events.mockResolvedValue([{ ...event2Record, expand: { formats_via_event: [named] } }]);

  const { screen } = await renderList();

  await expect.element(screen.getByText("10 km de Lyon")).toBeVisible();
  // The whole line: its first measure (here the name) is set apart in a span of its own.
  const measures = screen.getByText(/^Foulées de Lyon · /);
  expect(plain(measures.element().textContent)).toBe("Foulées de Lyon · Route 10 km");
});

test("EventCard — sur plusieurs jours, chaque épreuve dit son jour", async () => {
  const { screen } = await renderList();
  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();

  await expect.element(screen.getByText("sam. 13 juin", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("dim. 14 juin", { exact: true })).toBeVisible();
});

test("EventCard — le prix suit les caractéristiques de l'épreuve", async () => {
  const priced = { ...f42, price_eur: 65 };
  const cents = { ...fLyon, price_eur: 42.5 };
  mocks.events.mockResolvedValue([
    { ...eventRecord, expand: { formats_via_event: [priced] } },
    { ...event2Record, expand: { formats_via_event: [cents] } },
  ]);

  const { screen } = await renderList();

  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();
  // At the end of the line, after the elevation gain and the time limit; a round price has no cents.
  // (The whole line: its first measure is set apart in a span of its own.)
  expect(plain(screen.getByText(/^Trail 42\s+km · /).element().textContent)).toBe(
    "Trail 42 km · 2 400 m D+ · max 10h · 65 €",
  );
  expect(plain(screen.getByText(/^Route 10\s+km · /).element().textContent)).toBe(
    "Route 10 km · 42,50 €",
  );
});

test("EventCard — une épreuve sans prix (0) n'en montre pas", async () => {
  mocks.events.mockResolvedValue([
    { ...event2Record, expand: { formats_via_event: [{ ...fLyon, price_eur: 0 }] } },
  ]);

  const { screen } = await renderList();

  await expect.element(screen.getByText("10 km de Lyon")).toBeVisible();
  expect(plain(screen.getByText(/^Route 10/).element().textContent)).toBe("Route 10 km");
});

const withDeadline = { ...eventRecord, registration_deadline: "2026-06-10" };

test("EventCard — « Inscriptions jusqu'au … » puis « Inscriptions closes » une fois la date passée", async () => {
  mocks.events.mockResolvedValue([withDeadline]);

  // On 1 June the deadline of the 10th is ahead, under the place.
  const open = await renderList("/liste", ["fr"], "2026-06-01");
  await expect.element(open.screen.getByText("Trail des Crêtes")).toBeVisible();
  const until = open.screen.getByText(fr.event.registrationUntil("mer. 10 juin"), { exact: true });
  await expect.element(until).toBeVisible();
  await expect.element(open.screen.getByText(fr.event.registrationClosed)).not.toBeInTheDocument();
  const place = open.screen.getByText("Annecy", { exact: true });
  expect(until.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
    place.element().getBoundingClientRect().bottom,
  );
  expect(plain(until.element().textContent)).toBe("Inscriptions jusqu'au mer. 10 juin");
  await open.screen.unmount();

  // On the 11th it is closed, and the event is still to come (the 13th): said in words.
  const closed = await renderList("/liste", ["fr"], "2026-06-11");
  await expect.element(closed.screen.getByText("Trail des Crêtes")).toBeVisible();
  await expect
    .element(closed.screen.getByText(fr.event.registrationClosed, { exact: true }))
    .toBeVisible();
  await expect.element(closed.screen.getByText(/Inscriptions jusqu/)).not.toBeInTheDocument();
});

test("EventCard — le jour de la date limite, l'inscription est encore ouverte", async () => {
  mocks.events.mockResolvedValue([withDeadline]);

  const { screen } = await renderList("/liste", ["fr"], "2026-06-10");

  await expect
    .element(screen.getByText(fr.event.registrationUntil("mer. 10 juin"), { exact: true }))
    .toBeVisible();
  await expect.element(screen.getByText(fr.event.registrationClosed)).not.toBeInTheDocument();
});

test("EventCard — sans date limite, pas de ligne d'inscription", async () => {
  const { screen } = await renderList();
  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();

  expect(screen.container.textContent).not.toContain("Inscriptions");
});

test("EventCard — en anglais, « Registration until … » et « Registration closed »", async () => {
  mocks.events.mockResolvedValue([withDeadline]);

  const open = await renderList("/liste", ["en-GB"], "2026-06-01");
  await expect
    .element(open.screen.getByText("Registration until Wed 10 Jun", { exact: true }))
    .toBeVisible();
  await open.screen.unmount();

  const closed = await renderList("/liste", ["en-GB"], "2026-06-11");
  await expect
    .element(closed.screen.getByText("Registration closed", { exact: true }))
    .toBeVisible();
});

test("EventCard — un « Non partant » n'a pas de pastille ; un « Abandon » en a une", async () => {
  mocks.events.mockResolvedValue([withStatus(eventRecord, "p2", "dns")]);
  const { screen, queryClient } = await renderList();
  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();

  // Bob did not start: he is not on the card. The others are. (The names are
  // also in the options of the filter: the card is where to look.)
  const card = screen.getByRole("article").filter({ hasText: "Trail des Crêtes" });
  await expect.element(card.getByText("Alice", { exact: true })).toBeInTheDocument();
  await expect.element(card.getByText("Bob", { exact: true })).not.toBeInTheDocument();
  await expect.element(card.getByText("Sam", { exact: true })).toBeInTheDocument();

  // "Did not finish" is a start: the chip is there.
  mocks.events.mockResolvedValue([withStatus(eventRecord, "p2", "dnf")]);
  await queryClient.invalidateQueries({ queryKey: ["events"] });
  await expect.element(card.getByText("Bob", { exact: true })).toBeInTheDocument();
});

test("EventCard — les intéressés sans épreuve ont leurs pastilles sous « Format à choisir », dit en texte", async () => {
  mocks.events.mockResolvedValue([withParticipations(eventRecord, [pNinaUndecided]), event2Record]);
  const { screen } = await renderList();
  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();

  // The words say it: the chips are not told apart by their place alone.
  const label = screen.getByText(fr.event.formatToChoose, { exact: true });
  await expect.element(label).toBeVisible();
  const chips = screen.getByRole("list", { name: fr.event.interestedTitle });
  await expect.element(chips.getByText("Nina", { exact: true })).toBeInTheDocument();
  expect(chips.getByRole("listitem").elements()).toHaveLength(1);
  // The chip is the usual one: Nina added herself, so it is confirmed.
  expect(chips.element().textContent).not.toContain(fr.event.unconfirmed);
  // Before the formats, and only on the event that has such participations.
  const firstFormat = screen.getByText(/^Trail 42\s+km/);
  expect(label.element().getBoundingClientRect().top).toBeLessThan(
    firstFormat.element().getBoundingClientRect().top,
  );
  expect(screen.getByText(fr.event.formatToChoose).elements()).toHaveLength(1);
});

test("EventCard — un événement sans intéressés sans épreuve n'a pas de ligne « Format à choisir »", async () => {
  const { screen } = await renderList();
  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();

  await expect.element(screen.getByText(fr.event.formatToChoose)).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("list", { name: fr.event.interestedTitle }))
    .not.toBeInTheDocument();
});

test("EventCard — en anglais, la ligne des intéressés dit « Race to pick »", async () => {
  mocks.events.mockResolvedValue([withParticipations(eventRecord, [pNinaUndecided])]);
  const { screen } = await renderList("/liste", ["en-GB"]);
  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();

  await expect.element(screen.getByText("Race to pick", { exact: true })).toBeVisible();
  await expect
    .element(
      screen
        .getByRole("list", { name: "Interested, race to pick" })
        .getByText("Nina", { exact: true }),
    )
    .toBeInTheDocument();
});

test("EventCard — les supporteurs ont leurs pastilles sous « Supporteurs »", async () => {
  mocks.events.mockResolvedValue([withParticipations(eventRecord, [pNinaSupporter]), event2Record]);
  const { screen } = await renderList();
  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();

  // The words say it: the chips are not told apart by their place alone.
  const label = screen.getByText(fr.event.supportersTitle, { exact: true });
  await expect.element(label).toBeVisible();
  const chips = screen.getByRole("list", { name: fr.event.supportersTitle });
  await expect.element(chips.getByText("Nina", { exact: true })).toBeInTheDocument();
  expect(chips.getByRole("listitem").elements()).toHaveLength(1);
  // The chip is the usual one: Nina added herself, so it is confirmed.
  expect(chips.element().textContent).not.toContain(fr.event.unconfirmed);
  // After the formats, with their chips.
  const lastFormat = screen.getByText(/^Trail 42\s+km/);
  expect(label.element().getBoundingClientRect().top).toBeGreaterThan(
    lastFormat.element().getBoundingClientRect().bottom,
  );
  // A supporter starts nothing: she is not among the runners of a format, nor among the interested.
  const card = screen.getByRole("article").filter({ hasText: "Trail des Crêtes" });
  await expect
    .element(card.getByRole("list", { name: fr.event.participants }).getByText("Nina"))
    .not.toBeInTheDocument();
  await expect.element(screen.getByText(fr.event.formatToChoose)).not.toBeInTheDocument();
  // Only on the event that has supporters.
  expect(screen.getByText(fr.event.supportersTitle, { exact: true }).elements()).toHaveLength(1);
});

test("EventCard — un événement sans supporteurs n'a pas de ligne « Supporteurs »", async () => {
  const { screen } = await renderList();
  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();

  await expect.element(screen.getByText(fr.event.supportersTitle)).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("list", { name: fr.event.supportersTitle }))
    .not.toBeInTheDocument();
});

test("EventCard — en anglais, la ligne des supporteurs dit « Supporters »", async () => {
  mocks.events.mockResolvedValue([withParticipations(eventRecord, [pNinaSupporter])]);
  const { screen } = await renderList("/liste", ["en-GB"]);
  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();

  await expect.element(screen.getByText("Supporters", { exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("list", { name: "Supporters" }).getByText("Nina", { exact: true }))
    .toBeInTheDocument();
});

test("ParticipantChips — la puce de Bob, non confirmée, le dit en texte, en pointillés, avec son auteur", async () => {
  const { screen } = await renderList();
  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();

  const chips = screen
    .getByRole("list", { name: fr.event.participants })
    .filter({ hasText: "Bob" })
    .getByRole("listitem");
  const bob = chips.filter({ hasText: "Bob" });
  const alice = chips.filter({ hasText: "Alice" });

  expect(bob.element().textContent).toContain(fr.event.unconfirmed);
  await expect.element(bob.getByText(fr.event.unconfirmed)).toBeInTheDocument();
  expect(bob.element().getAttribute("title")).toBe(fr.event.addedBy("Alice"));
  expect(getComputedStyle(bob.element()).borderStyle).toBe("dashed");

  // Alice confirmed: a solid border, nothing to read out.
  expect(alice.element().textContent).not.toContain(fr.event.unconfirmed);
  expect(getComputedStyle(alice.element()).borderStyle).toBe("solid");
});

test("ParticipantChips — les puces montrent les initiales, et le nom reste lisible", async () => {
  const { screen } = await renderList();
  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();

  const bob = screen
    .getByRole("list", { name: fr.event.participants })
    .filter({ hasText: "Bob" })
    .getByRole("listitem")
    .filter({ hasText: "Bob" });

  await expect.element(bob.getByText("B", { exact: true })).toBeVisible();
  await expect.element(bob.getByText("Bob", { exact: true })).toBeInTheDocument();
});

test("ParticipantChips — avec une photo, l'image remplace les initiales ; la puce non confirmée garde ses pointillés et son texte", async () => {
  mocks.getURL.mockImplementation(() => pixelURL());
  const bob = { ...bobRunner, avatar: "bob_x1y2z3.webp" };
  mocks.events.mockResolvedValue([
    {
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
  ]);
  const { screen } = await renderList();
  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();

  const chips = screen
    .getByRole("list", { name: fr.event.participants })
    .filter({ hasText: "Bob" })
    .getByRole("listitem");
  const chip = chips.filter({ hasText: "Bob" });

  // The photo fills the chip, on the 96x96 thumb, with no text of its own.
  const image = chip.element().querySelector("img");
  expect(image?.getAttribute("src")).toBe(pixelURL());
  expect(image?.getAttribute("alt")).toBe("");
  expect(mocks.getURL).toHaveBeenCalledWith(
    expect.objectContaining({ id: bobRunner.id }),
    "bob_x1y2z3.webp",
    { thumb: "96x96" },
  );
  await expect.element(chip.getByText("B", { exact: true })).not.toBeInTheDocument();
  // He has not confirmed: still dashed, still said in words, still with who added him.
  expect(getComputedStyle(chip.element()).borderStyle).toBe("dashed");
  await expect.element(chip.getByText(fr.event.unconfirmed)).toBeInTheDocument();
  expect(chip.element().getAttribute("title")).toBe(fr.event.addedBy("Alice"));
  await expect.element(chip.getByText("Bob", { exact: true })).toBeInTheDocument();
  // Alice has no photo: her initial stays, and the other chips are not touched.
  const alice = chips.filter({ hasText: "Alice" });
  await expect.element(alice.getByText("A", { exact: true })).toBeVisible();
  expect(alice.element().querySelector("img")).toBeNull();
});

test("ParticipantChips — la photo remplit le rond de 36 px, sans le déformer", async () => {
  mocks.getURL.mockImplementation(() => pixelURL());
  const bob = { ...bobRunner, avatar: "bob_x1y2z3.webp" };
  mocks.events.mockResolvedValue([
    {
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
  ]);
  const { screen } = await renderList();
  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();

  const chip = screen
    .getByRole("list", { name: fr.event.participants })
    .filter({ hasText: "Bob" })
    .getByRole("listitem")
    .filter({ hasText: "Bob" })
    .element();
  const image = chip.querySelector("img");
  expect(chip.getBoundingClientRect().width).toBe(36);
  expect(chip.getBoundingClientRect().height).toBe(36);
  // Inside the 2 px border (dashed: Bob has not confirmed): the whole round, and it is a round.
  expect(image?.getBoundingClientRect().width).toBe(32);
  expect(image?.getBoundingClientRect().height).toBe(32);
  expect(getComputedStyle(image ?? chip).objectFit).toBe("cover");
  expect(getComputedStyle(image ?? chip).borderRadius).not.toBe("0px");
});

test("ParticipantChips — les initiales d'un nom composé", async () => {
  const marie = { ...aliceRunner, id: "marie0000000000", name: "Marie-Claire Dupont" };
  const record = {
    ...event2Record,
    expand: {
      ...event2Record.expand,
      participations_via_event: [
        { ...eventParticipation(marie.id), expand: { runner: marie, added_by: marie } },
      ],
    },
  };
  mocks.events.mockResolvedValue([record]);

  const { screen } = await renderList();

  await expect.element(screen.getByText("MD", { exact: true })).toBeVisible();
});

function eventParticipation(runner: string) {
  return {
    id: "px",
    created: "",
    updated: "",
    collectionId: "",
    collectionName: "",
    runner,
    event: "event2",
    format: "fLyon",
    status: "registered",
    confirmed: true,
    added_by: runner,
  };
}

test("ListPage — ?personne=moi se résout en coureur courant", async () => {
  const { screen } = await renderList("/liste?personne=moi");

  await expect.element(screen.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();
  // Alice is on the first event only.
  await expect.element(screen.getByText("10 km de Lyon")).not.toBeInTheDocument();
  expect(mocks.myRunner).toHaveBeenCalled();
  await expect.element(screen.getByLabelText(fr.filters.person)).toHaveValue("moi");
});

test("ListPage — ?personne=moi attend le coureur courant au lieu d'afficher tout le monde", async () => {
  mocks.myRunner.mockReturnValue(new Promise(() => {}));

  const { screen } = await renderList("/liste?personne=moi");

  await expect.element(screen.getByText(fr.common.loading)).toBeVisible();
  await expect.element(screen.getByText("Trail des Crêtes")).not.toBeInTheDocument();
  await expect.element(screen.getByText("10 km de Lyon")).not.toBeInTheDocument();
});

test("ListPage — ?personne=<id> garde les événements de ce coureur", async () => {
  const { screen } = await renderList(`/liste?personne=${bobRunner.id}`);

  await expect.element(screen.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();
  await expect.element(screen.getByText("10 km de Lyon")).not.toBeInTheDocument();
  await expect.element(screen.getByLabelText(fr.filters.person)).toHaveValue(bobRunner.id);
});

test("ListPage — ?personne=<id> garde un événement où ce coureur est intéressé sans épreuve", async () => {
  mocks.runners.mockResolvedValue([aliceRunner, bobRunner, ninaRunner, samRunner]);
  mocks.events.mockResolvedValue([withParticipations(eventRecord, [pNinaUndecided]), event2Record]);

  const { screen } = await renderList(`/liste?personne=${ninaRunner.id}`);

  await expect.element(screen.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();
  await expect.element(screen.getByText("10 km de Lyon")).not.toBeInTheDocument();
  await expect.element(screen.getByLabelText(fr.filters.person)).toHaveValue(ninaRunner.id);
});

test("ListPage — ?personne=<id> garde un événement où ce coureur est supporteur", async () => {
  mocks.runners.mockResolvedValue([aliceRunner, bobRunner, ninaRunner, samRunner]);
  mocks.events.mockResolvedValue([withParticipations(eventRecord, [pNinaSupporter]), event2Record]);

  const { screen } = await renderList(`/liste?personne=${ninaRunner.id}`);

  // A supporter is on the event, whatever she does there: it is not a "not starting".
  await expect.element(screen.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();
  await expect.element(screen.getByText("10 km de Lyon")).not.toBeInTheDocument();
  await expect.element(screen.getByLabelText(fr.filters.person)).toHaveValue(ninaRunner.id);
});

test("ListPage — ?personne=<id> ne garde pas un événement où ce coureur n'est que non partant", async () => {
  // Bob is only on F42 of the first event, and he does not start it.
  mocks.events.mockResolvedValue([withStatus(eventRecord, "p2", "dns"), event2Record]);

  const { screen } = await renderList(`/liste?personne=${bobRunner.id}`);

  await expect.element(screen.getByText(fr.list.empty)).toBeVisible();
  await expect.element(screen.getByText("Trail des Crêtes")).not.toBeInTheDocument();
  await expect.element(screen.getByText("10 km de Lyon")).not.toBeInTheDocument();
});

test("ListPage — ?type=<id> garde les événements qui ont une épreuve de ce type", async () => {
  const { screen } = await renderList(`/liste?type=${roadType.id}`);

  await expect.element(screen.getByRole("link", { name: "10 km de Lyon" })).toBeVisible();
  await expect.element(screen.getByText("Trail des Crêtes")).not.toBeInTheDocument();
  await expect.element(screen.getByLabelText(fr.filters.type)).toHaveValue(roadType.id);
});

test("Filters — choisir une personne l'écrit dans l'URL et filtre la liste", async () => {
  const { screen, router } = await renderList();
  await expect.element(screen.getByText("10 km de Lyon")).toBeVisible();

  await screen.getByLabelText(fr.filters.person).selectOptions(bobRunner.id);

  await expect.element(screen.getByText("10 km de Lyon")).not.toBeInTheDocument();
  expect(router.state.location.search).toEqual({ personne: bobRunner.id });
  expect(mocks.events).toHaveBeenCalledOnce();

  await screen.getByLabelText(fr.filters.person).selectOptions("");

  await expect.element(screen.getByText("10 km de Lyon")).toBeVisible();
  expect(router.state.location.search).toEqual({});
});

test("Filters — choisir un type et une période l'écrit dans l'URL", async () => {
  const { screen, router } = await renderList();
  await expect.element(screen.getByText("10 km de Lyon")).toBeVisible();

  await screen.getByLabelText(fr.filters.type).selectOptions(roadType.id);
  await screen.getByLabelText(fr.filters.period).selectOptions("passees");

  await vi.waitFor(() => {
    expect(router.state.location.search).toEqual({ type: roadType.id, periode: "passees" });
  });
  // The period is a request to the server.
  await vi.waitFor(() => {
    expect(mocks.events.mock.calls.at(-1)?.[0]).toMatchObject({ sort: "-start_date" });
  });

  // Back to the default period: it leaves the URL.
  await screen.getByLabelText(fr.filters.period).selectOptions("a-venir");
  await vi.waitFor(() => {
    expect(router.state.location.search).toEqual({ type: roadType.id });
  });
});

test("Filters — « moi » est proposé et les coureurs sont listés par nom", async () => {
  const { screen } = await renderList();
  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();

  const select = screen.getByLabelText(fr.filters.person);
  await expect.element(select.getByRole("option", { name: "Bob" })).toBeInTheDocument();
  const options = select
    .getByRole("option")
    .elements()
    .map((element) => element.textContent);
  expect(options).toEqual([fr.filters.everyone, fr.filters.me, "Alice", "Bob", "Sam"]);
});

test("ListPage — un état vide quand aucun événement ne correspond", async () => {
  mocks.events.mockResolvedValue([]);

  const { screen } = await renderList();

  await expect.element(screen.getByText(fr.list.empty)).toBeVisible();
  await expect.element(screen.getByRole("heading", { level: 2 })).not.toBeInTheDocument();
});

test("ListPage — un état vide aussi quand les filtres écartent tout", async () => {
  const { screen } = await renderList("/liste?personne=nobody0000000");

  await expect.element(screen.getByText(fr.list.empty)).toBeVisible();
});

test("ListPage — une erreur de chargement se signale et se retente", async () => {
  mocks.events.mockRejectedValueOnce(new Error("network"));

  const { screen } = await renderList();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await screen.getByRole("button", { name: fr.common.retry }).click();

  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});

test("ListPage — en anglais, les textes et les dates suivent la langue", async () => {
  const { screen } = await renderList("/liste", ["en-GB"]);

  await expect.element(screen.getByRole("heading", { level: 2, name: "June 2026" })).toBeVisible();
  const bob = screen
    .getByRole("list", { name: "Participants" })
    .filter({ hasText: "Bob" })
    .getByRole("listitem")
    .filter({ hasText: "Bob" });
  expect(bob.element().textContent).toContain("not confirmed");
  expect(bob.element().getAttribute("title")).toBe("Added by Alice");
  await expect
    .element(screen.getByText(/^Trail 42\s+km · 2,400\s+m gain · max 10h$/))
    .toBeVisible();
});

test("ListPage — zones tactiles d'au moins 44 px", async () => {
  await page.viewport(390, 844);
  const { screen } = await renderList();
  await expect.element(screen.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();

  const targets = [
    screen.getByRole("link", { name: "Trail des Crêtes" }),
    screen.getByLabelText(fr.filters.person),
    screen.getByLabelText(fr.filters.type),
    screen.getByLabelText(fr.filters.period),
  ];
  for (const target of targets) {
    const { width, height } = target.element().getBoundingClientRect();
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
  }
  await page.viewport(414, 896);
});

/** The columns of a grid, as the browser lays it out (`none`, for what is not a grid, is one). */
const columnsOf = (list: Element) => {
  const tracks = getComputedStyle(list).gridTemplateColumns;
  return tracks === "none" ? 1 : tracks.split(" ").length;
};

test("ListPage — les événements d'un mois sont sur deux colonnes dès `md` (48 rem), sur une seule en dessous", async () => {
  // Three events in June: a second row, whose card has no neighbour.
  mocks.events.mockResolvedValue([
    eventRecord,
    event2Record,
    { ...event2Record, id: "event4", name: "Cross du Salève", start_date: "2026-06-27" },
  ]);
  try {
    await page.viewport(767, 900);
    const { screen } = await renderList();
    await expect.element(screen.getByText("Cross du Salève")).toBeVisible();
    const list = document.querySelector(".event-list");
    if (!list) throw new Error("no list of events");
    // Under `md`: one card per row, as on a phone.
    expect(columnsOf(list), "767 px").toBe(1);
    const cards = [...list.querySelectorAll(".event-card")];
    expect(new Set(cards.map((card) => card.getBoundingClientRect().left)).size).toBe(1);

    for (const width of [768, 1024, 1280]) {
      await page.viewport(width, 900);
      expect(columnsOf(list), `${width} px`).toBe(2);
      const lefts = cards.map((card) => Math.round(card.getBoundingClientRect().left));
      // The first two side by side, the third under the first.
      expect(lefts[1], `${width} px: the second card is beside the first`).toBeGreaterThan(
        lefts[0] ?? 0,
      );
      expect(lefts[2], `${width} px: the third is under the first`).toBe(lefts[0]);
    }
  } finally {
    await page.viewport(414, 896);
  }
});

test("EventCard — la pastille d'ouverture", async () => {
  const opening = {
    ...withDeadline,
    registration_opening: "2026-06-05",
    registration_opening_time: "10:00",
  };
  mocks.events.mockResolvedValue([opening]);

  // Before the day: the date and the time, in words.
  const soon = await renderList("/liste", ["fr"], "2026-06-01");
  await expect.element(soon.screen.getByText("Trail des Crêtes")).toBeVisible();
  const chip = soon.screen.getByText(/^Ouverture le/);
  await expect.element(chip).toBeVisible();
  expect(plain(chip.element().textContent)).toBe("Ouverture le 5 juin à 10:00");
  expect(chip.element().getAttribute("data-kind")).toBe("soon");
  const soonLook = getComputedStyle(chip.element()).backgroundColor;
  await soon.screen.unmount();

  // The day itself.
  const today = await renderList("/liste", ["fr"], "2026-06-05");
  const chipToday = today.screen.getByText(/^Ouverture aujourd/);
  await expect.element(chipToday).toBeVisible();
  expect(plain(chipToday.element().textContent)).toBe("Ouverture aujourd'hui à 10:00");
  expect(chipToday.element().getAttribute("data-kind")).toBe("today");
  await today.screen.unmount();

  // It has the peach look of an open registration.
  const open = await renderList("/liste", ["fr"], "2026-06-06");
  const until = open.screen.getByText(/^Inscriptions jusqu/);
  await expect.element(until).toBeVisible();
  expect(getComputedStyle(until.element()).backgroundColor).toBe(soonLook);
});
