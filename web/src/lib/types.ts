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

export type RaceTypeRecord = BaseRecord & {
  label: string;
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
