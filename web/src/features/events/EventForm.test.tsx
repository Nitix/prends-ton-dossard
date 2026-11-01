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
  for (const fn of [mocks.send, mocks.raceTypes, mocks.getOne, mocks.getList, mocks.myRunner]) {
    fn.mockReset();
  }
  mocks.send.mockResolvedValue([]);
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

/** Opens the app at a page of the form, without waiting for anything. */
async function mountForm(options: { at?: string; languages?: string[] } = {}) {
  const { at = "/evenements/nouveau", languages = ["fr"] } = options;
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
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { screen, router, invalidate, queryClient };
}

/** Opens the form and waits until it is there: its title is the one given. */
async function renderForm(options: { at?: string; languages?: string[]; heading?: string } = {}) {
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
