import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  CircleMarker,
  LatLngBounds,
  latLng,
  latLngBounds,
  Map as LeafletMap,
  type LatLng,
  type LatLngBoundsExpression,
} from "leaflet";
import { afterEach, beforeEach, expect, test, vi, type MockInstance } from "vitest";
import { render } from "vitest-browser-react";
import { page, server, userEvent, type Locator } from "vitest/browser";

import { SECTION } from "../../components/section";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { FormatRecord } from "../../lib/types";
import { fontsReady } from "../../test/fontsReady";
import { spaceGaps } from "../../test/gaps";
import { emulateMedia, resetMedia } from "../../test/media";
import { isTouchDevice } from "../../test/support";
import { toTrack, type TrackPoint } from "./gpx";
import { RouteSection } from "./RouteSection";
import { SLOPE_COLORS, SLOPE_COLORS_DARK, type SlopeZone } from "./slope";
import { pointAtKm, trackIndex } from "./trackIndex";

// The colours and the sizes of the drawings are a matter of the styles.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  getURL: vi.fn<(record: Rec, filename: string) => string>(),
}));

vi.mock("../../lib/pb", () => ({ pb: { files: { getURL: mocks.getURL } } }));

// The map of a track is the real one, with blank tiles: no test asks a tile server for a tile.
vi.mock("./TrackMap", async (importOriginal) => {
  const { blankTileModule } = await import("../../test/tiles");
  return blankTileModule(importOriginal);
});

const TRACK_URL = "https://pb.example.test/api/files/formats/f42/trace_ab12cd.gpx";
const COURSE_URL = "https://www.openrunner.com/route-details/123";

const base = { created: "", updated: "", collectionId: "formats", collectionName: "formats" };

/** A format of the server, with the track and the link that a test gives it. */
function formatOf(extra: Partial<FormatRecord> = {}): FormatRecord {
  return {
    ...base,
    id: "f42",
    event: "event",
    name: "",
    race_type: "trail0000000000",
    distance_km: 42,
    ...extra,
  };
}

const NAMESPACE = "http://www.topografix.com/GPX/1/1";

/** A GPX file: 0.01° of latitude is 1.112 km, so three points are 2.2 km. */
function gpx(points: { lat: number; ele?: number }[]): string {
  const trkpts = points
    .map(({ lat, ele }) =>
      ele === undefined
        ? `<trkpt lat="${lat}" lon="6"/>`
        : `<trkpt lat="${lat}" lon="6"><ele>${ele}</ele></trkpt>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" xmlns="${NAMESPACE}"><trk><trkseg>${trkpts}</trkseg></trk></gpx>`;
}

/** 2.2 km, 200 m up then 50 m down, between 450 and 650 m. */
const CLIMB = gpx([
  { lat: 45, ele: 450 },
  { lat: 45.01, ele: 650 },
  { lat: 45.02, ele: 600 },
]);

/** What the server answers when the file is asked for: the text, as a new answer every time. */
function serve(body: string, status = 200) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(new Response(body, { status })));
}

