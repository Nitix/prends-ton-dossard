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
import { TodayProvider } from "../../lib/useToday";
import { EditEventPage, EventForm } from "./EventForm";
import {
  aliceRunner,
  bobRunner,
  event2Record,
  eventRecord,
  f15,
  f42,
  roadType,
  trailType,
} from "./testFixture";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;
type Call = { action: string; collection: string; id?: string; body?: Rec };

const mocks = vi.hoisted(() => ({
  user: null as Rec | null,
  calls: [] as Call[],
  send: vi.fn<() => Promise<unknown>>(),
  raceTypes: vi.fn<() => Promise<unknown>>(),
  getOne: vi.fn<(id: string, options: Rec) => Promise<unknown>>(),
  getList: vi.fn<(page: number, perPage: number, options: Rec) => Promise<unknown>>(),
  myRunner: vi.fn<(filter: string) => Promise<unknown>>(),
  /** The update of a format on its own: that is how its track is sent, after the batch. */
  updateFormat: vi.fn<(id: string, body: unknown) => Promise<unknown>>(),
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
    createBatch: () => ({
      collection: (collection: string) => ({
        create: (body: Rec) => mocks.calls.push({ action: "create", collection, body }),
        update: (id: string, body: Rec) =>
          mocks.calls.push({ action: "update", collection, id, body }),
        delete: (id: string) => mocks.calls.push({ action: "delete", collection, id }),
      }),
      send: mocks.send,
    }),
    collection: (name: string) =>
      ({
        race_types: { getFullList: mocks.raceTypes },
        events: { getOne: mocks.getOne, getList: mocks.getList },
        runners: { getFirstListItem: mocks.myRunner },
        formats: { update: mocks.updateFormat },
      })[name],
  },
}));

const base = { created: "", updated: "", collectionId: "", collectionName: "" };
const adminRunner = { ...base, id: "adminRunner0000", name: "Admin", user: "u-admin" };

// Alice wrote the event of the fixture; Bob is a member; the admin is a runner of the group too.
const users = {
  alice: { id: "u-alice", collectionName: "users", role: "member", runner: aliceRunner },
  bob: { id: "u-bob", collectionName: "users", role: "member", runner: bobRunner },
  admin: { id: "u-admin", collectionName: "users", role: "admin", runner: adminRunner },
};

function signIn(who: keyof typeof users) {
  const { runner, ...user } = users[who];
  mocks.user = user;
  mocks.myRunner.mockResolvedValue(runner);
}

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(() => {
  mocks.calls.length = 0;
  for (const fn of [
    mocks.send,
    mocks.raceTypes,
    mocks.getOne,
    mocks.getList,
    mocks.myRunner,
    mocks.updateFormat,
  ]) {
    fn.mockReset();
  }
  mocks.send.mockResolvedValue([]);
  mocks.updateFormat.mockResolvedValue({});
  mocks.raceTypes.mockResolvedValue([trailType, roadType]);
  mocks.getOne.mockResolvedValue(eventRecord);
  mocks.getList.mockResolvedValue({ items: [] });
  signIn("alice");
});

/** What PocketBase answers when the request number `index` of a batch fails. */
function refused(index: number, status: number, data: Rec = {}) {
  return new ClientResponseError({
    url: "/api/batch",
    status: 400,
    response: {
      status: 400,
      message: "Batch transaction failed.",
      data: {
        requests: {
          [index]: {
            code: "batch_request_failed",
            message: "Batch request failed.",
            response: { status, message: "Failed.", data },
          },
        },
      },
    },
  });
}

const field = (code: string) => ({ code, message: "server text, never shown" });

/** The page of an event, where saving leads. */
function Page() {
  const { id } = useParams({ strict: false });
  return <p>{`Fiche de ${id}`}</p>;
}

/** The page of the edit route, as the route of the app gives it its `id`. */
function Routed() {
  const { id } = useParams({ strict: false });
  return <EditEventPage id={id ?? ""} />;
}

/** The day of the tests: before the races of the examples (13 and 14 June), none of them has started. */
const TODAY = "2026-06-01";

/** Opens the app at a page of the form, without waiting for anything. */
async function mountForm(options: { at?: string; languages?: string[]; today?: string } = {}) {
  const { at = "/evenements/nouveau", languages = ["fr"], today = TODAY } = options;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const root = createRootRoute({ component: Outlet });
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/evenements/nouveau", component: EventForm }),
    createRoute({
      getParentRoute: () => root,
      path: "/evenements/$id/modifier",
      component: Routed,
    }),
    createRoute({ getParentRoute: () => root, path: "/evenements/$id", component: Page }),
    createRoute({ getParentRoute: () => root, path: "/liste", component: () => <p>Liste</p> }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [at] }),
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
  return { screen, router, invalidate, queryClient };
}

/** Opens the form and waits until it is there: its title is the one given. */
async function renderForm(
  options: { at?: string; languages?: string[]; heading?: string; today?: string } = {},
) {
  const { heading = fr.form.createTitle, ...mount } = options;
  const opened = await mountForm(mount);
  await expect
    .element(opened.screen.getByRole("heading", { level: 1, name: heading }))
    .toBeVisible();
  return opened;
}

type Screen = Awaited<ReturnType<typeof renderForm>>["screen"];

const renderEdit = (id = "event") =>
  renderForm({ at: `/evenements/${id}/modifier`, heading: fr.form.editTitle });

const name = (screen: Screen) => screen.getByLabelText(fr.form.name);
const location = (screen: Screen) => screen.getByLabelText(fr.form.location);
const startDate = (screen: Screen) => screen.getByLabelText(fr.form.startDate);
const endDate = (screen: Screen) => screen.getByLabelText(fr.form.endDate);
const registrationDeadline = (screen: Screen) =>
  screen.getByLabelText(fr.form.registrationDeadline);
const notes = (screen: Screen) => screen.getByLabelText(fr.form.notes);
const save = (screen: Screen) => screen.getByRole("button", { name: fr.common.save });
const addFormat = (screen: Screen) => screen.getByRole("button", { name: fr.form.addFormat });
const removes = (screen: Screen) => screen.getByRole("button", { name: fr.common.remove });
const joinBox = (screen: Screen) => screen.getByRole("checkbox", { name: fr.form.join });

/** The group of fields of the format `n`, from 1. */
const format = (screen: Screen, n: number) =>
  screen.getByRole("group", { name: fr.form.formatTitle(n), exact: true });

type Row = ReturnType<typeof format>;
const raceType = (row: Row) => row.getByLabelText(fr.form.raceType);
const distance = (row: Row) => row.getByLabelText(fr.form.distance);
const hoursOf = (row: Row, label: string) => row.getByLabelText(`${label}, ${fr.form.hours}`);
const minutesOf = (row: Row, label: string) => row.getByLabelText(`${label}, ${fr.form.minutes}`);
const elevation = (row: Row) => row.getByLabelText(fr.form.elevation);
const price = (row: Row) => row.getByLabelText(fr.format.price);
const formatDate = (row: Row) => row.getByLabelText(fr.form.formatDate);
const gpxField = (row: Row) => row.getByLabelText(fr.format.gpx, { exact: true });
const routeUrl = (row: Row) => row.getByLabelText(fr.format.routeUrl, { exact: true });

/** The event of the fixture's second example: a name, a place, one day, one 42 km trail. */
async function fillEvent(screen: Screen) {
  await name(screen).fill("Trail du Lac");
  await location(screen).fill("Annecy");
  await startDate(screen).fill("2026-06-13");
  await endDate(screen).fill("2026-06-14");
  const row = format(screen, 1);
  await raceType(row).selectOptions(trailType.id);
  await distance(row).fill("42");
}

// Intl separates a number from its unit with a no-break space: tests read the
// text as it looks.
const plain = (s: string | null) => (s ?? "").replace(/\p{Zs}/gu, " ");

/** The select of the format to join, and what it offers. */
const joinFormat = (screen: Screen) =>
  screen.getByLabelText(fr.participation.format, { exact: true });

function optionsOf(select: Element): HTMLOptionElement[] {
  if (!(select instanceof HTMLSelectElement)) throw new Error("not a select");
  return Array.from(select.options);
}

/** Chooses the format `n` (from 1) in the select of the format to join. */
async function chooseJoinFormat(screen: Screen, n: number) {
  const option = optionsOf(joinFormat(screen).element())[n - 1];
  if (!option) throw new Error(`no format ${n} to join`);
  await joinFormat(screen).selectOptions(option.value);
}

const summary = () => mocks.calls.map(({ action, collection }) => `${action} ${collection}`);

// --- Creation ---

test("EventForm — à la création : un groupe « Épreuve 1 », « Je participe » coché par défaut", async () => {
  const { screen } = await renderForm();

  await expect.element(name(screen)).toHaveValue("");
  await expect.element(format(screen, 1)).toBeVisible();
  await expect.element(joinBox(screen)).toBeChecked();
  // The race types come from the server.
  await expect.element(raceType(format(screen, 1))).toHaveValue("");
  expect(
    Array.from(raceType(format(screen, 1)).element().querySelectorAll("option")).map(
      (option) => option.textContent,
    ),
  ).toEqual([fr.form.chooseRaceType, "Route", "Trail"]);
});

test("EventForm — « Retirer » est désactivé avec une seule épreuve", async () => {
  const { screen } = await renderForm();

  await expect.element(removes(screen)).toBeDisabled();
});

test("EventForm — avec deux épreuves « Retirer » est actif, et retirer l'une ramène à une seule", async () => {
  const { screen } = await renderForm();
  await addFormat(screen).click();
  await expect.element(format(screen, 2)).toBeVisible();
  const buttons = screen.getByRole("button", { name: fr.common.remove });
  await expect.element(buttons.first()).toBeEnabled();
  await expect.element(buttons.last()).toBeEnabled();

  await buttons.last().click();

  await expect.element(format(screen, 2)).not.toBeInTheDocument();
  await expect.element(removes(screen)).toBeDisabled();
});

