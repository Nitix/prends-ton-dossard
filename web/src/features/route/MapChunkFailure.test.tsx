import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { FormatRecord } from "../../lib/types";
import { isTouchDevice } from "../../test/support";
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

// Intl separates a number from its unit with a no-break space: tests read the text as it looks.
const plain = (s: string | null | undefined) => (s ?? "").replace(/\p{Zs}/gu, " ");

// The test hovers the profile and then leaves it (unhover): the figures of a pointer are what it
// checks, and on a touch screen there is no pointer to put on it or to take off.
test.skipIf(isTouchDevice)("RouteSection — sans carte, le profil marche seul", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(TRACK)));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={["fr"]}>
        <RouteSection format={format} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  await expect.element(screen.getByText(fr.route.mapUnavailable)).toBeVisible();
  const drawing = screen.getByRole("img", { name: new RegExp(`^${fr.route.profileLabel}`) });
  const pill = () => plain(drawing.element().parentElement?.querySelector("p")?.textContent);
  const cursor = screen.getByRole("slider", { name: fr.route.profileCursor });
  expect(pill()).toBe("650 m");

  // The pointer on the profile: its figures, in the middle of the 1.1 km.
  await userEvent.hover(cursor);
  await expect.poll(pill).toMatch(/^0,6 km · \d+ m · 18 %$/);
  await userEvent.unhover(cursor);
  await expect.poll(pill).toBe("650 m");

  // The keys: what a screen reader hears, and the figures.
  cursor.element().focus();
  await userEvent.keyboard("{End}");
  expect(plain(cursor.element().getAttribute("aria-valuetext"))).toBe(
    "1,1 km, altitude 650 m, pente 18 %",
  );
  expect(pill()).toBe("1,1 km · 650 m · 18 %");
  await userEvent.keyboard("{Escape}");
  expect(pill()).toBe("650 m");
  // No mark of a map that is not there.
  expect(screen.container.querySelector(".track-marker")).toBeNull();
});
