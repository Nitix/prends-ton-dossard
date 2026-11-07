import type { Lang } from "../../i18n/detect";
import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { PARIS } from "../../lib/dates";
import type { EventView } from "../events/api";

// The calendar file of one event, made in the browser for a calendar app to
// import. It is written by the rules of the feed that the server makes of the
// races of a member (server/calendar/feed.go), which are the ones of RFC 5545:
// CRLF at the end of every line, the text values escaped, the control characters
// dropped, the lines folded at 75 octets without cutting a character, and whole
// days (`VALUE=DATE`), the end of which is the day after the last one.

/** The longest line of an iCalendar file, the line break not counted (RFC 5545, 3.1). */
const MAX_LINE_OCTETS = 75;

/**
 * How long the address of the file lives once the click has been made: the
 * browser reads it when it starts the download, not when it is clicked, and
 * some of them lose it if it is revoked at once.
 */
const REVOKE_AFTER_MS = 1000;

/** How long the opening of the registration lasts in a calendar, when it has a time. */
const OPENING_MINUTES = 30;

/** The UID of the opening of the registration of an event: its own, beside the event's. */
const openingUid = (eventId: string) => `opening-${eventId}@prends-ton-dossard`;

/** The UID of the event in a calendar: the same each time the file is downloaded, so that an app that imports it again does not add it twice. */
const uid = (eventId: string) => `event-${eventId}@prends-ton-dossard`;

/**
 * What a file can hold of a text: half of a pair of surrogates cannot be written
 * in UTF-8, so it becomes U+FFFD, and the control characters (C0 and DEL) are
 * dropped, except the ones of `keep`: a calendar app refuses a file that has
 * one, or the control character ends the line.
 */
function printable(value: string, keep: string): string {
  let clean = "";
  for (const character of value.toWellFormed()) {
    const code = character.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code !== 0x7f) || keep.includes(character)) clean += character;
  }
  return clean;
}

const TEXT_ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\\\",
  ";": "\\;",
  ",": "\\,",
  "\n": "\\n",
};

/**
 * A value of type TEXT, as it is written (RFC 5545, 3.3.11): cleaned, except
 * for the tab and the line break, which a text may hold (a CR is not a line
 * break), then the backslash, the semicolon, the comma and the line break are
 * escaped: the line break becomes the two characters `\n`.
 */
function textValue(value: string): string {
  return printable(value, "\t\n").replace(
    /[\\;,\n]/g,
    (character) => TEXT_ESCAPES[character] ?? character,
  );
}

/**
 * A value of type URI, as it is written. It is not escaped (its commas and
 * semicolons stay as they are), and holds no control character at all, so that
 * no line break can start a property of its own.
 */
function uriValue(value: string): string {
  return printable(value, "");
}

/** The number of octets of a character in UTF-8. */
function octetsOf(character: string): number {
  const code = character.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  return code < 0x10000 ? 3 : 4;
}

/**
 * Cuts a content line into lines of at most 75 octets, each one after the first
 * starting with the space that marks it as a continuation, which counts in its
 * length (RFC 5545, 3.1). It never cuts a character in two.
 */
function fold(line: string): string {
  const pieces: string[] = [];
  let piece = "";
  let octets = 0;
  let limit = MAX_LINE_OCTETS;
  for (const character of line) {
    const size = octetsOf(character);
    if (octets + size > limit) {
      pieces.push(piece);
      piece = "";
      octets = 0;
      limit = MAX_LINE_OCTETS - 1;
    }
    piece += character;
    octets += size;
  }
  pieces.push(piece);
  return pieces.join("\r\n ");
}

/** A day as the DATE value of iCalendar: `20260613`. */
function dateValue(day: Temporal.PlainDate): string {
  return day.toString().replaceAll("-", "");
}

/** An instant in UTC, as iCalendar has it (RFC 5545, 3.3.5): `20261101T093015Z`, the seconds cut where they are. */
function stampValue(instant: Temporal.Instant): string {
  return instant.toString({ smallestUnit: "second" }).replaceAll(/[-:]/g, "");
}