beforeEach(async () => {
  mocks.getURL.mockReset().mockReturnValue(TRACK_URL);
  // The pointer is where the last test left it, and WebKit hovers what is drawn under it: the
  // profile would start with a cursor. It goes to a corner, where nothing is, and clicks there.
  await userEvent.click(document.body, { position: { x: 1, y: 1 } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The section, alone, or `inCard`: where the page of an event puts it on a
 * phone, in the card of its format, between the gutters of the app shell.
 */
async function renderSection(format: FormatRecord, languages = ["fr"], { inCard = false } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const section = <RouteSection format={format} />;
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        {inCard ? (
          <div className="px-4">
            <div className={SECTION}>{section}</div>
          </div>
        ) : (
          section
        )}
      </I18nProvider>
    </QueryClientProvider>,
  );
}

// Intl separates a number from its unit with a no-break space: tests read the
// text as it looks.
const plain = (s: string | null) => (s ?? "").replace(/\p{Zs}/gu, " ");

const trackMap = (screen: Awaited<ReturnType<typeof renderSection>>) =>
  screen.getByRole("region", { name: fr.route.map });
const profileDrawing = (screen: Awaited<ReturnType<typeof renderSection>>) =>
  screen.getByRole("img", { name: new RegExp(`^${fr.route.profileLabel}`) });

/**
 * The line of the numbers of the track: tiles on the page, one line of text
 * (separators and spaces included) for a screen reader.
 */
function figures(screen: Awaited<ReturnType<typeof renderSection>>): HTMLElement {
  const line = screen.getByText(/D\+/).element().closest("p");
  if (!line) throw new Error("no line of numbers");
  return line;
}

/** What the section draws: its SVG, but for the icons of its links, which are words already. */
const drawings = (screen: Awaited<ReturnType<typeof renderSection>>) =>
  [...screen.container.querySelectorAll("svg")].filter((svg) => !svg.closest("a"));

test("RouteSection — chiffres, carte, profil et liens", async () => {
  const fetching = serve(CLIMB);
  const screen = await renderSection(formatOf({ gpx: "trace_ab12cd.gpx", route_url: COURSE_URL }));

  await expect.element(screen.getByRole("heading", { name: fr.route.title })).toBeVisible();
  // The numbers: the distance, the gain and the loss, then the lowest and the highest altitudes.
  await expect.element(screen.getByText(/D\+/)).toBeInTheDocument();
  expect(figures(screen)).toBeVisible();
  expect(plain(figures(screen).textContent)).toBe("2,2 km · 200 m D+ · 50 m D−");
  // Each one shows, in its tile.
  for (const value of ["2,2 km", "200 m", "50 m", "D+", "D−"]) {
    await expect.element(screen.getByText(value, { exact: true })).toBeVisible();
  }
  const altitudes = screen.getByText(/^altitude/);
  await expect.element(altitudes).toBeVisible();
  expect(plain(altitudes.element().textContent)).toBe("altitude 450 m à 650 m");
  // The map, and the profile, which is named with its numbers.
  await expect.element(trackMap(screen)).toBeVisible();
  await expect.element(profileDrawing(screen)).toBeVisible();
  expect(plain(profileDrawing(screen).element().getAttribute("aria-label"))).toContain(
    "altitude 450 m à 650 m",
  );
  // The file is the one of the server, asked for once.
  expect(mocks.getURL).toHaveBeenCalledWith(
    expect.objectContaining({ id: "f42" }),
    "trace_ab12cd.gpx",
  );
  expect(fetching).toHaveBeenCalledOnce();
  expect(fetching.mock.calls[0]?.[0]).toBe(TRACK_URL);
  // The two links.
  const download = screen.getByRole("link", { name: fr.route.download });
  await expect.element(download).toHaveAttribute("href", TRACK_URL);
  await expect.element(download).toHaveAttribute("download");
  const open = screen.getByRole("link", { name: fr.route.open });
  await expect.element(open).toHaveAttribute("href", COURSE_URL);
  await expect.element(open).toHaveAttribute("target", "_blank");
  const rel = open.element().getAttribute("rel") ?? "";
  expect(rel.split(" ")).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
  // They are tap targets.
  for (const link of [download, open]) {
    expect(link.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
});

/** An ultra: 171.5 km due north, 10 040 m up to the middle, then 9 000 m down. */
const ULTRA = gpx(
  Array.from({ length: 301 }, (_, i) => ({
    lat: 45 + (1.5423 * i) / 300,
    ele: i <= 150 ? 500 + (10_040 * i) / 150 : 10_540 - (9_000 * (i - 150)) / 150,
  })),
);

test("RouteSection — sur un téléphone de 320 px, les grands chiffres gardent un vrai blanc entre les milliers et avant l'unité, dans leur tuile", async () => {
  serve(ULTRA);
  await page.viewport(320, 700);
  try {
    const screen = await renderSection(formatOf({ gpx: "trace_ab12cd.gpx" }), ["fr"], {
      inCard: true,
    });
    await expect.element(screen.getByText(/D\+/)).toBeInTheDocument();
    // The map is loaded on its own: the page is whole once it is there.
    await expect.element(trackMap(screen)).toBeVisible();
    // Measured in the fonts of the site, not in those that stand in while they load.
    await fontsReady();

    const tiles = [...figures(screen).children];
    const values = tiles.map((tile) => {
      const value = tile.querySelector(":scope > span:not(.sr-only)");
      if (value === null) throw new Error("a tile has no figure");
      return value;
    });
    expect(values.map((value) => plain(value.textContent))).toEqual([
      "171,5 km",
      "10 040 m",
      "9 000 m",
    ]);
    for (const [i, value] of values.entries()) {
      // « 10 040 m », not « 10040m »: each space leaves a fifth of the size of the letters at least.
      const what = plain(value.textContent);
      const gaps = spaceGaps(value);
      expect(gaps.length, `spaces of ${what}`).toBeGreaterThan(0);
      for (const gap of gaps) expect(gap.em, `a space of ${what}`).toBeGreaterThanOrEqual(0.2);
      // On one line, inside its tile.
      const range = document.createRange();
      range.selectNodeContents(value);
      const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
      expect(lines.size, `lines of ${what}`).toBe(1);
      const box = value.getBoundingClientRect();
      const tile = tiles[i]?.getBoundingClientRect();
      // WebKit draws the same text about 1 % wider than Chromium, less than a pixel here, on the
      // padding of the tile: a pixel of room there, none elsewhere.
      const room = server.browser === "webkit" ? 1 : 0;
      expect(box.left, `left of ${what}`).toBeGreaterThanOrEqual((tile?.left ?? Infinity) - room);
      expect(box.right, `right of ${what}`).toBeLessThanOrEqual((tile?.right ?? -Infinity) + room);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  } finally {
    await page.viewport(414, 896);
  }
});

test("RouteSection — the map replaces the outline, profile and numbers unchanged", async () => {
  serve(CLIMB);
  const screen = await renderSection(formatOf({ gpx: "trace_ab12cd.gpx" }));

  // The map is there, and the outline of the track that it replaces is not.
  await expect.element(trackMap(screen)).toBeVisible();
  await expect
    .element(screen.getByRole("img", { name: /^Tracé du parcours/ }))
    .not.toBeInTheDocument();
  // The numbers are written outside of the map, as they were; so is the profile, which is the same.
  expect(plain(figures(screen).textContent)).toBe("2,2 km · 200 m D+ · 50 m D−");
  expect(trackMap(screen).element().contains(figures(screen))).toBe(false);
  expect(plain(screen.getByText(/^altitude/).element().textContent)).toBe("altitude 450 m à 650 m");
  await expect.element(profileDrawing(screen)).toBeVisible();
  expect(trackMap(screen).element().contains(profileDrawing(screen).element())).toBe(false);
  // The map comes before the profile.
  expect(
    trackMap(screen).element().compareDocumentPosition(profileDrawing(screen).element()) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("RouteSection — un lien sans trace", async () => {
  const fetching = serve(CLIMB);
  const screen = await renderSection(formatOf({ route_url: COURSE_URL }));

  await expect.element(screen.getByRole("heading", { name: fr.route.title })).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: fr.route.open }))
    .toHaveAttribute("href", COURSE_URL);
  // Nothing to download, nothing to draw, nothing asked for.
  await expect
    .element(screen.getByRole("link", { name: fr.route.download }))
    .not.toBeInTheDocument();
  expect(drawings(screen)).toEqual([]);
  expect(fetching).not.toHaveBeenCalled();
  expect(mocks.getURL).not.toHaveBeenCalled();
});

test("RouteSection — une trace sans altitude n'a pas de profil", async () => {
  serve(gpx([{ lat: 45 }, { lat: 45.01 }, { lat: 45.02 }]));
  const screen = await renderSection(formatOf({ gpx: "trace_ab12cd.gpx" }));

  // The track is drawn, with its length: the gain, the loss and the altitudes are not made up.
  await expect.element(trackMap(screen)).toBeVisible();
  await expect.element(screen.getByText("2,2 km", { exact: true }).first()).toBeVisible();
  await expect.element(profileDrawing(screen)).not.toBeInTheDocument();
  expect(screen.container.textContent).not.toContain("D+");
  expect(screen.container.textContent).not.toContain("altitude");
  await expect.element(screen.getByRole("link", { name: fr.route.download })).toBeVisible();
});

test("RouteSection — rien sans trace ni lien web, pas même le titre", async () => {
  // A link that is not a web address is never shown.
  for (const route_url of [undefined, "", "javascript:alert(1)", "mailto:a@example.test"]) {
    const screen = await renderSection(formatOf({ route_url }));

    expect(screen.container.textContent).toBe("");
    await screen.unmount();
  }
});

test("RouteSection — un lien qui n'est pas une adresse web n'est jamais un lien, la trace reste", async () => {
  serve(CLIMB);
  const screen = await renderSection(
    formatOf({ gpx: "trace_ab12cd.gpx", route_url: "javascript:alert(1)" }),
  );

  await expect.element(screen.getByRole("link", { name: fr.route.download })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: fr.route.open })).not.toBeInTheDocument();
});

test("RouteSection — une trace illisible est dite, ses liens restent", async () => {
  serve("ceci n'est pas du XML");
  const screen = await renderSection(formatOf({ gpx: "trace_ab12cd.gpx", route_url: COURSE_URL }));

  await expect.element(screen.getByText(fr.route.unreadable)).toBeVisible();
  expect(drawings(screen)).toEqual([]);
  await expect.element(screen.getByRole("link", { name: fr.route.download })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: fr.route.open })).toBeVisible();
});

test("RouteSection — un fichier que le serveur ne donne pas est dit illisible aussi", async () => {
  serve("not found", 404);
  const screen = await renderSection(formatOf({ gpx: "trace_ab12cd.gpx" }));

  await expect.element(screen.getByText(fr.route.unreadable)).toBeVisible();
});

test("RouteSection — pendant la lecture, la page dit qu'elle charge", async () => {
  const answer = Promise.withResolvers<Response>();
  vi.spyOn(globalThis, "fetch").mockReturnValue(answer.promise);
  const screen = await renderSection(formatOf({ gpx: "trace_ab12cd.gpx" }));

  await expect.element(screen.getByText(fr.common.loading)).toBeVisible();

  answer.resolve(new Response(CLIMB));
  await expect.element(trackMap(screen)).toBeVisible();
  await expect.element(screen.getByText(fr.common.loading)).not.toBeInTheDocument();
});

test("RouteSection — en anglais, les textes sont anglais", async () => {
  serve(CLIMB);
  const screen = await renderSection(formatOf({ gpx: "trace_ab12cd.gpx", route_url: COURSE_URL }), [
    "en-GB",
  ]);

  await expect.element(screen.getByRole("heading", { name: "Course" })).toBeVisible();
  await expect.element(screen.getByRole("region", { name: "Route map" })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: "Download the track" })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: "See the course" })).toBeVisible();
  await expect.element(screen.getByText(/^altitude 450 m to 650 m$/)).toBeVisible();
});

