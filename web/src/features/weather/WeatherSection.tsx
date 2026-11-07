import { useId, useRef, type ReactNode } from "react";

import { BlockTitle } from "../../components/BlockTitle";
import {
  CloudIcon,
  CloudSunIcon,
  DrizzleIcon,
  FogIcon,
  RainIcon,
  SnowIcon,
  StormIcon,
  SunIcon,
  UnknownWeatherIcon,
} from "../../components/icons";
import { LoadFailure } from "../../components/LoadFailure";
import { SECTION } from "../../components/section";
import type { Messages } from "../../i18n/fr";
import { useI18n } from "../../i18n/I18nProvider";
import { instantOf, parseDate } from "../../lib/dates";
import type { Formatters } from "../../lib/format";
import { useToday } from "../../lib/useToday";
import type { EventView } from "../events/api";
import { useWeather, type WeatherDay, type WeatherPlace } from "./api";
import { weatherKind, weatherLabel, type WeatherKind } from "./labels";
import { weatherPhase } from "./window";

const OPEN_METEO = "https://open-meteo.com/";

const ICONS: Record<WeatherKind, (props: { className?: string }) => ReactNode> = {
  clear: SunIcon,
  partly: CloudSunIcon,
  overcast: CloudIcon,
  fog: FogIcon,
  drizzle: DrizzleIcon,
  rain: RainIcon,
  snow: SnowIcon,
  storm: StormIcon,
  unknown: UnknownWeatherIcon,
};

/** The line of a day, readable on its own: « sam. 13 juin · Averses · 9 à 17 °C · pluie 60 %, 2 mm · rafales 35 km/h ». */
function dayLine(day: WeatherDay, f: Formatters, t: Messages): string {
  const mm = day.rainMm > 0 && day.rainMm < 0.5 ? t.weather.lessThanOneMm : f.integer(day.rainMm);
  return t.weather.day(
    f.date(parseDate(day.date)),
    weatherLabel(day.code, t),
    f.integer(day.tMin),
    f.integer(day.tMax),
    f.integer(day.rainChance),
    mm,
    f.integer(day.gustKmh),
  );
}

function placeLine(place: WeatherPlace, t: Messages): string {
  return place.source === "track"
    ? t.weather.atTrack(place.format ?? "")
    : t.weather.atPlace(place.name ?? "", place.detail ?? "");
}

/**
 * « Météo prévue » on the page of an event (spec § 10.6): one line per race day,
 * the place the forecast is for, when it was made, and where the data comes from.
 * Outside the window of the weather (from seven days before the race to its last
 * day) there is no request: before it, and for a race known by its month, the
 * section says when the forecast will be there instead of staying silent (the
 * user took the silence for a failure); after it, nothing.
 *
 * The server's list starts at today, not at the first day of the race: each
 * line says its own date.
 */
export function WeatherSection({ view }: { view: EventView }) {
  const { t, f } = useI18n();
  const today = useToday();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const span = weatherPhase(view, today);
  const phase = span.phase;
  const query = useWeather(view.event.id, phase === "now");

  if (phase === "over") return null;
  const weather = phase === "now" ? query.data : undefined;
  // The server's clock can differ from this one by a moment: it says the same as the page would.
  if (weather?.status === "over") return null;

  let body: ReactNode;
  if (phase === "no_day" || weather?.status === "no_day") {
    body = <p className="weather-no-day text-sm text-neutral-700">{t.weather.noDay}</p>;
  } else if (phase === "not_yet" || weather?.status === "not_yet") {
    const from =
      span.phase === "not_yet"
        ? span.from
        : parseDate(weather?.status === "not_yet" ? weather.from : "");
    body = (
      <p className="weather-not-yet text-sm text-neutral-700">{t.weather.notYet(f.date(from))}</p>
    );
  } else if (weather?.status === "ok") {
    const icon = (code: number) => {
      const Icon = ICONS[weatherKind(code)];
      return <Icon className="size-5 shrink-0 text-iris-600" />;
    };
    body = (
      <>
        <ul className="weather-days flex flex-col gap-2">
          {weather.days.map((day) => (
            <li key={day.date} className="weather-day flex items-start gap-2.5">
              <span className="mt-0.5">{icon(day.code)}</span>
              <span>{dayLine(day, f, t)}</span>
            </li>
          ))}
        </ul>
        <p className="weather-place text-sm text-neutral-700">{placeLine(weather.place, t)}</p>
        <p className="weather-time text-sm text-neutral-600">
          {t.weather.forecastAt(f.time(instantOf(weather.fetchedAt)), weather.stale === true)}
        </p>
        <p className="weather-source text-xs text-neutral-600">
          {t.weather.sourceBefore}
          <a
            href={OPEN_METEO}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {t.weather.sourceName}
            <span className="sr-only"> {t.share.newTab}</span>
          </a>
          {t.weather.sourceAfter}
          {weather.place.source === "place" && t.weather.geonames}
        </p>
      </>
    );
  } else if (weather?.status === "no_place") {
    body = <p className="weather-no-place text-sm">{t.weather.noPlace(weather.query)}</p>;
  } else if (query.isError) {
    body = (
      <LoadFailure onRetry={() => query.refetch()} heading={heading} message={t.weather.failed} />
    );
  } else {
    body = <output className="text-sm text-neutral-600">{t.weather.loading}</output>;
  }

  return (
    <section
      aria-labelledby={headingId}
      data-section="weather"
      className={`weather-section flex flex-col gap-3 ${SECTION}`}
    >
      <BlockTitle id={headingId} ref={heading} tabIndex={-1}>
        {t.weather.title}
      </BlockTitle>
      {body}
    </section>
  );
}