/**
 * The iCalendar file of an event: one `VEVENT` on its days, with its place and
 * the address of its page on the site at `appURL`, as of the moment `now`,
 * which is its `DTSTAMP`. An empty place is left out. `lang` is the language
 * of the site, which the `PRODID` says (`FR` or `EN`), as the feed of the
 * server does, and the one of the title of the opening.
 *
 * An event with an opening of its registration has a second `VEVENT` for it:
 * with a time, thirty minutes in UTC (the time is Paris time, so the instant
 * moves with summer time); without, the whole day.
 */
export function eventIcs(
  view: EventView,
  appURL: string,
  now: Temporal.Instant,
  lang: Lang,
): string {
  const { event, start, end } = view;
  const address = `${appURL}/evenements/${event.id}`;
  const lines: string[] = [];
  const line = (name: string, value: string) => {
    lines.push(`${fold(`${name}:${value}`)}\r\n`);
  };
  const optional = (name: string, value: string) => {
    if (value !== "") line(name, value);
  };

  line("BEGIN", "VCALENDAR");
  line("VERSION", "2.0");
  line("PRODID", `-//Prends ton dossard//${lang.toUpperCase()}`);
  line("CALSCALE", "GREGORIAN");
  line("BEGIN", "VEVENT");
  line("UID", textValue(uid(event.id)));
  line("DTSTAMP", stampValue(now));
  line("DTSTART;VALUE=DATE", dateValue(start));
  // The end of an event of whole days is exclusive.
  line("DTEND;VALUE=DATE", dateValue(end.add({ days: 1 })));
  line("SUMMARY", textValue(event.name));
  optional("DESCRIPTION", textValue(address));
  optional("LOCATION", textValue(event.location));
  optional("URL", uriValue(address));
  line("END", "VEVENT");
  if (event.registration_opening) {
    const day = Temporal.PlainDate.from(event.registration_opening);
    const time = event.registration_opening_time ?? "";
    line("BEGIN", "VEVENT");
    line("UID", textValue(openingUid(event.id)));
    line("DTSTAMP", stampValue(now));
    if (time === "") {
      line("DTSTART;VALUE=DATE", dateValue(day));
      line("DTEND;VALUE=DATE", dateValue(day.add({ days: 1 })));
    } else {
      const starts = day.toZonedDateTime({ timeZone: PARIS, plainTime: time }).toInstant();
      line("DTSTART", stampValue(starts));
      line("DTEND", stampValue(starts.add({ minutes: OPENING_MINUTES })));
    }
    const title = (lang === "fr" ? fr : en).event.openingCalendarTitle(event.name);
    line("SUMMARY", textValue(title));
    optional("DESCRIPTION", textValue(address));
    optional("URL", uriValue(address));
    line("END", "VEVENT");
  }
  line("END", "VCALENDAR");
  return lines.join("");
}

/**
 * The name of the file of an event: its name, without the characters that a
 * file name cannot have (`\ / : * ? " < > |` and the control characters), the
 * runs of spaces made one and the ends trimmed, then `.ics`. `fallback` is the
 * name when nothing is left of the event's.
 */
export function icsFileName(eventName: string, fallback: string): string {
  const name = eventName
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${name === "" ? fallback : name}.ics`;
}

/**
 * Saves the calendar file of the event: the browser is handed a file made on
 * the spot, through a link that is clicked and let go. `fallbackName` names the
 * file when the name of the event gives nothing (see `icsFileName`), and `lang`
 * is the language of the site (see `eventIcs`).
 */
export function downloadEventIcs(view: EventView, fallbackName: string, lang: Lang): void {
  const ics = eventIcs(view, location.origin, Temporal.Now.instant(), lang);
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = icsFileName(view.event.name, fallbackName);
  // Some browsers only follow a link that is in the page.
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_AFTER_MS);
}
