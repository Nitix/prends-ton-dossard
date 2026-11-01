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
import {
  aliceRunner,
  bobRunner,
  eventRecord,
  f15,
  f42,
  p1,
  samRunner,
} from "../events/testFixture";
import { validateStatsSearch } from "./search";
import { STATS_EXPAND } from "./stats";
import { StatsPage } from "./StatsPage";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  results: vi.fn<(options: Rec) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: { record: null, onChange: () => () => {} },
    filter: (raw: string, params: Rec) => `${raw} ${JSON.stringify(params)}`,
    collection: (name: string) => ({ participations: { getFullList: mocks.results } })[name],
    files: { getURL: () => "" },
  },
}));

/** A race that was started: the participation of a runner on a format, with what the server expands. */
function result(id: string, runner: Rec, format: Rec, day: string, participation: Rec = {}): Rec {
  // The format of the fixture is on the day it says: the day of the race is here.
  const dated = { ...format, date: day };
  return {
    ...p1,
    id,
    runner: runner.id,
    format: format.id,
    status: "finished",
    finish_time_s: 0,
    ...participation,
    expand: {
      runner,
      event: { ...eventRecord, start_date: day, end_date: "" },
      format: dated,
    },
  };
}

// Alice, 2026: the trail of 42 km (2 400 m, 4h 12min 30s) and the one of 15 km
// (700 m, 1h 30min): 57 km, 3 100 m, 5h 42min 30s.
const alice42 = result("a42", aliceRunner, f42, "2026-06-14", { finish_time_s: 15_150 });
const alice15 = result("a15", aliceRunner, f15, "2026-03-08", { finish_time_s: 5_400 });
// Bob, 2026: a finish of 15 km in 1h 15min, and a DNF on the trail of 42 km.
const bob15 = result("b15", bobRunner, f15, "2026-04-12", { finish_time_s: 4_500 });
const bobDnf = result("b42", bobRunner, f42, "2026-09-20", { status: "dnf" });
// Alice, 2025.
const alice2025 = result("a25", aliceRunner, f42, "2025-06-15", { finish_time_s: 16_000 });

/** The day of the tests: the current year is 2026. */
const TODAY = "2026-11-01";

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(() => {
  mocks.results.mockReset();
  mocks.results.mockResolvedValue([alice42, alice15, bob15, bobDnf, alice2025]);
});

async function renderStats(url = "/stats") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: Outlet });
  const stats = createRoute({
    getParentRoute: () => root,
    path: "/stats",
    validateSearch: validateStatsSearch,
    component: () => <StatsPage search={stats.useSearch()} />,
  });
  const runnerPage = createRoute({
    getParentRoute: () => root,
    path: "/coureurs/$id",
    component: () => <p>Page d'un coureur</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([stats, runnerPage]),
    history: createMemoryHistory({ initialEntries: [url] }),
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

type Screen = Awaited<ReturnType<typeof renderStats>>["screen"];

/** The cells of the rows of the table, as the text a reader sees: the name first. */
function rowsOf(screen: Screen): string[][] {
  return screen
    .getByRole("row")
    .elements()
    .slice(1)
    .map((row) => [...row.querySelectorAll("th, td")].map((cell) => plain(cell.textContent)));
}

test("StatsPage — le tableau de l'année, avec un lien par coureur", async () => {
  const { screen } = await renderStats();

  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.stats.yearTitle(2026) }))
    .toBeVisible();
  // A table with a caption, and its columns named.
  const table = screen.getByRole("table", { name: fr.stats.yearTitle(2026) });
  await expect.element(table).toBeVisible();
  const headers = screen
    .getByRole("columnheader")
    .elements()
    .map((cell) => cell.textContent);
  expect(headers).toEqual([
    fr.stats.runner,
    fr.stats.finished,
    fr.stats.dnf,
    fr.stats.km,
    fr.stats.elevation,
    fr.stats.time,
  ]);

  // Most kilometers first; only 2026. Each runner is the header of their row.
  expect(rowsOf(screen)).toEqual([
    ["Alice", "2", "0", "57 km", "3 100 m", "5h 42min 30s"],
    ["Bob", "1", "1", "15 km", "700 m", "1h 15min"],
  ]);
  const alice = screen.getByRole("rowheader", { name: "Alice" });
  expect(alice.element().getAttribute("scope")).toBe("row");
  const link = screen.getByRole("link", { name: "Alice" });
  expect(link.element().getAttribute("href")).toBe(`/coureurs/${aliceRunner.id}`);
  expect(link.element().closest("th")).toBe(alice.element());
  expect(screen.getByRole("link", { name: "Bob" }).element().getAttribute("href")).toBe(
    `/coureurs/${bobRunner.id}`,
  );
  // The link is a tap target.
  expect(link.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});

