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

import { AppShell } from "../../components/AppShell";
import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";
import { fontsReady } from "../../test/fontsReady";
import {
  aliceRunner,
  bobRunner,
  event2Record,
  eventRecord,
  pNinaSupporter,
  pNinaUndecided,
  roadType,
  samRunner,
  trailType,
  withParticipations,
  withStatus,
} from "../events/testFixture";
import { AgendaPage } from "./AgendaPage";
import { validateAgendaSearch } from "./search";

// The tap targets and the choice between the phone and the desktop render are
// matters of the styles, which are not loaded otherwise.
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

/** An event of the fixture, with an id, a name and a day of its own. */
const eventOn = (id: string, name: string, start: string) => ({
  ...event2Record,
  id,
  name,
  start_date: start,
});

/** `count` events of one day each, on `start`. */
const crowd = (start: string, count: number) =>
  Array.from({ length: count }, (_, i) => eventOn(`${start}-${i}`, `Course ${start}-${i}`, start));

/** From 30 June to 1 July, across a month boundary. */
const monthEnd = {
  ...event2Record,
  id: "event-end",
  name: "Trail de fin de mois",
  start_date: "2026-06-30",
  end_date: "2026-07-01",
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

/** A Wednesday of June 2026, in the middle of the month. */
const TODAY = "2026-06-10";

async function renderAgenda(url = "/agenda?mois=2026-06", languages = ["fr"], today = TODAY) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The page is drawn inside the app shell, as in the app: its `<main>` has
  // gutters, which is what the width of a day depends on.
  const root = createRootRoute({
    component: () => (
      <AppShell>
        <Outlet />
      </AppShell>
    ),
  });
  const agenda = createRoute({
    getParentRoute: () => root,
    path: "/agenda",
    validateSearch: validateAgendaSearch,
    component: () => <AgendaPage search={agenda.useSearch()} />,
  });
  const eventPage = createRoute({
    getParentRoute: () => root,
    path: "/evenements/$id",
    component: () => <p>Fiche</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([agenda, eventPage]),
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

type Screen = Awaited<ReturnType<typeof renderAgenda>>["screen"];

/** The button of a day, by its date ("dim. 14 juin"), whatever the number of events it says. */
const day = (screen: Screen, date: string) =>
  screen.getByRole("button", { name: new RegExp(`^${RegExp.escape(date)},`) });

const headers = (screen: Screen) =>
  screen
    .getByRole("columnheader")
    .elements()
    .map((element) => element.textContent);

const dayButtons = (screen: Screen) => screen.getByRole("button").elements();

const eventNames = (screen: Screen) =>
  screen
    .getByRole("heading", { level: 3 })
    .elements()
    .map((element) => element.textContent);

/** Runs `body` in a viewport of this size, and gives the usual one back. */
async function inViewport(width: number, height: number, body: () => Promise<void>) {
  await page.viewport(width, height);
  try {
    await body();
  } finally {
    await page.viewport(414, 896);
  }
}

test("AgendaPage — ?mois=2026-06 affiche « juin 2026 »", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06");

  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.nav.calendar }))
    .toBeVisible();
  await expect.element(screen.getByRole("heading", { level: 2, name: "juin 2026" })).toBeVisible();
});

test("AgendaPage — le titre du mois prend le style des titres du thème (--display-*), comme chaque titre en police des titres", async () => {
  // A theme whose titles are italic, in capitals, spaced out: the month follows it.
  const root = document.documentElement;
  const display = {
    "--display-style": "italic",
    "--display-transform": "uppercase",
    "--display-tracking": "0.1em",
  };
  for (const [property, value] of Object.entries(display)) root.style.setProperty(property, value);
  try {
    const { screen } = await renderAgenda("/agenda?mois=2026-06");
    const month = screen.getByRole("heading", { level: 2, name: "juin 2026" });
    await expect.element(month).toBeVisible();
    const style = getComputedStyle(month.element());
    expect(style.fontStyle).toBe("italic");
    expect(style.textTransform).toBe("uppercase");
    expect(style.letterSpacing).toBe(`${parseFloat(style.fontSize) * 0.1}px`);
  } finally {
    for (const property of Object.keys(display)) root.style.removeProperty(property);
  }
});

