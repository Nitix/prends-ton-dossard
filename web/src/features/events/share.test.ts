import { beforeAll, describe, expect, test } from "vitest";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { createFormatters } from "../../lib/format";
import { ensureTemporal } from "../../lib/temporal";
import { plain } from "../../test/said";
import { toEventView } from "./api";
import { shareText, whatsappURL } from "./share";
import {
  aliceRunner,
  event2Record,
  eventRecord,
  f15,
  p1,
  p2,
  pNinaSupporter,
  pNinaUndecided,
  roadType,
  withParticipations,
} from "./testFixture";

const APP = "https://prends-ton-dossard.example.test";
const FR = createFormatters("fr-FR");
const GB = createFormatters("en-GB");

let today: Temporal.PlainDate;
beforeAll(async () => {
  await ensureTemporal();
  today = Temporal.PlainDate.from("2026-01-05");
});

/** The lines of the text, whitespace gathered. */
const lines = (text: string) => text.split("\n").map(plain);

/** The days line (the second) of the text of a race that has these days. */
const days = (start: string, end: string, extra: object = {}) =>
  lines(
    shareText(
      toEventView({ ...event2Record, start_date: start, end_date: end, ...extra }),
      APP,
      today,
      FR,
      fr,
    ),
  )[1];

describe("shareText", () => {
  test("un jour : le nom, le jour et le lieu, l'épreuve, l'adresse", () => {
    const view = toEventView(event2Record);

    expect(lines(shareText(view, APP, today, FR, fr))).toEqual([
      "10 km de Lyon",
      "lun. 22 juin 2026 · Lyon",
      "Épreuves : Route 10 km",
      `${APP}/evenements/event2`,
    ]);
  });

  test("plusieurs jours : du … au …, les épreuves avec leurs mesures", () => {
    const view = toEventView(eventRecord);

    expect(lines(shareText(view, APP, today, FR, fr))).toEqual([
      "Trail des Crêtes",
      "Du sam. 13 au dim. 14 juin 2026 · Annecy",
      "Épreuves : Trail 15 km · 700 m D+ ; Trail 42 km · 2 400 m D+ · max 10h",
      `${APP}/evenements/event`,
    ]);
  });

  test("au mois : « juin 2027 (date à préciser) », jamais un jour", () => {
    const view = toEventView({
      ...event2Record,
      start_date: "2027-06-01",
      end_date: "2027-06-30",
      date_precision: "month",
    });

    const [, when] = lines(shareText(view, APP, today, FR, fr));
    expect(when).toBe("juin 2027 (date à préciser) · Lyon");
  });

  test("ouverture à venir : la ligne d'ouverture, puis la date limite", () => {
    const view = toEventView({
      ...event2Record,
      registration_opening: "2026-01-12",
      registration_opening_time: "10:00",
      registration_deadline: "2026-05-31",
    });

    expect(lines(shareText(view, APP, today, FR, fr))).toEqual([
      "10 km de Lyon",
      "lun. 22 juin 2026 · Lyon",
      "Épreuves : Route 10 km",
      "Ouverture des inscriptions le lun. 12 janv. à 10:00",
      "Inscriptions jusqu'au dim. 31 mai",
      `${APP}/evenements/event2`,
    ]);
  });

  test("les jours : un mois, deux mois, deux années, un seul jour, un mois seul", () => {
    expect(days("2026-06-13", "2026-06-14")).toBe("Du sam. 13 au dim. 14 juin 2026 · Lyon");
    expect(days("2026-05-30", "2026-06-01")).toBe("Du sam. 30 mai au lun. 1 juin 2026 · Lyon");
    expect(days("2026-12-31", "2027-01-01")).toBe(
      "Du jeu. 31 déc. 2026 au ven. 1 janv. 2027 · Lyon",
    );
    expect(days("2026-06-13", "2026-06-13")).toBe("sam. 13 juin 2026 · Lyon");
    expect(days("2027-06-01", "2027-06-30", { date_precision: "month" })).toBe(
      "juin 2027 (date à préciser) · Lyon",
    );
  });

  test("une ouverture aujourd'hui dit son jour et son heure, jamais « aujourd'hui »", () => {
    const view = toEventView({
      ...event2Record,
      registration_opening: "2026-01-05",
      registration_opening_time: "10:00",
    });

    const text = plain(shareText(view, APP, today, FR, fr));

    expect(text).toContain("Ouverture des inscriptions le lun. 5 janv. à 10:00");
    expect(text).not.toContain("aujourd");
  });

  test("date limite : une ligne, et aucune quand les inscriptions sont closes ou sans date", () => {
    const open = toEventView({ ...event2Record, registration_deadline: "2026-05-31" });
    expect(lines(shareText(open, APP, today, FR, fr))).toContain(
      "Inscriptions jusqu'au dim. 31 mai",
    );

    const closed = toEventView({ ...event2Record, registration_deadline: "2026-05-31" });
    const late = Temporal.PlainDate.from("2026-06-10");
    expect(shareText(closed, APP, late, FR, fr)).not.toContain("Inscriptions");

    expect(shareText(toEventView(event2Record), APP, today, FR, fr)).not.toContain("Inscriptions");
  });

  test("épreuve sans mesure : son type seul", () => {
    const bare = {
      ...f15,
      id: "fBare",
      distance_km: 0,
      elevation_gain_m: 0,
      expand: { race_type: roadType },
    };
    const view = toEventView({
      ...event2Record,
      expand: { formats_via_event: [bare] },
    });

    expect(lines(shareText(view, APP, today, FR, fr))).toContain("Épreuves : Route");
  });

  test("une course sans épreuve ni lieu : pas de ligne d'épreuves, le jour seul", () => {
    const view = toEventView({ ...event2Record, location: "", expand: { formats_via_event: [] } });

    expect(lines(shareText(view, APP, today, FR, fr))).toEqual([
      "10 km de Lyon",
      "lun. 22 juin 2026",
      `${APP}/evenements/event2`,
    ]);
  });

  test("aucun nom de participant : ni coureurs, ni supporters, ni propositions", () => {
    const view = toEventView(
      withParticipations(
        {
          ...eventRecord,
          registration_deadline: "2026-05-31",
          notes: "Retrait des dossards le vendredi",
        },
        [pNinaUndecided, pNinaSupporter],
      ),
    );
    expect(view.interested.length + view.supporters.length).toBeGreaterThan(0);
    expect([p1, p2].length).toBe(2);

    const text = shareText(view, APP, today, FR, fr);

    for (const name of ["Alice", "Bob", "Sam", "Nina", aliceRunner.name]) {
      expect(text).not.toContain(name);
    }
  });

  test("en anglais : les mots et les dates de la langue", () => {
    const view = toEventView({
      ...eventRecord,
      registration_opening: "2026-01-12",
      registration_opening_time: "10:00",
      registration_deadline: "2026-05-31",
    });

    expect(lines(shareText(view, APP, today, GB, en))).toEqual([
      "Trail des Crêtes",
      "Sat 13 to Sun, 14 Jun 2026 · Annecy",
      "Races: Trail 15 km · 700 m gain ; Trail 42 km · 2,400 m gain · max 10h",
      "Registration opens on Mon 12 Jan at 10:00",
      "Registration until Sun 31 May",
      `${APP}/evenements/event`,
    ]);

    const month = toEventView({
      ...event2Record,
      start_date: "2027-06-01",
      end_date: "2027-06-30",
      date_precision: "month",
    });
    expect(lines(shareText(month, APP, today, GB, en))[1]).toBe(
      "June 2027 (date to be set) · Lyon",
    );
  });
});

describe("whatsappURL", () => {
  test("le texte est encodé, retours à la ligne et accents compris", () => {
    const url = whatsappURL("Trail des Crêtes\nhttps://x.test/a?b=1&c=2");

    expect(url).toBe(
      "https://wa.me/?text=Trail%20des%20Cr%C3%AAtes%0Ahttps%3A%2F%2Fx.test%2Fa%3Fb%3D1%26c%3D2",
    );
  });
});
