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
import { beforeAll, beforeEach, expect, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ToastProvider } from "../../components/Toast";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";
import { EditEventPage, EventForm } from "./EventForm";
import { mocks } from "./formMocks";
import { aliceRunner, bobRunner, eventRecord, roadType, trailType } from "./testFixture";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

// What the tests of the form share (EventForm.test.tsx, EventForm.period.test.tsx,
// FormatFieldset.test.tsx): the app around the form, and how to find its fields. Each
// test file replaces `../../lib/pb` itself (see `pbModule` in formMocks.ts) and calls
// `setUpFormTests()`.

export const base = { created: "", updated: "", collectionId: "", collectionName: "" };
const adminRunner = { ...base, id: "adminRunner0000", name: "Admin", user: "u-admin" };

// Alice wrote the event of the fixture; Bob is a member; the admin is a runner of the group too.
const users = {
  alice: { id: "u-alice", collectionName: "users", role: "member", runner: aliceRunner },
  bob: { id: "u-bob", collectionName: "users", role: "member", runner: bobRunner },
  admin: { id: "u-admin", collectionName: "users", role: "admin", runner: adminRunner },
};

export function signIn(who: keyof typeof users) {
  const { runner, ...user } = users[who];
  mocks.user = user;
  mocks.myRunner.mockResolvedValue(runner);
}

/**
 * Sets the tests of a file up: Temporal is loaded, and every test starts with
 * the mocks emptied, the race types of the fixture, the event of the fixture,
 * and Alice (who wrote it) signed in.
 */
export function setUpFormTests() {
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
}

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
export async function mountForm(
  options: { at?: string; languages?: string[]; today?: string } = {},
) {
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
export async function renderForm(
  options: { at?: string; languages?: string[]; heading?: string; today?: string } = {},
) {
  const { heading = fr.form.createTitle, ...mount } = options;
  const opened = await mountForm(mount);
  await expect
    .element(opened.screen.getByRole("heading", { level: 1, name: heading }))
    .toBeVisible();
  return opened;
}

export type Screen = Awaited<ReturnType<typeof renderForm>>["screen"];

export const renderEdit = (id = "event") =>
  renderForm({ at: `/evenements/${id}/modifier`, heading: fr.form.editTitle });

export const name = (screen: Screen) => screen.getByLabelText(fr.form.name);
export const location = (screen: Screen) => screen.getByLabelText(fr.form.location);
export const startDate = (screen: Screen) => screen.getByLabelText(fr.form.startDate);
export const save = (screen: Screen) => screen.getByRole("button", { name: fr.common.save });
export const addFormat = (screen: Screen) =>
  screen.getByRole("button", { name: fr.form.addFormat });

/** The group of fields of the format `n`, from 1. */
export const format = (screen: Screen, n: number) =>
  screen.getByRole("group", { name: fr.form.formatTitle(n), exact: true });

export type Row = ReturnType<typeof format>;
export const raceType = (row: Row) => row.getByLabelText(fr.form.raceType);
export const distance = (row: Row) => row.getByLabelText(fr.form.distance);
export const hoursOf = (row: Row, label: string) =>
  row.getByLabelText(`${label}, ${fr.form.hours}`);
export const minutesOf = (row: Row, label: string) =>
  row.getByLabelText(`${label}, ${fr.form.minutes}`);
export const elevation = (row: Row) => row.getByLabelText(fr.form.elevation);
export const price = (row: Row) => row.getByLabelText(fr.format.price);
export const formatDate = (row: Row) => row.getByLabelText(fr.form.formatDate);
export const gpxField = (row: Row) => row.getByLabelText(fr.format.gpx, { exact: true });
export const routeUrl = (row: Row) => row.getByLabelText(fr.format.routeUrl, { exact: true });

/** The event of the fixture's second example: a name, a place, one day, one 42 km trail. */
export async function fillEvent(screen: Screen) {
  await name(screen).fill("Trail du Lac");
  await location(screen).fill("Annecy");
  await startDate(screen).fill("2026-06-13");
  const row = format(screen, 1);
  await raceType(row).selectOptions(trailType.id);
  await distance(row).fill("42");
}

// --- The track and the link of the course ---

const GPX_NAMESPACE = "http://www.topografix.com/GPX/1/1";

/** 0.1° of latitude is 11.12 km: 22.2 km, 200 m up then 100 m down. */
export const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="${GPX_NAMESPACE}"><trk><trkseg>
  <trkpt lat="45.0" lon="6"><ele>450</ele></trkpt>
  <trkpt lat="45.1" lon="6"><ele>650</ele></trkpt>
  <trkpt lat="45.2" lon="6"><ele>550</ele></trkpt>
</trkseg></trk></gpx>`;

/** The same, with no altitude. */
export const GPX_FLAT = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="${GPX_NAMESPACE}"><trk><trkseg>
  <trkpt lat="45.0" lon="6"/><trkpt lat="45.1" lon="6"/><trkpt lat="45.2" lon="6"/>
</trkseg></trk></gpx>`;

export const gpxFile = (text = GPX, filename = "trace.gpx") =>
  new File([text], filename, { type: "application/gpx+xml" });

export const reuse = (row: Row) => row.getByRole("button", { name: fr.format.gpxReuse });
/** The line that says what a chosen file holds. */
export const trackRead = (row: Row) => row.getByText(/^(Trace|Track) ?: /);

/** Waits for the page of the event that has just been saved. */
export async function savedEvent(router: Awaited<ReturnType<typeof renderForm>>["router"]) {
  await vi.waitFor(() => {
    expect(router.state.location.pathname).toMatch(/^\/evenements\/[a-z0-9]{15}$/);
  });
}