test("AgendaPage — sans mois, c'est le mois en cours", async () => {
  const { screen } = await renderAgenda("/agenda");

  await expect.element(screen.getByRole("heading", { level: 2, name: "juin 2026" })).toBeVisible();
});

test("AgendaPage — le mois en cours suit « aujourd'hui », y compris à l'autre bout de l'année", async () => {
  const { screen } = await renderAgenda("/agenda", ["fr"], "2027-01-05");

  await expect
    .element(screen.getByRole("heading", { level: 2, name: "janvier 2027" }))
    .toBeVisible();
  // The grid of January 2027 starts in December.
  await expect.element(day(screen, "lun. 28 déc.")).toBeVisible();
});

test("AgendaPage — un mois invalide dans l'URL retombe sur le mois en cours", async () => {
  for (const mois of ["2026-13", "juin", "2026-6", "2026-06-15", ""]) {
    const { screen } = await renderAgenda(`/agenda?mois=${mois}`);

    await expect
      .element(screen.getByRole("heading", { level: 2, name: "juin 2026" }))
      .toBeVisible();
    await screen.unmount();
  }
});

test("AgendaPage — la flèche suivante passe à mois=2026-07", async () => {
  const { screen, router } = await renderAgenda("/agenda?mois=2026-06");
  await expect.element(screen.getByRole("heading", { level: 2, name: "juin 2026" })).toBeVisible();

  await screen.getByRole("link", { name: fr.agenda.next }).click();

  await expect
    .element(screen.getByRole("heading", { level: 2, name: "juillet 2026" }))
    .toBeVisible();
  expect(router.state.location.search).toEqual({ mois: "2026-07" });
});

test("AgendaPage — la flèche précédente passe à mois=2026-05", async () => {
  const { screen, router } = await renderAgenda("/agenda?mois=2026-06");

  await screen.getByRole("link", { name: fr.agenda.previous }).click();

  await expect.element(screen.getByRole("heading", { level: 2, name: "mai 2026" })).toBeVisible();
  expect(router.state.location.search).toEqual({ mois: "2026-05" });
});

test("AgendaPage — les flèches passent d'une année à l'autre", async () => {
  const { screen, router } = await renderAgenda("/agenda?mois=2026-12");

  await screen.getByRole("link", { name: fr.agenda.next }).click();
  await expect
    .element(screen.getByRole("heading", { level: 2, name: "janvier 2027" }))
    .toBeVisible();
  expect(router.state.location.search).toEqual({ mois: "2027-01" });

  await screen.getByRole("link", { name: fr.agenda.previous }).click();
  await expect
    .element(screen.getByRole("heading", { level: 2, name: "décembre 2026" }))
    .toBeVisible();
  expect(router.state.location.search).toEqual({ mois: "2026-12" });
});

test("AgendaPage — sans mois, la flèche suivante part du mois en cours", async () => {
  const { screen, router } = await renderAgenda("/agenda");

  await screen.getByRole("link", { name: fr.agenda.next }).click();

  await expect
    .element(screen.getByRole("heading", { level: 2, name: "juillet 2026" }))
    .toBeVisible();
  expect(router.state.location.search).toEqual({ mois: "2026-07" });
});

test("AgendaPage — changer de mois garde les filtres et oublie le jour choisi", async () => {
  const { screen, router } = await renderAgenda(
    `/agenda?mois=2026-06&jour=2026-06-14&personne=${bobRunner.id}`,
  );
  await expect
    .element(screen.getByRole("heading", { level: 2, name: "dim. 14 juin 2026" }))
    .toBeVisible();

  await screen.getByRole("link", { name: fr.agenda.next }).click();

  await expect
    .element(screen.getByRole("heading", { level: 2, name: "juillet 2026" }))
    .toBeVisible();
  expect(router.state.location.search).toEqual({ mois: "2026-07", personne: bobRunner.id });
  await expect.element(screen.getByText(fr.agenda.selectDay)).toBeVisible();
});

