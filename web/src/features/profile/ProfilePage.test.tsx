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
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";
import { pixelURL } from "../../test/images";
import {
  aliceRunner,
  bobRunner,
  event2Record,
  eventRecord,
  f42,
  fLyon,
  p1,
} from "../events/testFixture";
import { ProfilePage } from "./ProfilePage";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  store: { record: null as Rec | null },
  sessionRunner: vi.fn<(filter: string) => Promise<unknown>>(),
  runners: vi.fn<(options?: Rec) => Promise<unknown>>(),
  events: vi.fn<(options: Rec) => Promise<unknown>>(),
  results: vi.fn<(options: Rec) => Promise<unknown>>(),
  getURL: vi.fn<(record: Rec, filename: string, options: Rec) => string>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: {
      // A new object on every read, like the SDK's LocalAuthStore.
      get record() {
        return mocks.store.record && { ...mocks.store.record };
      },
      onChange: () => () => {},
    },
    filter: (raw: string, params: Rec) => `${raw} ${JSON.stringify(params)}`,
    collection: (name: string) =>
      ({
        runners: { getFirstListItem: mocks.sessionRunner, getFullList: mocks.runners },
        events: { getFullList: mocks.events },
        participations: { getFullList: mocks.results },
      })[name],
    // Only called for a runner who has a photo: none has, unless a test says so.
    files: { getURL: mocks.getURL },
  },
}));

/** The day of the tests: the races of the results are behind, the ones of the events are ahead. */
const TODAY = "2026-11-01";

const ALICE = {
  id: "u-alice",
  collectionName: "users",
  email: "alice@example.test",
  role: "member",
  updated: "2026-10-01 08:00:00.000Z",
};

/** A participation of Alice, who has confirmed it unless the test says otherwise. */
function mine(id: string, event: Rec, format: Rec | null, status: string, more: Rec = {}): Rec {
  return {
    ...p1,
    id,
    event: event.id,
    format: format?.id ?? "",
    status,
    confirmed: true,
    ...more,
  };
}

/** A format of an event, on a day of its own unless it has none. */
function formatOf(id: string, event: Rec, model: Rec, date: string, more: Rec = {}): Rec {
  return { ...model, id, event: event.id, date, ...more };
}

// On 21 and 22 November: the trail of 42 km on the first day, a short race on
// the second. Alice is registered on the trail, and is not starting the short
// one. Bob is on the trail too.
const autumn: Rec = {
  ...eventRecord,
  id: "eventAutumn",
  name: "Trail d'Automne",
  start_date: "2026-11-21",
  end_date: "2026-11-22",
};
const autumn42 = formatOf("fAutumn42", autumn, f42, "2026-11-21");
const autumn10 = formatOf("fAutumn10", autumn, fLyon, "2026-11-22");
const autumnEvent: Rec = {
  ...autumn,
  expand: {
    formats_via_event: [autumn10, autumn42],
    participations_via_event: [
      mine("pAutumn10", autumn, autumn10, "dns"),
      mine("pAutumn42", autumn, autumn42, "registered"),
      {
        ...mine("pAutumnBob", autumn, autumn42, "interested", { runner: bobRunner.id }),
        expand: { runner: bobRunner },
      },
    ],
  },
};

// On 5 December, one day: Alice comes to cheer, on the event alone.
const winter: Rec = {
  ...event2Record,
  id: "eventWinter",
  name: "Foulées d'Hiver",
  start_date: "2026-12-05",
  end_date: "",
};
const winter10 = formatOf("fWinter10", winter, fLyon, "");
const winterEvent: Rec = {
  ...winter,
  expand: {
    formats_via_event: [winter10],
    participations_via_event: [mine("pWinter", winter, null, "supporter")],
  },
};

// On 16 January: Alice is interested in a race that has a name of its own, and
// has not confirmed it (somebody else added her).
const january: Rec = {
  ...eventRecord,
  id: "eventJanuary",
  name: "Ultra de Janvier",
  start_date: "2027-01-16",
  end_date: "",
};
const january100 = formatOf("fJanuary100", january, f42, "", { name: "L'Ultra", distance_km: 100 });
const januaryEvent: Rec = {
  ...january,
  expand: {
    formats_via_event: [january100],
    participations_via_event: [
      mine("pJanuary", january, january100, "interested", { confirmed: false }),
    ],
  },
};

