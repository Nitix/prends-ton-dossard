import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { FormatRecord } from "../../lib/types";
import { RouteSection } from "./RouteSection";

// The colours and the sizes of the drawings are a matter of the styles.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  getURL: vi.fn<(record: Rec, filename: string) => string>(),
}));

vi.mock("../../lib/pb", () => ({ pb: { files: { getURL: mocks.getURL } } }));

// The map of a track is the real one, with blank tiles: no test asks a tile server for a tile.
vi.mock("./TrackMap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./TrackMap")>();
  const { withBlankTiles } = await import("../../test/tiles");
  return { ...actual, default: withBlankTiles(actual.default) };
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

beforeEach(() => {
  mocks.getURL.mockReset().mockReturnValue(TRACK_URL);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderSection(format: FormatRecord, languages = ["fr"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        <RouteSection format={format} />
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

test("RouteSection — chiffres, carte, profil et liens", async () => {
  const fetching = serve(CLIMB);
  const screen = await renderSection(formatOf({ gpx: "trace_ab12cd.gpx", route_url: COURSE_URL }));

  await expect.element(screen.getByRole("heading", { name: fr.route.title })).toBeVisible();
  // The numbers: the distance, the gain and the loss, then the lowest and the highest altitudes.
  const figures = screen.getByText(/D\+/);
  await expect.element(figures).toBeVisible();
  expect(plain(figures.element().textContent)).toBe("2,2 km · 200 m D+ · 50 m D−");
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

test("RouteSection — the map replaces the outline, profile and numbers unchanged", async () => {
  serve(CLIMB);
  const screen = await renderSection(formatOf({ gpx: "trace_ab12cd.gpx" }));

  // The map is there, and the outline of the track that it replaces is not.
  await expect.element(trackMap(screen)).toBeVisible();
  await expect
    .element(screen.getByRole("img", { name: /^Tracé du parcours/ }))
    .not.toBeInTheDocument();
  // The numbers are written outside of the map, as they were; so is the profile, which is the same.
  const figures = screen.getByText(/D\+/);
  expect(plain(figures.element().textContent)).toBe("2,2 km · 200 m D+ · 50 m D−");
  expect(trackMap(screen).element().contains(figures.element())).toBe(false);
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
  expect(screen.container.querySelector("svg")).toBeNull();
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
  expect(screen.container.querySelector("svg")).toBeNull();
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