test("EventForm — retirer la première épreuve garde les valeurs de la seconde", async () => {
  const { screen } = await renderForm();
  await distance(format(screen, 1)).fill("10");
  await addFormat(screen).click();
  await distance(format(screen, 2)).fill("21");

  await screen.getByRole("button", { name: fr.common.remove }).first().click();

  await expect.element(distance(format(screen, 1))).toHaveValue(21);
  await expect.element(format(screen, 2)).not.toBeInTheDocument();
});

test("EventForm — une nouvelle épreuve reprend le type de la précédente, et son premier champ a le focus", async () => {
  const { screen } = await renderForm();
  await raceType(format(screen, 1)).selectOptions(roadType.id);

  await addFormat(screen).click();

  await expect.element(raceType(format(screen, 2))).toHaveValue(roadType.id);
  await expect.element(format(screen, 2).getByLabelText(fr.form.formatName)).toHaveFocus();
});

test("EventForm — retirer une épreuve met le focus sur le titre des épreuves, qui reste", async () => {
  const { screen } = await renderForm();
  await addFormat(screen).click();

  await screen.getByRole("button", { name: fr.common.remove }).last().click();

  await expect
    .element(screen.getByRole("heading", { level: 2, name: fr.form.formatsTitle }))
    .toHaveFocus();
});

// --- The measure of a format ---

test("EventForm — sans distance, ni durée, ni temps max, l'erreur s'affiche avant tout envoi", async () => {
  const { screen } = await renderForm();
  await fillEvent(screen);
  await distance(format(screen, 1)).fill("");

  await save(screen).click();

  const row = format(screen, 1);
  await expect.element(row.getByText(fr.errors.format_measure_required)).toBeVisible();
  expect(mocks.send).not.toHaveBeenCalled();
  // The three measures are linked to the message.
  const describedBy = distance(row).element().getAttribute("aria-describedby") ?? "";
  const message = row.getByText(fr.errors.format_measure_required).element();
  expect(describedBy.split(" ")).toContain(message.id);
  expect(hoursOf(row, fr.form.duration).element().getAttribute("aria-describedby")).toContain(
    message.id,
  );
  expect(distance(row).element().getAttribute("aria-invalid")).toBe("true");
});

test("EventForm — seule l'épreuve sans mesure a l'erreur, et tout ce qui est saisi reste", async () => {
  const { screen } = await renderForm();
  await fillEvent(screen);
  await addFormat(screen).click();
  await elevation(format(screen, 2)).fill("300");

  await save(screen).click();

  await expect
    .element(format(screen, 2).getByText(fr.errors.format_measure_required))
    .toBeVisible();
  await expect
    .element(format(screen, 1).getByText(fr.errors.format_measure_required))
    .not.toBeInTheDocument();
  await expect.element(name(screen)).toHaveValue("Trail du Lac");
  await expect.element(distance(format(screen, 1))).toHaveValue(42);
  await expect.element(elevation(format(screen, 2))).toHaveValue(300);
  expect(mocks.send).not.toHaveBeenCalled();
});

test("EventForm — une durée, ou un temps max, suffit comme mesure", async () => {
  const { screen } = await renderForm();
  await fillEvent(screen);
  await distance(format(screen, 1)).fill("");
  await hoursOf(format(screen, 1), fr.form.timeLimit).fill("48");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  expect(mocks.calls[1]?.body).toMatchObject({ distance_km: 0, time_limit_min: 2880 });
});

// --- A save that works ---

test("EventForm — enregistre l'événement, ses épreuves et ma participation en un seul lot, puis va à la fiche", async () => {
  const { screen, router, invalidate } = await renderForm();
  await name(screen).fill("  Trail du Lac ");
  await location(screen).fill("Annecy");
  await startDate(screen).fill("2026-06-13");
  await endDate(screen).fill("2026-06-14");
  await screen
    .getByLabelText(fr.form.registrationUrl)
    .fill("https://trail.example.test/inscription");
  await notes(screen).fill("Parking à l'arrivée.");
  const first = format(screen, 1);
  await raceType(first).selectOptions(trailType.id);
  await distance(first).fill("42.195");
  await hoursOf(first, fr.form.timeLimit).fill("10");
  await elevation(first).fill("2400");
  await formatDate(first).fill("2026-06-14");
  await addFormat(screen).click();
  const second = format(screen, 2);
  await raceType(second).selectOptions(roadType.id);
  await hoursOf(second, fr.form.duration).fill("6");
  await minutesOf(second, fr.form.timeLimit).fill("90");
  await screen.getByLabelText(fr.participation.status).selectOptions("registered");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(router.state.location.pathname).toMatch(/^\/evenements\/[a-z0-9]{15}$/);
  });
  expect(mocks.send).toHaveBeenCalledOnce();
  expect(summary()).toEqual([
    "create events",
    "create formats",
    "create formats",
    "create participations",
  ]);
  const [event, one, two, participation] = mocks.calls;
  const eventId = String(event?.body?.id);
  expect(router.state.location.pathname).toBe(`/evenements/${eventId}`);
  expect(event?.body).toEqual({
    id: eventId,
    name: "Trail du Lac",
    location: "Annecy",
    start_date: "2026-06-13",
    end_date: "2026-06-14",
    registration_url: "https://trail.example.test/inscription",
    registration_deadline: "",
    notes: "Parking à l'arrivée.",
  });
  expect(one?.body).toMatchObject({
    event: eventId,
    race_type: trailType.id,
    distance_km: 42.195,
    duration_min: 0,
    time_limit_min: 600,
    elevation_gain_m: 2400,
    date: "2026-06-14",
  });
  expect(two?.body).toMatchObject({
    event: eventId,
    race_type: roadType.id,
    distance_km: 0,
    duration_min: 360,
    time_limit_min: 90,
    date: "",
  });
  expect(participation?.body).toEqual({
    id: expect.stringMatching(/^[a-z0-9]{15}$/),
    runner: aliceRunner.id,
    event: eventId,
    format: one?.body?.id,
    status: "registered",
  });
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(keys).toContainEqual(["events"]);
  expect(keys).toContainEqual(["event", eventId]);
  await expect.element(screen.getByText(`Fiche de ${eventId}`)).toBeVisible();
  await expect.element(screen.getByText(fr.form.saved)).toBeVisible();
});

test("EventForm — la date limite et le prix sont envoyés", async () => {
  const { screen, router } = await renderForm();
  await fillEvent(screen);
  await registrationDeadline(screen).fill("2026-06-10");
  await price(format(screen, 1)).fill("42.5");
  await addFormat(screen).click();
  await raceType(format(screen, 2)).selectOptions(roadType.id);
  await distance(format(screen, 2)).fill("10");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(router.state.location.pathname).toMatch(/^\/evenements\/[a-z0-9]{15}$/);
  });
  const [event, one, two] = mocks.calls;
  expect(event?.body).toMatchObject({ registration_deadline: "2026-06-10" });
  expect(one?.body).toMatchObject({ price_eur: 42.5 });
  // A format with no price sends 0, which is how it is cleared.
  expect(two?.body).toMatchObject({ price_eur: 0 });
});