// The map and the profile, linked: the cursor of the profile has its mark on
// the map, and the track of the map moves the cursor of the profile.

/**
 * A track due north from 45° (on 6° east), of n points over `degrees` of
 * latitude, climbing at a steady `grade` percent from 500 m: what the server
 * gives as a file, and the points that the page reads from it.
 */
function steady(n: number, degrees: number, grade: number): { file: string; points: TrackPoint[] } {
  const flat = toTrack(
    Array.from({ length: n }, (_, i) => ({ lat: 45 + (degrees * i) / (n - 1), lon: 6 })),
  );
  const points = flat.map((point) => ({ ...point, ele: 500 + grade * 10 * point.km }));
  return { file: gpx(points), points };
}

/** 2.2 km due north at 8 %, from 500 m to 678 m. */
const STEADY = steady(21, 0.02, 8);
const STEADY_KM = STEADY.points.at(-1)?.km ?? 0;

type Screen = Awaited<ReturnType<typeof renderSection>>;

/** The figures over the profile: the summit's altitude, or the cursor's reading in its place. */
function pill(screen: Screen): string {
  return plain(
    profileDrawing(screen).element().parentElement?.querySelector("p")?.textContent ?? "",
  );
}

const slider = (screen: Screen) => screen.getByRole("slider", { name: fr.route.profileCursor });

