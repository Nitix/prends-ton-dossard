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
import { buttonOf, clickTwice } from "../../test/busyButton";
import { pixelURL } from "../../test/images";
import { spokenText } from "../../test/spoken";
import { EVENT_EXPAND } from "../events/api";
import {
  aliceRunner,
  bobRunner,
  event2Record,
  eventRecord,
  f42,
  fLyon,
  p1,
  p2,
  samRunner,
} from "../events/testFixture";
import { STATS_EXPAND } from "../stats/stats";
import { RunnerPage } from "./RunnerPage";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  runners: vi.fn<(options?: Rec) => Promise<unknown>>(),
  events: vi.fn<(options: Rec) => Promise<unknown>>(),
  results: vi.fn<(options: Rec) => Promise<unknown>>(),
  getURL: vi.fn<(record: Rec, filename: string, options: Rec) => string>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: { record: null, onChange: () => () => {} },
    filter: (raw: string, params: Rec) => `${raw} ${JSON.stringify(params)}`,
    collection: (name: string) =>
      ({
        runners: { getFullList: mocks.runners },
        events: { getFullList: mocks.events },
        participations: { getFullList: mocks.results },
      })[name],
    // Only called for a runner who has a photo: none has, unless a test says so.
    files: { getURL: mocks.getURL },
  },
}));

/** The day of the tests: the races of the fixture of the results are behind, the one below is ahead. */
const TODAY = "2026-11-01";

// An event ahead, with Alice registered and Bob interested (and not confirmed
// by him) on its trail of 42 km, on 21 November.
const nextFormat = { ...f42, id: "fNext", event: "eventNext", date: "2026-11-21" };
const nextEvent = {
  ...eventRecord,
  id: "eventNext",
  name: "Trail d'Automne",
  start_date: "2026-11-21",
  end_date: "2026-11-22",
  expand: {
    formats_via_event: [nextFormat],
    participations_via_event: [
      { ...p1, id: "pNextAlice", event: "eventNext", format: "fNext" },
      { ...p2, id: "pNextBob", event: "eventNext", format: "fNext" },
    ],
  },
};

// What Alice has run: the trail of 42 km in June 2026, 12th of 340, a short race
// in March, an abandon in May, and the same trail the year before.
const crossFormat = { ...fLyon, id: "fCross", event: "event0", distance_km: 6 };
const crossEvent = {
  ...event2Record,
  id: "event0",
  name: "Cross de Mai",
  start_date: "2026-05-10",
};

function result(id: string, event: Rec, format: Rec, day: string, participation: Rec): Rec {
  return {
    ...p1,
    id,
    event: event.id,
    format: format.id,
    status: "finished",
    ...participation,
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
  result_note: "3e V1H",
});
const lyon2026 = result("r2", event2Record, fLyon, "2026-03-08", {
  finish_time_s: 2_700,
  rank: 5,
});
const cross2026 = result("r3", crossEvent, crossFormat, "2026-05-10", {
  status: "dnf",
  result_note: "Blessure à mi-course",
});
const trail2025 = result("r4", eventRecord, f42, "2025-06-15", { finish_time_s: 16_000 });
// In no particular order: the page sorts.
const aliceResults = [trail2025, lyon2026, trail2026, cross2026];

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.runners.mockResolvedValue([aliceRunner, bobRunner, samRunner]);
  mocks.events.mockResolvedValue([nextEvent]);
  mocks.results.mockResolvedValue(aliceResults);
});

/**
 * `kept` is the list of the runners that an earlier page left in the cache of
 * the app (it is good for 5 minutes): the page does not ask for it again, unless
 * the runner it is about is not in it.
 */
