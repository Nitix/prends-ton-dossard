import type { Messages } from "../../i18n/fr";
import { isMonthOnly } from "../../lib/dates";
import type { Formatters } from "../../lib/format";
import type { EventView } from "./api";
import { formatMeasures } from "./formatName";
import { openingText, registrationState } from "./registration";

/** What separates the measures of a format, and the formats of a race. */
const MEASURES = " · ";
const FORMATS = " ; ";

/**
 * The days of a race that is not known by its month, with the year said once
 * when it can be: « sam. 13 juin 2026 », « Du sam. 13 au dim. 14 juin 2026 »,
 * « Du sam. 30 mai au lun. 1 juin 2026 », and with both years when they differ.
 */
function daysLine(view: EventView, f: Formatters, t: Messages): string {
  const { start, end } = view;
  if (start.equals(end)) return f.dateLong(start);
  const sameYear = start.year === end.year;
  const sameMonth = sameYear && start.month === end.month;
  const from = sameMonth ? f.dateToDay(start) : sameYear ? f.date(start) : f.dateLong(start);
  const range = t.event.dateRange(from, f.dateLong(end));
  return range.charAt(0).toLocaleUpperCase() + range.slice(1);
}

/**
 * The text of a race to send to a friend, in the language of the page, one line
 * per fact the race has: its name; its days (or its month and « date à préciser »)
 * and its place; its formats as the page names them, with their measures; the
 * opening of the registration when it is to come; the deadline; and the address
 * of the race on the site (`appURL`) last. Never who goes: no participant, no
 * comment, no carpool.
 */
export function shareText(
  view: EventView,
  appURL: string,
  today: Temporal.PlainDate,
  f: Formatters,
  t: Messages,
): string {
  const { event, formats, start } = view;
  const when = isMonthOnly(event)
    ? t.share.monthWhen(f.monthTitle(start.toPlainYearMonth()))
    : daysLine(view, f, t);
  const place = event.location?.trim();
  const lines = [event.name, place ? `${when} · ${place}` : when];

  if (formats.length > 0) {
    const list = formats.map(({ format, raceType }) =>
      formatMeasures(format, raceType.label, f, t).join(MEASURES),
    );
    lines.push(t.share.formats(list.join(FORMATS)));
  }

  const state = registrationState(event, today);
  if (state) {
    if (state.kind === "soon" || state.kind === "today") {
      // The text is read later: the day of the opening, never « aujourd'hui ».
      lines.push(openingText({ ...state, kind: "soon", daysLeft: 0 }, f, t, "hero"));
      if (state.deadline) lines.push(t.event.registrationUntil(f.date(state.deadline)));
    } else if (state.kind === "open") {
      lines.push(t.event.registrationUntil(f.date(state.deadline)));
    }
  }

  lines.push(`${appURL}/evenements/${event.id}`);
  return lines.join("\n");
}

/** The link that opens WhatsApp with this text ready to send. */
export function whatsappURL(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
