import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { SKINS, chooseSkin, slotOf } from ".";
import { ToastProvider } from "../components/Toast";
import {
  aliceRunner,
  bobRunner,
  eventRecord,
  roadType,
  samRunner,
  trailType,
} from "../features/events/testFixture";
import { fr } from "../i18n/fr";
import { I18nProvider } from "../i18n/I18nProvider";
import { ensureTemporal } from "../lib/temporal";
import { chooseTheme } from "../lib/theme";
import { TodayProvider } from "../lib/useToday";
import { routeTree } from "../routeTree.gen";
import { fontsReady } from "../test/fontsReady";

import "../styles.css";

// The main pages of the app, drawn in each skin, on a phone: the home page, the
// page of an event with the map and the profile of its track, the form of a new
// event, and the settings. A skin only dresses the app: every page is there,
// with what it shows, nothing goes past the width of the screen, and the motifs
// of the skin are in their places (Crête's where it draws none).

/** An event of the fixture whose 42 km has a track. */
const event = {
  ...eventRecord,
  expand: {
    ...eventRecord.expand,
    formats_via_event: eventRecord.expand.formats_via_event.map((format) =>
      format.id === "f42" ? { ...format, gpx: "trace_ab12cd.gpx" } : format,
    ),
  },
};

/** 2.2 km, 200 m up then 50 m down. */
const CLIMB = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
  <trkpt lat="45.00" lon="6"><ele>450</ele></trkpt>
  <trkpt lat="45.01" lon="6"><ele>650</ele></trkpt>
  <trkpt lat="45.02" lon="6"><ele>600</ele></trkpt>
</trkseg></trk></gpx>`;

const lists: Record<string, unknown[]> = {
  events: [event],
  runners: [aliceRunner, bobRunner, samRunner],
  race_types: [trailType, roadType],
};

// The real tree of routes, as in routes/root.test.tsx: the pages ask for their
// data, and get the event of the fixture, its runners and the race types.
vi.mock("../lib/pb", () => ({
  pb: {
    authStore: {
      isValid: true,
      token: "token",
      get record() {
        return { id: "u-alice", collectionName: "users", role: "member", email: "a@example.test" };
      },
      onChange: () => () => {},
    },
    filter: (raw: string) => raw,
    send: () => Promise.resolve({}),
    collection: (name: string) => ({
      getFullList: () => Promise.resolve(lists[name] ?? []),
      getList: () => Promise.resolve({ items: [], page: 1, perPage: 1, totalItems: 0 }),
      getFirstListItem: () => Promise.resolve(aliceRunner),
      getOne: () => Promise.resolve(event),
    }),
    files: {
      getURL: (_record: unknown, filename: string) =>
        filename.endsWith(".gpx") ? "https://pb.example.test/trace_ab12cd.gpx" : "",
    },
  },
}));

// The map of a track is the real one, with blank tiles: no test asks a tile server for a tile.
vi.mock("../features/route/TrackMap", async (importOriginal) => {
  const { blankTileModule } = await import("../test/tiles");
  return blankTileModule(importOriginal);
});

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(CLIMB)));
  await page.viewport(375, 812);
});

afterEach(async () => {
  vi.restoreAllMocks();
  chooseSkin("crete");
  chooseTheme("auto");
  window.scrollTo(0, 0);
  await page.viewport(414, 896);
});

async function openApp(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const screen = await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider languages={["fr"]}>
        <TodayProvider value={Temporal.PlainDate.from("2026-06-01")}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </TodayProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return screen;
}

type Screen = Awaited<ReturnType<typeof openApp>>;

/** What every page has, in every skin: the tabs, the button to create, nothing wider than the phone. */
async function framed(screen: Screen) {
  await expect.element(screen.getByRole("navigation", { name: fr.nav.main })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: fr.nav.createEvent })).toBeVisible();
  await fontsReady();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
}

/** The class that the mark before a block's title has in a skin: its own, or Crête's. */
const markerOf = (id: string) => {
  const skin = SKINS.find((one) => one.id === id);
  const crete = SKINS[0];
  return skin && crete && slotOf(skin, "SectionMarker") !== slotOf(crete, "SectionMarker")
    ? ".example-marker"
    : ".section-marker";
};

for (const skin of SKINS) {
  test(`smoke — ${skin.id} : l'accueil, ses blocs et la marque de leurs titres`, async () => {
    chooseSkin(skin.id);
    const screen = await openApp("/");
    await expect
      .element(screen.getByRole("heading", { level: 1, name: fr.nav.home }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Trail des Crêtes" }).first())
      .toBeVisible();
    await framed(screen);
    expect(document.documentElement.dataset.skin).toBe(skin.id === "crete" ? undefined : skin.id);
    // Each title of a block starts with the mark of the skin.
    const titles = [...document.querySelectorAll("h2.section-title")];
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      expect(
        title.firstElementChild?.matches(markerOf(skin.id)),
        `title ${title.textContent}`,
      ).toBe(true);
    }
  });

  test(`smoke — ${skin.id} : la page d'un événement, avec la carte et le profil de sa trace`, async () => {
    chooseSkin(skin.id);
    const screen = await openApp(`/evenements/${event.id}`);
    await expect
      .element(screen.getByRole("heading", { level: 1, name: "Trail des Crêtes" }))
      .toBeVisible();
    const trail42 = screen.getByRole("region", { name: /^Trail 42/ });
    await expect.element(trail42.getByRole("region", { name: fr.route.map })).toBeVisible();
    await expect
      .element(trail42.getByRole("img", { name: new RegExp(`^${fr.route.profileLabel}`) }))
      .toBeVisible();
    await expect.element(trail42.getByText(/D\+/).first()).toBeVisible();
    await framed(screen);
    expect(document.querySelector(".event-hero")).not.toBeNull();
  });

  test(`smoke — ${skin.id} : le formulaire d'un nouvel événement`, async () => {
    chooseSkin(skin.id);
    const screen = await openApp("/evenements/nouveau");
    await expect.element(screen.getByRole("heading", { level: 1 })).toBeVisible();
    await expect
      .element(screen.getByRole("heading", { level: 2, name: fr.form.formatsTitle }))
      .toBeVisible();
    await expect.element(screen.getByRole("textbox").first()).toBeVisible();
    await framed(screen);
  });

  test(`smoke — ${skin.id} : les réglages, avec le choix du thème`, async () => {
    chooseSkin(skin.id);
    const screen = await openApp("/profil/reglages");
    await expect
      .element(screen.getByRole("heading", { level: 1, name: fr.profile.settings }))
      .toBeVisible();
    const skins = screen.getByRole("radiogroup", { name: fr.settings.skin });
    await expect
      .element(skins.getByRole("radio", { name: skin.label.fr, exact: true }))
      .toBeChecked();
    await framed(screen);
  });
}
