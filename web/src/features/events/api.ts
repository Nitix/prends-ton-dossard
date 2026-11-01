import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { effectiveDate, eventRange } from "../../lib/dates";
import { pb } from "../../lib/pb";
import type {
  EventRecord,
  FormatRecord,
  ParticipationRecord,
  RaceTypeRecord,
  RunnerRecord,
} from "../../lib/types";
import { isOnEvent } from "./participants";

export type { ListSearch } from "./search";

// Events, with everything the screens show of them, in a single request: the
// formats (back-relation of `formats.event`) with their race type, and all the
// participations of the event (back-relation of `participations.event`) with
// the runner and who added them. `toEventView` ranges the participations: by
// format, or, for those with no format, in `interested` or, when they are
// supporters, in `supporters`.

export type ParticipationView = {
  participation: ParticipationRecord;
  runner: RunnerRecord;
  /** Absent when the runner who added the participation is not there any more. */
  addedBy?: RunnerRecord;
};

export type FormatView = {
  format: FormatRecord;
  raceType: RaceTypeRecord;
  /** The day of the format: its own date, or the start of its event. */
  date: Temporal.PlainDate;
  participations: ParticipationView[];
};

export type EventView = {
  event: EventRecord;
  /** In the order of their days, then of their distances. */
  formats: FormatView[];
  /** The participations on the event alone, with the status `interested` ("interested, format to choose"), by runner name. */
  interested: ParticipationView[];
  /** The participations on the event alone, with the status `supporter`, by runner name: they come to cheer, they do not start. */
  supporters: ParticipationView[];
  start: Temporal.PlainDate;
  /** The last day: the same as `start` when the event has no end date. */
  end: Temporal.PlainDate;
};

/** The events to ask for: those that are to come or over, or those that have a day in a range. */
export type EventsQuery =
  | { period: "a-venir" | "passees"; today: Temporal.PlainDate }
  | { from: Temporal.PlainDate; to: Temporal.PlainDate };

/** The `expand` that gives `toEventViews` everything it needs. */
export const EVENT_EXPAND =
  "formats_via_event.race_type,participations_via_event.runner,participations_via_event.added_by";

/**
 * The filter and the sort to give the server for a query. The dates are bound
 * as parameters, never written into the filter.
 *
 * - `a-venir`: the event is not over, that is it starts today or later, or it
 *   ends today or later;
 * - `passees`: the opposite, with no end date counting as the start date;
 * - a range: it starts before the range ends, and it ends after the range
 *   starts (a single day has no end date, hence the start date alternative).
 */
export function eventsFilter(q: EventsQuery): { filter: string; sort: string } {
  if ("period" in q) {
    const params = { t: q.today.toString() };
    return q.period === "a-venir"
      ? { filter: pb.filter("start_date >= {:t} || end_date >= {:t}", params), sort: "start_date" }
      : {
          filter: pb.filter('start_date < {:t} && (end_date = "" || end_date < {:t})', params),
          sort: "-start_date",
        };
  }
  return {
    filter: pb.filter("start_date <= {:to} && (end_date >= {:from} || start_date >= {:from})", {
      from: q.from.toString(),
      to: q.to.toString(),
    }),
    sort: "start_date",
  };
}

// What the server sends for EVENT_EXPAND. An expand that is empty is left
// out of the record, hence all the `?`.
type ExpandedParticipation = ParticipationRecord & {
  expand?: { runner?: RunnerRecord; added_by?: RunnerRecord };
};
type ExpandedFormat = FormatRecord & {
  expand?: { race_type?: RaceTypeRecord };
};
type ExpandedEvent = EventRecord & {
  expand?: {
    formats_via_event?: ExpandedFormat[];
    participations_via_event?: ExpandedParticipation[];
  };
};

/** A participation with its `runner` and `added_by` expanded: the runner has to be there. */
export function toParticipationView(record: ExpandedParticipation): ParticipationView {
  const runner = record.expand?.runner;
  if (!runner) throw new Error(`participation ${record.id}: its runner is missing from the answer`);
  return { participation: record, runner, addedBy: record.expand?.added_by };
}

function byRunnerName(a: ParticipationView, b: ParticipationView): number {
  return a.runner.name.localeCompare(b.runner.name);
}

function toFormatView(
  record: ExpandedFormat,
  event: EventRecord,
  participations: ExpandedParticipation[],
): FormatView {
  const raceType = record.expand?.race_type;
  if (!raceType) throw new Error(`format ${record.id}: its race_type is missing from the answer`);
  return {
    format: record,
    raceType,
    date: effectiveDate(record, event),
    participations: participations.map(toParticipationView).toSorted(byRunnerName),
  };
}

/** Earlier days first, then shorter distances; a timed race has no distance and comes last. */
function compareFormats(a: FormatView, b: FormatView): number {
  const byDate = Temporal.PlainDate.compare(a.date, b.date);
  if (byDate !== 0) return byDate;
  const distanceA = a.format.distance_km || Infinity;
  const distanceB = b.format.distance_km || Infinity;
  if (distanceA !== distanceB) return distanceA < distanceB ? -1 : 1;
  return a.format.id.localeCompare(b.format.id);
}

function isEvent(record: unknown): record is ExpandedEvent {
  return (
    typeof record === "object" &&
    record !== null &&
    "id" in record &&
    typeof record.id === "string" &&
    "start_date" in record &&
    typeof record.start_date === "string"
  );
}