// What Alice has run: the trail of 42 km in June 2026, and the year before.
function result(id: string, event: Rec, format: Rec, day: string, more: Rec): Rec {
  return {
    ...p1,
    id,
    event: event.id,
    format: format.id,
    status: "finished",
    ...more,
    expand: {
      runner: aliceRunner,
      event: { ...event, start_date: day, end_date: "" },
      format: { ...format, date: day },
    },
  };
}
const trail2026 = result("r1", eventRecord, f42, "2026-06-14", {
  finish_time_s: 15_150,
  rank: 12,
  rank_of: 340,
});
const trail2025 = result("r2", eventRecord, f42, "2025-06-15", { finish_time_s: 16_000 });
// In no particular order: the page sorts.
const aliceResults = [trail2025, trail2026];

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(() => {
  for (const fn of Object.values(mocks)) {
    if (vi.isMockFunction(fn)) fn.mockReset();
  }
  mocks.store.record = ALICE;
  mocks.sessionRunner.mockResolvedValue(aliceRunner);
  mocks.runners.mockResolvedValue([aliceRunner, bobRunner]);
  // In no particular order: the page sorts.
  mocks.events.mockResolvedValue([januaryEvent, autumnEvent, winterEvent]);
  mocks.results.mockResolvedValue(aliceResults);
});

/** The page, in a router that knows the pages it links to. */
async function renderProfile() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: Outlet });
  const profile = createRoute({
    getParentRoute: () => root,
    path: "/profil",
    component: ProfilePage,
  });
  const settings = createRoute({
    getParentRoute: () => root,
    path: "/profil/reglages",
    component: () => <p>Page des réglages</p>,
  });
  const stats = createRoute({
    getParentRoute: () => root,
    path: "/stats",
    component: () => <p>Page des statistiques</p>,
  });
  const eventPage = createRoute({
    getParentRoute: () => root,
    path: "/evenements/$id",
    component: () => <p>Fiche</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([profile, settings, stats, eventPage]),
    history: createMemoryHistory({ initialEntries: ["/profil"] }),
  });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={["fr"]}>
        <TodayProvider value={Temporal.PlainDate.from(TODAY)}>
          <RouterProvider router={router} />
        </TodayProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { screen, router };
}

// Intl separates a number from its unit with a no-break space: tests read the
// text as it looks.
const plain = (s: string | null) => (s ?? "").replace(/\p{Zs}/gu, " ");

type Screen = Awaited<ReturnType<typeof renderProfile>>["screen"];

/** A section of the page, by its heading. */
function section(screen: Screen, title: string) {
  return screen.getByRole("region", { name: title, exact: true });
}

/** The lines of each race of « Mes prochaines courses », as they look. */
function upcomingRows(screen: Screen): string[][] {
  return section(screen, fr.profile.upcoming)
    .getByRole("listitem")
    .elements()
    .map((item) => [...item.children].map((line) => plain(line.textContent)));
}