async function renderRunner(id: string = aliceRunner.id, kept?: Rec[], ageMs = 0) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (kept) queryClient.setQueryData(["runners"], kept, { updatedAt: Date.now() - ageMs });
  const root = createRootRoute({ component: Outlet });
  const runner = createRoute({
    getParentRoute: () => root,
    path: "/coureurs/$id",
    component: () => <RunnerPage id={runner.useParams().id} />,
  });
  const eventPage = createRoute({
    getParentRoute: () => root,
    path: "/evenements/$id",
    component: () => <p>Fiche</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([runner, eventPage]),
    history: createMemoryHistory({ initialEntries: [`/coureurs/${id}`] }),
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

type Screen = Awaited<ReturnType<typeof renderRunner>>["screen"];

/** A section of the page, by its heading. */
function section(screen: Screen, title: string) {
  return screen.getByRole("region", { name: title, exact: true });
}

test("RunnerPage — nom, à venir, bilan par année et historique", async () => {
  const { screen } = await renderRunner();

  // The name is the title of the page.
  await expect.element(screen.getByRole("heading", { level: 1, name: "Alice" })).toBeVisible();

  // What is to come: the registration for the trail of November, which the runner has confirmed.
  const upcoming = section(screen, fr.runner.upcoming);
  await expect
    .element(upcoming.getByRole("link", { name: "Trail d'Automne" }))
    .toHaveAttribute("href", "/evenements/eventNext");
  await expect.element(upcoming.getByText("Trail 42 km · Inscrit")).toBeVisible();
  await expect.element(upcoming.getByText("sam. 21 nov.")).toBeVisible();
  // Only the participations of this runner: Bob is on the same trail, and is not here.
  await expect.element(upcoming.getByText(fr.event.unconfirmed)).not.toBeInTheDocument();

  // The year by year, the latest year first: a table with a caption.
  const years = section(screen, fr.runner.years);
  await expect.element(years.getByRole("table", { name: fr.runner.years })).toBeVisible();
  expect(
    years
      .getByRole("columnheader")
      .elements()
      .map((cell) => cell.textContent),
  ).toEqual([
    fr.stats.year,
    fr.stats.finished,
    fr.stats.dnf,
    fr.stats.km,
    fr.stats.elevation,
    fr.stats.time,
  ]);
  // The cells, as a screen reader says them.
  const rows = years
    .getByRole("row")
    .elements()
    .slice(1)
    .map((row) => [...row.querySelectorAll("th, td")].map((cell) => plain(spokenText(cell))));
  expect(rows).toEqual([
    ["2026", "2", "1", "52 km", "2 400 m", "4h 57min 30s"],
    ["2025", "1", "0", "42 km", "2 400 m", "4h 26min 40s"],
  ]);
  expect(years.getByRole("rowheader", { name: "2026" }).element().getAttribute("scope")).toBe(
    "row",
  );

  // The history, the latest race first, each with its event, its race, its status and its result.
  const history = section(screen, fr.runner.history);
  const items = history
    .getByRole("listitem")
    .elements()
    .map((item) => [...item.children].map((line) => plain(line.textContent)));
  expect(items).toEqual([
    [
      "Trail des Crêtes",
      "Trail 42 km · Terminé",
      "dim. 14 juin 2026",
      "4h 12min 30s · 12e sur 340 · 3e V1H",
    ],
    ["Cross de Mai", "Route 6 km · Abandon", "dim. 10 mai 2026", "Blessure à mi-course"],
    ["10 km de Lyon", "Route 10 km · Terminé", "dim. 8 mars 2026", "45min · 5e"],
    ["Trail des Crêtes", "Trail 42 km · Terminé", "dim. 15 juin 2025", "4h 26min 40s"],
  ]);
  // The event is a link to its page.
  const link = history.getByRole("link", { name: "Cross de Mai" });
  await expect.element(link).toHaveAttribute("href", "/evenements/event0");
  expect(link.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});

test("RunnerPage — demande les résultats de ce coureur, et les événements à venir", async () => {
  const { screen } = await renderRunner();
  await expect.element(section(screen, fr.runner.history)).toBeVisible();

  expect(mocks.results).toHaveBeenCalledOnce();
  const options = mocks.results.mock.calls[0]?.[0];
  expect(options).toMatchObject({ expand: STATS_EXPAND });
  expect(options?.filter).toContain('(status = "finished" || status = "dnf")');
  expect(options?.filter).toContain(`"runner":"${aliceRunner.id}"`);
  expect(mocks.events).toHaveBeenCalledOnce();
  expect(mocks.events.mock.calls[0]?.[0]).toMatchObject({
    sort: "start_date",
    expand: EVENT_EXPAND,
  });
});

test("RunnerPage — la page d'un autre coureur montre ses participations à lui", async () => {
  mocks.results.mockResolvedValue([]);

  const { screen } = await renderRunner(bobRunner.id);

  await expect.element(screen.getByRole("heading", { level: 1, name: "Bob" })).toBeVisible();
  // Bob has not confirmed: it is dashed, and said in words.
  const upcoming = section(screen, fr.runner.upcoming);
  await expect.element(upcoming.getByText("Trail 42 km · Intéressé")).toBeVisible();
  await expect.element(upcoming.getByText(fr.event.unconfirmed)).toBeVisible();
});

test("RunnerPage — une participation sans épreuve d'un événement en cours y reste jusqu'à son dernier jour", async () => {
  mocks.results.mockResolvedValue([]);
  // From yesterday to today: the event has started, and it is its last day.
  const underway = {
    ...eventRecord,
    id: "eventUnderway",
    name: "Week-end du Vercors",
    start_date: "2026-10-31",
    end_date: TODAY,
    expand: {
      formats_via_event: [],
      participations_via_event: [
        { ...p2, id: "pUnderwayBob", event: "eventUnderway", format: "", status: "interested" },
      ],
    },
  };
  mocks.events.mockResolvedValue([underway]);

  const { screen } = await renderRunner(bobRunner.id);

  const upcoming = section(screen, fr.runner.upcoming);
  await expect.element(upcoming.getByRole("link", { name: "Week-end du Vercors" })).toBeVisible();
  await expect.element(upcoming.getByText(fr.event.formatToChoose, { exact: false })).toBeVisible();
  // Dated by its first day, and on today.
  await expect.element(upcoming.getByText("sam. 31 oct.")).toBeVisible();
  await expect.element(upcoming.getByText("aujourd’hui")).toBeVisible();
});

test("RunnerPage — un coureur sans résultat", async () => {
  mocks.results.mockResolvedValue([]);
  // Sam is on nothing to come either.
  const { screen } = await renderRunner(samRunner.id);

  await expect.element(screen.getByRole("heading", { level: 1, name: "Sam" })).toBeVisible();
  const history = section(screen, fr.runner.history);
  await expect.element(history.getByText(fr.runner.noHistory)).toBeVisible();
  // Nothing to add up, and nothing to come: no empty sections.
  await expect
    .element(screen.getByRole("heading", { name: fr.runner.years }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByRole("table")).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("heading", { name: fr.runner.upcoming }))
    .not.toBeInTheDocument();
});

test("RunnerPage — la photo en 256 px, avec un alt vide puisque le nom est écrit à côté", async () => {
  mocks.getURL.mockImplementation(() => pixelURL());
  mocks.runners.mockResolvedValue([{ ...aliceRunner, avatar: "alice_x1y2z3.webp" }, bobRunner]);

  const { screen } = await renderRunner();

  await expect.element(screen.getByRole("heading", { level: 1, name: "Alice" })).toBeVisible();
  const image = screen.container.querySelector("img");
  expect(image?.getAttribute("src")).toBe(pixelURL());
  expect(image?.getAttribute("alt")).toBe("");
  expect(mocks.getURL.mock.calls[0]?.[2]).toEqual({ thumb: "256x256" });
});

test("RunnerPage — un coureur inconnu", async () => {
  const { screen } = await renderRunner("nobody0000000");

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.not_found);
  await expect.element(screen.getByRole("heading", { level: 1 })).not.toBeInTheDocument();
  // The list was fetched for this page: it is not asked for again.
  expect(mocks.runners).toHaveBeenCalledOnce();
});

test("RunnerPage — un coureur arrivé depuis la liste gardée : la liste est redemandée une fois, puis sa page s'affiche", async () => {
  // Alice has joined since: the copy that was kept does not have her, the server does.
  const { screen } = await renderRunner(aliceRunner.id, [bobRunner, samRunner]);

  await expect.element(screen.getByRole("heading", { level: 1, name: "Alice" })).toBeVisible();
  await expect.element(section(screen, fr.runner.history)).toBeVisible();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  expect(mocks.runners).toHaveBeenCalledOnce();
});

test("RunnerPage — pendant qu'on redemande la liste, la page se charge, elle ne dit pas « Introuvable »", async () => {
  const answer = Promise.withResolvers<unknown>();
  mocks.runners.mockReturnValue(answer.promise);

  const { screen } = await renderRunner(aliceRunner.id, [bobRunner, samRunner]);

  await expect.element(screen.getByText(fr.common.loading)).toBeVisible();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  answer.resolve([aliceRunner, bobRunner, samRunner]);
  await expect.element(screen.getByRole("heading", { level: 1, name: "Alice" })).toBeVisible();
});

test("RunnerPage — toujours absent de la liste redemandée : « Introuvable », sans la redemander encore", async () => {
  mocks.runners.mockResolvedValue([bobRunner, samRunner]);

  const { screen } = await renderRunner(aliceRunner.id, [bobRunner, samRunner]);

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.not_found);
  await expect.element(screen.getByRole("heading", { level: 1 })).not.toBeInTheDocument();
  expect(mocks.runners).toHaveBeenCalledOnce();
});

test("RunnerPage — une liste gardée trop vieille est déjà redemandée à l'ouverture : pas une demande de plus", async () => {
  // Older than the 5 minutes it is good for: the page asks for it as it opens.
  const { screen } = await renderRunner(aliceRunner.id, [bobRunner, samRunner], 10 * 60_000);

  await expect.element(screen.getByRole("heading", { level: 1, name: "Alice" })).toBeVisible();
  expect(mocks.runners).toHaveBeenCalledOnce();
});

test("RunnerPage — un coureur qui est dans la liste gardée ne la fait pas redemander", async () => {
  mocks.results.mockResolvedValue([]);

  const { screen } = await renderRunner(bobRunner.id, [aliceRunner, bobRunner]);

  await expect.element(screen.getByRole("heading", { level: 1, name: "Bob" })).toBeVisible();
  expect(mocks.runners).not.toHaveBeenCalled();
});

test("RunnerPage — le chargement se dit", async () => {
  mocks.runners.mockReturnValue(new Promise(() => {}));

  const { screen } = await renderRunner();

  await expect.element(screen.getByText(fr.common.loading)).toBeVisible();
  // The page already has its title, which the focus can go to, whatever happens next.
  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.runner.title }))
    .toBeVisible();
});