test("EventForm — « Je participe » décoché : pas de participation", async () => {
  const { screen } = await renderForm();
  await fillEvent(screen);
  await joinBox(screen).click();

  await save(screen).click();

  await vi.waitFor(() => {
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  expect(summary()).toEqual(["create events", "create formats"]);
});

test("EventForm — « Je participe » propose les épreuves du formulaire, et je choisis l'épreuve et le statut", async () => {
  const { screen } = await renderForm();
  await fillEvent(screen);
  await addFormat(screen).click();
  await distance(format(screen, 2)).fill("15");
  await chooseJoinFormat(screen, 2);
  expect(plain(optionsOf(joinFormat(screen).element())[1]?.textContent ?? "")).toBe(
    "Épreuve 2 · Trail 15 km",
  );

  await save(screen).click();

  await vi.waitFor(() => {
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  const [, , second, participation] = mocks.calls;
  expect(participation?.body).toMatchObject({ format: second?.body?.id, status: "interested" });
});

test("EventForm — l'épreuve où je participe retirée du formulaire, la première prend sa place", async () => {
  const { screen } = await renderForm();
  await fillEvent(screen);
  await addFormat(screen).click();
  await distance(format(screen, 2)).fill("15");
  await chooseJoinFormat(screen, 2);
  await screen.getByRole("button", { name: fr.common.remove }).last().click();

  await save(screen).click();

  await vi.waitFor(() => {
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  expect(mocks.calls[2]?.body).toMatchObject({ format: mocks.calls[1]?.body?.id });
});

test("EventForm — pendant l'envoi le bouton est désactivé et dit « Enregistrement… »", async () => {
  // An action that is not over holds back every later transition of the page (React
  // runs them together with it): it has to end before the test does.
  const answer = Promise.withResolvers<unknown>();
  mocks.send.mockReturnValue(answer.promise);
  const { screen, router } = await renderForm();
  await fillEvent(screen);

  await save(screen).click();

  await expect.element(screen.getByRole("button", { name: fr.auth.saving })).toBeDisabled();
  expect(mocks.send).toHaveBeenCalledOnce();

  answer.resolve([]);
  await vi.waitFor(() => {
    expect(router.state.location.pathname).toMatch(/^\/evenements\/[a-z0-9]{15}$/);
  });
});

// --- « I'm taking part » before the day of the race ---
//
// Nobody finishes a race, or gives up on it, before its day: the server refuses it, and the
// form does not offer it for the race that the member takes part in. The event of `fillEvent`
// runs on 13 and 14 June.

const statusesOf = (screen: Screen) =>
  optionsOf(screen.getByLabelText(fr.participation.status).element()).map(
    (option) => option.textContent,
  );

const BEFORE_RACES = [fr.status.interested, fr.status.registered, fr.status.dns];
const ALL_STATUSES = [
  fr.status.interested,
  fr.status.registered,
  fr.status.finished,
  fr.status.dnf,
  fr.status.dns,
];

test("EventForm — « Je participe » à une course à venir : ni « Terminé » ni « Abandon »", async () => {
  const { screen } = await renderForm({ today: "2026-06-12" });
  await fillEvent(screen);

  expect(statusesOf(screen)).toEqual(BEFORE_RACES);
});

test("EventForm — le premier jour de la course ou après, tous les statuts sont proposés (on saisit une course passée)", async () => {
  for (const today of ["2026-06-13", "2026-09-01"]) {
    const { screen } = await renderForm({ today });
    await fillEvent(screen);

    expect(statusesOf(screen)).toEqual(ALL_STATUSES);
    await screen.unmount();
  }
});

test("EventForm — tant que la date de début n'est pas saisie, ni « Terminé » ni « Abandon »", async () => {
  const { screen } = await renderForm({ today: "2026-09-01" });

  expect(statusesOf(screen)).toEqual(BEFORE_RACES);

  await startDate(screen).fill("2026-06-13");

  expect(statusesOf(screen)).toEqual(ALL_STATUSES);
});

test("EventForm — la liste suit l'épreuve choisie, et son jour s'il en a un", async () => {
  const { screen } = await renderForm({ today: "2026-06-13" });
  await fillEvent(screen);
  await addFormat(screen).click();
  const second = format(screen, 2);
  await raceType(second).selectOptions(roadType.id);
  await minutesOf(second, fr.form.timeLimit).fill("90");
  await formatDate(second).fill("2026-06-14");

  // The first format has no day: it is the first day of the event, today.
  expect(statusesOf(screen)).toEqual(ALL_STATUSES);

  await chooseJoinFormat(screen, 2);

  expect(statusesOf(screen)).toEqual(BEFORE_RACES);
});

test("EventForm — « Terminé » choisi, puis un début plus tard : le statut envoyé est « Intéressé »", async () => {
  const { screen } = await renderForm({ today: "2026-06-13" });
  await fillEvent(screen);
  await screen.getByLabelText(fr.participation.status).selectOptions("finished");

  await startDate(screen).fill("2026-06-20");
  await endDate(screen).fill("2026-06-21");

  await expect.element(screen.getByLabelText(fr.participation.status)).toHaveValue("interested");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  expect(mocks.calls.at(-1)).toMatchObject({
    collection: "participations",
    body: { status: "interested" },
  });
});

// --- A save that is refused ---

test("EventForm — une erreur end_before_start s'affiche sous la date de fin, liée au champ, et les valeurs saisies restent", async () => {
  mocks.send.mockRejectedValue(refused(0, 400, { end_date: field("end_before_start") }));
  const { screen } = await renderForm();
  await name(screen).fill("Trail du Lac");
  await location(screen).fill("Annecy");
  await startDate(screen).fill("2026-06-14");
  await endDate(screen).fill("2026-06-13");
  await screen.getByLabelText(fr.form.registrationUrl).fill("https://trail.example.test");
  await notes(screen).fill("Parking à l'arrivée.");
  const first = format(screen, 1);
  await raceType(first).selectOptions(roadType.id);
  await distance(first).fill("10");
  await hoursOf(first, fr.form.duration).fill("1");
  await minutesOf(first, fr.form.duration).fill("30");
  await elevation(first).fill("50");
  await formatDate(first).fill("2026-06-14");
  await addFormat(screen).click();
  const second = format(screen, 2);
  await raceType(second).selectOptions(trailType.id);
  await minutesOf(second, fr.form.timeLimit).fill("90");
  await chooseJoinFormat(screen, 2);
  await screen.getByLabelText(fr.participation.status).selectOptions("dns");

  await save(screen).click();

  const message = screen.getByText(fr.errors.end_before_start);
  await expect.element(message).toBeVisible();
  // Linked to the end date, not to the start date.
  expect(endDate(screen).element().getAttribute("aria-describedby")).toContain(
    message.element().id,
  );
  expect(endDate(screen).element().getAttribute("aria-invalid")).toBe("true");
  expect(startDate(screen).element().getAttribute("aria-invalid")).toBe("false");
  // Everything typed is still there.
  await expect.element(name(screen)).toHaveValue("Trail du Lac");
  await expect.element(location(screen)).toHaveValue("Annecy");
  await expect.element(startDate(screen)).toHaveValue("2026-06-14");
  await expect.element(endDate(screen)).toHaveValue("2026-06-13");
  await expect
    .element(screen.getByLabelText(fr.form.registrationUrl))
    .toHaveValue("https://trail.example.test");
  await expect.element(notes(screen)).toHaveValue("Parking à l'arrivée.");
  await expect.element(raceType(first)).toHaveValue(roadType.id);
  await expect.element(distance(first)).toHaveValue(10);
  await expect.element(hoursOf(first, fr.form.duration)).toHaveValue(1);
  await expect.element(minutesOf(first, fr.form.duration)).toHaveValue(30);
  await expect.element(elevation(first)).toHaveValue(50);
  await expect.element(formatDate(first)).toHaveValue("2026-06-14");
  await expect.element(raceType(second)).toHaveValue(trailType.id);
  await expect.element(minutesOf(second, fr.form.timeLimit)).toHaveValue(90);
  await expect.element(joinBox(screen)).toBeChecked();
  // The second format is the one that is chosen to join.
  const joined = optionsOf(joinFormat(screen).element()).findIndex((option) => option.selected);
  expect(joined).toBe(1);
  await expect.element(screen.getByLabelText(fr.participation.status)).toHaveValue("dns");
});

test("EventForm — un refus registration_deadline_after_start s'affiche sous la date limite", async () => {
  mocks.send.mockRejectedValue(
    refused(0, 400, { registration_deadline: field("registration_deadline_after_start") }),
  );
  const { screen } = await renderForm();
  await fillEvent(screen);
  await registrationDeadline(screen).fill("2026-06-20");

  await save(screen).click();

  const message = screen.getByText(fr.errors.registration_deadline_after_start);
  await expect.element(message).toBeVisible();
  // Linked to the deadline, not to the start date, and what was typed stays.
  expect(registrationDeadline(screen).element().getAttribute("aria-describedby")).toContain(
    message.element().id,
  );
  expect(registrationDeadline(screen).element().getAttribute("aria-invalid")).toBe("true");
  expect(startDate(screen).element().getAttribute("aria-invalid")).toBe("false");
  await expect.element(registrationDeadline(screen)).toHaveValue("2026-06-20");
});

test("EventForm — le refus d'un prix s'affiche sous le prix de son épreuve", async () => {
  // Request 0 is the event, 1 the first format.
  mocks.send.mockRejectedValue(refused(1, 400, { price_eur: field("price_invalid") }));
  const { screen } = await renderForm();
  await fillEvent(screen);
  await price(format(screen, 1)).fill("12.34");

  await save(screen).click();

  const message = screen.getByText(fr.errors.price_invalid);
  await expect.element(message).toBeVisible();
  expect(price(format(screen, 1)).element().getAttribute("aria-describedby")).toContain(
    message.element().id,
  );
  await expect.element(price(format(screen, 1))).toHaveValue(12.34);
});

test("EventForm — l'erreur d'une épreuve s'affiche dans cette épreuve, pas dans l'autre", async () => {
  // Request 0 is the event, 1 the first format, 2 the second.
  mocks.send.mockRejectedValue(refused(2, 400, { date: field("format_date_out_of_range") }));
  const { screen } = await renderForm();
  await fillEvent(screen);
  await addFormat(screen).click();
  await distance(format(screen, 2)).fill("15");
  await formatDate(format(screen, 2)).fill("2026-07-01");

  await save(screen).click();

  const message = format(screen, 2).getByText(fr.errors.format_date_out_of_range);
  await expect.element(message).toBeVisible();
  expect(formatDate(format(screen, 2)).element().getAttribute("aria-describedby")).toContain(
    message.element().id,
  );
  await expect
    .element(format(screen, 1).getByText(fr.errors.format_date_out_of_range))
    .not.toBeInTheDocument();
  await expect.element(formatDate(format(screen, 2))).toHaveValue("2026-07-01");
});

test("EventForm — la mesure refusée par le serveur est dite une fois, pour l'épreuve", async () => {
  mocks.send.mockRejectedValue(refused(1, 400, { distance_km: field("format_measure_required") }));
  const { screen } = await renderForm();
  await fillEvent(screen);

  await save(screen).click();

  await expect
    .element(format(screen, 1).getByText(fr.errors.format_measure_required))
    .toBeVisible();
});

test("EventForm — un code de champ du serveur est traduit dans la langue de l'application", async () => {
  mocks.send.mockRejectedValue(refused(0, 400, { name: field("validation_required") }));
  const { screen } = await renderForm();
  await fillEvent(screen);

  await save(screen).click();

  await expect.element(screen.getByText(fr.errors.validation_required)).toBeVisible();
  expect(name(screen).element().getAttribute("aria-invalid")).toBe("true");
});

test("EventForm — le refus de la participation, sans champ du formulaire, est dit au-dessus du bouton", async () => {
  mocks.send.mockRejectedValue(refused(3, 400, { runner: field("validation_not_unique") }));
  const { screen } = await renderForm();
  await fillEvent(screen);
  await addFormat(screen).click();
  await distance(format(screen, 2)).fill("15");

  await save(screen).click();

  await expect
    .element(screen.getByRole("alert").filter({ hasText: fr.errors.validation_not_unique }))
    .toBeVisible();
  await expect.element(name(screen)).toHaveValue("Trail du Lac");
});

test("EventForm — une règle qui refuse (404) est dite avec son message, une panne avec le message général", async () => {
  mocks.send.mockRejectedValue(refused(1, 404));
  const { screen } = await renderForm();
  await fillEvent(screen);

  await save(screen).click();

  await expect.element(format(screen, 1).getByText(fr.errors.not_found)).toBeVisible();

  mocks.send.mockRejectedValue(
    new ClientResponseError({ status: 0, originalError: new TypeError("fetch") }),
  );
  await save(screen).click();

  await expect.element(screen.getByText(fr.errors.generic)).toBeVisible();
  await expect.element(name(screen)).toHaveValue("Trail du Lac");
  await expect.element(distance(format(screen, 1))).toHaveValue(42);
  // The message of the format is gone, it is the message of this attempt that is shown.
  await expect.element(screen.getByText(fr.errors.not_found)).not.toBeInTheDocument();
});

test("EventForm — après un refus, on peut corriger et enregistrer", async () => {
  mocks.send.mockRejectedValueOnce(refused(0, 400, { end_date: field("end_before_start") }));
  const { screen, router } = await renderForm();
  await fillEvent(screen);
  await endDate(screen).fill("2026-06-12");
  await save(screen).click();
  await expect.element(screen.getByText(fr.errors.end_before_start)).toBeVisible();

  await endDate(screen).fill("2026-06-14");
  await save(screen).click();

  await vi.waitFor(() => {
    expect(router.state.location.pathname).toMatch(/^\/evenements\/[a-z0-9]{15}$/);
  });
  expect(mocks.send).toHaveBeenCalledTimes(2);
  await expect.element(screen.getByText(fr.errors.end_before_start)).not.toBeInTheDocument();
});

// --- Duplicates ---

const lac = {
  ...eventRecord,
  id: "lac00000000000",
  name: "Trail du Lac d'Annecy",
  location: "Annecy",
  start_date: "2026-06-20",
  end_date: "2026-06-21",
};

test("EventForm — les doublons possibles sont cherchés 400 ms après la dernière frappe, une fois le nom et la date remplis", async () => {
  mocks.getList.mockResolvedValue({ items: [lac, event2Record] });
  const { screen } = await renderForm();

  await name(screen).fill("Trail des Crêtes");
  await new Promise((resolve) => setTimeout(resolve, 600));
  // No date yet.
  expect(mocks.getList).not.toHaveBeenCalled();

  await startDate(screen).fill("2026-06-13");
  // Not yet: the user may be typing.
  expect(mocks.getList).not.toHaveBeenCalled();

  await expect.element(screen.getByText(fr.form.duplicateQuestion)).toBeVisible();
  expect(mocks.getList).toHaveBeenCalledOnce();
  const options = mocks.getList.mock.calls[0]?.[2];
  expect(String(options?.filter)).toContain('"w0":"trail"');
  expect(String(options?.filter)).toContain('"w1":"crêtes"');
  expect(String(options?.filter)).toContain('"from":"2026-05-14"');
  expect(String(options?.filter)).toContain('"to":"2026-07-13"');
  expect(String(options?.filter)).not.toContain("exclude");
});

test("EventForm — chaque frappe repousse la recherche : un seul appel", async () => {
  const { screen } = await renderForm();
  await startDate(screen).fill("2026-06-13");

  await name(screen).fill("Tra");
  await name(screen).fill("Trail");
  await new Promise((resolve) => setTimeout(resolve, 200));
  await name(screen).fill("Trail du");
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(mocks.getList).not.toHaveBeenCalled();

  await vi.waitFor(() => {
    expect(mocks.getList).toHaveBeenCalledOnce();
  });
  expect(String(mocks.getList.mock.calls[0]?.[2].filter)).toContain('"w0":"trail"');
});

test("EventForm — les doublons sont des liens vers les fiches, qui s'ouvrent à part pour ne pas perdre la saisie", async () => {
  mocks.getList.mockResolvedValue({ items: [lac] });
  const { screen } = await renderForm();
  await name(screen).fill("Trail du Lac");
  await startDate(screen).fill("2026-06-13");

  const link = screen.getByRole("link", { name: /Trail du Lac d'Annecy/ });
  await expect.element(link).toBeVisible();
  await expect.element(link).toHaveAttribute("href", "/evenements/lac00000000000");
  await expect.element(link).toHaveAttribute("target", "_blank");
  expect(link.element().textContent).toContain("Annecy");
  expect(link.element().textContent).toContain("sam. 20 juin 2026");
});

test("EventForm — rien à chercher quand le nom n'a pas de mot de quatre lettres", async () => {
  const { screen } = await renderForm();

  await name(screen).fill("Le 10");
  await startDate(screen).fill("2026-06-13");
  await new Promise((resolve) => setTimeout(resolve, 700));

  expect(mocks.getList).not.toHaveBeenCalled();
});

test("EventForm — une recherche de doublons qui échoue ne gêne pas", async () => {
  mocks.getList.mockRejectedValue(new Error("down"));
  const { screen } = await renderForm();
  await fillEvent(screen);
  await new Promise((resolve) => setTimeout(resolve, 700));

  expect(screen.container.textContent).not.toContain(fr.form.duplicateQuestion);
  await expect.element(save(screen)).toBeEnabled();
});

// --- Modification ---

test("EventForm — à la modification : les valeurs de l'événement, ses épreuves dans l'ordre, et pas de « Je participe »", async () => {
  const { screen } = await renderEdit();

  await expect.element(name(screen)).toHaveValue("Trail des Crêtes");
  await expect.element(location(screen)).toHaveValue("Annecy");
  await expect.element(startDate(screen)).toHaveValue("2026-06-13");
  await expect.element(endDate(screen)).toHaveValue("2026-06-14");
  // F15 is on the first day, F42 on the second.
  await expect.element(distance(format(screen, 1))).toHaveValue(15);
  await expect.element(elevation(format(screen, 1))).toHaveValue(700);
  await expect.element(formatDate(format(screen, 1))).toHaveValue("");
  await expect.element(distance(format(screen, 2))).toHaveValue(42);
  await expect.element(hoursOf(format(screen, 2), fr.form.timeLimit)).toHaveValue(10);
  await expect.element(formatDate(format(screen, 2))).toHaveValue("2026-06-14");
  await expect.element(raceType(format(screen, 2))).toHaveValue(trailType.id);
  expect(screen.container.textContent).not.toContain(fr.form.join);
});

test("EventForm — à la modification, la date limite et le prix sont préremplis", async () => {
  mocks.getOne.mockResolvedValue({
    ...eventRecord,
    registration_deadline: "2026-06-10",
    expand: {
      ...eventRecord.expand,
      formats_via_event: [
        { ...f42, price_eur: 65 },
        { ...f15, price_eur: 42.5 },
      ],
    },
  });
  const { screen } = await renderEdit();

  await expect.element(registrationDeadline(screen)).toHaveValue("2026-06-10");
  // F15 is the first format, F42 the second.
  await expect.element(price(format(screen, 1))).toHaveValue(42.5);
  await expect.element(price(format(screen, 2))).toHaveValue(65);
});

test("EventForm — à la modification, sans date limite ni prix, les champs sont vides", async () => {
  const { screen } = await renderEdit();

  await expect.element(registrationDeadline(screen)).toHaveValue("");
  await expect.element(price(format(screen, 1))).toHaveValue(null);
});

test("EventForm — enregistre la modification par id, sans l'événement dans les épreuves, et va à la fiche", async () => {
  const { screen, router, invalidate } = await renderEdit();
  await name(screen).fill("Trail des Crêtes 2026");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(router.state.location.pathname).toBe("/evenements/event");
  });
  expect(mocks.send).toHaveBeenCalledOnce();
  // The formats that stay are updated first, then the event.
  expect(summary()).toEqual(["update formats", "update formats", "update events"]);
  expect(mocks.calls.map(({ id }) => id)).toEqual(["f15", "f42", "event"]);
  expect(mocks.calls[2]?.body).toMatchObject({ name: "Trail des Crêtes 2026", location: "Annecy" });
  expect(mocks.calls[2]?.body).not.toHaveProperty("created_by");
  for (const call of mocks.calls.slice(0, 2)) expect(call.body).not.toHaveProperty("event");
  expect(mocks.calls[1]?.body).toMatchObject({
    distance_km: 42,
    time_limit_min: 600,
    elevation_gain_m: 2400,
    date: "2026-06-14",
  });
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(keys).toContainEqual(["events"]);
  expect(keys).toContainEqual(["event", "event"]);
});

test("EventForm — l'épreuve qu'on retire est supprimée dans le même lot, et celle qu'on ajoute est créée pour l'événement", async () => {
  const { screen } = await renderEdit();
  await screen.getByRole("button", { name: fr.common.remove }).first().click();
  await addFormat(screen).click();
  await distance(format(screen, 2)).fill("21");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  expect(mocks.calls).toContainEqual({ action: "delete", collection: "formats", id: "f15" });
  const created = mocks.calls.filter(({ action }) => action === "create");
  expect(created).toHaveLength(1);
  expect(created[0]?.body).toMatchObject({ event: "event", distance_km: 21 });
});

test("EventForm — les dates effacées, ou les mesures, sont envoyées vides pour être effacées", async () => {
  const { screen } = await renderEdit();
  await endDate(screen).fill("");
  await formatDate(format(screen, 2)).fill("");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  expect(mocks.calls.find(({ collection }) => collection === "events")?.body).toMatchObject({
    end_date: "",
  });
  expect(mocks.calls.find(({ id }) => id === "f42")?.body).toMatchObject({ date: "" });
});

test("EventForm — l'auteur peut retirer les épreuves existantes, et est prévenu quand des coureurs y sont", async () => {
  const { screen } = await renderEdit();

  const buttons = screen.getByRole("button", { name: fr.common.remove });
  await expect.element(buttons.first()).toBeEnabled();
  await expect.element(buttons.last()).toBeEnabled();
  // F15 has one runner, F42 two.
  await expect.element(format(screen, 1).getByText(fr.form.formatHasParticipants(1))).toBeVisible();
  await expect.element(format(screen, 2).getByText(fr.form.formatHasParticipants(2))).toBeVisible();
  // The warning is the description of the button.
  const warning = format(screen, 2).getByText(fr.form.formatHasParticipants(2)).element();
  const button = format(screen, 2).getByRole("button", { name: fr.common.remove }).element();
  expect(button.getAttribute("aria-describedby")).toBe(warning.id);
});

test("EventForm — un format sans participant n'a pas d'avertissement", async () => {
  mocks.getOne.mockResolvedValue(event2Record);
  mocks.myRunner.mockResolvedValue(bobRunner);
  signIn("bob");
  const { screen } = await renderEdit("event2");

  await expect.element(distance(format(screen, 1))).toHaveValue(10);
  expect(screen.container.textContent).not.toContain("personne est sur");
  expect(screen.container.textContent).not.toContain("personnes sont sur");
});

test("EventForm — un admin peut retirer les épreuves existantes", async () => {
  signIn("admin");
  const { screen } = await renderEdit();

  await expect
    .element(screen.getByRole("button", { name: fr.common.remove }).first())
    .toBeEnabled();
  await expect.element(screen.getByRole("button", { name: fr.common.remove }).last()).toBeEnabled();
});

test("EventForm — un membre qui n'est pas l'auteur ne voit pas « Retirer » sur les épreuves existantes, mais peut retirer les siennes", async () => {
  signIn("bob");
  const { screen, queryClient } = await renderEdit();
  await expect.element(distance(format(screen, 1))).toHaveValue(15);
  // The runner of Bob is loaded: the rule is applied, not the default of a runner that is not there yet.
  await vi.waitFor(() => {
    expect(queryClient.getQueryData(["runner", "u-bob"])).toBeDefined();
  });
  await expect
    .element(screen.getByRole("button", { name: fr.common.remove }))
    .not.toBeInTheDocument();
  // No warning either: it would be about a button that is not there.
  expect(screen.container.textContent).not.toContain("personnes sont sur");

  await addFormat(screen).click();
  await expect.element(format(screen, 3)).toBeVisible();

  // Only the new format can be taken off.
  const buttons = screen.getByRole("button", { name: fr.common.remove });
  await expect.element(buttons).toBeVisible();
  await expect.element(buttons).toBeEnabled();
  await buttons.click();
  await expect.element(format(screen, 3)).not.toBeInTheDocument();
});

test("EventForm — tant que le coureur de l'utilisateur se charge, les épreuves existantes ne peuvent pas être retirées", async () => {
  mocks.myRunner.mockReturnValue(new Promise(() => {}));
  const { screen } = await renderEdit();

  await expect.element(distance(format(screen, 1))).toHaveValue(15);
  await expect
    .element(screen.getByRole("button", { name: fr.common.remove }))
    .not.toBeInTheDocument();
});

test("EventForm — l'erreur d'une épreuve existante est dans son groupe, et la modification garde les valeurs", async () => {
  // F15 and F42 are updated before the event: the request 0 is F15.
  mocks.send.mockRejectedValue(refused(0, 404));
  const { screen } = await renderEdit();
  await name(screen).fill("Trail des Crêtes 2026");

  await save(screen).click();

  await expect.element(format(screen, 1).getByText(fr.errors.not_found)).toBeVisible();
  await expect.element(format(screen, 2).getByText(fr.errors.not_found)).not.toBeInTheDocument();
  await expect.element(name(screen)).toHaveValue("Trail des Crêtes 2026");
});

test("EventForm — réduire les dates : l'erreur du serveur s'affiche sous la date de début", async () => {
  // The formats that stay (F15, F42) go first: the event is the third request.
  mocks.send.mockRejectedValue(refused(2, 400, { start_date: field("format_date_out_of_range") }));
  const { screen } = await renderEdit();
  await endDate(screen).fill("2026-06-13");

  await save(screen).click();

  await expect.element(screen.getByText(fr.errors.format_date_out_of_range)).toBeVisible();
  expect(startDate(screen).element().getAttribute("aria-describedby")).toContain(
    screen.getByText(fr.errors.format_date_out_of_range).element().id,
  );
});

test("EventForm — reporter l'événement et déplacer l'épreuve du jour 2 : un seul lot, la date de l'épreuve après l'événement", async () => {
  const { screen, router } = await renderEdit();
  // 13-14 June becomes 20-21 June, and F42 (the 14th) goes to the 21st.
  await startDate(screen).fill("2026-06-20");
  await endDate(screen).fill("2026-06-21");
  await formatDate(format(screen, 2)).fill("2026-06-21");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(router.state.location.pathname).toBe("/evenements/event");
  });
  expect(mocks.send).toHaveBeenCalledOnce();
  // F42 waits with no date, the event moves, then F42 gets its day.
  expect(summary()).toEqual([
    "update formats",
    "update formats",
    "update events",
    "update formats",
  ]);
  expect(mocks.calls.map(({ id }) => id)).toEqual(["f15", "f42", "event", "f42"]);
  expect(mocks.calls[1]?.body).toMatchObject({ distance_km: 42, date: "" });
  expect(mocks.calls[2]?.body).toMatchObject({
    start_date: "2026-06-20",
    end_date: "2026-06-21",
  });
  expect(mocks.calls[3]?.body).toEqual({ date: "2026-06-21" });
  for (const call of mocks.calls.filter(({ collection }) => collection === "formats")) {
    expect(call.body).not.toHaveProperty("event");
  }
});

test("EventForm — la date d'une épreuve refusée à la fin du lot s'affiche sous la date de cette épreuve", async () => {
  // The requests: F15, F42 (undated), the event, then the date of F42.
  mocks.send.mockRejectedValue(refused(3, 400, { date: field("format_date_out_of_range") }));
  const { screen } = await renderEdit();
  await startDate(screen).fill("2026-06-20");
  await endDate(screen).fill("2026-06-21");
  await formatDate(format(screen, 2)).fill("2026-06-30");

  await save(screen).click();

  const message = format(screen, 2).getByText(fr.errors.format_date_out_of_range);
  await expect.element(message).toBeVisible();
  expect(formatDate(format(screen, 2)).element().getAttribute("aria-describedby")).toContain(
    message.element().id,
  );
  await expect
    .element(format(screen, 1).getByText(fr.errors.format_date_out_of_range))
    .not.toBeInTheDocument();
  // The event's fields have no error, and everything typed is still there.
  expect(startDate(screen).element().getAttribute("aria-invalid")).toBe("false");
  await expect.element(startDate(screen)).toHaveValue("2026-06-20");
  await expect.element(formatDate(format(screen, 2))).toHaveValue("2026-06-30");
});

test("EventForm — les doublons de la modification laissent de côté l'événement lui-même", async () => {
  const { screen } = await renderEdit();

  await vi.waitFor(() => {
    expect(mocks.getList).toHaveBeenCalled();
  });
  expect(String(mocks.getList.mock.calls[0]?.[2].filter)).toContain('"exclude":"event"');
  await expect.element(name(screen)).toHaveValue("Trail des Crêtes");
});

test("EventForm — une épreuve ajoutée par quelqu'un d'autre pendant la modification n'est pas supprimée par ce formulaire", async () => {
  const { screen, queryClient } = await renderEdit();
  await name(screen).fill("Trail des Crêtes 2026");
  // Somebody adds a format to the event: the page asks again and gets it.
  const added = {
    ...eventRecord.expand.formats_via_event[1],
    id: "fnew",
    expand: { race_type: trailType },
  };
  mocks.getOne.mockResolvedValue({
    ...eventRecord,
    expand: { formats_via_event: [...eventRecord.expand.formats_via_event, added] },
  });
  await queryClient.invalidateQueries({ queryKey: ["event", "event"] });
  await vi.waitFor(() => {
    expect(mocks.getOne).toHaveBeenCalledTimes(2);
  });

  await save(screen).click();

  await vi.waitFor(() => {
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  expect(mocks.calls.some(({ action }) => action === "delete")).toBe(false);
  // The form still has the two formats it was opened with.
  expect(mocks.calls.filter(({ collection }) => collection === "formats")).toHaveLength(2);
});

// --- The page of the edit route ---

test("EditEventPage — attend l'événement, puis montre le formulaire", async () => {
  mocks.getOne.mockReturnValue(new Promise(() => {}));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={["fr"]}>
        <ToastProvider>
          <EditEventPage id="event" />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );

  await expect.element(screen.getByText(fr.common.loading)).toBeVisible();
});

test("EditEventPage — un événement introuvable est dit, sans bouton pour réessayer", async () => {
  mocks.getOne.mockRejectedValue(
    new ClientResponseError({ status: 404, response: { status: 404 } }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={["fr"]}>
        <ToastProvider>
          <EditEventPage id="gone" />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );

  await expect.element(screen.getByText(fr.errors.not_found)).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: fr.common.retry }))
    .not.toBeInTheDocument();
});

test("EventForm — les types de course qui ne se chargent pas : message et nouvel essai", async () => {
  mocks.raceTypes.mockRejectedValueOnce(new Error("down"));
  const { screen } = await mountForm();
  await expect.element(screen.getByText(fr.errors.generic)).toBeVisible();

  await screen.getByRole("button", { name: fr.common.retry }).click();

  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.form.createTitle }))
    .toBeVisible();
});

