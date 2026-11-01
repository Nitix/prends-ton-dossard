import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { FormatRecord } from "../../lib/types";
import { RouteSection } from "./RouteSection";

// The sizes are classes of Tailwind, which the styles load.
import "../../styles.css";

// A file of its own: a chunk that failed to load is kept as failed, so the
// import of the map fails for every test of the file.

vi.mock("../../lib/pb", () => ({
  pb: { files: { getURL: () => "https://pb.example.test/api/files/formats/f42/trace.gpx" } },
}));

// The map does not come: its chunk is gone (the network, or a deploy that
// replaced the file under the name that the page asks for), so what the page
// gets from `import()` is an error, when it asks for the component.
vi.mock("./TrackMap", () => ({
  get default(): never {
    throw new Error("Failed to fetch dynamically imported module");
  },
}));

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
  route_url: "https://www.openrunner.com/route-details/123",
};

afterEach(() => {
  vi.restoreAllMocks();
});

test("RouteSection — if the map cannot be loaded, a line says so, and the numbers, the profile and the links stay", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(TRACK)));
  // React says in the console that an error boundary caught the failure: it is expected.
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={["fr"]}>
        <RouteSection format={format} />
      </I18nProvider>
    </QueryClientProvider>,
  );

  // What the file says is there...
  await expect.element(screen.getByText(/D\+/)).toBeVisible();
  await expect
    .element(screen.getByRole("img", { name: new RegExp(`^${fr.route.profileLabel}`) }))
    .toBeVisible();
  await expect.element(screen.getByRole("link", { name: fr.route.download })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: fr.route.open })).toBeVisible();
  // ... the map is not, and one line says it, rather than a map that is gone with
  // no word (a first visit offline): no alert, no error screen, and nothing waits for it.
  await expect.element(screen.getByRole("region", { name: fr.route.map })).not.toBeInTheDocument();
  await expect.element(screen.getByText(fr.route.mapUnavailable)).toBeVisible();
  await expect.element(screen.getByText(fr.common.loading)).not.toBeInTheDocument();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  expect(logged).toHaveBeenCalled();
});