test("RunnerPage — une erreur sur les résultats se dit, avec « Réessayer », sous le nom", async () => {
  mocks.results.mockRejectedValue(new ClientResponseError({ status: 500, response: {} }));

  const { screen } = await renderRunner();

  await expect.element(screen.getByRole("heading", { level: 1, name: "Alice" })).toBeVisible();
  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  mocks.results.mockResolvedValue(aliceResults);
  await screen.getByRole("button", { name: fr.common.retry }).click();
  await expect.element(section(screen, fr.runner.history)).toBeVisible();
});

test("RunnerPage — une erreur sur la liste des coureurs se dit aussi", async () => {
  mocks.runners.mockRejectedValue(new ClientResponseError({ status: 500, response: {} }));

  const { screen } = await renderRunner();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  mocks.runners.mockResolvedValue([aliceRunner]);
  await screen.getByRole("button", { name: fr.common.retry }).click();
  await expect.element(screen.getByRole("heading", { level: 1, name: "Alice" })).toBeVisible();
});

test("RunnerPage — « Réessayer » sur la liste des coureurs : le focus est sur le titre de la page, puis sur le nom", async () => {
  mocks.runners.mockRejectedValue(new ClientResponseError({ status: 500, response: {} }));
  const { screen } = await renderRunner();
  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  // No name to show yet: the page has a title all the same, which takes the focus.
  const title = screen.getByRole("heading", { level: 1 });
  await expect.element(title).toHaveTextContent(fr.runner.title);
  const answer = Promise.withResolvers<unknown>();
  mocks.runners.mockReturnValue(answer.promise);

  await screen.getByRole("button", { name: fr.common.retry }).click();

  // The block goes with the request: the focus is on the title, not on the page.
  await expect.element(screen.getByText(fr.common.loading)).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: fr.common.retry }))
    .not.toBeInTheDocument();
  await expect.element(title).toHaveFocus();
  answer.resolve([aliceRunner]);
  // It is the same title: it keeps the focus and takes the name of the runner.
  await expect.element(title).toHaveTextContent("Alice");
  await expect.element(title).toHaveFocus();
  expect(title.element().getAttribute("tabindex")).toBe("-1");
});