/** What the cursor says to a screen reader. */
const valueText = (cursor: Locator) => plain(cursor.element().getAttribute("aria-valuetext"));

/** Where the cursor is, in kilometers. */
function cursorKm(cursor: Locator): number {
  const input = cursor.element();
  if (!(input instanceof HTMLInputElement)) throw new Error("the cursor is not a range");
  return Number(input.value);
}

/** The one element of the map that matches, or an error. */
function part(screen: Screen, selector: string): Element {
  const found = screen.container.querySelectorAll(selector);
  const [only] = found;
  if (found.length !== 1 || only === undefined) {
    throw new Error(`${found.length} elements match ${selector}, not 1`);
  }
  return only;
}

/** The mark of the cursor on the map, if it is there. */
const mark = (screen: Screen) =>
  screen.container.querySelector<SVGPathElement>("path.track-marker");

const centre = (element: Element) => {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { x: left + width / 2, y: top + height / 2 };
};

/**
 * Where a fraction of a track due north is on the screen: between the dots of
 * the start and of the finish, in proportion (over a few kilometers, the
 * projection of the map is a straight scale, to well under a pixel).
 */
function onScreen(screen: Screen, fraction: number): { x: number; y: number } {
  const start = centre(part(screen, "path.track-start"));
  const finish = centre(part(screen, "path.track-finish"));
  return {
    x: start.x + (finish.x - start.x) * fraction,
    y: start.y + (finish.y - start.y) * fraction,
  };
}

/** How far the mark is drawn from a point of the screen, in pixels (the further axis); no mark is infinitely far. */
function markOffset(screen: Screen, at: { x: number; y: number }): number {
  const dot = mark(screen);
  if (!dot) return Infinity;
  const drawn = centre(dot);
  return Math.max(Math.abs(drawn.x - at.x), Math.abs(drawn.y - at.y));
}

/** Waits for n images of the browser: what is done at the next image (the map reads the pointer then) is done. */
function frames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let left = n;
    const step = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/**
 * The track is where it was on the screen: the map has not moved. Its numbers
 * are compared (a DOMRect has no keys of its own: `toEqual` would pass whatever
 * they are).
 */
function expectStill(now: DOMRect, before: DOMRect, what: string) {
  expect(now.left - before.left, `${what}: across`).toBeCloseTo(0, 1);
  expect(now.top - before.top, `${what}: up and down`).toBeCloseTo(0, 1);
}

/** Where the mark was last put, as Leaflet was told. */
function placedAt(placed: MockInstance<CircleMarker["setLatLng"]>): LatLng | undefined {
  const call = placed.mock.lastCall;
  return call ? latLng(call[0]) : undefined;
}

/**
 * The mark is on the map at the kilometer of the cursor: Leaflet was given the
 * place of the track there (`pointAtKm`), and draws it there, on the line
 * between the start and the finish of a track due north (`degrees` of latitude
 * from 45°).
 */
async function expectMarkAtCursor(
  screen: Screen,
  placed: MockInstance<CircleMarker["setLatLng"]>,
  points: TrackPoint[],
  degrees: number,
) {
  const index = trackIndex(points);
  const cursor = slider(screen);
  await expect
    .poll(() => {
      const wanted = pointAtKm(index, cursorKm(cursor));
      const given = placedAt(placed);
      return (
        mark(screen) !== null &&
        wanted !== undefined &&
        given !== undefined &&
        Math.abs(given.lat - wanted.lat) < 1e-9 &&
        Math.abs(given.lng - wanted.lon) < 1e-9
      );
    })
    .toBe(true);
  const wanted = pointAtKm(index, cursorKm(cursor));
  const dot = mark(screen);
  if (!wanted || !dot) throw new Error("no mark");
  const there = onScreen(screen, (wanted.lat - 45) / degrees);
  const drawn = centre(dot);
  expect(Math.abs(drawn.x - there.x), "across the track").toBeLessThan(1.5);
  expect(Math.abs(drawn.y - there.y), "along the track").toBeLessThan(1.5);
}

/** Moves the mouse over the map, to a point of the screen. */
async function hoverMap(screen: Screen, at: { x: number; y: number }) {
  const map = trackMap(screen);
  const box = map.element().getBoundingClientRect();
  const { clientLeft, clientTop } = map.element();
  // The position is taken from the corner inside the border of the map.
  await userEvent.hover(map, {
    position: { x: at.x - box.left - clientLeft, y: at.y - box.top - clientTop },
  });
}

