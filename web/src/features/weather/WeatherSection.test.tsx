import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";
import { plain } from "../../test/said";
import { toEventView } from "../events/api";
import { eventRecord } from "../events/testFixture";
import type { Weather } from "./api";
import { WeatherSection } from "./WeatherSection";

import "../../styles.css";

const mocks = vi.hoisted(() => ({
  send: vi.fn<(path: string, options: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({ pb: { send: mocks.send } }));

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(() => {
  mocks.send.mockReset();
});

/** The 13 and 14 June, as the server says them. */
const SHOWERS = {
  date: "2026-06-13",
  code: 80,
  tMin: 9.1,
  tMax: 17.3,
  rainChance: 60,
  rainMm: 2.1,
  windKmh: 20,
  gustKmh: 35,
};
const CLEAR = { ...SHOWERS, date: "2026-06-14", code: 0, rainChance: 5, rainMm: 0, gustKmh: 12 };

const FOUND_PLACE: Weather = {
  status: "ok",
  place: { source: "place", name: "Annecy", detail: "Auvergne-Rhône-Alpes, France" },
  days: [SHOWERS, CLEAR],
  // 14:05 in Paris, in June.
  fetchedAt: "2026-06-08T12:05:00Z",
  stale: false,
};
const FOUND_TRACK: Weather = {
  ...FOUND_PLACE,
  place: { source: "track", format: "Trail 42 km" },
};

async function renderSection(
  answer: Weather | Error | "pending",
  options: { today?: string; languages?: string[] } = {},
) {
  const { today = "2026-06-08", languages = ["fr"] } = options;
  if (answer === "pending") mocks.send.mockReturnValue(new Promise(() => {}));
  else if (answer instanceof Error) mocks.send.mockRejectedValue(answer);
  else mocks.send.mockResolvedValue(answer);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        <TodayProvider value={Temporal.PlainDate.from(today)}>
          <WeatherSection view={toEventView(eventRecord)} />
        </TodayProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const title = () => page.getByRole("heading", { level: 2, name: fr.weather.title });
const failure = () =>
  new ClientResponseError({ status: 502, response: { code: "weather_unavailable" } });

describe("WeatherSection", () => {
  test("WeatherSection — une ligne par jour", async () => {
    const screen = await renderSection(FOUND_PLACE);
    await expect.element(title()).toBeVisible();
    const items = screen.getByRole("list").getByRole("listitem");
    await expect.poll(() => items.elements().length).toBe(2);
    expect(plain(items.nth(0).element().textContent)).toBe(
      "sam. 13 juin · Averses · 9 à 17 °C · pluie 60 %, 2 mm · rafales 35 km/h",
    );
    expect(plain(items.nth(1).element().textContent)).toBe(
      "dim. 14 juin · Ciel dégagé · 9 à 17 °C · pluie 5 %, 0 mm · rafales 12 km/h",
    );
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0]?.[0]).toBe("/api/app/events/event/weather");
    // The icon is decoration: the weather is in the words.
    expect(items.nth(0).element().querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  test("WeatherSection — une course en cours : les jours passés manquent, chaque jour dit sa date", async () => {
    // On the 14th the server starts at today: the first day of the list is not the first day of the race.
    const screen = await renderSection({ ...FOUND_PLACE, days: [CLEAR] }, { today: "2026-06-14" });
    const items = screen.getByRole("list").getByRole("listitem");
    await expect.poll(() => items.elements().length).toBe(1);
    expect(plain(items.nth(0).element().textContent)).toBe(
      "dim. 14 juin · Ciel dégagé · 9 à 17 °C · pluie 5 %, 0 mm · rafales 12 km/h",
    );
  });

  test("WeatherSection — en anglais", async () => {
    const screen = await renderSection(FOUND_PLACE, { languages: ["en-GB"] });
    const items = screen.getByRole("list").getByRole("listitem");
    await expect.poll(() => items.elements().length).toBe(2);
    expect(plain(items.nth(0).element().textContent)).toMatch(
      /^Sat,? 13 Jun · Showers · 9 to 17 °C · rain 60 ?%, 2 mm · gusts 35 km\/h$/,
    );
  });

  test("WeatherSection — le lieu : la trace, ou le lieu trouvé", async () => {
    const onTrack = await renderSection(FOUND_TRACK);
    await expect
      .element(onTrack.getByText("Au départ de la trace de « Trail 42 km »"))
      .toBeVisible();
    await onTrack.unmount();

    const found = await renderSection(FOUND_PLACE);
    await expect.element(found.getByText("À Annecy (Auvergne-Rhône-Alpes, France)")).toBeVisible();
  });

  test("WeatherSection — un lieu sans précision n'a pas de parenthèses", async () => {
    const screen = await renderSection({
      ...FOUND_PLACE,
      place: { source: "place", name: "Annecy" },
    });
    await expect.element(screen.getByText("À Annecy", { exact: true })).toBeVisible();
  });

  test("WeatherSection — « Prévision de 14:05 », et « pas à jour »", async () => {
    const fresh = await renderSection(FOUND_PLACE);
    await expect.element(fresh.getByText("Prévision de 14:05", { exact: true })).toBeVisible();
    await fresh.unmount();

    const stale = await renderSection({ ...FOUND_PLACE, stale: true });
    await expect
      .element(stale.getByText("Prévision de 14:05, pas à jour", { exact: true }))
      .toBeVisible();
  });

  test("WeatherSection — la source et son lien", async () => {
    const screen = await renderSection(FOUND_TRACK);
    const link = screen.getByRole("link", { name: "Open-Meteo.com" });
    await expect.element(link).toBeVisible();
    expect(link.element().getAttribute("href")).toBe("https://open-meteo.com/");
    expect(link.element().getAttribute("rel")).toContain("noopener");
    expect(plain(link.element().parentElement?.textContent)).toBe(
      "Données : Open-Meteo.com (CC BY 4.0)",
    );
  });

  test("WeatherSection — « lieu : GeoNames » pour un lieu géocodé", async () => {
    const geocoded = await renderSection(FOUND_PLACE);
    await expect
      .element(geocoded.getByText("Données : Open-Meteo.com (CC BY 4.0) · lieu : GeoNames"))
      .toBeVisible();
    await geocoded.unmount();

    const track = await renderSection(FOUND_TRACK);
    await expect.element(track.getByRole("link", { name: "Open-Meteo.com" })).toBeVisible();
    expect(document.body.textContent).not.toContain("GeoNames");
  });

  test("WeatherSection — lieu introuvable", async () => {
    const screen = await renderSection({ status: "no_place", query: "Annecy" });
    await expect
      .element(screen.getByText("Pas de météo : le lieu « Annecy » n'a pas été trouvé."))
      .toBeVisible();
    expect(screen.getByRole("list").elements()).toHaveLength(0);
  });

  test("WeatherSection — échec et « Réessayer »", async () => {
    const screen = await renderSection(failure());
    await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.weather.failed);
    mocks.send.mockResolvedValue(FOUND_PLACE);
    await screen.getByRole("button", { name: "Réessayer" }).click();
    await expect.element(screen.getByText("sam. 13 juin", { exact: false })).toBeVisible();
    expect(mocks.send).toHaveBeenCalledTimes(2);
    // The page was never left on the <body>: the title took the focus as the button was tapped.
    expect(document.activeElement).not.toBe(document.body);
  });

  test("WeatherSection — chargement", async () => {
    const screen = await renderSection("pending");
    await expect.element(title()).toBeVisible();
    await expect.element(screen.getByText("Chargement de la météo…")).toBeVisible();
  });

  test("WeatherSection — rien à dire avant J-7 ni pour une course au mois", async () => {
    for (const answer of [
      { status: "not_yet", from: "2026-06-06" },
      { status: "over" },
      { status: "no_day" },
    ] as const) {
      const screen = await renderSection(answer);
      await expect.poll(() => mocks.send.mock.calls.length).toBeGreaterThan(0);
      await expect.element(title()).not.toBeInTheDocument();
      await screen.unmount();
      mocks.send.mockReset();
    }
  });

  test("WeatherSection — hors de la fenêtre, ni section ni requête", async () => {
    const screen = await renderSection(FOUND_PLACE, { today: "2026-06-05" });
    await expect.element(title()).not.toBeInTheDocument();
    expect(screen.container.textContent).toBe("");
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