test("AgendaPage — demande au serveur les événements de la grille, avec leurs jours des mois voisins", async () => {
  const { screen, queryClient } = await renderAgenda("/agenda?mois=2026-06");
  await expect.element(day(screen, "sam. 13 juin")).toBeVisible();

  expect(mocks.events).toHaveBeenCalledOnce();
  const options = mocks.events.mock.calls[0]?.[0];
  expect(options).toMatchObject({ sort: "start_date" });
  // The weeks start on Monday: from Monday 1 June to Sunday 5 July.
  expect(options?.filter).toContain('"from":"2026-06-01"');
  expect(options?.filter).toContain('"to":"2026-07-05"');
  const key = [
    "events",
    { from: Temporal.PlainDate.from("2026-06-01"), to: Temporal.PlainDate.from("2026-07-05") },
  ];
  expect(queryClient.getQueryData(key)).toHaveLength(2);
});

test("AgendaPage — changer de mois demande les événements du nouveau mois", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06");
  await expect.element(day(screen, "sam. 13 juin")).toBeVisible();

  await screen.getByRole("link", { name: fr.agenda.next }).click();

  await vi.waitFor(() => {
    expect(mocks.events).toHaveBeenCalledTimes(2);
  });
  const options = mocks.events.mock.calls[1]?.[0];
  // July 2026 starts on a Wednesday and ends on a Friday.
  expect(options?.filter).toContain('"from":"2026-06-29"');
  expect(options?.filter).toContain('"to":"2026-08-02"');
});

test("AgendaPage — la semaine commence le lundi en français", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06");

  await expect.element(day(screen, "lun. 1 juin")).toBeVisible();
  expect(headers(screen)).toEqual(["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."]);
  // June 2026 starts on a Monday: five full weeks, to Sunday 5 July.
  const buttons = dayButtons(screen);
  expect(buttons).toHaveLength(35);
  expect(buttons[0]?.getAttribute("aria-label")).toBe("lun. 1 juin, aucun événement");
  expect(buttons.at(-1)?.getAttribute("aria-label")).toBe("dim. 5 juil., aucun événement");
});

test("AgendaPage — la semaine commence le lundi en en-GB", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06", ["en-GB"]);

  await expect.element(screen.getByRole("heading", { level: 2, name: "June 2026" })).toBeVisible();
  expect(headers(screen)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  expect(dayButtons(screen)).toHaveLength(35);
});

test("AgendaPage — la semaine commence le dimanche en en-US, et la grille aussi", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06", ["en-US"]);

  await expect.element(screen.getByRole("heading", { level: 2, name: "June 2026" })).toBeVisible();
  expect(headers(screen)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  // The first week of the grid starts on Sunday 31 May, the last ends on Saturday 4 July.
  const buttons = dayButtons(screen);
  expect(buttons[0]?.getAttribute("aria-label")).toBe("Sun, May 31, no events");
  expect(buttons.at(-1)?.getAttribute("aria-label")).toBe("Sat, Jul 4, no events");
  // The server is asked for the days of that grid.
  const options = mocks.events.mock.calls[0]?.[0];
  expect(options?.filter).toContain('"from":"2026-05-31"');
  expect(options?.filter).toContain('"to":"2026-07-04"');
});

test("AgendaPage — chaque jour est un bouton nommé par sa date et son nombre d'événements", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06");

  await expect.element(day(screen, "sam. 13 juin")).toBeVisible();
  const label = (date: string) => day(screen, date).element().getAttribute("aria-label");
  expect(label("sam. 13 juin")).toBe("sam. 13 juin, 1 événement");
  expect(label("dim. 14 juin")).toBe("dim. 14 juin, 1 événement");
  expect(label("lun. 22 juin")).toBe("lun. 22 juin, 1 événement");
  expect(label("dim. 7 juin")).toBe("dim. 7 juin, aucun événement");
});

test("AgendaPage — le nom d'un jour compte ses événements, au pluriel quand il y en a plusieurs", async () => {
  mocks.events.mockResolvedValue([event2Record, eventOn("twin", "Autre course", "2026-06-22")]);

  const { screen } = await renderAgenda("/agenda?mois=2026-06");

  await expect
    .element(screen.getByRole("button", { name: "lun. 22 juin, 2 événements" }))
    .toBeVisible();
});

