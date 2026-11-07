import { describe, expect, test } from "vitest";

import type { Reminder } from "../../lib/types";
import { toEventView } from "../events/api";
import { event2Record, eventRecord } from "../events/testFixture";
import { eventIcs, icsFileName } from "./eventIcs";

const APP_URL = "https://courses.example.test";

/** The clock of the tests: DTSTAMP is the only line that comes from it. */
const now = () => Temporal.Instant.from("2026-11-01T09:30:15Z");

/** The view of an event, with some of its fields changed. */
function viewOf(changes: Record<string, unknown> = {}, record: object = eventRecord) {
  return toEventView({ ...record, ...changes });
}

/** The lines of a file, checking on the way that each ends with CRLF and nothing else does. */
function lines(ics: string): string[] {
  expect(ics.endsWith("\r\n")).toBe(true);
  const parts = ics.slice(0, -2).split("\r\n");
  for (const part of parts) expect(part).not.toMatch(/[\r\n]/);
  return parts;
}

/** The content lines: a line that starts with a space continues the one before it (RFC 5545, 3.1). */
function unfold(ics: string): string[] {
  return ics.replaceAll("\r\n ", "").slice(0, -2).split("\r\n");
}

/** The DTSTAMP of the file of an event, made at that instant. */
function stamp(instant: string): string | undefined {
  return properties(eventIcs(viewOf(), APP_URL, Temporal.Instant.from(instant), "fr")).DTSTAMP;
}

/** The value of each property of the event, by name, after unfolding. */
function properties(ics: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const line of unfold(ics)) {
    const colon = line.indexOf(":");
    found[line.slice(0, colon)] = line.slice(colon + 1);
  }
  return found;
}

