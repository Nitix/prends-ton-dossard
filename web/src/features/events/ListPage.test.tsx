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
  roadType,
  samRunner,
  trailType,
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
  for (const fn of [mocks.events, mocks.runners, mocks.raceTypes, mocks.myRunner]) fn.mockReset();
  mocks.user = aliceUser;
  mocks.events.mockResolvedValue([eventRecord, event2Record]);
  mocks.runners.mockResolvedValue([aliceRunner, bobRunner, samRunner]);
  mocks.raceTypes.mockResolvedValue([trailType, roadType]);
  mocks.myRunner.mockResolvedValue(aliceRunner);
});

/** The `YYYY-MM-DD` day of the tests: events are over or to come from there. */
const TODAY = "2026-06-01";

async function renderList(url = "/liste", languages = ["fr"]) {
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
  const router = createRouter({
    routeTree: root.addChildren([list, eventPage]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        <TodayProvider value={Temporal.PlainDate.from(TODAY)}>
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
  const measures = screen.getByText(/^Foulées de Lyon/);
  expect(plain(measures.element().textContent)).toBe("Foulées de Lyon · Route 10 km");
});

test("EventCard — sur plusieurs jours, chaque épreuve dit son jour", async () => {
  const { screen } = await renderList();
  await expect.element(screen.getByText("Trail des Crêtes")).toBeVisible();

  await expect.element(screen.getByText("sam. 13 juin", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("dim. 14 juin", { exact: true })).toBeVisible();
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