/** The second element is after the first in the page. */
function follows(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

test("ProfilePage — montre son coureur : photo, nom, bilan, historique", async () => {
  mocks.getURL.mockImplementation(() => pixelURL());
  const withPhoto = { ...aliceRunner, avatar: "alice_x1y2z3.webp" };
  mocks.sessionRunner.mockResolvedValue(withPhoto);
  mocks.runners.mockResolvedValue([withPhoto, bobRunner]);

  const { screen } = await renderProfile();

  // The name is the title of the page: the only one.
  await expect.element(screen.getByRole("heading", { level: 1, name: "Alice" })).toBeVisible();
  expect(screen.getByRole("heading", { level: 1 }).elements()).toHaveLength(1);
  // The photo is the one of the page of a runner: big, and named by the title next to it.
  const image = screen.container.querySelector("img");
  expect(image?.getAttribute("src")).toBe(pixelURL());
  expect(image?.getAttribute("alt")).toBe("");
  expect(mocks.getURL.mock.calls[0]?.[2]).toEqual({ thumb: "256x256" });

  // The year by year, the latest year first.
  const years = section(screen, fr.runner.years);
  await expect.element(years.getByRole("table", { name: fr.runner.years })).toBeVisible();
  const rows = years
    .getByRole("row")
    .elements()
    .slice(1)
    .map((row) => [...row.querySelectorAll("th, td")].map((cell) => plain(cell.textContent)));
  expect(rows).toEqual([
    ["2026", "1", "0", "42 km", "2 400 m", "4h 12min 30s"],
    ["2025", "1", "0", "42 km", "2 400 m", "4h 26min 40s"],
  ]);

  // The history, the latest race first.
  const history = section(screen, fr.runner.history);
  expect(
    history
      .getByRole("listitem")
      .elements()
      .map((item) => [...item.children].map((line) => plain(line.textContent))),
  ).toEqual([
    [
      "Trail des Crêtes",
      "Trail 42 km · Terminé",
      "dim. 14 juin 2026",
      "4h 12min 30s · 12e sur 340",
    ],
    ["Trail des Crêtes", "Trail 42 km · Terminé", "dim. 15 juin 2025", "4h 26min 40s"],
  ]);
  // Results of this runner, not of another one.
  const options = mocks.results.mock.calls[0]?.[0];
  expect(options?.filter).toContain(`"runner":"${aliceRunner.id}"`);
});

test("ProfilePage — « Mes prochaines courses » du plus proche au plus lointain, chacune vers sa fiche", async () => {
  const { screen } = await renderProfile();

  const upcoming = section(screen, fr.profile.upcoming);
  await expect.element(upcoming.getByRole("link", { name: "Trail d'Automne" })).toBeVisible();
  // The date, the event, the race that has one, and the status, in words: the nearest first.
  expect(upcomingRows(screen)).toEqual([
    ["Trail d'Automne", "Trail 42 km · Inscrit", "sam. 21 nov. 2026"],
    ["Foulées d'Hiver", "Supporteur", "sam. 5 déc. 2026"],
    // A name of its own is the name of the race, and what is not confirmed says so.
    ["Ultra de Janvier", "L'Ultra · Intéressé", "sam. 16 janv. 2027", fr.event.unconfirmed],
  ]);
  // Each one is a link to the page of its event, big enough to tap.
  for (const [name, id] of [
    ["Trail d'Automne", "eventAutumn"],
    ["Foulées d'Hiver", "eventWinter"],
    ["Ultra de Janvier", "eventJanuary"],
  ] as const) {
    const link = upcoming.getByRole("link", { name });
    await expect.element(link).toHaveAttribute("href", `/evenements/${id}`);
    expect(link.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
  // « Non partant » is not a race to come.
  await expect.element(upcoming.getByText(fr.status.dns)).not.toBeInTheDocument();

  await upcoming.getByRole("link", { name: "Foulées d'Hiver" }).click();
  await expect.element(screen.getByText("Fiche")).toBeVisible();

  // The same request as the home page's: the events that are to come.
  expect(mocks.events).toHaveBeenCalledOnce();
  expect(mocks.events.mock.calls[0]?.[0]).toMatchObject({ sort: "start_date" });
  // One list of what is to come: not this one and the one of the page of a runner.
  await expect
    .element(screen.getByRole("heading", { name: fr.runner.upcoming }))
    .not.toBeInTheDocument();
});

test("ProfilePage — « Mes prochaines courses » : le jour de l'épreuve compte, pas celui de l'événement ; sans épreuve, c'est le dernier jour de l'événement", async () => {
  // From 31 October to 2 November: the trail of 42 km was run on the first day
  // (it is behind), the short race is today. Alice is also interested in the
  // event as a whole, with no race chosen: that is until its last day.
  const vercors: Rec = {
    ...eventRecord,
    id: "eventVercors",
    name: "Week-end du Vercors",
    start_date: "2026-10-31",
    end_date: "2026-11-02",
  };
  const vercors42 = formatOf("fVercors42", vercors, f42, "2026-10-31");
  const vercors10 = formatOf("fVercors10", vercors, fLyon, "2026-11-01");
  mocks.events.mockResolvedValue([
    {
      ...vercors,
      expand: {
        formats_via_event: [vercors42, vercors10],
        participations_via_event: [
          mine("pVercors42", vercors, vercors42, "registered"),
          mine("pVercors10", vercors, vercors10, "registered"),
          // Not the same runner: Bob is not on this page.
          {
            ...mine("pVercorsBob", vercors, vercors10, "registered", { runner: bobRunner.id }),
            expand: { runner: bobRunner },
          },
          mine("pVercorsEvent", vercors, null, "interested"),
        ],
      },
    },
    autumnEvent,
  ]);

  const { screen } = await renderProfile();

  await expect
    .element(section(screen, fr.profile.upcoming).getByRole("link", { name: "Trail d'Automne" }))
    .toBeVisible();
  // Sorted by the day each one is on: the start of the event for the race to choose.
  expect(upcomingRows(screen)).toEqual([
    ["Week-end du Vercors", "Format à choisir · Intéressé", "sam. 31 oct. 2026"],
    ["Week-end du Vercors", "Route 10 km · Inscrit", "dim. 1 nov. 2026"],
    ["Trail d'Automne", "Trail 42 km · Inscrit", "sam. 21 nov. 2026"],
  ]);
});

test("ProfilePage — « Mes prochaines courses » : un événement dont le dernier jour est passé n'y est plus", async () => {
  // Over since yesterday, on the event alone: whatever the request returned.
  const over: Rec = {
    ...winter,
    id: "eventOver",
    name: "Cross d'hier",
    start_date: "2026-10-30",
    end_date: "2026-10-31",
  };
  mocks.events.mockResolvedValue([
    {
      ...over,
      expand: {
        formats_via_event: [],
        participations_via_event: [mine("pOver", over, null, "interested")],
      },
    },
    autumnEvent,
  ]);

  const { screen } = await renderProfile();

  await expect
    .element(section(screen, fr.profile.upcoming).getByRole("link", { name: "Trail d'Automne" }))
    .toBeVisible();
  expect(upcomingRows(screen)).toEqual([
    ["Trail d'Automne", "Trail 42 km · Inscrit", "sam. 21 nov. 2026"],
  ]);
});

test("ProfilePage — sans course prévue", async () => {
  mocks.events.mockResolvedValue([]);
  mocks.results.mockResolvedValue([]);

  const { screen } = await renderProfile();

  const upcoming = section(screen, fr.profile.upcoming);
  await expect.element(upcoming.getByText(fr.profile.noUpcoming)).toBeVisible();
  await expect.element(upcoming.getByRole("list")).not.toBeInTheDocument();
  // The rest of the page is there all the same.
  await expect.element(screen.getByRole("heading", { level: 1, name: "Alice" })).toBeVisible();
  await expect
    .element(section(screen, fr.runner.history).getByText(fr.runner.noHistory))
    .toBeVisible();
});

test("ProfilePage — « Mes prochaines courses » : le chargement se dit, et une erreur se redemande, le focus va au titre de la section", async () => {
  mocks.events.mockRejectedValue(new ClientResponseError({ status: 500, response: {} }));
  const { screen } = await renderProfile();

  const upcoming = section(screen, fr.profile.upcoming);
  await expect.element(upcoming.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  // « Aucune course prévue » would be a lie: the answer is not known.
  await expect.element(screen.getByText(fr.profile.noUpcoming)).not.toBeInTheDocument();
  const answer = Promise.withResolvers<unknown>();
  mocks.events.mockReturnValue(answer.promise);

  await upcoming.getByRole("button", { name: fr.common.retry }).click();

  await expect.element(upcoming.getByText(fr.common.loading)).toBeVisible();
  await expect
    .element(upcoming.getByRole("button", { name: fr.common.retry }))
    .not.toBeInTheDocument();
  const title = screen.getByRole("heading", { level: 2, name: fr.profile.upcoming });
  await expect.element(title).toHaveFocus();
  expect(title.element().getAttribute("tabindex")).toBe("-1");
  answer.resolve([autumnEvent]);
  await expect.element(upcoming.getByRole("link", { name: "Trail d'Automne" })).toBeVisible();
});

test("ProfilePage — un lien « Réglages » mène à /profil/reglages", async () => {
  const { screen } = await renderProfile();

  const link = screen.getByRole("link", { name: fr.profile.settings });
  await expect.element(link).toBeVisible();
  expect(link.element().getAttribute("href")).toBe("/profil/reglages");
  expect(link.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  // At the top of the page: under the title, before what is to come.
  expect(follows(screen.getByRole("heading", { level: 1 }).element(), link.element())).toBe(true);
  expect(follows(link.element(), section(screen, fr.profile.upcoming).element())).toBe(true);

  await link.click();
  await expect.element(screen.getByText("Page des réglages")).toBeVisible();
});

test("ProfilePage — le lien vers les statistiques du groupe est là, avant le bilan par année", async () => {
  const { screen } = await renderProfile();

  const link = screen.getByRole("link", { name: fr.stats.link });
  await expect.element(link).toBeVisible();
  expect(link.element().getAttribute("href")).toBe("/stats");
  expect(link.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await expect.element(section(screen, fr.runner.years)).toBeVisible();
  expect(follows(section(screen, fr.profile.upcoming).element(), link.element())).toBe(true);
  expect(follows(link.element(), section(screen, fr.runner.years).element())).toBe(true);

  await link.click();
  await expect.element(screen.getByText("Page des statistiques")).toBeVisible();
});

test("ProfilePage — ce qui est dans les réglages n'est plus sur le profil", async () => {
  const { screen } = await renderProfile();
  await expect.element(section(screen, fr.runner.history)).toBeVisible();

  for (const title of [fr.avatar.title, fr.profile.nameTitle, fr.profile.emailTitle]) {
    await expect.element(screen.getByRole("heading", { name: title })).not.toBeInTheDocument();
  }
  await expect
    .element(screen.getByRole("button", { name: fr.profile.logout }))
    .not.toBeInTheDocument();
});

test("ProfilePage — un compte sans coureur voit le lien « Réglages »", async () => {
  mocks.sessionRunner.mockRejectedValue(new ClientResponseError({ status: 404, response: {} }));

  const { screen } = await renderProfile();

  await expect.element(screen.getByText(fr.profile.noRunner)).toBeVisible();
  const link = screen.getByRole("link", { name: fr.profile.settings });
  expect(link.element().getAttribute("href")).toBe("/profil/reglages");
  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.nav.profile }))
    .toBeVisible();
  // No runner: nothing to show of one.
  await expect.element(screen.getByRole("table")).not.toBeInTheDocument();
  expect(mocks.results).not.toHaveBeenCalled();
});

test("ProfilePage — un super-admin de PocketBase, qui n'est pas un membre, voit aussi le lien « Réglages »", async () => {
  mocks.store.record = { id: "su1", collectionName: "_superusers", email: "root@example.test" };

  const { screen } = await renderProfile();

  await expect.element(screen.getByText(fr.profile.noRunner)).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: fr.profile.settings }))
    .toHaveAttribute("href", "/profil/reglages");
  expect(mocks.sessionRunner).not.toHaveBeenCalled();
});

