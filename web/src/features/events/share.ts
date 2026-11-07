import type { Messages } from "../../i18n/fr";
import { isMonthOnly } from "../../lib/dates";
import type { Formatters } from "../../lib/format";
import type { EventView } from "./api";
import { eventWhen } from "./eventWhen";
import { formatMeasures } from "./formatName";
import { openingText, registrationState } from "./registration";

/** What separates the measures of a format, and the formats of a race. */
const MEASURES = " · ";
const FORMATS = " ; ";

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
    : eventWhen(view, f, t, "long");
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
      lines.push(openingText(state, f, t, "hero"));
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