describe("eventIcs", () => {
  test("eventIcs — un VEVENT sur les jours de l'événement, avec son adresse", () => {
    const ics = eventIcs(viewOf(), APP_URL, now(), "fr");

    // The event runs on the 13th and the 14th: the end is the day after, since
    // the end of an event of whole days is exclusive.
    expect(ics).toBe(
      "BEGIN:VCALENDAR\r\n" +
        "VERSION:2.0\r\n" +
        "PRODID:-//Prends ton dossard//FR\r\n" +
        "CALSCALE:GREGORIAN\r\n" +
        "BEGIN:VEVENT\r\n" +
        "UID:event-event@prends-ton-dossard\r\n" +
        "DTSTAMP:20261101T093015Z\r\n" +
        "DTSTART;VALUE=DATE:20260613\r\n" +
        "DTEND;VALUE=DATE:20260615\r\n" +
        "SUMMARY:Trail des Crêtes\r\n" +
        "DESCRIPTION:https://courses.example.test/evenements/event\r\n" +
        "LOCATION:Annecy\r\n" +
        "URL:https://courses.example.test/evenements/event\r\n" +
        "END:VEVENT\r\n" +
        "END:VCALENDAR\r\n",
    );
  });

  test("eventIcs — la langue est celle du PRODID : FR ou EN, comme dans le flux du serveur", () => {
    expect(properties(eventIcs(viewOf(), APP_URL, now(), "fr")).PRODID).toBe(
      "-//Prends ton dossard//FR",
    );
    const english = eventIcs(viewOf(), APP_URL, now(), "en");
    expect(properties(english).PRODID).toBe("-//Prends ton dossard//EN");
    // Nothing else depends on the language: the texts are the event's own.
    expect(english.replace("//EN", "//FR")).toBe(eventIcs(viewOf(), APP_URL, now(), "fr"));
  });

  test("eventIcs — un événement d'un jour s'arrête le lendemain, même au passage d'une année", () => {
    // No end date: one day, which ends on the next.
    const oneDay = properties(eventIcs(viewOf({}, event2Record), APP_URL, now(), "fr"));
    expect(oneDay["DTSTART;VALUE=DATE"]).toBe("20260622");
    expect(oneDay["DTEND;VALUE=DATE"]).toBe("20260623");
    expect(oneDay.SUMMARY).toBe("10 km de Lyon");
    expect(oneDay.UID).toBe("event-event2@prends-ton-dossard");
    expect(oneDay.URL).toBe("https://courses.example.test/evenements/event2");

    const overTheYear = properties(
      eventIcs(viewOf({ start_date: "2026-12-30", end_date: "2026-12-31" }), APP_URL, now(), "fr"),
    );
    expect(overTheYear["DTSTART;VALUE=DATE"]).toBe("20261230");
    expect(overTheYear["DTEND;VALUE=DATE"]).toBe("20270101");
  });

  test("eventIcs — le DTSTAMP est l'instant en UTC, les fractions de seconde coupées", () => {
    expect(stamp("2026-07-01T00:30:15Z")).toBe("20260701T003015Z");
    expect(stamp("2026-11-01T23:59:59.999Z")).toBe("20261101T235959Z");
  });

  test("eventIcs — sans lieu, pas de LOCATION", () => {
    const ics = eventIcs(viewOf({ location: "" }), APP_URL, now(), "fr");

    expect(ics).not.toContain("LOCATION");
    // The rest is still there.
    expect(properties(ics).SUMMARY).toBe("Trail des Crêtes");
  });

  test("eventIcs — échappement et repli", () => {
    const ics = eventIcs(
      viewOf({
        name: `Course, des; "Crêtes" \\ 10 km`,
        location: "Annecy, Haute-Savoie; France\r\nParking\nnord",
      }),
      APP_URL,
      now(),
      "fr",
    );

    // A comma, a semicolon, a backslash and a line break would split the value
    // or the line: they are escaped, and a line break becomes two characters.
    const found = properties(ics);
    expect(found.SUMMARY).toBe(`Course\\, des\\; "Crêtes" \\\\ 10 km`);
    expect(found.LOCATION).toBe("Annecy\\, Haute-Savoie\\; France\\nParking\\nnord");
    // Only CRLF ends a line, and the file stays one calendar with one event.
    lines(ics);
    expect(unfold(ics).filter((line) => line.startsWith("BEGIN:VEVENT"))).toHaveLength(1);
  });

  test("eventIcs — une ligne longue est repliée à 75 octets, sans couper un caractère", () => {
    // 'é' is 2 octets, '·' 2, '🏃' 4 (a pair of UTF-16 units) and the space 1: the
    // cut falls at several places of the title, inside a character if it is not careful.
    const name = `Trail des Crêtes ${"é·🏃 ".repeat(40)}fin`;
    const ics = eventIcs(viewOf({ name }), APP_URL, now(), "fr");

    const encoder = new TextEncoder();
    const physical = lines(ics);
    for (const line of physical) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    // The title took several lines, each one after the first starting with a space.
    const title = physical.findIndex((line) => line.startsWith("SUMMARY:"));
    expect(physical[title + 1]).toMatch(/^ /);
    // Unfolded, nothing is lost or cut in two (a cut character would be U+FFFD).
    expect(properties(ics).SUMMARY).toBe(name);
    expect(ics).not.toContain("�");
  });

  test("eventIcs — une ligne de 75 octets pile n'est pas repliée, une de 76 l'est", () => {
    // "SUMMARY:" is 8 octets: 67 more make 75.
    const name = "x".repeat(67);
    const ics = eventIcs(viewOf({ name }), APP_URL, now(), "fr");

    expect(lines(ics)).toContain(`SUMMARY:${name}`);
    expect(properties(ics).SUMMARY).toBe(name);

    // One octet too many: the last character goes to a line of its own.
    const longer = eventIcs(viewOf({ name: `${name}y` }), APP_URL, now(), "fr");
    expect(lines(longer)).toContain(`SUMMARY:${name}`);
    expect(lines(longer)).toContain(" y");
    expect(properties(longer).SUMMARY).toBe(`${name}y`);
  });

  test("eventIcs — aucun caractère de contrôle ne passe, hors la tabulation d'un texte", () => {
    // As in the feed of the server: a control character is refused by the
    // calendar apps, or ends the line, and a CR alone is not a line break.
    const ics = eventIcs(
      viewOf({ name: "a\u0000b\u0007c\u007Fd\te\rf", location: "g\u001Bh" }),
      APP_URL,
      now(),
      "fr",
    );

    const found = properties(ics);
    expect(found.SUMMARY).toBe("abcd\tef");
    expect(found.LOCATION).toBe("gh");
    // Without its CRLFs, the file has no control character but that tab.
    const controls = Array.from(ics.replaceAll("\r\n", "")).filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (code < 0x20 && character !== "\t") || code === 0x7f;
    });
    expect(controls).toEqual([]);
  });

  test("eventIcs — l'adresse ne peut pas ouvrir une propriété de plus, ni garder une tabulation", () => {
    // The URL of the page is a value that is not escaped: a line break in the
    // address of the site would start a line of its own.
    const ics = eventIcs(viewOf(), "https://courses.example.test\t\r\nATTENDEE:evil", now(), "fr");

    expect(unfold(ics).some((line) => line.startsWith("ATTENDEE"))).toBe(false);
    expect(properties(ics).URL).toBe("https://courses.example.testATTENDEE:evil/evenements/event");
  });

  test("eventIcs — la moitié d'une paire de substitution devient U+FFFD, comme un octet de travers côté serveur", () => {
    const ics = eventIcs(viewOf({ name: "Trail \uD83C" }), APP_URL, now(), "fr");

    expect(properties(ics).SUMMARY).toBe("Trail �");
  });
});

