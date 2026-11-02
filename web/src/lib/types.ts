// The records the API sends, as described in section 4 of the design spec.
//
// PocketBase sends an empty optional field as an empty value, not as an
// absent one: `""` for a text, a date or a relation, `0` for a number. The
// optional fields are typed with `?`, but at run time they come as `""` or
// `0`: test them for truthiness, never with `=== undefined`.
//
// Dates are `YYYY-MM-DD` strings (see lib/dates.ts). Date-times (`created`,
// `expires_at`...) are PocketBase's `YYYY-MM-DD HH:MM:SS.sssZ` strings.

// `supporter` comes to cheer without running: the server accepts it on the
// event alone only, with no format, where `interested` is the only other
// status it accepts. The other statuses need a format.
export type Status = "interested" | "registered" | "finished" | "dnf" | "dns" | "supporter";

export type Role = "member" | "admin";

/** The fields every record has. */
type BaseRecord = {
  id: string;
  created: string;
  updated: string;
  collectionId: string;
  collectionName: string;
};

export type UserRecord = BaseRecord & {
  email: string;
  role: Role;
  disabled: boolean;
};

export type RunnerRecord = BaseRecord & {
  name: string;
  /** The account of the runner: empty until the person has one. */
  user?: string;
  /** The name of the photo file, to ask `pb.files.getURL` for: empty without a photo. */
  avatar?: string;
};

/**
 * What a format measures: its distance, its elevation gain, the length of a
 * timed race, the cut-off time. The names are those of the `measures` field of
 * the race types.
 */
export type Measure = "distance" | "elevation" | "duration" | "time_limit";

export type RaceTypeRecord = BaseRecord & {
  label: string;
  /**
   * The measures that the form of a format of this type shows first, the others
   * going into its « Options avancées ». Empty (or missing, before the migration
   * that adds it has run) means all four: use `measuresOf`.
   */
  measures?: Measure[];
};

export type EventRecord = BaseRecord & {
  name: string;
  location: string;
  start_date: string;
  end_date?: string;
  registration_url?: string;
  /** The last day to register, never after the start of the event: empty without a deadline. */
  registration_deadline?: string;
  notes?: string;
  /** The runner of the user who created the event (a `runners` id). */
  created_by: string;
};

export type FormatRecord = BaseRecord & {
  event: string;
  name?: string;
  race_type: string;
  distance_km?: number;
  /** The length of a timed race, in minutes. */
  duration_min?: number;
  /** The cut-off time, in minutes. */
  time_limit_min?: number;
  elevation_gain_m?: number;
  /** The price of the registration, in euros: 0 without a price. */
  price_eur?: number;
  /** The GPX track of the format: the name of the file on the server, empty without one. */
  gpx?: string;
  /** A link to the course on a website (any address: show it only through `webAddress`). */
  route_url?: string;
  /** The day of the format when it differs from the start of its event. */
  date?: string;
};

export type ParticipationRecord = BaseRecord & {
  runner: string;
  /** The event: always set, also when the participation is on a format. */
  event: string;
  /** Empty for a participation on the event alone: "interested, format to choose", or supporter. */
  format?: string;
  status: Status;
  /** The runner of the user who added the participation (a `runners` id). */
  added_by: string;
  /** Whether the runner agrees: computed by the server. */
  confirmed: boolean;
  // The result. The server keeps the time, the rank and the number of people
  // ranked at the status `finished` only, and the note at `finished` and `dnf`:
  // it clears them when the status changes. 0 is "not given".
  /** The final time, in seconds. */
  finish_time_s?: number;
  /** The place in the general ranking. */
  rank?: number;
  /** How many people were ranked. */
  rank_of?: number;
  result_note?: string;
};

export type InvitationKind = "invite" | "reset";

export type InvitationRecord = BaseRecord & {
  runner: string;
  kind: InvitationKind;
  /** The role given on acceptance (`invite` only). */
  role?: Role;
  expires_at: string;
  used_at?: string;
  /** A `users` id: empty when created from the command line. */
  created_by?: string;
};

export type PasskeyRecord = BaseRecord & {
  user: string;
  name: string;
  credential_id: string;
  last_used_at?: string;
};

export type CommentRecord = BaseRecord & {
  event: string;
  /** The runner who wrote it: set by the server, never sent. */
  author: string;
  /** Plain text, 1 to 2000 characters. */
  body: string;
};

export type OfferKind = "ride" | "lodging";

/**
 * Places that a member offers for an event: a car (`ride`) or a lodging. The
 * places do not count the owner: 3 seats in a car are 3 passengers besides
 * the driver. `seats` is 0 for a lodging that does not say how many people it
 * takes (no limit); `time` is `HH:MM`; `end_date` and `url` are for a lodging.
 */
export type OfferRecord = BaseRecord & {
  event: string;
  kind: OfferKind;
  /** The runner who offers the places: set by the server, never sent. */
  owner: string;
  /** Where the car leaves from, or the name or address of the lodging. */
  place: string;
  seats?: number;
  /** The day of the departure of a car, or the arrival at a lodging. */
  date?: string;
  time?: string;
  end_date?: string;
  url?: string;
  notes?: string;
};

/** A place taken in an offer by a runner (the owner is not one). */
export type OfferMemberRecord = BaseRecord & {
  offer: string;
  runner: string;
  /** The runner of the user who placed them: set by the server. */
  added_by: string;
};
