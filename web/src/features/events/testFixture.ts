// The events of the shared fixture (section 3 of the plan: "Trail des Crêtes",
// "10 km de Lyon"), as the server sends them: the JSON of an `events` request
// with `EVENT_EXPAND`. For the tests of the screens that show events.
//
// The records are plain objects, as `JSON.parse` would give them: PocketBase
// sends `""` and `0` for what is not set. The formats come in an order the
// server may choose, which is not the order of their days: F42 before F15, and
// Bob before Alice.

const base = { created: "", updated: "", collectionId: "", collectionName: "" };

export const aliceRunner = { ...base, id: "aliceRunner0000", name: "Alice", user: "u-alice" };
export const bobRunner = { ...base, id: "bobRunner000000", name: "Bob", user: "u-bob" };
export const samRunner = { ...base, id: "samRunner000000", name: "Sam", user: "" };

export const trailType = { ...base, id: "trail0000000000", label: "Trail" };
export const roadType = { ...base, id: "road00000000000", label: "Route" };

/** Alice, confirmed, on F42. */
export const p1 = {
  ...base,
  id: "p1",
  runner: aliceRunner.id,
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
  expand: { race_type: trailType, participations_via_format: [p2, p1] },
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
  expand: { race_type: trailType, participations_via_format: [p3] },
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
  expand: { race_type: roadType, participations_via_format: [] },
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
  expand: { formats_via_event: [f42, f15] },
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