describe("icsFileName", () => {
  test("icsFileName — le nom de l'événement, suivi de .ics", () => {
    expect(icsFileName("Trail des Crêtes", "evenement")).toBe("Trail des Crêtes.ics");
  });

  test("icsFileName — sans les caractères interdits dans un nom de fichier, les espaces réunis", () => {
    expect(
      icsFileName('  10 km: Lyon / Villeurbanne ?  "Les <Gones>" | *Run*\\1 ', "evenement"),
    ).toBe("10 km Lyon Villeurbanne Les Gones Run1.ics");
    // The control characters go too, tabs and line breaks included.
    expect(icsFileName("Trail\u0000 des\tCrêtes\n", "evenement")).toBe("Trail desCrêtes.ics");
  });

  test("icsFileName — un nom dont il ne reste rien prend le nom de repli", () => {
    expect(icsFileName("", "evenement")).toBe("evenement.ics");
    expect(icsFileName(' / : * ? " < > | \\ ', "event")).toBe("event.ics");
  });
});

/** The properties of each VEVENT of the file, by name. */
function events(ics: string): Record<string, string>[] {
  return ics
    .split("BEGIN:VEVENT\r\n")
    .slice(1)
    .map((part) => properties(part.split("END:VEVENT")[0] ?? ""));
}

/** The alarms of the event that has the UID: [TRIGGER, DESCRIPTION] of each, in order. */
function alarms(ics: string, uid: string): string[][] {
  const found: string[][] = [];
  let inEvent = false;
  let alarm: string[] | null = null;
  for (const line of unfold(ics)) {
    if (line.startsWith("UID:")) inEvent = line === `UID:${uid}`;
    else if (line === "BEGIN:VALARM") alarm = [];
    else if (line === "END:VALARM") {
      if (inEvent && alarm !== null) found.push(alarm);
      alarm = null;
    } else if (alarm !== null) {
      // ACTION, TRIGGER and DESCRIPTION, in that order, and nothing else.
      if (line !== "ACTION:DISPLAY") alarm.push(line);
    }
  }
  for (const one of found) expect(one).toHaveLength(2);
  return found;
}
const OPENING = "opening-event@prends-ton-dossard";

