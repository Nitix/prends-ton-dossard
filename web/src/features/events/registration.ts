import type { Messages } from "../../i18n/fr";
import { daysBetween, isUpcoming, parseDate } from "../../lib/dates";
import type { Formatters } from "../../lib/format";
import type { EventRecord } from "../../lib/types";
import type { Opening } from "./opening";

/**
 * The days left before the deadline that a hero counts beside it: a week or
 * less.
 */
export const DAYS_LEFT_SHOWN = 7;

/**
 * Where the registration of an event stands: not open yet (`soon`, with the
 * days left before it opens), opening today (`today`), open until `deadline`,
 * or closed. `time` is the time of the opening, Paris time, "" when it has
 * none; `deadline` of `soon` and `today` is there when the event has one, and
 * `formatIds` are the formats that have this opening (empty: the event's own).
 */
export type RegistrationState =
  | {
      kind: "soon";
      opening: Temporal.PlainDate;
      time: string;
      daysLeft: number;
      formatIds: readonly string[];
      deadline?: Temporal.PlainDate;
    }
  | {
      kind: "today";
      opening: Temporal.PlainDate;
      time: string;
      formatIds: readonly string[];
      deadline?: Temporal.PlainDate;
    }
  | { kind: "open"; deadline: Temporal.PlainDate; daysLeft: number }
  | { kind: "closed" };

/**
 * The state of the registration of an event on the day `today`, given the
 * opening that counts for the person (`opening`, see `shownOpening`; null for
 * none), or null when
 * there is nothing to say: the event has no deadline (the API sends an empty
 * text for that) and no opening to come, or the deadline is over and so is the
 * event.
 *
 * An opening after `today` is `soon`, and on `today` it is `today`, all day
 * (the state is told to the day, not to the hour). Once it has passed, only the
 * deadline counts, as if there were no opening.
 *
 * The day of the deadline one can still register: the registration is open
 * while the deadline is not before `today`, and `daysLeft` is 0 on that day.
 * It is closed when the deadline has passed and the event has not.
 */
export function registrationState(
  event: Pick<EventRecord, "start_date" | "end_date" | "registration_deadline" | "date_precision">,
  opening: Opening | null,
  today: Temporal.PlainDate,
): RegistrationState | null {
  const deadline = event.registration_deadline ? parseDate(event.registration_deadline) : undefined;
  if (opening) {
    const { day, time, formatIds } = opening;
    const order = Temporal.PlainDate.compare(day, today);
    if (order > 0) {
      const soon = {
        kind: "soon",
        opening: day,
        time,
        daysLeft: daysBetween(today, day),
        formatIds,
      } as const;
      return deadline ? { ...soon, deadline } : soon;
    }
    if (order === 0) {
      const now = { kind: "today", opening: day, time, formatIds } as const;
      return deadline ? { ...now, deadline } : now;
    }
  }
  if (!deadline) return null;
  if (Temporal.PlainDate.compare(deadline, today) >= 0) {
    return { kind: "open", deadline, daysLeft: daysBetween(today, deadline) };
  }
  return isUpcoming(event, today) ? { kind: "closed" } : null;
}

/** Where the opening is said: the page's line, the chip of a card, the box of a runner who is interested, the home page. */
export type OpeningForm = "hero" | "card" | "aside" | "todo" | "format";

/** "at 10:00", with the space before it, or nothing when the opening has no time. */
const atTime = (time: string, t: Messages) => (time === "" ? "" : ` ${t.event.openingAt(time)}`);

/**
 * The opening of a registration that is `soon` or `today`, in words, for the
 * place it is said in:
 * - `hero`: "Ouverture des inscriptions le lun. 12 janv. à 10:00", "… aujourd'hui à 10:00";
 * - `card`: "Ouverture le 12 janv. à 10:00" (the day without its weekday), "Ouverture aujourd'hui à 10:00";
 * - `aside`: "Les inscriptions ouvrent le lun. 12 janv. à 10:00.";
 * - `todo`: "ouvre le lun. 12 janv. à 10:00", "ouvre demain à 10:00", "ouvre aujourd'hui à 10:00".
 * - `format`: "Ouverture le mar. 17 nov. à 12:00" (under a format: its name is above).
 * Without a time, the time and its "à" are left out. `names` (the formats that
 * have the opening, "" for the event's) follow the time in parentheses.
 */
export function openingText(
  state: Extract<RegistrationState, { kind: "soon" | "today" }>,
  f: Formatters,
  t: Messages,
  form: OpeningForm,
  names = "",
): string {
  const head = {
    hero: t.event.openingHero,
    card: t.event.openingCard,
    format: t.event.openingCard,
    aside: t.event.openingAside,
    todo: t.event.openingTodo,
  }[form];
  const tomorrow = form === "todo" && state.kind === "soon" && state.daysLeft === 1;
  const day =
    state.kind === "today"
      ? t.event.openingToday
      : tomorrow
        ? f.inDays(1)
        : t.event.openingOnDate(
            form === "card" ? f.dayMonth(state.opening) : f.date(state.opening),
          );
  const named = names === "" ? "" : ` ${t.event.openingNames(names)}`;
  return `${head} ${day}${atTime(state.time, t)}${named}${form === "aside" ? "." : ""}`;
}

/**
 * What is said of the registration, in words (a closed registration is never
 * told by a colour alone): "Inscriptions jusqu'au mer. 10 juin",
 * "Inscriptions closes", or, before it opens, "Ouverture le 12 janv. à 10:00".
 */
export function registrationLabel(
  state: RegistrationState,
  f: Formatters,
  t: Messages,
  names = "",
): string {
  if (state.kind === "soon" || state.kind === "today") {
    return openingText(state, f, t, "card", names);
  }
  return state.kind === "open"
    ? t.event.registrationUntil(f.date(state.deadline))
    : t.event.registrationClosed;
}

/** What separates the deadline from the days left in `deadlineText`. */
const SEPARATOR = " · ";

/**
 * The deadline as a hero says it: `registrationLabel`, and in its last week
 * (`DAYS_LEFT_SHOWN` days or less) the days left after it: "Inscriptions
 * jusqu'au mer. 10 juin · plus que 3 jours". Before the opening, the opening,
 * and the deadline after it: "Ouverture des inscriptions le lun. 12 janv. à
 * 10:00 · jusqu'au dim. 31 mai".
 */
export function deadlineText(
  state: RegistrationState,
  f: Formatters,
  t: Messages,
  names = "",
): string {
  if (state.kind === "soon" || state.kind === "today") {
    const opening = openingText(state, f, t, "hero", names);
    return state.deadline
      ? `${opening}${SEPARATOR}${t.event.openingDeadline(f.date(state.deadline))}`
      : opening;
  }
  const label = registrationLabel(state, f, t, names);
  return state.kind === "open" && state.daysLeft <= DAYS_LEFT_SHOWN
    ? `${label}${SEPARATOR}${t.event.daysLeft(state.daysLeft)}`
    : label;
}