test("AgendaPage — en anglais, les noms des jours suivent la langue", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06", ["en-GB"]);

  await expect.element(screen.getByRole("button", { name: "Sat 13 Jun, 1 event" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Sun 7 Jun, no events" })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: en.agenda.next })).toBeVisible();
});

test("AgendaPage — aujourd'hui est le seul jour marqué, et il l'est autrement que par la couleur", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06");
  await expect.element(day(screen, "mer. 10 juin")).toBeVisible();

  const current = dayButtons(screen).filter(
    (button) => button.getAttribute("aria-current") === "date",
  );
  expect(current.map((button) => button.getAttribute("aria-label"))).toEqual([
    "mer. 10 juin, aucun événement",
  ]);
  // A ring around the number, which the other days have none of (their border is transparent).
  const ring = (date: string, number: string) => {
    const style = getComputedStyle(day(screen, date).getByText(number, { exact: true }).element());
    return { width: style.borderTopWidth, color: style.borderTopColor };
  };
  expect(ring("mer. 10 juin", "10").width).toBe("2px");
  expect(ring("mer. 10 juin", "10").color).not.toBe("rgba(0, 0, 0, 0)");
  expect(ring("jeu. 11 juin", "11").color).toBe("rgba(0, 0, 0, 0)");
});

test("AgendaPage — toucher le 14 affiche « Trail des Crêtes » dans la liste du jour", async () => {
  const { screen, router } = await renderAgenda("/agenda?mois=2026-06");
  // Nothing to choose from until a day is touched.
  await expect.element(screen.getByText(fr.agenda.selectDay)).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "Trail des Crêtes" }))
    .not.toBeInTheDocument();

  await day(screen, "dim. 14 juin").click();

  await expect.element(screen.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();
  await expect
    .element(screen.getByRole("heading", { level: 2, name: "dim. 14 juin 2026" }))
    .toBeVisible();
  expect(router.state.location.search).toEqual({ mois: "2026-06", jour: "2026-06-14" });
  // The list is the one of the day: the other event is not there.
  expect(eventNames(screen)).toEqual(["Trail des Crêtes"]);
  await expect.element(screen.getByText(fr.agenda.selectDay)).not.toBeInTheDocument();
});

test("AgendaPage — le jour choisi est marqué par aria-pressed, et lui seul", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06");
  await expect.element(day(screen, "dim. 14 juin")).toHaveAttribute("aria-pressed", "false");

  await day(screen, "dim. 14 juin").click();

  await expect.element(day(screen, "dim. 14 juin")).toHaveAttribute("aria-pressed", "true");
  const pressed = dayButtons(screen).filter(
    (button) => button.getAttribute("aria-pressed") === "true",
  );
  expect(pressed).toHaveLength(1);
  // Not by colour alone: the day is filled in (white on sunrise, a gradient: a
  // background image), and a day that is not is not.
  const filled = (date: string) => {
    const style = getComputedStyle(day(screen, date).element());
    return `${style.backgroundColor} ${style.backgroundImage}`;
  };
  expect(filled("dim. 14 juin")).not.toBe(filled("sam. 13 juin"));
});

test("AgendaPage — toucher un autre jour change la liste, toucher le même la ferme", async () => {
  const { screen, router } = await renderAgenda("/agenda?mois=2026-06");

  await day(screen, "dim. 14 juin").click();
  await expect.element(screen.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();

  await day(screen, "lun. 22 juin").click();
  await expect.element(screen.getByRole("link", { name: "10 km de Lyon" })).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "Trail des Crêtes" }))
    .not.toBeInTheDocument();
  expect(router.state.location.search).toEqual({ mois: "2026-06", jour: "2026-06-22" });

  await day(screen, "lun. 22 juin").click();
  await expect.element(screen.getByRole("link", { name: "10 km de Lyon" })).not.toBeInTheDocument();
  await expect.element(screen.getByText(fr.agenda.selectDay)).toBeVisible();
  expect(router.state.location.search).toEqual({ mois: "2026-06" });
  await expect.element(day(screen, "lun. 22 juin")).toHaveAttribute("aria-pressed", "false");
});

test("AgendaPage — choisir un jour ne s'ajoute pas à l'historique", async () => {
  const { screen, router } = await renderAgenda("/agenda?mois=2026-06");

  await day(screen, "dim. 14 juin").click();
  await expect.element(day(screen, "dim. 14 juin")).toHaveAttribute("aria-pressed", "true");
  await day(screen, "lun. 22 juin").click();
  await expect.element(day(screen, "lun. 22 juin")).toHaveAttribute("aria-pressed", "true");

  expect(router.history.length).toBe(1);
});