test("RouteSection — le repère de la carte suit le curseur du profil", async () => {
  // A long track: 100 000 points over 50 km, a point every half meter.
  const long = steady(100_000, 0.45, 8);
  serve(long.file);
  const placed = vi.spyOn(CircleMarker.prototype, "setLatLng");
  const screen = await renderSection(formatOf({ gpx: "trace_ab12cd.gpx" }));
  // A file of 5 MB to read, and the map to load when no test of the file has loaded it yet.
  await expect.element(trackMap(screen), { timeout: 10_000 }).toBeVisible();
  const cursor = slider(screen);

  // No cursor, no mark.
  expect(mark(screen)).toBeNull();
  // The pointer along the profile: the mark is on the track, at the cursor's kilometer.
  for (const fraction of [0.2, 0.5, 0.85]) {
    const { width } = cursor.element().getBoundingClientRect();
    await userEvent.hover(cursor, { position: { x: width * fraction, y: 80 } });
    await expectMarkAtCursor(screen, placed, long.points, 0.45);
  }
  // Away from the profile, the cursor and its mark go.
  await userEvent.unhover(cursor);
  await expect.poll(() => mark(screen)).toBeNull();
  expect(pill(screen)).toBe("4 503 m");

  // A click gives the profile the focus, and leaves the cursor where it is (not at the start).
  const { width } = cursor.element().getBoundingClientRect();
  await userEvent.click(cursor, { position: { x: width * 0.6, y: 80 } });
  expect(document.activeElement).toBe(cursor.element());
  expect(cursorKm(cursor)).toBeGreaterThan(25);
  await expectMarkAtCursor(screen, placed, long.points, 0.45);
});

test("RouteSection — survoler le tracé place le curseur du profil", async () => {
  serve(STEADY.file);
  const screen = await renderSection(formatOf({ gpx: "trace_ab12cd.gpx" }));
  await expect.element(trackMap(screen)).toBeVisible();
  const cursor = slider(screen);
  expect(pill(screen)).toBe("678 m");

  // The pointer on the track, at 1.1 km: the profile reads there, in figures
  // and for a screen reader, and the mark of the map is under the pointer.
  const at = onScreen(screen, 1.1 / STEADY_KM);
  await hoverMap(screen, at);
  await expect.poll(() => pill(screen)).toMatch(/^1,1 km · \d+ m · 8 %$/);
  const altitude = /· (\d+) m ·/.exec(pill(screen))?.[1];
  expect(Number(altitude)).toBeGreaterThanOrEqual(585);
  expect(Number(altitude)).toBeLessThanOrEqual(593);
  expect(valueText(cursor)).toBe(`1,1 km, altitude ${altitude} m, pente 8 %`);
  await expect.poll(() => markOffset(screen, at)).toBeLessThan(1.5);

  // Beside the line (8 px off), it is still the track: the point across from the pointer.
  const elsewhere = onScreen(screen, 0.7 / STEADY_KM);
  await hoverMap(screen, { x: elsewhere.x + 8, y: elsewhere.y });
  await expect.poll(() => pill(screen)).toMatch(/^0,7 km · \d+ m · 8 %$/);
  expect(valueText(cursor)).toMatch(/^0,7 km, altitude \d+ m, pente 8 %$/);

  // Away from it (40 px), there is no cursor and no mark.
  await hoverMap(screen, { x: elsewhere.x + 40, y: elsewhere.y });
  await expect.poll(() => pill(screen)).toBe("678 m");
  await expect.poll(() => mark(screen)).toBeNull();
  expect(valueText(cursor)).toBe("0 km, altitude 500 m, pente 8 %");

  // A mouse that moves with its button down is moving the map: the track that
  // passes under it puts no cursor.
  const under = document.elementFromPoint(at.x, at.y);
  under?.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: at.x,
      clientY: at.y,
      pointerType: "mouse",
      buttons: 1,
      bubbles: true,
    }),
  );
  await frames(4);
  expect(pill(screen)).toBe("678 m");
  expect(mark(screen)).toBeNull();

  // Back on the track, then off the map: the cursor goes with the pointer.
  await hoverMap(screen, at);
  await expect.poll(() => pill(screen)).toMatch(/^1,1 km/);
  await userEvent.unhover(trackMap(screen));
  await expect.poll(() => pill(screen)).toBe("678 m");
  await expect.poll(() => mark(screen)).toBeNull();
});

/** The elements of the map that the Tab key stops on. */
const tabStops = (region: Element) =>
  [...region.querySelectorAll<HTMLElement>("a[href], button, input, [tabindex]")].filter(
    (element) => element.tabIndex >= 0,
  );