/**
 * One event of the answer to a request made with `EVENT_EXPAND`. The shape
 * is the server's contract: a record without something that has to be there
 * (the race type of a format, the runner of a participation) throws, and so
 * does a participation on a format that is not one of the event's.
 */
export function toEventView(event: unknown): EventView {
  if (!isEvent(event)) throw new TypeError("not an event record");
  const formatRecords = event.expand?.formats_via_event ?? [];

  // The participations come in a single list: each goes to its format, or to
  // the event alone when it has none.
  const onFormat = new Map<string, ExpandedParticipation[]>(
    formatRecords.map(({ id }) => [id, []]),
  );
  const interested: ExpandedParticipation[] = [];
  const supporters: ExpandedParticipation[] = [];
  for (const record of event.expand?.participations_via_event ?? []) {
    if (!record.format) {
      (record.status === "supporter" ? supporters : interested).push(record);
      continue;
    }
    const list = onFormat.get(record.format);
    if (!list) {
      throw new Error(
        `participation ${record.id}: its format ${record.format} is not one of the formats of the event`,
      );
    }
    list.push(record);
  }

  return {
    event,
    formats: formatRecords
      .map((format) => toFormatView(format, event, onFormat.get(format.id) ?? []))
      .toSorted(compareFormats),
    interested: interested.map(toParticipationView).toSorted(byRunnerName),
    supporters: supporters.map(toParticipationView).toSorted(byRunnerName),
    ...eventRange(event),
  };
}

/** The events of the answer, in the order the server gave them. */
export function toEventViews(records: unknown[]): EventView[] {
  return records.map(toEventView);
}

/**
 * The events that start first come first (`desc`: last), and on the same day
 * they go by name. The input is left alone.
 */
export function sortEvents(views: EventView[], direction: "asc" | "desc"): EventView[] {
  const sign = direction === "asc" ? 1 : -1;
  return views.toSorted(
    (a, b) =>
      sign * Temporal.PlainDate.compare(a.start, b.start) ||
      a.event.name.localeCompare(b.event.name) ||
      a.event.id.localeCompare(b.event.id),
  );
}

/**
 * Keeps the events the criteria let through; an empty criterion lets
 * everything through.
 * - `personne`: a runner id; the event has a participation of this runner that
 *   is not "not starting" (`isOnEvent`), on a format or on the event alone;
 * - `type`: a race type id; the event has a format of this type.
 *
 * `moi` is not understood here: whoever reads it from the URL resolves it to
 * the runner first (see `useFilterCriteria`).
 */
export function applyFilters(
  views: EventView[],
  criteria: { personne?: string; type?: string },
): EventView[] {
  const { personne, type } = criteria;
  return views.filter(
    (view) =>
      (!personne || isOnEvent(view, personne)) &&
      (!type || view.formats.some(({ raceType }) => raceType.id === type)),
  );
}

export function useEvents(q: EventsQuery): UseQueryResult<EventView[]> {
  return useQuery({
    queryKey: ["events", q],
    queryFn: async () =>
      toEventViews(
        await pb.collection("events").getFullList({ ...eventsFilter(q), expand: EVENT_EXPAND }),
      ),
  });
}

export function useEvent(id: string): UseQueryResult<EventView> {
  return useQuery({
    queryKey: ["event", id],
    queryFn: async () =>
      toEventView(await pb.collection("events").getOne(id, { expand: EVENT_EXPAND })),
  });
}

// The two lists that the filters and the forms choose from. Everybody may read
// them, and they hardly ever change, so they are fetched once in a while.

const LOOKUP_STALE_MS = 5 * 60_000;

export function useRunners(): UseQueryResult<RunnerRecord[]> {
  return useQuery({
    queryKey: ["runners"],
    queryFn: async () => {
      const runners = await pb.collection("runners").getFullList<RunnerRecord>();
      return runners.toSorted((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: LOOKUP_STALE_MS,
  });
}

export function useRaceTypes(): UseQueryResult<RaceTypeRecord[]> {
  return useQuery({
    queryKey: ["race_types"],
    queryFn: async () => {
      const raceTypes = await pb.collection("race_types").getFullList<RaceTypeRecord>();
      return raceTypes.toSorted((a, b) => a.label.localeCompare(b.label));
    },
    staleTime: LOOKUP_STALE_MS,
  });
}

/**
 * Makes everything that shows an event ask for it again, after a change of the
 * event, of its formats or of its participations: the lists (`["events"]`),
 * the page of the event, and the participations the user has to confirm
 * (`["pending"]`). It resolves once the queries that are on screen have their
 * new data.
 */
export async function invalidateEvents(queryClient: QueryClient, eventId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["events"] }),
    queryClient.invalidateQueries({ queryKey: ["event", eventId] }),
    queryClient.invalidateQueries({ queryKey: ["pending"] }),
  ]);
}

/**
 * Deletes an event; the server deletes its formats and their participations
 * with it, and its comments and offers. Only the lists are out of date
 * afterwards, the comments and the offers of all the events included (the home
 * page lists the latest comments): the page of the event is not asked for
 * again (it would answer "not found"), whoever calls this leaves it and then
 * `removeQueries` it.
 */
export function useDeleteEvent(eventId: string): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await pb.collection("events").delete(eventId);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["events"] }),
        queryClient.invalidateQueries({ queryKey: ["pending"] }),
        queryClient.invalidateQueries({ queryKey: ["comments"] }),
        queryClient.invalidateQueries({ queryKey: ["offers"] }),
      ]);
    },
  });
}