test("AgendaPage — un jour sans événement le dit", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06");

  await day(screen, "dim. 7 juin").click();

  await expect
    .element(screen.getByRole("heading", { level: 2, name: "dim. 7 juin 2026" }))
    .toBeVisible();
  await expect.element(screen.getByText(fr.agenda.dayEmpty)).toBeVisible();
});

test("AgendaPage — ?jour=<date> ouvre la liste de ce jour", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06&jour=2026-06-22");

  await expect.element(screen.getByRole("link", { name: "10 km de Lyon" })).toBeVisible();
  await expect.element(day(screen, "lun. 22 juin")).toHaveAttribute("aria-pressed", "true");
});

test("AgendaPage — un jour invalide, ou hors de la grille, est ignoré", async () => {
  for (const jour of ["2026-02-30", "nope", "2026-09-01", "2026-06"]) {
    const { screen } = await renderAgenda(`/agenda?mois=2026-06&jour=${jour}`);

    await expect.element(screen.getByText(fr.agenda.selectDay)).toBeVisible();
    expect(
      dayButtons(screen).filter((button) => button.getAttribute("aria-pressed") === "true"),
    ).toHaveLength(0);
    await screen.unmount();
  }
});

test("AgendaPage — un événement sur deux mois est sur chacun de ses jours, dans la grille des deux mois", async () => {
  mocks.events.mockResolvedValue([monthEnd]);

  const june = await renderAgenda("/agenda?mois=2026-06");
  await expect
    .element(june.screen.getByRole("button", { name: "mar. 30 juin, 1 événement" }))
    .toBeVisible();
  // 1 July is a trailing day of the grid of June.
  await expect
    .element(june.screen.getByRole("button", { name: "mer. 1 juil., 1 événement" }))
    .toBeVisible();
  await expect
    .element(june.screen.getByRole("button", { name: "jeu. 2 juil., aucun événement" }))
    .toBeVisible();
  await june.screen.unmount();

  const july = await renderAgenda("/agenda?mois=2026-07");
  // 30 June is a leading day of the grid of July.
  await expect
    .element(july.screen.getByRole("button", { name: "mar. 30 juin, 1 événement" }))
    .toBeVisible();
  await expect
    .element(july.screen.getByRole("button", { name: "mer. 1 juil., 1 événement" }))
    .toBeVisible();
});

test("AgendaPage — toucher un jour d'un mois voisin affiche ses événements sans changer de mois", async () => {
  mocks.events.mockResolvedValue([monthEnd]);
  const { screen, router } = await renderAgenda("/agenda?mois=2026-06");

  await day(screen, "mer. 1 juil.").click();

  await expect.element(screen.getByRole("link", { name: "Trail de fin de mois" })).toBeVisible();
  await expect.element(screen.getByRole("heading", { level: 2, name: "juin 2026" })).toBeVisible();
  expect(router.state.location.search).toEqual({ mois: "2026-06", jour: "2026-07-01" });
});

test("AgendaPage — des points par jour, trois au plus, puis « +N »", async () => {
  // Two events on the 16th, four on the 17th, three on the 18th.
  mocks.events.mockResolvedValue([
    ...crowd("2026-06-16", 2),
    ...crowd("2026-06-17", 4),
    ...crowd("2026-06-18", 3),
  ]);

  const { screen } = await renderAgenda("/agenda?mois=2026-06");
  await expect.element(day(screen, "mar. 16 juin")).toBeVisible();

  const dots = (date: string) => day(screen, date).getByTestId("dot").elements().length;
  expect(dots("lun. 15 juin")).toBe(0);
  expect(dots("mar. 16 juin")).toBe(2);
  expect(dots("mer. 17 juin")).toBe(3);
  expect(dots("jeu. 18 juin")).toBe(3);
  await expect.element(day(screen, "mer. 17 juin").getByText("+1")).toBeVisible();
  await expect.element(day(screen, "mar. 16 juin").getByText(/^\+/)).not.toBeInTheDocument();
  await expect.element(day(screen, "jeu. 18 juin").getByText(/^\+/)).not.toBeInTheDocument();
  // The dots are decoration: the name of the day says how many events there are.
  await expect
    .element(screen.getByRole("button", { name: "mer. 17 juin, 4 événements" }))
    .toBeVisible();
});