test("StatsPage — demande au serveur les participations terminées ou abandonnées, avec leur expand", async () => {
  const { screen } = await renderStats();
  await expect.element(screen.getByRole("table")).toBeVisible();

  expect(mocks.results).toHaveBeenCalledOnce();
  const options = mocks.results.mock.calls[0]?.[0];
  expect(options).toMatchObject({ expand: STATS_EXPAND });
  expect(options?.filter).toBe('(status = "finished" || status = "dnf")');
});

test("StatsPage — les flèches changent l'année dans l'URL", async () => {
  const { screen, router } = await renderStats();
  await expect.element(screen.getByRole("table")).toBeVisible();

  const previous = screen.getByRole("link", { name: fr.stats.previousYear });
  expect(previous.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await previous.click();

  // The year is in the address, and the page follows it.
  expect(router.state.location.search).toEqual({ annee: 2025 });
  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.stats.yearTitle(2025) }))
    .toBeVisible();
  await vi.waitFor(() => {
    expect(rowsOf(screen)).toEqual([["Alice", "1", "0", "42 km", "2 400 m", "4h 26min 40s"]]);
  });
  // The results are asked for once for all the years.
  expect(mocks.results).toHaveBeenCalledOnce();

  // Forward again, and one more: a year with nothing is empty.
  await screen.getByRole("link", { name: fr.stats.nextYear }).click();
  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.stats.yearTitle(2026) }))
    .toBeVisible();
  await screen.getByRole("link", { name: fr.stats.nextYear }).click();
  await expect.element(screen.getByText(fr.stats.empty)).toBeVisible();
  expect(router.state.location.search).toEqual({ annee: 2027 });
});

test("StatsPage — l'année de l'adresse est celle qui s'affiche", async () => {
  const { screen } = await renderStats("/stats?annee=2025");

  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.stats.yearTitle(2025) }))
    .toBeVisible();
  await vi.waitFor(() => {
    expect(rowsOf(screen)).toEqual([["Alice", "1", "0", "42 km", "2 400 m", "4h 26min 40s"]]);
  });
});

test("StatsPage — une année qui n'en est pas une est l'année en cours", async () => {
  const { screen } = await renderStats("/stats?annee=demain");

  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.stats.yearTitle(2026) }))
    .toBeVisible();
});

test("StatsPage — « Aucun résultat cette année. »", async () => {
  mocks.results.mockResolvedValue([alice2025]);

  const { screen } = await renderStats();

  await expect.element(screen.getByText(fr.stats.empty)).toBeVisible();
  // No table to read when there is nothing in it, but the arrows to go and look elsewhere.
  await expect.element(screen.getByRole("table")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("link", { name: fr.stats.previousYear })).toBeVisible();
});

test("StatsPage — un abandon seul est une ligne, à 0 terminée, et un total à zéro n'est pas écrit 0", async () => {
  mocks.results.mockResolvedValue([result("d1", bobRunner, f42, "2026-09-20", { status: "dnf" })]);

  const { screen } = await renderStats();

  await expect.element(screen.getByRole("table")).toBeVisible();
  expect(rowsOf(screen)).toEqual([["Bob", "0", "1", "–", "–", "–"]]);
});

test("StatsPage — à égalité de kilomètres, l'ordre est celui des noms", async () => {
  mocks.results.mockResolvedValue([
    result("s1", samRunner, f15, "2026-05-01", { finish_time_s: 4_000 }),
    result("b1", bobRunner, f15, "2026-05-02", { finish_time_s: 4_000 }),
  ]);

  const { screen } = await renderStats();

  await expect.element(screen.getByRole("table")).toBeVisible();
  expect(rowsOf(screen).map(([name]) => name)).toEqual(["Bob", "Sam"]);
});

test("StatsPage — le chargement se dit", async () => {
  mocks.results.mockReturnValue(new Promise(() => {}));

  const { screen } = await renderStats();

  await expect.element(screen.getByText(fr.common.loading)).toBeVisible();
  await expect.element(screen.getByRole("table")).not.toBeInTheDocument();
});

test("StatsPage — une erreur se dit, avec « Réessayer »", async () => {
  mocks.results.mockRejectedValue(new ClientResponseError({ status: 500, response: {} }));

  const { screen } = await renderStats();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  mocks.results.mockResolvedValue([alice42]);
  await screen.getByRole("button", { name: fr.common.retry }).click();
  await expect.element(screen.getByRole("table")).toBeVisible();
});
