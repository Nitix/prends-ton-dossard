import { describe, expect, test } from "vitest";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { createFormatters } from "../../lib/format";
import { eventLabel } from "./eventLabel";

/** Intl separates the parts of a date with several kinds of non-breaking spaces. */
const plain = (s: string) => s.replace(/\s/g, " ");

const trail = { name: "Trail des Crêtes", location: "Annecy", start_date: "2026-06-13" };

describe("eventLabel", () => {
  test("an event of one day: its name, its day and its place", () => {
    expect(plain(eventLabel(trail, createFormatters("fr-FR"), fr))).toBe(
      "Trail des Crêtes · sam. 13 juin 2026 · Annecy",
    );
  });

  test("an empty end date is no end date (that is how the API sends it)", () => {
    expect(plain(eventLabel({ ...trail, end_date: "" }, createFormatters("fr-FR"), fr))).toBe(
      "Trail des Crêtes · sam. 13 juin 2026 · Annecy",
    );
  });

  test("an event of several days gives both days, in the language of the texts", () => {
    const event = { ...trail, end_date: "2026-06-14" };
    expect(plain(eventLabel(event, createFormatters("fr-FR"), fr))).toBe(
      "Trail des Crêtes · du sam. 13 juin 2026 au dim. 14 juin 2026 · Annecy",
    );
    expect(plain(eventLabel(event, createFormatters("en-GB"), en))).toBe(
      "Trail des Crêtes · Sat, 13 Jun 2026 to Sun, 14 Jun 2026 · Annecy",
    );
  });
});