test("RouteSection — au clavier, le repère suit", async () => {
  serve(STEADY.file);
  const placed = vi.spyOn(CircleMarker.prototype, "setLatLng");
  const screen = await renderSection(formatOf({ gpx: "trace_ab12cd.gpx" }));
  await expect.element(trackMap(screen)).toBeVisible();
  const region = trackMap(screen).element();
  const stopsBefore = tabStops(region);
  const cursor = slider(screen);

  // Tab goes through the map and its buttons, then to the cursor of the profile:
  // it shows at the start, and so does its mark.
  for (let i = 0; i < 12 && document.activeElement !== cursor.element(); i++) {
    await userEvent.tab();
  }
  await expect.element(cursor).toHaveFocus();
  expect(valueText(cursor)).toBe("0 km, altitude 500 m, pente 8 %");
  await expectMarkAtCursor(screen, placed, STEADY.points, 0.02);

  // The arrows move it along the track, Page Up further, End to the finish.
  await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");
  expect(cursorKm(cursor)).toBeGreaterThan(0.08);
  await expectMarkAtCursor(screen, placed, STEADY.points, 0.02);
  await userEvent.keyboard("{PageUp}{PageUp}{PageUp}");
  expect(cursorKm(cursor)).toBeGreaterThan(0.7);
  await expectMarkAtCursor(screen, placed, STEADY.points, 0.02);
  await userEvent.keyboard("{End}");
  expect(valueText(cursor)).toBe("2,2 km, altitude 678 m, pente 8 %");
  await expectMarkAtCursor(screen, placed, STEADY.points, 0.02);

  // The mark is for the eye: the cursor says where it is. Nothing for a screen
  // reader, no tab stop, nothing to click.
  const dot = mark(screen);
  expect(dot?.getAttribute("aria-hidden")).toBe("true");
  expect(dot?.classList.contains("leaflet-interactive")).toBe(false);
  expect(dot && getComputedStyle(dot).pointerEvents).toBe("none");
  expect(tabStops(region)).toEqual(stopsBefore);

  // A mouse that passes over the map while the keys use the cursor: on the
  // track, the cursor goes there; off the track, then off the map, it stays
  // (the keys still have it), with its mark, and the focus stays on the profile.
  const at = onScreen(screen, 1.1 / STEADY_KM);
  await hoverMap(screen, at);
  await expect.poll(() => valueText(cursor)).toMatch(/^1,1 km, altitude \d+ m, pente 8 %$/);
  await hoverMap(screen, { x: at.x + 40, y: at.y });
  await userEvent.unhover(trackMap(screen));
  await frames(4);
  expect(valueText(cursor)).toMatch(/^1,1 km, altitude \d+ m, pente 8 %$/);
  expect(pill(screen)).toMatch(/^1,1 km/);
  expect(mark(screen)).not.toBeNull();
  expect(document.activeElement).toBe(cursor.element());

  // Escape puts the cursor away, and its mark; the focus stays.
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => mark(screen)).toBeNull();
  expect(document.activeElement).toBe(cursor.element());
});

/** A colour "#rrggbb" as the browser gives it back from a style. */
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;

/** 1 km flat at 500 m, then 1 km at 30 %: a point every 100 m. */
const FLAT_THEN_WALL = gpx(
  Array.from({ length: 21 }, (_, i) => ({
    lat: 45 + (0.009 * i) / 10,
    ele: i <= 10 ? 500 : 500 + (i - 10) * 30,
  })),
);

test("RouteSection — le repère a la couleur de la pente sous le curseur, de jour, de nuit et en couleurs forcées, avec un contour", async () => {
  try {
    for (const [what, theme, palette, forced] of [
      ["day", "light", SLOPE_COLORS, false],
      ["night", "dark", SLOPE_COLORS_DARK, false],
      ["forced colours", "light", SLOPE_COLORS, true],
    ] as const) {
      document.documentElement.dataset.theme = theme;
      if (forced) await emulateMedia({ forcedColors: "active" });
      serve(FLAT_THEN_WALL);
      const screen = await renderSection(formatOf({ gpx: "trace_ab12cd.gpx" }));
      await expect.element(trackMap(screen)).toBeVisible();
      const cursor = slider(screen);
      cursor.element().focus();

      const stops: [string, SlopeZone][] = [
        ["{Home}", 1],
        ["{End}", 5],
      ];
      for (const [key, zone] of stops) {
        await userEvent.keyboard(key);
        await expect.poll(() => mark(screen)).not.toBeNull();
        const dot = mark(screen);
        if (!dot) throw new Error("no mark");
        // The colour of the zone in the palette of the theme: the one of the dot of the profile.
        await expect
          .poll(() => getComputedStyle(dot).fill, { message: `the mark at ${key} (${what})` })
          .toBe(rgb(palette[zone]));
        const dots = profileDrawing(screen).element().querySelectorAll("circle");
        const profileDot = dots[dots.length - 1];
        expect(profileDot && getComputedStyle(profileDot).fill).toBe(rgb(palette[zone]));
        // A ring of the card around it, as the dot of the profile has: it stands
        // out of the map, and of the line under it.
        const card = getComputedStyle(document.documentElement).getPropertyValue("--color-card");
        expect(getComputedStyle(dot).stroke, `the ring (${what})`).toBe(rgb(card.trim()));
        expect(Number.parseFloat(getComputedStyle(dot).strokeWidth)).toBeGreaterThanOrEqual(2);
        expect(getComputedStyle(dot).fillOpacity).toBe("1");
      }
      await screen.unmount();
      if (forced) await resetMedia();
    }
  } finally {
    delete document.documentElement.dataset.theme;
    await resetMedia();
  }
});

let fingers = 100;

type ScreenPoint = { x: number; y: number };

/**
 * A finger on the screen, as a browser tells it: each step is a pointer event
 * and a touch event (a phone sends both; Leaflet listens to the touch events
 * where the browser has them, as the Chromium of the tests does). A finger on
 * the screen is a pointer with its button down.
 */