// --- The look ---

test("EventForm — les champs et les boutons font au moins 44 px de haut", async () => {
  const { screen } = await renderForm();
  await addFormat(screen).click();
  const targets = [
    name(screen),
    location(screen),
    startDate(screen),
    endDate(screen),
    registrationDeadline(screen),
    notes(screen),
    save(screen),
    addFormat(screen),
    screen.getByRole("button", { name: fr.common.remove }).first(),
    screen.getByRole("link", { name: fr.common.cancel }),
    raceType(format(screen, 1)),
    distance(format(screen, 1)),
    hoursOf(format(screen, 1), fr.form.duration),
    minutesOf(format(screen, 2), fr.form.timeLimit),
    elevation(format(screen, 2)),
    price(format(screen, 2)),
    formatDate(format(screen, 2)),
    screen.getByLabelText(fr.participation.status),
  ];

  for (const target of targets) {
    expect(target.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
  // The checkbox is small, its label is the tap target.
  const label = joinBox(screen).element().closest("label");
  expect(label?.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});

test("EventForm — en anglais, les textes sont anglais", async () => {
  const { screen } = await renderForm({ languages: ["en-GB"], heading: "Create an event" });

  await expect.element(screen.getByLabelText("Event name")).toBeVisible();
  await expect.element(screen.getByRole("group", { name: "Race 1", exact: true })).toBeVisible();
  await expect.element(screen.getByRole("checkbox", { name: "I'm taking part" })).toBeChecked();
  await expect.element(screen.getByRole("button", { name: "Add a race" })).toBeVisible();
});

// --- The track and the link of the course ---

const GPX_NAMESPACE = "http://www.topografix.com/GPX/1/1";

/** 0.1° of latitude is 11.12 km: 22.2 km, 200 m up then 100 m down. */
const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="${GPX_NAMESPACE}"><trk><trkseg>
  <trkpt lat="45.0" lon="6"><ele>450</ele></trkpt>
  <trkpt lat="45.1" lon="6"><ele>650</ele></trkpt>
  <trkpt lat="45.2" lon="6"><ele>550</ele></trkpt>
</trkseg></trk></gpx>`;

/** The same, with no altitude. */
const GPX_FLAT = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="${GPX_NAMESPACE}"><trk><trkseg>
  <trkpt lat="45.0" lon="6"/><trkpt lat="45.1" lon="6"/><trkpt lat="45.2" lon="6"/>
</trkseg></trk></gpx>`;

const gpxFile = (text = GPX, filename = "trace.gpx") =>
  new File([text], filename, { type: "application/gpx+xml" });

/** The event of the fixture, whose 15 km (the first format of the form) has a track and a link. */
function withTrack() {
  mocks.getOne.mockResolvedValue({
    ...eventRecord,
    expand: {
      ...eventRecord.expand,
      formats_via_event: [
        f42,
        {
          ...f15,
          gpx: "trace_ab12cd.gpx",
          route_url: "https://www.openrunner.com/route-details/1",
        },
      ],
    },
  });
}

/** What the update number `n` of a format on its own was given: the id, and the file of its form. */
function uploaded(n = 0): { id: string; file: File } {
  const [id, body] = mocks.updateFormat.mock.calls[n] ?? [];
  const file = body instanceof FormData ? body.get("gpx") : undefined;
  if (typeof id !== "string" || !(file instanceof File)) {
    throw new Error("the format was not updated with a file");
  }
  return { id, file };
}

/** How many files a file field holds: the browser forgets one that was refused. */
function filesIn(input: { element(): Element }): number {
  const element = input.element();
  if (!(element instanceof HTMLInputElement)) throw new Error("not an input");
  return element.files?.length ?? 0;
}

const reuse = (row: Row) => row.getByRole("button", { name: fr.format.gpxReuse });
const removeTrack = (row: Row) =>
  row.getByRole("button", { name: fr.format.gpxRemove, exact: true });
/** The line that says what a chosen file holds. */
const trackRead = (row: Row) => row.getByText(/^(Trace|Track) ?: /);

/** Waits for the page of the event that has just been saved. */
async function savedEvent(router: Awaited<ReturnType<typeof renderForm>>["router"]) {
  await vi.waitFor(() => {
    expect(router.state.location.pathname).toMatch(/^\/evenements\/[a-z0-9]{15}$/);
  });
}

test("EventForm — une trace choisie affiche sa distance et son D+, « Reprendre ces valeurs » les recopie", async () => {
  const { screen } = await renderForm();
  const row = format(screen, 1);
  await distance(row).fill("20");
  await elevation(row).fill("500");

  await gpxField(row).upload(gpxFile());

  // What the file says is read in the browser, and shown: the fields are not touched yet.
  const read = row.getByText(/^Trace : /);
  await expect.element(read).toBeVisible();
  expect(plain(read.element().textContent)).toBe("Trace : 22,2 km, 200 m D+");
  await expect.element(distance(row)).toHaveValue(20);
  await expect.element(elevation(row)).toHaveValue(500);

  await reuse(row).click();

  await expect.element(distance(row)).toHaveValue(22.2);
  await expect.element(elevation(row)).toHaveValue(200);
});

test("EventForm — une trace sans altitude ne remplit que la distance, et ne dit pas de D+", async () => {
  const { screen } = await renderForm();
  const row = format(screen, 1);
  await elevation(row).fill("500");

  await gpxField(row).upload(gpxFile(GPX_FLAT));

  const read = row.getByText(/^Trace : /);
  await expect.element(read).toBeVisible();
  expect(plain(read.element().textContent)).toBe("Trace : 22,2 km");
  await reuse(row).click();
  await expect.element(distance(row)).toHaveValue(22.2);
  // The elevation typed by the user is not erased by a track that has none.
  await expect.element(elevation(row)).toHaveValue(500);
});

test("EventForm — une trace illisible est refusée avec un message, et n'est pas gardée", async () => {
  const { screen, router } = await renderForm();
  await fillEvent(screen);
  const row = format(screen, 1);

  await gpxField(row).upload(gpxFile("ceci n'est pas une trace", "notes.gpx"));

  const message = row.getByText(fr.route.unreadable);
  await expect.element(message).toBeVisible();
  // The message is linked to the field, which says that it is invalid.
  expect(gpxField(row).element().getAttribute("aria-describedby")).toContain(message.element().id);
  expect(gpxField(row).element().getAttribute("aria-invalid")).toBe("true");
  // The file is not kept: the field is empty, and no reading is shown.
  expect(filesIn(gpxField(row))).toBe(0);
  await expect.element(trackRead(row)).not.toBeInTheDocument();
  await expect.element(reuse(row)).not.toBeInTheDocument();
  // Saving sends no track.
  await save(screen).click();
  await savedEvent(router);
  expect(mocks.updateFormat).not.toHaveBeenCalled();
});

test("EventForm — après une trace illisible, un bon fichier efface le message", async () => {
  const { screen } = await renderForm();
  const row = format(screen, 1);
  await gpxField(row).upload(gpxFile("ceci n'est pas une trace", "notes.gpx"));
  await expect.element(row.getByText(fr.route.unreadable)).toBeVisible();

  await gpxField(row).upload(gpxFile());

  await expect.element(trackRead(row)).toBeVisible();
  await expect.element(row.getByText(fr.route.unreadable)).not.toBeInTheDocument();
});

test("EventForm — une trace illisible après une bonne ne laisse pas la bonne partir", async () => {
  const { screen, router } = await renderForm();
  await fillEvent(screen);
  const row = format(screen, 1);
  await gpxField(row).upload(gpxFile());
  await expect.element(trackRead(row)).toBeVisible();

  await gpxField(row).upload(gpxFile("ceci n'est pas une trace", "notes.gpx"));

  await expect.element(row.getByText(fr.route.unreadable)).toBeVisible();
  await expect.element(trackRead(row)).not.toBeInTheDocument();
  await save(screen).click();
  await savedEvent(router);
  expect(mocks.updateFormat).not.toHaveBeenCalled();
});

test("EventForm — la trace choisie part après le lot, pour l'épreuve que le lot crée, puis on va à la fiche", async () => {
  const { screen, router, invalidate } = await renderForm();
  await fillEvent(screen);
  await gpxField(format(screen, 1)).upload(gpxFile());
  await expect.element(trackRead(format(screen, 1))).toBeVisible();

  await save(screen).click();

  await savedEvent(router);
  // The track is not in the batch: it is sent on its own, once the format exists.
  const created = mocks.calls.find(({ collection }) => collection === "formats");
  expect(created?.body).not.toHaveProperty("gpx");
  expect(mocks.updateFormat).toHaveBeenCalledOnce();
  const { id, file } = uploaded();
  expect(id).toBe(created?.body?.id);
  expect(file.name).toBe("trace.gpx");
  expect(await file.text()).toBe(GPX);
  // The page of the event is asked for again, to have the track.
  const eventId = router.state.location.pathname.split("/").pop();
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(keys).toContainEqual(["event", eventId]);
  await expect.element(screen.getByText(fr.form.saved)).toBeVisible();
});

test("EventForm — une trace qui ne part pas : l'événement est enregistré, on va à la fiche avec un message qui nomme l'épreuve", async () => {
  mocks.updateFormat.mockRejectedValue(new Error("offline"));
  const { screen, router, invalidate } = await renderForm();
  await fillEvent(screen);
  await gpxField(format(screen, 1)).upload(gpxFile());
  await expect.element(trackRead(format(screen, 1))).toBeVisible();

  await save(screen).click();

  await savedEvent(router);
  expect(mocks.send).toHaveBeenCalledOnce();
  const eventId = router.state.location.pathname.split("/").pop();
  await expect.element(screen.getByText(`Fiche de ${eventId}`)).toBeVisible();
  // The format is named as the page names it, by its type and its distance.
  const failed = screen.getByText(/mais la trace de /);
  await expect.element(failed).toBeVisible();
  expect(plain(failed.element().textContent)).toBe(fr.form.traceFailed("Trail 42 km"));
  expect(screen.container.textContent).not.toContain(fr.form.saved);
  // The event is saved all the same: its lists are asked for again.
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(keys).toContainEqual(["event", eventId]);
});

test("EventForm — le lien du parcours est envoyé", async () => {
  const { screen, router } = await renderForm();
  await fillEvent(screen);
  await addFormat(screen).click();
  await raceType(format(screen, 2)).selectOptions(roadType.id);
  await distance(format(screen, 2)).fill("10");
  await routeUrl(format(screen, 1)).fill("  https://www.openrunner.com/route-details/123 ");
  await expect.element(routeUrl(format(screen, 1))).toHaveAttribute("type", "url");

  await save(screen).click();

  await savedEvent(router);
  const [, one, two] = mocks.calls;
  expect(one?.body).toMatchObject({ route_url: "https://www.openrunner.com/route-details/123" });
  // A format with no link sends an empty one, which is how it is cleared.
  expect(two?.body).toMatchObject({ route_url: "" });
  expect(mocks.updateFormat).not.toHaveBeenCalled();
});

test("EventForm — un refus validation_invalid_mime_type sur gpx dit « Ce fichier n'est pas une trace GPX. »", async () => {
  // Request 0 is the event, 1 the first format.
  mocks.send.mockRejectedValue(refused(1, 400, { gpx: field("validation_invalid_mime_type") }));
  const { screen } = await renderForm();
  await fillEvent(screen);

  await save(screen).click();

  const message = screen.getByText("Ce fichier n'est pas une trace GPX.");
  await expect.element(message).toBeVisible();
  expect(gpxField(format(screen, 1)).element().getAttribute("aria-describedby")).toContain(
    message.element().id,
  );
  // Not the message of the photo of a runner.
  expect(screen.container.textContent).not.toContain(fr.errors.validation_invalid_mime_type);
});

test("EventForm — un refus validation_file_size_limit sur gpx dit que la trace est trop lourde", async () => {
  mocks.send.mockRejectedValue(refused(1, 400, { gpx: field("validation_file_size_limit") }));
  const { screen } = await renderForm();
  await fillEvent(screen);

  await save(screen).click();

  await expect.element(screen.getByText("La trace est trop lourde : 10 Mo maximum.")).toBeVisible();
  expect(screen.container.textContent).not.toContain(fr.errors.validation_file_size_limit);
});

test("EventForm — le refus du lien du parcours s'affiche sous son champ", async () => {
  mocks.send.mockRejectedValue(refused(1, 400, { route_url: field("validation_invalid_url") }));
  const { screen } = await renderForm();
  await fillEvent(screen);
  await routeUrl(format(screen, 1)).fill("https://parcours.example.test/1");

  await save(screen).click();

  const message = screen.getByText(fr.errors.validation_invalid_url);
  await expect.element(message).toBeVisible();
  expect(routeUrl(format(screen, 1)).element().getAttribute("aria-describedby")).toContain(
    message.element().id,
  );
  await expect.element(routeUrl(format(screen, 1))).toHaveValue("https://parcours.example.test/1");
});

test("EventForm — à la modification, « Retirer la trace » n'est proposé qu'à l'épreuve qui a une trace, et le lien est prérempli", async () => {
  withTrack();
  const { screen } = await renderEdit();

  // F15 is the first format, F42 the second.
  await expect.element(removeTrack(format(screen, 1))).toBeVisible();
  await expect.element(removeTrack(format(screen, 2))).not.toBeInTheDocument();
  await expect
    .element(routeUrl(format(screen, 1)))
    .toHaveValue("https://www.openrunner.com/route-details/1");
  await expect.element(routeUrl(format(screen, 2))).toHaveValue("");
  // Nothing to reuse until a file is chosen.
  await expect.element(reuse(format(screen, 1))).not.toBeInTheDocument();
});

test("EventForm — « Retirer la trace » enlève la trace après le lot, et le focus va au titre de l'épreuve", async () => {
  withTrack();
  const { screen, router } = await renderEdit();
  const row = format(screen, 1);

  await removeTrack(row).click();

  // The button is gone with the track: the focus is on the title of its format, not lost.
  await expect.element(removeTrack(row)).not.toBeInTheDocument();
  await expect.element(row.getByText(fr.form.formatTitle(1), { exact: true })).toHaveFocus();
  // Nothing is sent before the form is.
  expect(mocks.updateFormat).not.toHaveBeenCalled();

  await save(screen).click();

  await vi.waitFor(() => {
    expect(router.state.location.pathname).toBe("/evenements/event");
  });
  expect(mocks.updateFormat).toHaveBeenCalledExactlyOnceWith("f15", { gpx: null });
  // It went after the batch.
  expect(mocks.send.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.updateFormat.mock.invocationCallOrder[0] ?? 0,
  );
});

test("EventForm — « Retirer la trace » sur un fichier choisi mais pas encore envoyé le laisse de côté, sans rien envoyer", async () => {
  const { screen, router } = await renderForm();
  await fillEvent(screen);
  const row = format(screen, 1);
  await gpxField(row).upload(gpxFile());
  await expect.element(trackRead(row)).toBeVisible();

  await removeTrack(row).click();

  await expect.element(trackRead(row)).not.toBeInTheDocument();
  await expect.element(removeTrack(row)).not.toBeInTheDocument();
  expect(filesIn(gpxField(row))).toBe(0);
  // The button went with the file, and the focus did not go to the page: it is on the title of the format.
  await expect.element(row.getByText(fr.form.formatTitle(1), { exact: true })).toHaveFocus();
  await save(screen).click();
  await savedEvent(router);
  expect(mocks.updateFormat).not.toHaveBeenCalled();
});

test("EventForm — une nouvelle trace remplace celle qui est enregistrée : un seul envoi, le fichier", async () => {
  withTrack();
  const { screen, router } = await renderEdit();
  const row = format(screen, 1);

  await gpxField(row).upload(gpxFile(GPX, "nouvelle.gpx"));
  await expect.element(trackRead(row)).toBeVisible();
  await save(screen).click();

  await vi.waitFor(() => {
    expect(router.state.location.pathname).toBe("/evenements/event");
  });
  expect(mocks.updateFormat).toHaveBeenCalledOnce();
  const { id, file } = uploaded();
  expect(id).toBe("f15");
  expect(file.name).toBe("nouvelle.gpx");
});

test("EventForm — sans trace choisie ni retirée, rien n'est envoyé à part le lot", async () => {
  withTrack();
  const { screen, router } = await renderEdit();

  await save(screen).click();

  await vi.waitFor(() => {
    expect(router.state.location.pathname).toBe("/evenements/event");
  });
  expect(mocks.updateFormat).not.toHaveBeenCalled();
});

test("EventForm — le champ de la trace et ses boutons font au moins 44 px de haut", async () => {
  withTrack();
  const { screen } = await renderEdit();
  const row = format(screen, 1);
  await gpxField(row).upload(gpxFile());
  await expect.element(reuse(row)).toBeVisible();

  for (const target of [gpxField(row), routeUrl(row), reuse(row), removeTrack(row)]) {
    expect(target.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
  expect(gpxField(row).element().getAttribute("accept")).toBe(".gpx,application/gpx+xml");
});

test("EventForm — en anglais, les textes de la trace sont anglais", async () => {
  const { screen } = await renderForm({ languages: ["en-GB"], heading: "Create an event" });

  await expect.element(screen.getByLabelText("GPX track", { exact: true })).toBeVisible();
  await expect.element(screen.getByLabelText("Course link", { exact: true })).toBeVisible();
  await screen.getByLabelText("GPX track", { exact: true }).upload(gpxFile());
  const read = screen.getByText(/^Track: /);
  await expect.element(read).toBeVisible();
  expect(plain(read.element().textContent)).toBe("Track: 22.2 km, 200 m gain");
  await expect.element(screen.getByRole("button", { name: "Use these values" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Remove the track" })).toBeVisible();
});

// --- A track that is too big, why a track was refused, and taking a track off ---

/** What the server accepts for a track: 10 MiB (`MaxSize` in server/migrations/9f_format_route.go). */
const LIMIT = 10 * 1024 * 1024;

/** A readable GPX file of exactly this many bytes: a comment after the track pads it. */
function gpxOfSize(bytes: number): File {
  const padding = bytes - GPX.length - "<!---->".length;
  return gpxFile(`${GPX}<!--${"x".repeat(padding)}-->`, "gros.gpx");
}

/** What PocketBase answers when the update of a format is refused for its file. */
const uploadRefused = (code: string) =>
  new ClientResponseError({
    url: "/api/collections/formats/records/f",
    status: 400,
    response: { status: 400, message: "Failed to update record.", data: { gpx: field(code) } },
  });

const undo = (row: Row) => row.getByRole("button", { name: fr.common.cancel, exact: true });
const formatTitleOf = (row: Row) => row.getByText(fr.form.formatTitle(1), { exact: true });

test("EventForm — une trace de plus de 10 Mo est refusée au choix, avec son message, et n'est pas gardée", async () => {
  const { screen, router } = await renderForm();
  await fillEvent(screen);
  const row = format(screen, 1);

  await gpxField(row).upload(gpxOfSize(LIMIT + 1));

  const message = row.getByText(fr.format.gpxTooBig);
  await expect.element(message).toBeVisible();
  expect(gpxField(row).element().getAttribute("aria-describedby")).toContain(message.element().id);
  expect(gpxField(row).element().getAttribute("aria-invalid")).toBe("true");
  // The file is not kept, though it could be read: the field is empty, nothing is shown of it.
  expect(filesIn(gpxField(row))).toBe(0);
  await expect.element(trackRead(row)).not.toBeInTheDocument();
  await expect.element(row.getByText(fr.route.unreadable)).not.toBeInTheDocument();
  await expect.element(reuse(row)).not.toBeInTheDocument();
  // Saving sends no track.
  await save(screen).click();
  await savedEvent(router);
  expect(mocks.updateFormat).not.toHaveBeenCalled();
});

test("EventForm — une trace de 10 Mo pile est acceptée", async () => {
  const { screen } = await renderForm();
  const row = format(screen, 1);

  await gpxField(row).upload(gpxOfSize(LIMIT));

  await expect.element(trackRead(row)).toBeVisible();
  await expect.element(row.getByText(fr.format.gpxTooBig)).not.toBeInTheDocument();
});

test("EventForm — une trace trop lourde après une bonne ne laisse pas la bonne partir, un bon fichier efface le message", async () => {
  const { screen, router } = await renderForm();
  await fillEvent(screen);
  const row = format(screen, 1);
  await gpxField(row).upload(gpxFile());
  await expect.element(trackRead(row)).toBeVisible();

  await gpxField(row).upload(gpxOfSize(LIMIT + 1));

  await expect.element(row.getByText(fr.format.gpxTooBig)).toBeVisible();
  await expect.element(trackRead(row)).not.toBeInTheDocument();
  expect(filesIn(gpxField(row))).toBe(0);

  await gpxField(row).upload(gpxFile());

  await expect.element(trackRead(row)).toBeVisible();
  await expect.element(row.getByText(fr.format.gpxTooBig)).not.toBeInTheDocument();
  await save(screen).click();
  await savedEvent(router);
  expect(mocks.updateFormat).toHaveBeenCalledOnce();
});

test("EventForm — une trace que le serveur refuse : le message dit pourquoi, quand le formulaire a des mots pour ce motif", async () => {
  mocks.updateFormat.mockRejectedValue(uploadRefused("validation_file_size_limit"));
  const { screen, router } = await renderForm();
  await fillEvent(screen);
  await gpxField(format(screen, 1)).upload(gpxFile());
  await expect.element(trackRead(format(screen, 1))).toBeVisible();

  await save(screen).click();

  await savedEvent(router);
  const failed = screen.getByText(/mais la trace de /);
  await expect.element(failed).toBeVisible();
  expect(plain(failed.element().textContent)).toBe(
    fr.form.traceFailedBecause("Trail 42 km", fr.format.gpxTooBig),
  );
  expect(plain(failed.element().textContent)).toContain(
    "La trace est trop lourde : 10 Mo maximum.",
  );
});

test("EventForm — un type de fichier refusé par le serveur est dit aussi", async () => {
  mocks.updateFormat.mockRejectedValue(uploadRefused("validation_invalid_mime_type"));
  const { screen, router } = await renderForm();
  await fillEvent(screen);
  await gpxField(format(screen, 1)).upload(gpxFile());
  await expect.element(trackRead(format(screen, 1))).toBeVisible();

  await save(screen).click();

  await savedEvent(router);
  const failed = screen.getByText(/mais la trace de /);
  await expect.element(failed).toBeVisible();
  expect(plain(failed.element().textContent)).toBe(
    fr.form.traceFailedBecause("Trail 42 km", fr.format.gpxNotGpx),
  );
});

test("EventForm — un motif que le formulaire ne connaît pas garde le message général", async () => {
  mocks.updateFormat.mockRejectedValue(uploadRefused("validation_something_new"));
  const { screen, router } = await renderForm();
  await fillEvent(screen);
  await gpxField(format(screen, 1)).upload(gpxFile());
  await expect.element(trackRead(format(screen, 1))).toBeVisible();

  await save(screen).click();

  await savedEvent(router);
  const failed = screen.getByText(/mais la trace de /);
  await expect.element(failed).toBeVisible();
  expect(plain(failed.element().textContent)).toBe(fr.form.traceFailed("Trail 42 km"));
});

/** The form with two formats, a 42 km trail and a 10 km road race, each with a track chosen. */
async function twoTracks() {
  const opened = await renderForm();
  await fillEvent(opened.screen);
  await addFormat(opened.screen).click();
  await raceType(format(opened.screen, 2)).selectOptions(roadType.id);
  await distance(format(opened.screen, 2)).fill("10");
  for (const n of [1, 2]) {
    await gpxField(format(opened.screen, n)).upload(gpxFile());
    await expect.element(trackRead(format(opened.screen, n))).toBeVisible();
  }
  return opened;
}

test("EventForm — deux traces refusées pour le même motif le disent une fois, pour des motifs différents le message général", async () => {
  mocks.updateFormat.mockRejectedValue(uploadRefused("validation_file_size_limit"));
  const same = await twoTracks();

  await save(same.screen).click();

  await savedEvent(same.router);
  const together = same.screen.getByText(/mais la trace de /);
  await expect.element(together).toBeVisible();
  expect(plain(together.element().textContent)).toBe(
    fr.form.traceFailedBecause("Trail 42 km et Route 10 km", fr.format.gpxTooBig),
  );
  await same.screen.unmount();

  mocks.updateFormat
    .mockReset()
    .mockRejectedValueOnce(uploadRefused("validation_file_size_limit"))
    .mockRejectedValueOnce(uploadRefused("validation_invalid_mime_type"));
  const mixed = await twoTracks();

  await save(mixed.screen).click();

  await savedEvent(mixed.router);
  const apart = mixed.screen.getByText(/mais la trace de /);
  await expect.element(apart).toBeVisible();
  expect(plain(apart.element().textContent)).toBe(
    fr.form.traceFailed("Trail 42 km et Route 10 km"),
  );
});

test("EventForm — « Retirer la trace » d'une trace enregistrée dit qu'elle sera retirée, « Annuler » la garde, et le focus n'est jamais perdu", async () => {
  withTrack();
  const { screen, router } = await renderEdit();
  const row = format(screen, 1);

  await removeTrack(row).click();

  // The removal is said, with the way back, and the focus is on the title of the format.
  const said = row.getByText(fr.format.gpxRemoved);
  await expect.element(said).toBeVisible();
  await expect.element(undo(row)).toBeVisible();
  expect(undo(row).element().getAttribute("aria-describedby")).toContain(said.element().id);
  await expect.element(removeTrack(row)).not.toBeInTheDocument();
  await expect.element(formatTitleOf(row)).toHaveFocus();

  await undo(row).click();

  // « Annuler » is gone with the message: the focus is on the title again, never on the page.
  await expect.element(said).not.toBeInTheDocument();
  await expect.element(undo(row)).not.toBeInTheDocument();
  await expect.element(removeTrack(row)).toBeVisible();
  await expect.element(formatTitleOf(row)).toHaveFocus();
  expect(document.activeElement).not.toBe(document.body);
  // The track is kept: nothing is sent.
  await save(screen).click();
  await vi.waitFor(() => {
    expect(router.state.location.pathname).toBe("/evenements/event");
  });
  expect(mocks.updateFormat).not.toHaveBeenCalled();
});

test("EventForm — choisir un fichier puis « Retirer la trace » revient à l'état d'avant : un retrait en attente reste", async () => {
  withTrack();
  const { screen, router } = await renderEdit();
  const row = format(screen, 1);
  await removeTrack(row).click();
  await expect.element(row.getByText(fr.format.gpxRemoved)).toBeVisible();

  await gpxField(row).upload(gpxFile());

  // The file replaces the removal: it says what it holds, and no longer that the track goes.
  await expect.element(trackRead(row)).toBeVisible();
  await expect.element(row.getByText(fr.format.gpxRemoved)).not.toBeInTheDocument();

  await removeTrack(row).click();

  // Back to the state before the choice: the removal is still to be done.
  await expect.element(row.getByText(fr.format.gpxRemoved)).toBeVisible();
  await expect.element(trackRead(row)).not.toBeInTheDocument();
  expect(filesIn(gpxField(row))).toBe(0);
  await expect.element(formatTitleOf(row)).toHaveFocus();
  await save(screen).click();
  await vi.waitFor(() => {
    expect(router.state.location.pathname).toBe("/evenements/event");
  });
  expect(mocks.updateFormat).toHaveBeenCalledExactlyOnceWith("f15", { gpx: null });
});

test("EventForm — choisir un fichier puis « Retirer la trace » garde la trace enregistrée, et le bouton qui reste garde le focus", async () => {
  withTrack();
  const { screen, router } = await renderEdit();
  const row = format(screen, 1);
  await gpxField(row).upload(gpxFile());
  await expect.element(trackRead(row)).toBeVisible();

  await removeTrack(row).click();

  await expect.element(trackRead(row)).not.toBeInTheDocument();
  await expect.element(row.getByText(fr.format.gpxRemoved)).not.toBeInTheDocument();
  await expect.element(removeTrack(row)).toHaveFocus();
  await save(screen).click();
  await vi.waitFor(() => {
    expect(router.state.location.pathname).toBe("/evenements/event");
  });
  expect(mocks.updateFormat).not.toHaveBeenCalled();
});

test("EventForm — le message de la trace est dans la page dès le départ, vide mais pas masqué, pour être annoncé quand il s'écrit", async () => {
  const { screen } = await renderForm();
  const row = format(screen, 1);

  // Found by its role: an element that is not drawn (display: none) is not in
  // the accessibility tree, and a text that comes with its element is often not
  // read out. The message is the only feedback that the file was read.
  const status = row.getByRole("status");
  await expect.element(status).toBeInTheDocument();
  const element = status.element();
  expect(getComputedStyle(element).display).not.toBe("none");
  expect(element.textContent).toBe("");
  // Empty, it takes no room: the gaps of the fields around it are the same.
  expect(element.getBoundingClientRect().height).toBeLessThanOrEqual(1);

  await gpxField(row).upload(gpxFile());

  // The reading is written in the same element, which is what a screen reader watches.
  await expect.element(trackRead(row)).toBeVisible();
  expect(row.getByRole("status").element()).toBe(element);
  expect(element.textContent).toMatch(/^(Trace|Track) ?: /);
});

test("EventForm — « Annuler » sous un retrait en attente efface aussi le message d'un fichier refusé", async () => {
  withTrack();
  const { screen } = await renderEdit();
  const row = format(screen, 1);
  await removeTrack(row).click();
  await gpxField(row).upload(gpxFile("ceci n'est pas une trace", "notes.gpx"));
  await expect.element(row.getByText(fr.route.unreadable)).toBeVisible();

  await undo(row).click();

  // The removal is cancelled, and a refusal of a file that is not there any more has nothing to say.
  await expect.element(row.getByText(fr.route.unreadable)).not.toBeInTheDocument();
  await expect.element(row.getByText(fr.format.gpxRemoved)).not.toBeInTheDocument();
  await expect.element(formatTitleOf(row)).toHaveFocus();
});

test("EventForm — un fichier illisible, ou trop lourd, laisse le retrait en attente comme il était", async () => {
  withTrack();
  const { screen, router } = await renderEdit();
  const row = format(screen, 1);
  await removeTrack(row).click();

  // With no file chosen yet, a refused file changes nothing of the removal.
  await gpxField(row).upload(gpxFile("ceci n'est pas une trace", "notes.gpx"));
  await expect.element(row.getByText(fr.route.unreadable)).toBeVisible();
  await expect.element(row.getByText(fr.format.gpxRemoved)).toBeVisible();

  // After a good file, a refused one gives the removal back.
  await gpxField(row).upload(gpxFile());
  await expect.element(trackRead(row)).toBeVisible();
  await gpxField(row).upload(gpxOfSize(LIMIT + 1));

  await expect.element(row.getByText(fr.format.gpxTooBig)).toBeVisible();
  await expect.element(trackRead(row)).not.toBeInTheDocument();
  await expect.element(row.getByText(fr.format.gpxRemoved)).toBeVisible();
  await save(screen).click();
  await vi.waitFor(() => {
    expect(router.state.location.pathname).toBe("/evenements/event");
  });
  expect(mocks.updateFormat).toHaveBeenCalledExactlyOnceWith("f15", { gpx: null });
});
