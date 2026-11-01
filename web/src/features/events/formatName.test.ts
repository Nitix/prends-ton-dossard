import { describe, expect, test } from "vitest";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { createFormatters } from "../../lib/format";
import { formatDisplayName, formatMeasures } from "./formatName";

// Intl separates a number from its unit with a no-break space: tests read the
// text as it looks.
const plain = (s: string) => s.replace(/\p{Zs}/gu, " ");

const f = createFormatters("fr-FR");
const name = (format: Parameters<typeof formatDisplayName>[0], label: string) =>
  plain(formatDisplayName(format, label, f, fr));

describe("formatDisplayName (French)", () => {
  test("the type and the distance, with at most one decimal", () => {
    expect(name({ distance_km: 42.195 }, "Trail")).toBe("Trail 42,2 km");
    expect(name({ distance_km: 15 }, "Trail")).toBe("Trail 15 km");
  });

  test("the type and the duration of a timed race", () => {
    expect(name({ duration_min: 360 }, "Route")).toBe("Route 6h");
    expect(name({ duration_min: 2790 }, "Route")).toBe("Route 46h 30min");
  });

  test("the type and the time limit when that is all there is", () => {
    expect(name({ time_limit_min: 2880 }, "Backyard")).toBe("Backyard max 48h");
  });

  test("the name typed by the user wins over everything", () => {
    expect(
      name({ name: "Les 6 heures de Bron", distance_km: 42, duration_min: 360 }, "Route"),
    ).toBe("Les 6 heures de Bron");
  });

  test("the distance wins over the duration, and the duration over the time limit", () => {
    expect(name({ distance_km: 10, duration_min: 360, time_limit_min: 600 }, "Route")).toBe(
      "Route 10 km",
    );
    expect(name({ duration_min: 360, time_limit_min: 600 }, "Route")).toBe("Route 6h");
  });

  test("an empty value is absent: the API sends 0 and an empty text for what is not set", () => {
    expect(name({ name: "", distance_km: 0, duration_min: 360, time_limit_min: 0 }, "Route")).toBe(
      "Route 6h",
    );
    expect(
      name({ name: "", distance_km: 0, duration_min: 0, time_limit_min: 2880 }, "Backyard"),
    ).toBe("Backyard max 48h");
  });

  test("a format with no measure at all is called by its type", () => {
    expect(name({}, "Cross")).toBe("Cross");
    expect(name({ name: "", distance_km: 0 }, "Cross")).toBe("Cross");
  });
});

describe("formatDisplayName (English)", () => {
  test("the numbers follow the formatting locale", () => {
    const gb = createFormatters("en-GB");

    expect(plain(formatDisplayName({ distance_km: 42.195 }, "Trail", gb, en))).toBe(
      "Trail 42.2 km",
    );
    expect(plain(formatDisplayName({ time_limit_min: 2790 }, "Backyard", gb, en))).toBe(
      "Backyard max 46h 30m",
    );
  });
});

const measures = (format: Parameters<typeof formatMeasures>[0], label: string) =>
  formatMeasures(format, label, f, fr).map(plain);

describe("formatMeasures", () => {
  test("a format with a distance and a time limit says both: Trail 42 km · max 10h", () => {
    expect(measures({ distance_km: 42, time_limit_min: 600 }, "Trail")).toEqual([
      "Trail 42 km",
      "max 10h",
    ]);
  });

  test("the elevation gain comes before the time limit", () => {
    expect(
      measures({ distance_km: 42, elevation_gain_m: 2400, time_limit_min: 600 }, "Trail"),
    ).toEqual(["Trail 42 km", "2 400 m D+", "max 10h"]);
  });

  test("a timed race can have a time limit too", () => {
    expect(measures({ duration_min: 1440, time_limit_min: 1500 }, "Route")).toEqual([
      "Route 24h",
      "max 25h",
    ]);
  });

  test("a time limit that is already in the name is not said twice", () => {
    expect(measures({ time_limit_min: 2880 }, "Backyard")).toEqual(["Backyard max 48h"]);
  });

  test("a named format says what it is made of after its name", () => {
    expect(measures({ name: "Marathon de Lyon", distance_km: 42.195 }, "Route")).toEqual([
      "Marathon de Lyon",
      "Route 42,2 km",
    ]);
  });

  test("a name that has the type already leaves it out of what it is made of", () => {
    expect(measures({ name: "Trail court", distance_km: 15 }, "Trail")).toEqual([
      "Trail court",
      "15 km",
    ]);
    expect(measures({ name: "Backyard des Aiguilles", time_limit_min: 2880 }, "Backyard")).toEqual([
      "Backyard des Aiguilles",
      "max 48h",
    ]);
  });

  test("a named format that has no measure says its type, unless the name does", () => {
    expect(measures({ name: "Foulées" }, "Route")).toEqual(["Foulées", "Route"]);
    expect(measures({ name: "Route des vins" }, "Route")).toEqual(["Route des vins"]);
  });

  test("formatMeasures — le prix vient en dernier, absent quand il vaut 0", () => {
    expect(
      measures(
        { distance_km: 42, elevation_gain_m: 2400, time_limit_min: 600, price_eur: 65 },
        "Trail",
      ),
    ).toEqual(["Trail 42 km", "2 400 m D+", "max 10h", "65 €"]);
    expect(measures({ distance_km: 10, price_eur: 12.5 }, "Route")).toEqual([
      "Route 10 km",
      "12,50 €",
    ]);
    // A named format: the price still closes the line.
    expect(
      measures({ name: "Marathon de Lyon", distance_km: 42.195, price_eur: 90 }, "Route"),
    ).toEqual(["Marathon de Lyon", "Route 42,2 km", "90 €"]);
    // 0 is how the API says "no price".
    expect(measures({ distance_km: 10, price_eur: 0 }, "Route")).toEqual(["Route 10 km"]);
    expect(measures({ distance_km: 10 }, "Route")).toEqual(["Route 10 km"]);
  });

  test("what is not set (0) adds nothing", () => {
    expect(
      measures(
        { distance_km: 10, elevation_gain_m: 0, time_limit_min: 0, duration_min: 0 },
        "Route",
      ),
    ).toEqual(["Route 10 km"]);
  });
});