test("ProfilePage — une panne en cherchant le coureur de la session n'est pas « Ce compte n'a pas de coureur »", async () => {
  mocks.sessionRunner.mockRejectedValue(new TypeError("Failed to fetch"));

  const { screen } = await renderProfile();

  await vi.waitFor(() => {
    expect(mocks.sessionRunner).toHaveBeenCalledOnce();
  });
  await expect.element(screen.getByRole("link", { name: fr.profile.settings })).toBeVisible();
  await expect.element(screen.getByText(fr.profile.noRunner)).not.toBeInTheDocument();
});

test("ProfilePage — pendant que le coureur de la session charge : le titre et le lien « Réglages » sont là, sans « Ce compte n'a pas de coureur »", async () => {
  mocks.sessionRunner.mockReturnValue(new Promise(() => {}));

  const { screen } = await renderProfile();

  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.nav.profile }))
    .toBeVisible();
  await expect.element(screen.getByText(fr.common.loading)).toBeVisible();
  await expect.element(screen.getByRole("link", { name: fr.profile.settings })).toBeVisible();
  await expect.element(screen.getByText(fr.profile.noRunner)).not.toBeInTheDocument();
});

test("ProfilePage — sans session (entre la déconnexion et la page de connexion), la page est vide", async () => {
  mocks.store.record = null;

  const { screen } = await renderProfile();

  await vi.waitFor(() => {
    expect(screen.container.textContent).toBe("");
  });
  expect(mocks.sessionRunner).not.toHaveBeenCalled();
});
