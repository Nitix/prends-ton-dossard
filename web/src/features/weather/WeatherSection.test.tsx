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
import { useWeather, type Weather } from "./api";
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
  options: { today?: string; languages?: string[]; record?: typeof eventRecord } = {},
) {
  const { today = "2026-06-08", languages = ["fr"], record = eventRecord } = options;
  if (answer === "pending") mocks.send.mockReturnValue(new Promise(() => {}));
  else if (answer instanceof Error) mocks.send.mockRejectedValue(answer);
  else mocks.send.mockResolvedValue(answer);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        <TodayProvider value={Temporal.PlainDate.from(today)}>
          <WeatherSection view={toEventView(record)} />
        </TodayProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const title = () => page.getByRole("heading", { level: 2, name: fr.weather.title });
const failure = () =>
  new ClientResponseError({ status: 502, response: { code: "weather_unavailable" } });

function Probe({ enabled }: { enabled: boolean }) {
  useWeather("event", enabled);
  return null;
}

async function mount(enabled: boolean) {
  mocks.send.mockResolvedValue({ status: "no_day" });
  const queryClient = new QueryClient();
  await render(
    <QueryClientProvider client={queryClient}>
      <Probe enabled={enabled} />
    </QueryClientProvider>,
  );
  return queryClient.getQueryCache().find({ queryKey: ["weather", "event"] });
}

describe("useWeather", () => {
  const QUARTER = 15 * 60_000;

  test("useWeather — gardée 15 minutes, redemandée toutes les 15 minutes", async () => {
    const query = await mount(true);
    const options = query?.observers[0]?.options;
    expect(options?.staleTime).toBe(QUARTER);
    expect(options?.refetchInterval).toBe(QUARTER);
  });

  test("useWeather — hors de la fenêtre, ni requête ni minuterie", async () => {
    const query = await mount(false);
    expect(query?.observers[0]?.options.enabled).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

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

  test("WeatherSection — un peu de pluie n'est pas pas de pluie, et pas de « -0 »", async () => {
    const drops = { ...SHOWERS, tMin: -0.4, tMax: 0.2, rainMm: 0.3 };
    const half = { ...SHOWERS, date: "2026-06-14", tMin: -2.6, rainMm: 0.5 };
    const screen = await renderSection({ ...FOUND_PLACE, days: [drops, half] });
    const items = screen.getByRole("list").getByRole("listitem");
    await expect.poll(() => items.elements().length).toBe(2);
    expect(plain(items.nth(0).element().textContent)).toBe(
      "sam. 13 juin · Averses · 0 à 0 °C · pluie 60 %, < 1 mm · rafales 35 km/h",
    );
    expect(plain(items.nth(1).element().textContent)).toBe(
      "dim. 14 juin · Averses · -3 à 17 °C · pluie 60 %, 1 mm · rafales 35 km/h",
    );
  });

  test("WeatherSection — les unités ne se coupent pas de leur nombre", async () => {
    const screen = await renderSection(FOUND_PLACE);
    const item = screen.getByRole("list").getByRole("listitem").nth(0);
    await expect.poll(() => item.element().textContent).toContain("°C");
    const text = item.element().textContent;
    for (const unit of ["°C", "%", "mm", "km/h"]) {
      expect(text).toContain(" " + unit);
    }
  });

  test("WeatherSection — en anglais", async () => {
    const screen = await renderSection(FOUND_PLACE, { languages: ["en-GB"] });
    const items = screen.getByRole("list").getByRole("listitem");
    await expect.poll(() => items.elements().length).toBe(2);
    expect(plain(items.nth(0).element().textContent)).toMatch(
      /^Sat,? 13 Jun · Showers · 9 to 17 °C · rain 60 ?%, 2 mm · gusts 35 km\/h$/,
    );
  });

  describe("l'heure de départ", () => {
    // 20 % de pluie, 0 mm, 4 °C, des rafales à 30 km/h, un ciel peu nuageux.
    const START = {
      format: "Trail 42 km",
      date: "2026-06-14",
      time: "07:30",
      code: 2,
      temp: 4.2,
      rainChance: 20,
      rainMm: 0,
      windKmh: 18,
      gustKmh: 30,
    };
    const WITH_START: Weather = { ...FOUND_PLACE, starts: [START] };

    test("WeatherSection — une ligne spéciale sous le jour du départ, et les lignes des jours restent", async () => {
      const screen = await renderSection(WITH_START);
      await expect.poll(() => screen.container.querySelectorAll(".weather-start").length).toBe(1);
      const days = screen.container.querySelectorAll(".weather-days > li");
      expect(days).toHaveLength(2);
      // The day line is what it was, with the minimum and the maximum of the day.
      expect(plain(days[0]?.textContent)).toBe(
        "sam. 13 juin · Averses · 9 à 17 °C · pluie 60 %, 2 mm · rafales 35 km/h",
      );
      expect(days[0]?.querySelector(".weather-start")).toBeNull();
      expect(plain(days[1]?.querySelector(".weather-day-line")?.textContent)).toBe(
        "dim. 14 juin · Ciel dégagé · 9 à 17 °C · pluie 5 %, 0 mm · rafales 12 km/h",
      );
      // Under the day of the start.
      const start = days[1]?.querySelector(".weather-start");
      expect(plain(start?.textContent)).toBe(
        "Départ de « Trail 42 km » à 7 h 30 : peu nuageux, 4 °C, pluie 20 % (0 mm), rafales 30 km/h",
      );
    });

    test("WeatherSection — la ligne du départ a son icône, décorative, et les mêmes espaces insécables", async () => {
      const screen = await renderSection(WITH_START);
      await expect.poll(() => screen.container.querySelector(".weather-start")).not.toBeNull();
      const start = screen.container.querySelector(".weather-start");
      expect(start?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      const text = start?.textContent ?? "";
      for (const unit of ["°C", "%", "mm)", "km/h"]) expect(text).toContain("\u00A0" + unit);
      // The time of the start does not break either.
      expect(text).toContain("7\u00A0h\u00A030");
    });

    test("WeatherSection — le nom de l'épreuve est lu comme un texte, pas comme du balisage", async () => {
      const screen = await renderSection({
        ...FOUND_PLACE,
        starts: [{ ...START, format: "<b>Trail</b> « 42 »" }],
      });
      await expect.poll(() => screen.container.querySelector(".weather-start")).not.toBeNull();
      const start = screen.container.querySelector(".weather-start");
      expect(start?.querySelector("b")).toBeNull();
      expect(start?.textContent).toContain("<b>Trail</b> « 42 »");
    });

    test("WeatherSection — en anglais", async () => {
      const screen = await renderSection(WITH_START, { languages: ["en-GB"] });
      await expect.poll(() => screen.container.querySelector(".weather-start")).not.toBeNull();
      expect(plain(screen.container.querySelector(".weather-start")?.textContent)).toBe(
        "Start of “Trail 42 km” at 7:30: partly cloudy, 4 °C, rain 20% (0 mm), gusts 30 km/h",
      );
    });

    test("WeatherSection — un départ dont le jour n'est pas dans la liste n'est pas montré, sans départ pas de liste", async () => {
      const lost = await renderSection({
        ...FOUND_PLACE,
        starts: [{ ...START, date: "2026-06-20" }],
      });
      await expect.element(title()).toBeVisible();
      await expect.poll(() => lost.container.querySelectorAll(".weather-days > li").length).toBe(2);
      expect(lost.container.querySelector(".weather-start")).toBeNull();
      await lost.unmount();

      const none = await renderSection(FOUND_PLACE);
      await expect.poll(() => none.container.querySelectorAll(".weather-days > li").length).toBe(2);
      expect(none.container.querySelector(".weather-starts")).toBeNull();
    });
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
    const link = screen.getByRole("link", { name: `Open-Meteo.com ${fr.share.newTab}` });
    await expect.element(link).toBeVisible();
    expect(link.element().getAttribute("href")).toBe("https://open-meteo.com/");
    expect(link.element().getAttribute("rel")).toContain("noopener");
    expect(plain(link.element().parentElement?.textContent)).toBe(
      "Données : Open-Meteo.com (nouvel onglet) (CC BY 4.0)",
    );
  });

  test("WeatherSection — « lieu : GeoNames » pour un lieu géocodé", async () => {
    const geocoded = await renderSection(FOUND_PLACE);
    await expect.element(geocoded.getByText(/ · lieu : GeoNames$/)).toBeVisible();
    await geocoded.unmount();

    const track = await renderSection(FOUND_TRACK);
    await expect
      .element(track.getByRole("link", { name: `Open-Meteo.com ${fr.share.newTab}` }))
      .toBeVisible();
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
    // The query tries once more by itself (an outage is not waited out three times), then the button asks again.
    expect(mocks.send).toHaveBeenCalledTimes(3);
    // The page was never left on the <body>: the title took the focus as the button was tapped.
    expect(document.activeElement).not.toBe(document.body);
  });

  test("WeatherSection — chargement", async () => {
    const screen = await renderSection("pending");
    await expect.element(title()).toBeVisible();
    await expect.element(screen.getByText("Chargement de la météo…")).toBeVisible();
  });

  test("WeatherSection — avant J-7, une ligne dit à partir de quand, sans requête", async () => {
    // The race is on 13 June: the window opens on 6 June.
    const screen = await renderSection(FOUND_PLACE, { today: "2026-06-05" });
    await expect.element(title()).toBeVisible();
    await expect.element(screen.getByText(fr.weather.notYet("sam. 6 juin"))).toBeVisible();
    expect(fr.weather.notYet("sam. 6 juin")).toBe(
      "La météo sera là à partir du sam. 6 juin, une semaine avant la course.",
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });

  test("WeatherSection — avant J-7, en anglais", async () => {
    const screen = await renderSection(FOUND_PLACE, { today: "2026-06-05", languages: ["en"] });
    await expect
      .element(
        screen.getByText("The forecast will be here from Sat, Jun 6, a week before the race."),
      )
      .toBeVisible();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  test("WeatherSection — une course au mois : une ligne, sans requête", async () => {
    const record = { ...eventRecord, date_precision: "month" };
    const screen = await renderSection({ status: "no_day" }, { record });
    await expect.element(title()).toBeVisible();
    await expect
      .element(screen.getByText("La météo viendra quand le jour de la course sera connu."))
      .toBeVisible();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  test("WeatherSection — après la course, rien du tout, sans requête", async () => {
    const screen = await renderSection({ status: "over" }, { today: "2026-06-15" });
    await expect.element(title()).not.toBeInTheDocument();
    expect(screen.container.textContent).toBe("");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  test("WeatherSection — si le serveur dit « over », rien; s'il dit « not_yet », sa date", async () => {
    // The clocks of the page and of the server can differ by a moment.
    const over = await renderSection({ status: "over" });
    await expect.poll(() => mocks.send.mock.calls.length).toBeGreaterThan(0);
    await expect.element(title()).not.toBeInTheDocument();
    await over.unmount();
    mocks.send.mockReset();
    const early = await renderSection({ status: "not_yet", from: "2026-06-09" });
    await expect.element(early.getByText(fr.weather.notYet("mar. 9 juin"))).toBeVisible();
  });
});