test("AgendaPage — les événements d'un jour sont triés par nom dans la liste", async () => {
  // Given in no order.
  mocks.events.mockResolvedValue([
    eventOn("z", "Zèbre", "2026-06-22"),
    eventOn("a", "Alpe", "2026-06-22"),
    eventOn("m", "Mont", "2026-06-22"),
  ]);
  const { screen } = await renderAgenda("/agenda?mois=2026-06&jour=2026-06-22");

  await expect.element(screen.getByRole("link", { name: "Alpe" })).toBeVisible();

  expect(eventNames(screen)).toEqual(["Alpe", "Mont", "Zèbre"]);
});

test("AgendaPage — la liste du jour a la carte de la liste: lieu, épreuves et lien vers la fiche", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06&jour=2026-06-14");

  const link = screen.getByRole("link", { name: "Trail des Crêtes" });
  await expect.element(link).toBeVisible();
  expect(link.element().getAttribute("href")).toBe("/evenements/event");
  await expect.element(screen.getByText("Annecy")).toBeVisible();
  await expect.element(screen.getByText(/^Trail 42\s+km/)).toBeVisible();
});

test("AgendaPage — la liste du jour ne montre pas la pastille d'un non partant", async () => {
  mocks.events.mockResolvedValue([withStatus(eventRecord, "p2", "dns"), event2Record]);
  const { screen } = await renderAgenda("/agenda?mois=2026-06");

  await day(screen, "sam. 13 juin").click();

  await expect.element(screen.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();
  // Bob does not start F42: no chip for him. The others have theirs. (The
  // names are also in the options of the filter: the card is where to look.)
  const card = screen.getByRole("article");
  await expect.element(card.getByText("Alice", { exact: true })).toBeInTheDocument();
  await expect.element(card.getByText("Bob", { exact: true })).not.toBeInTheDocument();
  await expect.element(card.getByText("Sam", { exact: true })).toBeInTheDocument();
});

test("AgendaPage — la liste du jour dit « Format à choisir » pour les intéressés sans épreuve", async () => {
  mocks.events.mockResolvedValue([withParticipations(eventRecord, [pNinaUndecided])]);
  const { screen } = await renderAgenda("/agenda?mois=2026-06&jour=2026-06-13");

  await expect.element(screen.getByText(fr.event.formatToChoose, { exact: true })).toBeVisible();
  await expect
    .element(
      screen
        .getByRole("list", { name: fr.event.interestedTitle })
        .getByText("Nina", { exact: true }),
    )
    .toBeInTheDocument();
});

test("AgendaPage — la liste du jour montre la ligne Supporteurs", async () => {
  mocks.events.mockResolvedValue([withParticipations(eventRecord, [pNinaSupporter])]);
  const { screen } = await renderAgenda("/agenda?mois=2026-06&jour=2026-06-13");

  // The words say it, after the formats; the supporters are not among those who start.
  await expect.element(screen.getByText(fr.event.supportersTitle, { exact: true })).toBeVisible();
  const card = screen.getByRole("article");
  await expect
    .element(
      card.getByRole("list", { name: fr.event.supportersTitle }).getByText("Nina", { exact: true }),
    )
    .toBeInTheDocument();
  await expect.element(card.getByText(fr.event.formatToChoose)).not.toBeInTheDocument();
  await expect
    .element(card.getByRole("list", { name: fr.event.participants }).getByText("Nina"))
    .not.toBeInTheDocument();
});

test("AgendaPage — à partir de md, les noms des courses sont dans les cases, et la liste du jour n'y est plus", async () => {
  await inViewport(1024, 768, async () => {
    const { screen } = await renderAgenda("/agenda?mois=2026-06&jour=2026-06-14");

    // The two days of the trail, and no more.
    const links = screen.getByRole("link", { name: "Trail des Crêtes" });
    await expect.element(links.first()).toBeVisible();
    // Measured in the fonts of the site, not in those that stand in while they load.
    await fontsReady();
    expect(links.elements()).toHaveLength(2);
    expect(links.first().element().getAttribute("href")).toBe("/evenements/event");
    await expect.element(screen.getByRole("link", { name: "10 km de Lyon" })).toBeVisible();
    // Neither the day buttons, nor the list under the grid, nor the hint, are there.
    expect(dayButtons(screen)).toHaveLength(0);
    await expect
      .element(screen.getByRole("heading", { level: 2, name: "dim. 14 juin 2026" }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText(fr.agenda.selectDay)).not.toBeInTheDocument();
    // The columns are still named, and the number of the day is a date.
    expect(headers(screen)).toHaveLength(7);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });
});

test("AgendaPage — sous md, les noms des courses ne sont pas dans les cases", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06");
  await expect.element(day(screen, "dim. 14 juin")).toBeVisible();

  await expect
    .element(screen.getByRole("link", { name: "Trail des Crêtes" }))
    .not.toBeInTheDocument();
});

test("AgendaPage — à partir de md, un événement sur deux mois a un nom dans chaque case", async () => {
  mocks.events.mockResolvedValue([monthEnd]);
  await inViewport(1024, 768, async () => {
    const { screen } = await renderAgenda("/agenda?mois=2026-06");

    const links = screen.getByRole("link", { name: "Trail de fin de mois" });
    await expect.element(links.first()).toBeVisible();
    expect(links.elements()).toHaveLength(2);
  });
});

test("AgendaPage — ?personne=<id> garde les événements de ce coureur", async () => {
  const { screen } = await renderAgenda(`/agenda?mois=2026-06&personne=${bobRunner.id}`);

  await expect
    .element(screen.getByRole("button", { name: "sam. 13 juin, 1 événement" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "lun. 22 juin, aucun événement" }))
    .toBeVisible();
  await expect.element(screen.getByLabelText(fr.filters.person)).toHaveValue(bobRunner.id);
});

test("AgendaPage — ?type=<id> garde les événements qui ont une épreuve de ce type", async () => {
  const { screen } = await renderAgenda(`/agenda?mois=2026-06&type=${roadType.id}`);

  await expect
    .element(screen.getByRole("button", { name: "lun. 22 juin, 1 événement" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "sam. 13 juin, aucun événement" }))
    .toBeVisible();
  await expect.element(screen.getByLabelText(fr.filters.type)).toHaveValue(roadType.id);
});

test("AgendaPage — ?personne=moi se résout en coureur courant", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06&personne=moi");

  // Alice is on the first event only.
  await expect
    .element(screen.getByRole("button", { name: "sam. 13 juin, 1 événement" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "lun. 22 juin, aucun événement" }))
    .toBeVisible();
  expect(mocks.myRunner).toHaveBeenCalled();
  await expect.element(screen.getByLabelText(fr.filters.person)).toHaveValue("moi");
});

