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

/** Where the forecast is for: the start of a track (`format` is the race), or a place that was found (`name` and its `detail`). */
export type WeatherPlace = {
  source: "track" | "place";
  name?: string;
  detail?: string;
  format?: string;
};

/**
 * What the server answers. Only `ok` and `no_place` have something to show; before
 * the window (`not_yet`), after it (`over`) and for a race known by its month
 * (`no_day`) there is nothing.
 */
export type Weather =
  | { status: "ok"; place: WeatherPlace; days: WeatherDay[]; fetchedAt: string; stale?: boolean }
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
    staleTime: STALE_MS,
  });
}