function finger(at: ScreenPoint) {
  const target = document.elementFromPoint(at.x, at.y);
  if (!target) throw new Error("nothing there");
  fingers += 1;
  const identifier = fingers;
  const send = (pointer: string, touch: string, { x, y }: ScreenPoint, down: boolean) => {
    target.dispatchEvent(
      new PointerEvent(pointer, {
        clientX: x,
        clientY: y,
        pointerId: identifier,
        pointerType: "touch",
        isPrimary: true,
        buttons: down ? 1 : 0,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
    const contact = new Touch({ identifier, target, clientX: x, clientY: y });
    target.dispatchEvent(
      new TouchEvent(touch, {
        touches: down ? [contact] : [],
        targetTouches: down ? [contact] : [],
        changedTouches: [contact],
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
  };
  return {
    down: () => send("pointerdown", "touchstart", at, true),
    move: (to: ScreenPoint) => send("pointermove", "touchmove", to, true),
    up: (to: ScreenPoint) => send("pointerup", "touchend", to, false),
    /** At the end of a touch, the browser says that the pointer has left the element, and the map. */
    gone: (region: Element, to: ScreenPoint) => {
      const pointer = { clientX: to.x, clientY: to.y, pointerId: identifier, pointerType: "touch" };
      target.dispatchEvent(new PointerEvent("pointerout", { ...pointer, bubbles: true }));
      region.dispatchEvent(new PointerEvent("pointerleave", pointer));
    },
    target,
  };
}

/** A tap at a point of the screen: the finger down and up, gone from the map, then the click. */
function tap(region: Element, at: ScreenPoint) {
  const touch = finger(at);
  touch.down();
  touch.up(at);
  touch.gone(region, at);
  touch.target.dispatchEvent(
    new MouseEvent("click", { clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }),
  );
}

/**
 * A finger that goes down at a point, slides to another over a few images (as
 * a finger does: Leaflet works out the speed of the map from their times), and
 * goes up: no click (a browser sends none after a slide).
 */
async function slide(region: Element, from: ScreenPoint, to: ScreenPoint) {
  const touch = finger(from);
  touch.down();
  for (let step = 1; step <= 6; step++) {
    await frames(1);
    touch.move({
      x: from.x + ((to.x - from.x) * step) / 6,
      y: from.y + ((to.y - from.y) * step) / 6,
    });
  }
  await frames(1);
  touch.up(to);
  touch.gone(region, to);
}

/** The place of an element on the screen once it has stopped moving (a map that glides at the end of a slide). */
async function settled(read: () => DOMRect): Promise<DOMRect> {
  let previous = read();
  for (let i = 0; i < 100; i++) {
    await frames(3);
    const now = read();
    if (Math.abs(now.left - previous.left) < 0.01 && Math.abs(now.top - previous.top) < 0.01) {
      return now;
    }
    previous = now;
  }
  throw new Error("it does not stop moving");
}

// Safari has no `new Touch()` (it has `document.createTouch`, which is gone from the others): a
// finger cannot be made there, and this test cannot be run by hand-made touch events.
const canMakeTouches = (() => {
  try {
    return new Touch({ identifier: 1, target: document.body }) instanceof Touch;
  } catch {
    return false;
  }
})();

// On a real touch screen (an emulated phone), Leaflet reads the touches of the browser, not these.
test.skipIf(!canMakeTouches || isTouchDevice)(
  "RouteSection — sur un téléphone, toucher le tracé place le curseur du profil, sans déplacer la carte",
  async () => {
    serve(STEADY.file);
    await page.viewport(375, 812);
    try {
      const screen = await renderSection(formatOf({ gpx: "trace_ab12cd.gpx" }), ["fr"], {
        inCard: true,
      });
      await expect.element(trackMap(screen)).toBeVisible();
      const region = trackMap(screen).element();
      const cursor = slider(screen);
      const line = () => part(screen, "path.track-line").getBoundingClientRect();
      const before = line();

      // A finger beside the track (a finger is wide: 14 px off), at 1.1 km: the
      // profile reads there, and the mark is on the track.
      const at = onScreen(screen, 1.1 / STEADY_KM);
      tap(region, { x: at.x + 14, y: at.y });
      await expect.poll(() => pill(screen)).toMatch(/^1,1 km · \d+ m · 8 %$/);
      expect(valueText(cursor)).toMatch(/^1,1 km, altitude \d+ m, pente 8 %$/);
      await expect.poll(() => markOffset(screen, at)).toBeLessThan(1.5);
      // The map has not moved, not even a little later: the track is where it was.
      await frames(10);
      expectStill(line(), before, "after a tap on the track");

      // A finger that slides along the track, from 0.5 km toward the finish,
      // ending on the line: it moves the map, as before, and leaves the cursor at
      // 1.1 km. Nor does the end of the touch, which the browser tells as the
      // pointer leaving the map, take the cursor away.
      const from = onScreen(screen, 0.5 / STEADY_KM);
      const toward = onScreen(screen, 1);
      const length = Math.hypot(toward.x - from.x, toward.y - from.y);
      const to = {
        x: from.x + ((toward.x - from.x) * 40) / length,
        y: from.y + ((toward.y - from.y) * 40) / length,
      };
      await slide(region, from, to);
      await frames(4);
      expect(pill(screen)).toMatch(/^1,1 km · \d+ m · 8 %$/);
      expect(valueText(cursor)).toMatch(/^1,1 km, altitude \d+ m, pente 8 %$/);
      expect(mark(screen)).not.toBeNull();
      const afterSlide = await settled(line);
      expect(
        Math.hypot(afterSlide.left - before.left, afterSlide.top - before.top),
      ).toBeGreaterThan(25);

      // A touch far from the track (where it is now) puts the cursor away; the map stays.
      const now = onScreen(screen, 1.1 / STEADY_KM);
      tap(region, { x: now.x + 80, y: now.y });
      await expect.poll(() => pill(screen)).toBe("678 m");
      await expect.poll(() => mark(screen)).toBeNull();
      await frames(10);
      expectStill(line(), afterSlide, "after a tap away from the track");
    } finally {
      await page.viewport(414, 896);
    }
  },
);

/** The box that a call of `fitBounds` was given. */
const boundsOf = (box: LatLngBoundsExpression | undefined): LatLngBounds =>
  box instanceof LatLngBounds ? box : latLngBounds(box ?? []);

test("RouteSection — la carte suit la portion : elle se cadre dessus, la met en avant, et Vue entière recadre la trace", async () => {
  serve(STEADY.file);
  const framed = vi.spyOn(LeafletMap.prototype, "fitBounds");
  const screen = await renderSection(formatOf({ gpx: "trace_ab12cd.gpx" }));
  await expect.element(trackMap(screen)).toBeVisible();
  const index = trackIndex(STEADY.points);
  const lat = (km: number) => pointAtKm(index, km)?.lat ?? Number.NaN;
  // The whole track is framed first, and nothing is highlighted.
  expect(framed).toHaveBeenCalledTimes(1);
  expect(screen.container.querySelector("path.track-portion")).toBeNull();
  const line = part(screen, "path.track-line");
  expect(getComputedStyle(line).strokeOpacity).toBe("1");

  // Zoom in on the profile: twice shorter, around its middle.
  await screen.getByRole("button", { name: fr.route.zoomProfileInLabel }).click();
  await expect.poll(() => framed.mock.calls.length).toBe(2);
  const bounds = boundsOf(framed.mock.calls[1]?.[0]);
  expect(bounds.getSouth()).toBeCloseTo(lat(STEADY_KM * 0.25), 6);
  expect(bounds.getNorth()).toBeCloseTo(lat(STEADY_KM * 0.75), 6);
  // The portion is a line of its own over the track, which is dimmed.
  const portion = part(screen, "path.track-portion");
  expect(Number.parseFloat(getComputedStyle(portion).strokeWidth)).toBeGreaterThan(
    Number.parseFloat(getComputedStyle(line).strokeWidth),
  );
  expect(getComputedStyle(line).strokeOpacity).toBe("0.5");

  // The whole view: the track is framed again, the highlight goes.
  await screen.getByRole("button", { name: fr.route.zoomProfileAllLabel }).click();
  await expect.poll(() => framed.mock.calls.length).toBe(3);
  const whole = boundsOf(framed.mock.calls[2]?.[0]);
  expect(whole.getSouth()).toBeCloseTo(lat(0), 6);
  expect(whole.getNorth()).toBeCloseTo(lat(STEADY_KM), 6);
  expect(screen.container.querySelector("path.track-portion")).toBeNull();
  expect(getComputedStyle(part(screen, "path.track-line")).strokeOpacity).toBe("1");
});

test("RouteSection — un point de la carte hors de la portion n'y met pas de curseur", async () => {
  serve(STEADY.file);
  const screen = await renderSection(formatOf({ gpx: "trace_ab12cd.gpx" }));
  await expect.element(trackMap(screen)).toBeVisible();
  // Zoomed in on the middle half of the profile (0.55 to 1.65 km), then the map zoomed out by
  // hand, so that the whole track is in view again.
  await screen.getByRole("button", { name: fr.route.zoomProfileInLabel }).click();
  await expect.poll(() => screen.container.querySelector("path.track-portion")).not.toBeNull();
  await screen.getByRole("button", { name: fr.route.zoomOut, exact: true }).click();
  await new Promise((resolve) => setTimeout(resolve, 600));
  await screen.getByRole("button", { name: fr.route.zoomOut, exact: true }).click();
  await new Promise((resolve) => setTimeout(resolve, 800));
  const cursor = slider(screen);

  // On the portion, the cursor goes there; out of it, the map puts none.
  await hoverMap(screen, onScreen(screen, 0.5));
  await expect.poll(() => valueText(cursor)).toMatch(/^1,1 km/);
  await hoverMap(screen, onScreen(screen, 0.05));
  await expect.poll(() => pill(screen)).toMatch(/^\d+ m$/);
  await hoverMap(screen, onScreen(screen, 0.5));
  await expect.poll(() => pill(screen)).toMatch(/ · /);
  await hoverMap(screen, onScreen(screen, 0.95));
  await expect.poll(() => pill(screen)).toMatch(/^\d+ m$/);
  expect(cursorKm(cursor)).toBeLessThanOrEqual(STEADY_KM * 0.75 + 0.01);
});