test("AgendaPage — ?personne=moi attend le coureur courant au lieu d'afficher tout le monde", async () => {
  mocks.myRunner.mockReturnValue(new Promise(() => {}));

  const { screen } = await renderAgenda("/agenda?mois=2026-06&personne=moi");

  await expect.element(screen.getByText(fr.common.loading)).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "sam. 13 juin, aucun événement" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "lun. 22 juin, aucun événement" }))
    .toBeVisible();
});

test("Filters — choisir une personne l'écrit dans l'URL, et garde le mois et le jour", async () => {
  const { screen, router } = await renderAgenda("/agenda?mois=2026-06&jour=2026-06-14");
  await expect.element(day(screen, "dim. 14 juin")).toBeVisible();

  await screen.getByLabelText(fr.filters.person).selectOptions(bobRunner.id);

  await expect
    .element(screen.getByRole("button", { name: "lun. 22 juin, aucun événement" }))
    .toBeVisible();
  expect(router.state.location.search).toEqual({
    mois: "2026-06",
    jour: "2026-06-14",
    personne: bobRunner.id,
  });
  // The filter is applied to the list of the day too.
  await expect.element(screen.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();
});

test("Filters — l'agenda n'a pas de filtre de période", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06");
  await expect.element(screen.getByLabelText(fr.filters.person)).toBeVisible();

  await expect.element(screen.getByLabelText(fr.filters.type)).toBeVisible();
  await expect.element(screen.getByLabelText(fr.filters.period)).not.toBeInTheDocument();
});

