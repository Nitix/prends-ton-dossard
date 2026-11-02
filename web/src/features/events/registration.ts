import type { Messages } from "../../i18n/fr";
import { daysBetween, isUpcoming, parseDate } from "../../lib/dates";
import type { Formatters } from "../../lib/format";
import type { EventRecord } from "../../lib/types";

/**
 * The days left before the deadline that a hero counts beside it: a week or
 * less (Crête's hero, and a skin's variant of it, say them alike).
 */
export const DAYS_LEFT_SHOWN = 7;

/**
 * Where the registration of an event stands: still open until `deadline`, or
 * closed.
 */
export type RegistrationState =
  | { kind: "open"; deadline: Temporal.PlainDate; daysLeft: number }
  | { kind: "closed" };

/**
 * The state of the registration of an event on the day `today`, or null when
 * there is nothing to say: the event has no deadline (the API sends an empty
 * text for that), or the deadline is over and so is the event.
 *
 * The day of the deadline one can still register: the registration is open
 * while the deadline is not before `today`, and `daysLeft` is 0 on that day.
 * It is closed when the deadline has passed and the event has not.
 */
export function registrationState(
  event: Pick<EventRecord, "start_date" | "end_date" | "registration_deadline">,
  today: Temporal.PlainDate,
): RegistrationState | null {
  if (!event.registration_deadline) return null;
  const deadline = parseDate(event.registration_deadline);
  if (Temporal.PlainDate.compare(deadline, today) >= 0) {
    return { kind: "open", deadline, daysLeft: daysBetween(today, deadline) };
  }
  return isUpcoming(event, today) ? { kind: "closed" } : null;
}

/**
 * What is said of the registration, in words (a closed registration is never
 * told by a colour alone): "Inscriptions jusqu'au mer. 10 juin", or
 * "Inscriptions closes".
 */
export function registrationLabel(state: RegistrationState, f: Formatters, t: Messages): string {
  return state.kind === "open"
    ? t.event.registrationUntil(f.date(state.deadline))
    : t.event.registrationClosed;
}
