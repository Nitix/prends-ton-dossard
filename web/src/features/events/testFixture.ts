// The events of the shared fixture (section 3 of the plan: "Trail des Crêtes",
// "10 km de Lyon"), as the server sends them: the JSON of an `events` request
// with `EVENT_EXPAND`. For the tests of the screens that show events.
//
// The records are plain objects, as `JSON.parse` would give them: PocketBase
// sends `""` and `0` for what is not set. The server chooses the order of what
// it sends, which is neither the order of the days of the formats (F42 before
// F15) nor the order of the names of the participants (Bob before Alice). The
// participations of an event come in a single list, `participations_via_event`,
// and it is `toEventView` that ranges them by format.

const base = { created: "", updated: "", collectionId: "", collectionName: "" };

export const aliceRunner = { ...base, id: "aliceRunner0000", name: "Alice", user: "u-alice" };
export const bobRunner = { ...base, id: "bobRunner000000", name: "Bob", user: "u-bob" };
export const samRunner = { ...base, id: "samRunner000000", name: "Sam", user: "" };
/** Not on the event of the fixture: see `pNinaUndecided`. */
export const ninaRunner = { ...base, id: "ninaRunner00000", name: "Nina", user: "u-nina" };

export const trailType = { ...base, id: "trail0000000000", label: "Trail" };
export const roadType = { ...base, id: "road00000000000", label: "Route" };

/** Alice, confirmed, on F42. */
export const p1 = {
  ...base,
  id: "p1",
  runner: aliceRunner.id,
  event: "event",
  format: "f42",
  status: "registered",
  confirmed: true,
  added_by: aliceRunner.id,
  expand: { runner: aliceRunner, added_by: aliceRunner },
};

/** Bob, added by Alice and not confirmed, on F42. */
export const p2 = {
  ...base,
  id: "p2",
  runner: bobRunner.id,
  event: "event",
  format: "f42",
  status: "interested",
  confirmed: false,
  added_by: aliceRunner.id,
  expand: { runner: bobRunner, added_by: aliceRunner },
};

/** Sam, added by Alice and not confirmed, on F15. */
export const p3 = {
  ...base,
  id: "p3",
  runner: samRunner.id,
  event: "event",
  format: "f15",
  status: "interested",
  confirmed: false,
  added_by: aliceRunner.id,
  expand: { runner: samRunner, added_by: aliceRunner },
};

/** Trail, 42 km, 10 h limit, 2400 m, on the second day. */
export const f42 = {
  ...base,
  id: "f42",
  event: "event",
  name: "",
  race_type: trailType.id,
  distance_km: 42,
  duration_min: 0,
  time_limit_min: 600,
  elevation_gain_m: 2400,
  date: "2026-06-14",
  expand: { race_type: trailType },
};

/** Trail, 15 km, 700 m, no date of its own. */
export const f15 = {
  ...base,
  id: "f15",
  event: "event",
  name: "",
  race_type: trailType.id,
  distance_km: 15,
  duration_min: 0,
  time_limit_min: 0,
  elevation_gain_m: 700,
  date: "",
  expand: { race_type: trailType },
};

export const fLyon = {
  ...base,
  id: "fLyon",
  event: "event2",
  name: "",
  race_type: roadType.id,
  distance_km: 10,
  duration_min: 0,
  time_limit_min: 0,
  elevation_gain_m: 0,
  date: "",
  expand: { race_type: roadType },
};

/** From 13 to 14 June, in Annecy. */
export const eventRecord = {
  ...base,
  id: "event",
  name: "Trail des Crêtes",
  location: "Annecy",
  start_date: "2026-06-13",
  end_date: "2026-06-14",
  registration_url: "",
  notes: "",
  created_by: aliceRunner.id,
  // On purpose in the order of neither the formats nor the names.
  expand: { formats_via_event: [f42, f15], participations_via_event: [p2, p1, p3] },
};

/** On 22 June, in Lyon, a single day. */
export const event2Record = {
  ...base,
  id: "event2",
  name: "10 km de Lyon",
  location: "Lyon",
  start_date: "2026-06-22",
  end_date: "",
  registration_url: "",
  notes: "",
  created_by: bobRunner.id,
  expand: { formats_via_event: [fLyon] },
};

/**
 * Nina, interested in the event with no format chosen yet: added by herself,
 * so confirmed. She is not in `eventRecord`: see `withParticipations`.
 */
export const pNinaUndecided = {
  ...base,
  id: "pNinaUndecided",
  runner: ninaRunner.id,
  event: "event",
  format: "",
  status: "interested",
  confirmed: true,
  added_by: ninaRunner.id,
  expand: { runner: ninaRunner, added_by: ninaRunner },
};

/** A copy of the event whose participations are those it has, then `extra`. */
export function withParticipations<E extends { expand: object }>(event: E, extra: unknown[]) {
  const known =
    "participations_via_event" in event.expand &&
    Array.isArray(event.expand.participations_via_event)
      ? event.expand.participations_via_event
      : [];
  return {
    ...event,
    expand: { ...event.expand, participations_via_event: [...known, ...extra] },
  };
}

/** A copy of the event where the participation `id` has this status (it keeps its place in the list). */
export function withStatus<E extends { expand: object }>(event: E, id: string, status: string) {
  const known =
    "participations_via_event" in event.expand &&
    Array.isArray(event.expand.participations_via_event)
      ? event.expand.participations_via_event
      : [];
  return {
    ...event,
    expand: {
      ...event.expand,
      participations_via_event: known.map((record: { id: string }) =>
        record.id === id ? { ...record, status } : record,
      ),
    },
  };
}
