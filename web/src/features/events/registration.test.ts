import { describe, expect, test } from "vitest";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { createFormatters } from "../../lib/format";
import { deadlineText, registrationLabel, registrationState } from "./registration";

const date = (s: string) => Temporal.PlainDate.from(s);

// An event of one day, on 20 June.
const event = { start_date: "2026-06-20", end_date: "", registration_deadline: "2026-06-10" };

describe("registrationState", () => {
  test("registrationState — sans date limite, null", () => {
    expect(
      registrationState({ ...event, registration_deadline: "" }, date("2026-06-01")),
    ).toBeNull();
    // An event that has not got the field at all (an older record) is the same.
    expect(registrationState({ start_date: "2026-06-20" }, date("2026-06-01"))).toBeNull();
  });

  test("registrationState — le jour même, ouvert avec 0 jour restant", () => {
    // The deadline is a day on which one can still register: "not over" means
    // the deadline is today or later.
    expect(registrationState(event, date("2026-06-10"))).toEqual({
      kind: "open",
      deadline: date("2026-06-10"),
      daysLeft: 0,
    });
  });

  test("registrationState — dans 3 jours, ouvert avec 3 jours restants", () => {
    expect(registrationState(event, date("2026-06-07"))).toEqual({
      kind: "open",
      deadline: date("2026-06-10"),
      daysLeft: 3,
    });
  });

  test("registrationState — passée, événement à venir : closed", () => {
    expect(registrationState(event, date("2026-06-11"))).toEqual({ kind: "closed" });
    // Still closed on the day of the event, and on the last day of an event of several days.
    expect(registrationState(event, date("2026-06-20"))).toEqual({ kind: "closed" });
    expect(registrationState({ ...event, end_date: "2026-06-22" }, date("2026-06-22"))).toEqual({
      kind: "closed",
    });
  });

  test("registrationState — passée, événement passé : null", () => {
    expect(registrationState(event, date("2026-06-21"))).toBeNull();
    expect(registrationState({ ...event, end_date: "2026-06-22" }, date("2026-06-23"))).toBeNull();
  });
});

// Intl separates the parts of a date with several kinds of non-breaking spaces.
const plain = (s: string) => s.replace(/\p{Zs}/gu, " ");

describe("registrationLabel", () => {
  const open = { kind: "open", deadline: date("2026-06-10"), daysLeft: 3 } as const;

  test("the deadline, in the language of the texts", () => {
    expect(plain(registrationLabel(open, createFormatters("fr-FR"), fr))).toBe(
      "Inscriptions jusqu'au mer. 10 juin",
    );
    expect(plain(registrationLabel(open, createFormatters("en-GB"), en))).toBe(
      "Registration until Wed 10 Jun",
    );
  });

  test("a closed registration says so in words", () => {
    expect(registrationLabel({ kind: "closed" }, createFormatters("fr-FR"), fr)).toBe(
      "Inscriptions closes",
    );
    expect(registrationLabel({ kind: "closed" }, createFormatters("en-GB"), en)).toBe(
      "Registration closed",
    );
  });
});

/** An open registration until 10 June, `daysLeft` days ahead. */
const openFor = (daysLeft: number) =>
  ({ kind: "open", deadline: date("2026-06-10"), daysLeft }) as const;

describe("deadlineText", () => {
  const inFrench = createFormatters("fr-FR");

  test("deadlineText — plus d'une semaine avant : la date seule, comme registrationLabel", () => {
    expect(plain(deadlineText(openFor(8), inFrench, fr))).toBe(
      "Inscriptions jusqu'au mer. 10 juin",
    );
    expect(plain(deadlineText(openFor(30), inFrench, fr))).toBe(
      "Inscriptions jusqu'au mer. 10 juin",
    );
  });

  test("deadlineText — une semaine ou moins avant : les jours qui restent, après « · »", () => {
    // DAYS_LEFT_SHOWN is 7: the week is counted, its last day as « dernier jour ».
    expect(plain(deadlineText(openFor(7), inFrench, fr))).toBe(
      "Inscriptions jusqu'au mer. 10 juin · plus que 7 jours",
    );
    expect(plain(deadlineText(openFor(1), inFrench, fr))).toBe(
      "Inscriptions jusqu'au mer. 10 juin · plus qu'un jour",
    );
    expect(plain(deadlineText(openFor(0), inFrench, fr))).toBe(
      "Inscriptions jusqu'au mer. 10 juin · dernier jour",
    );
    expect(plain(deadlineText(openFor(3), createFormatters("en-GB"), en))).toBe(
      `Registration until Wed 10 Jun · ${en.event.daysLeft(3)}`,
    );
  });

  test("deadlineText — close : « Inscriptions closes », sans jours", () => {
    expect(deadlineText({ kind: "closed" }, inFrench, fr)).toBe("Inscriptions closes");
  });
});