test("RunnerPage — « Réessayer » sur les résultats : le focus est sur le nom du coureur", async () => {
  mocks.results.mockRejectedValue(new ClientResponseError({ status: 500, response: {} }));
  const { screen } = await renderRunner();
  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  const title = screen.getByRole("heading", { level: 1, name: "Alice" });
  const answer = Promise.withResolvers<unknown>();
  mocks.results.mockReturnValue(answer.promise);

  await screen.getByRole("button", { name: fr.common.retry }).click();

  await expect.element(screen.getByText(fr.common.loading)).toBeVisible();
  await expect.element(title).toHaveFocus();
  answer.resolve(aliceResults);
  await expect.element(section(screen, fr.runner.history)).toBeVisible();
  await expect.element(title).toHaveFocus();
});

test("RunnerPage — « Réessayer » n'est pas désactivé et un double appui ne redemande qu'une fois", async () => {
  mocks.runners.mockRejectedValue(new ClientResponseError({ status: 500, response: {} }));
  const { screen } = await renderRunner();
  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  const button = buttonOf(screen.getByRole("button", { name: fr.common.retry }));
  expect(button.disabled).toBe(false);
  expect(mocks.runners).toHaveBeenCalledOnce();
  mocks.runners.mockReturnValue(new Promise(() => {}));

  clickTwice(button);

  await expect.element(screen.getByText(fr.common.loading)).toBeVisible();
  // The first request, and one more.
  expect(mocks.runners).toHaveBeenCalledTimes(2);
});