describe("eventIcs — l'ouverture des inscriptions", () => {
  test("eventIcs — l'ouverture est un second événement, en UTC", () => {
    // In winter, Paris is one hour ahead of UTC: 10:00 is 09:00Z.
    const winter = eventIcs(
      viewOf({ registration_opening: "2026-01-12", registration_opening_time: "10:00" }),
      APP_URL,
      now(),
      "fr",
    );
    const [race, opening] = events(winter);
    expect(race?.UID).toBe("event-event@prends-ton-dossard");
    expect(opening).toEqual({
      UID: "opening-event@prends-ton-dossard",
      DTSTAMP: "20261101T093015Z",
      DTSTART: "20260112T090000Z",
      DTEND: "20260112T093000Z",
      SUMMARY: "Ouverture des inscriptions : Trail des Crêtes",
      DESCRIPTION: "https://courses.example.test/evenements/event",
      URL: "https://courses.example.test/evenements/event",
    });
    // Still one calendar, every line ended by CRLF.
    lines(winter);
    expect(unfold(winter).filter((line) => line === "BEGIN:VEVENT")).toHaveLength(2);

    // In summer, two hours ahead: 10:00 is 08:00Z.
    const summer = events(
      eventIcs(
        viewOf({ registration_opening: "2026-05-12", registration_opening_time: "10:00" }),
        APP_URL,
        now(),
        "en",
      ),
    )[1];
    expect(summer?.DTSTART).toBe("20260512T080000Z");
    expect(summer?.DTEND).toBe("20260512T083000Z");
    expect(summer?.SUMMARY).toBe("Registration opens: Trail des Crêtes");
  });

  test("eventIcs — sans heure, un jour entier", () => {
    const [, opening] = events(
      eventIcs(viewOf({ registration_opening: "2026-05-12" }), APP_URL, now(), "fr"),
    );

    expect(opening?.UID).toBe("opening-event@prends-ton-dossard");
    expect(opening?.["DTSTART;VALUE=DATE"]).toBe("20260512");
    expect(opening?.["DTEND;VALUE=DATE"]).toBe("20260513");
    expect(opening).not.toHaveProperty("DTSTART");
  });

  test("eventIcs — les alarmes de la personne", () => {
    const timed = viewOf({
      registration_opening: "2026-01-12",
      registration_opening_time: "10:00",
    });
    const wholeDay = viewOf({ registration_opening: "2026-01-12" });
    const title = "DESCRIPTION:Ouverture des inscriptions : Trail des Crêtes";
    const alarmsOf = (view: ReturnType<typeof viewOf>, lang: "fr" | "en", reminders?: Reminder[]) =>
      alarms(eventIcs(view, APP_URL, now(), lang, reminders), OPENING);

    // With a time: a day before and an hour before it, day first.
    expect(alarmsOf(timed, "fr", ["hour", "day"])).toEqual([
      ["TRIGGER:-P1D", title],
      ["TRIGGER:-PT1H", title],
    ]);
    lines(eventIcs(timed, APP_URL, now(), "fr", ["hour", "day"]));
    expect(alarmsOf(timed, "fr", ["day"])).toEqual([["TRIGGER:-P1D", title]]);
    expect(alarmsOf(timed, "fr", ["hour"])).toEqual([["TRIGGER:-PT1H", title]]);

    // Without a time, from the start of the day: the day before at 9 h, the day itself at 8 h.
    expect(alarmsOf(wholeDay, "fr", ["day", "hour"])).toEqual([
      ["TRIGGER:-PT15H", title],
      ["TRIGGER:PT8H", title],
    ]);

    // In English, an alarm says what the title says.
    expect(alarmsOf(timed, "en", ["day"])).toEqual([
      ["TRIGGER:-P1D", "DESCRIPTION:Registration opens: Trail des Crêtes"],
    ]);

    // None chosen, or not given: no alarm; the race itself never has one.
    expect(eventIcs(timed, APP_URL, now(), "fr", [])).not.toContain("VALARM");
    expect(eventIcs(timed, APP_URL, now(), "fr")).not.toContain("VALARM");
    expect(eventIcs(viewOf(), APP_URL, now(), "fr", ["day", "hour"])).not.toContain("VALARM");
    expect(
      alarms(eventIcs(timed, APP_URL, now(), "fr", ["day"]), "event-event@prends-ton-dossard"),
    ).toEqual([]);
  });

  test("eventIcs — sans ouverture, un seul événement", () => {
    expect(events(eventIcs(viewOf(), APP_URL, now(), "fr"))).toHaveLength(1);
  });
});
