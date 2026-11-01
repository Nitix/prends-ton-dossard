// The records the API sends, as described in section 4 of the design spec.
//
// PocketBase sends an empty optional field as an empty value, not as an
// absent one: `""` for a text, a date or a relation, `0` for a number. The
// optional fields are typed with `?`, but at run time they come as `""` or
// `0`: test them for truthiness, never with `=== undefined`.
//
// Dates are `YYYY-MM-DD` strings (see lib/dates.ts). Date-times (`created`,
// `expires_at`...) are PocketBase's `YYYY-MM-DD HH:MM:SS.sssZ` strings.

export type Status = "interested" | "registered" | "finished" | "dnf" | "dns";

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
  /** The day of the format when it differs from the start of its event. */
  date?: string;
};

export type ParticipationRecord = BaseRecord & {
  runner: string;
  /** The event: always set, also when the participation is on a format. */
  event: string;
  /** Empty for an "interested, format to choose" participation. */
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