test("AgendaPage — un état vide quand aucun événement ne tombe dans la grille, avec la grille", async () => {
  mocks.events.mockResolvedValue([]);

  const { screen } = await renderAgenda("/agenda?mois=2026-06");

  await expect.element(screen.getByText(fr.list.empty)).toBeVisible();
  await expect.element(screen.getByRole("heading", { level: 2, name: "juin 2026" })).toBeVisible();
  expect(dayButtons(screen)).toHaveLength(35);
});

test("AgendaPage — un état vide aussi quand les filtres écartent tout", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06&personne=nobody0000000");

  await expect.element(screen.getByText(fr.list.empty)).toBeVisible();
});

test("AgendaPage — pendant le chargement, le mois et la grille restent, avec « Chargement… »", async () => {
  mocks.events.mockReturnValue(new Promise(() => {}));

  const { screen } = await renderAgenda("/agenda?mois=2026-06");

  await expect.element(screen.getByText(fr.common.loading)).toBeVisible();
  await expect.element(screen.getByRole("heading", { level: 2, name: "juin 2026" })).toBeVisible();
  expect(dayButtons(screen)).toHaveLength(35);
  // No empty state while the answer is not there.
  await expect.element(screen.getByText(fr.list.empty)).not.toBeInTheDocument();
});

test("AgendaPage — une erreur de chargement se signale et se retente", async () => {
  mocks.events.mockRejectedValueOnce(new Error("network"));

  const { screen } = await renderAgenda("/agenda?mois=2026-06");

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await screen.getByRole("button", { name: fr.common.retry }).click();

  await expect
    .element(screen.getByRole("button", { name: "sam. 13 juin, 1 événement" }))
    .toBeVisible();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});

test("AgendaPage — en anglais, les textes et les dates suivent la langue", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06&jour=2026-06-14", ["en-GB"]);

  await expect.element(screen.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: "Previous month" })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: "Next month" })).toBeVisible();
  await expect
    .element(screen.getByRole("heading", { level: 2, name: "Sun, 14 Jun 2026" }))
    .toBeVisible();
  await expect.element(screen.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();
});

test("AgendaPage — en anglais, un jour sans événement le dit, et le jour à choisir aussi", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06", ["en-GB"]);

  await expect.element(screen.getByText(en.agenda.selectDay)).toBeVisible();
  await screen.getByRole("button", { name: "Sun 7 Jun, no events" }).click();
  await expect.element(screen.getByText(en.agenda.dayEmpty)).toBeVisible();
});

test("AgendaPage — zones tactiles d'au moins 44 px, sans défilement horizontal, de 320 à 390 px", async () => {
  for (const width of [320, 390]) {
    await inViewport(width, 844, async () => {
      const { screen } = await renderAgenda("/agenda?mois=2026-06&jour=2026-06-14");
      await expect.element(screen.getByRole("link", { name: "Trail des Crêtes" })).toBeVisible();
      // Measured in the fonts of the site, not in those that stand in while they load.
      await fontsReady();

      const targets = [
        ...dayButtons(screen),
        screen.getByRole("link", { name: fr.agenda.previous }).element(),
        screen.getByRole("link", { name: fr.agenda.next }).element(),
        screen.getByRole("link", { name: "Trail des Crêtes" }).element(),
        screen.getByLabelText(fr.filters.person).element(),
        screen.getByLabelText(fr.filters.type).element(),
      ];
      // Thirty-five days, two arrows, the link of the list and the two selects.
      expect(targets).toHaveLength(35 + 5);
      for (const target of targets) {
        const { width: w, height: h } = target.getBoundingClientRect();
        expect(w, `width at ${width} px`).toBeGreaterThanOrEqual(44);
        expect(h, `height at ${width} px`).toBeGreaterThanOrEqual(44);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      await screen.unmount();
    });
  }
});

test("AgendaPage — la grille a des en-têtes de colonne et le mois pour nom", async () => {
  const { screen } = await renderAgenda("/agenda?mois=2026-06");

  await expect.element(screen.getByRole("table", { name: "juin 2026" })).toBeVisible();
  await expect.element(screen.getByRole("columnheader").first()).toBeVisible();
  expect(screen.getByRole("row").elements()).toHaveLength(1 + 5);
});
