import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { FormatRecord } from "../../lib/types";
import { RouteSection } from "./RouteSection";

// The sizes are classes of Tailwind, which the styles load.
import "../../styles.css";

// A file of its own: the map is loaded once, the first time that a test shows
// one, so the test that looks at the time before it is loaded must be the first
// to show a map in its file.

const gate = vi.hoisted(() => Promise.withResolvers<void>());

vi.mock("../../lib/pb", () => ({
  pb: { files: { getURL: () => "https://pb.example.test/api/files/formats/f42/trace.gpx" } },
}));

// The real map, with blank tiles (no test asks a tile server for a tile), which
// arrives when the test opens the gate.
vi.mock("./TrackMap", async (importOriginal) => {
  const { blankTileModule } = await import("../../test/tiles");
  await gate.promise;
  return blankTileModule(importOriginal);
});

const TRACK = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="45" lon="6"><ele>450</ele></trkpt><trkpt lat="45.01" lon="6"><ele>650</ele></trkpt></trkseg></trk></gpx>`;

const format: FormatRecord = {
  created: "",
  updated: "",
  collectionId: "formats",
  collectionName: "formats",
  id: "f42",
  event: "event",
  name: "",
  race_type: "trail0000000000",
  distance_km: 42,
  gpx: "trace.gpx",
};

afterEach(() => {
  vi.restoreAllMocks();
});

const heightOf = (element: Element | null | undefined) => element?.getBoundingClientRect().height;

test("RouteSection — while the map loads, a box of its size stands in its place", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(TRACK)));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={["fr"]}>
        <RouteSection format={format} />
      </I18nProvider>
    </QueryClientProvider>,
  );

  // The numbers are there, and a box that says it loads, of the size of a map.
  await expect.element(screen.getByText(/D\+/)).toBeVisible();
  const box = screen.getByText(fr.common.loading);
  await expect.element(box).toBeVisible();
  const height = heightOf(box.element());
  expect(height).toBeGreaterThan(200);
  await expect.element(screen.getByRole("region", { name: fr.route.map })).not.toBeInTheDocument();

  // The map takes its place, at the same size: the page below does not move.
  gate.resolve();
  const map = screen.getByRole("region", { name: fr.route.map });
  await expect.element(map).toBeVisible();
  expect(heightOf(map.element())).toBe(height);
  await expect.element(screen.getByText(fr.common.loading)).not.toBeInTheDocument();
});
