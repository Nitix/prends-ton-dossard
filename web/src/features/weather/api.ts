import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { pb } from "../../lib/pb";

// The weather of an event, from the route of the server (`GET /api/app/events/{id}/weather`),
// which asks Open-Meteo: the browser never does.

/** A day of race, as the server says it: temperatures in °C, rain in mm, wind in km/h. */
export type WeatherDay = {
  /** `YYYY-MM-DD`: each day says its own date, the list does not start at the first day of the race. */
  date: string;
  /** A WMO weather code. */
  code: number;
  tMin: number;
  tMax: number;
  /** The chance of rain, in percent. */
  rainChance: number;
  rainMm: number;
  windKmh: number;
  gustKmh: number;
};

/**
 * The weather at the start of a format that has a start time, read at the hour of that time
 * (07:30 reads the 07:00 hour): the same units as a day. `format` is what the format is called.
 */
export type WeatherStart = {
  format: string;
  /** `YYYY-MM-DD`: the day of the start, which is one of the days of the list. */
  date: string;
  /** `HH:MM`, Paris time. */
  time: string;
  code: number;
  /** In °C. */
  temp: number;
  rainChance: number;
  rainMm: number;
  windKmh: number;
  gustKmh: number;
};

/** Where the forecast is for: the start of a track (`format` is the race), or a place that was found (`name` and its `detail`). */
export type WeatherPlace = {
  source: "track" | "place";
  name?: string;
  detail?: string;
  format?: string;
};

/**
 * What the server answers. `ok` and `no_place` have a forecast or its reason; `not_yet`
 * (with the first day of the window) and `no_day` (a race known by its month) say when it
 * will be there; after the window (`over`) there is nothing. The page works out the first
 * three cases itself and asks only inside the window.
 */
export type Weather =
  | {
      status: "ok";
      place: WeatherPlace;
      days: WeatherDay[];
      /** The starts of the formats that have a start time, on one of the days; none when no format has. */
      starts?: WeatherStart[];
      fetchedAt: string;
      stale?: boolean;
    }
  | { status: "no_place"; query: string }
  | { status: "not_yet"; from: string }
  | { status: "over" }
  | { status: "no_day" };

const STALE_MS = 30 * 60_000;

/** The weather of an event, kept 30 minutes. Not asked for unless `enabled`: outside the window, the page makes no request. */
export function useWeather(eventId: string, enabled: boolean): UseQueryResult<Weather> {
  return useQuery({
    queryKey: ["weather", eventId],
    queryFn: () =>
      pb.send<Weather>(`/api/app/events/${encodeURIComponent(eventId)}/weather`, { method: "GET" }),
    enabled,
    // An outage of Open-Meteo answers 502 after up to 8 s: one more try, not three (the page says it failed, and has a button).
    retry: 1,
    staleTime: STALE_MS,
  });
}
