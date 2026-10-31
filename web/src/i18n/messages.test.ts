import { describe, expect, test } from "vitest";

import { en } from "./en";
import { fr } from "./fr";

describe("status labels", () => {
  test("French", () => {
    expect(fr.status).toEqual({
      interested: "Intéressé",
      registered: "Inscrit",
      finished: "Terminé",
      dnf: "Abandon",
      dns: "Non partant",
    });
  });

  test("English", () => {
    expect(en.status).toEqual({
      interested: "Interested",
      registered: "Registered",
      finished: "Finished",
      dnf: "DNF",
      dns: "DNS",
    });
  });
});

describe("event and format texts", () => {
  test("French", () => {
    expect(fr.event.unconfirmed).toBe("non confirmé");
    expect(fr.event.addedBy("Alice")).toBe("Ajouté par Alice");
    expect(fr.event.dateRange("sam. 13 juin", "dim. 14 juin")).toBe(
      "du sam. 13 juin au dim. 14 juin",
    );
    expect(fr.format.max("10h")).toBe("max 10h");
    expect(fr.format.elevation("2 400 m")).toBe("2 400 m D+");
  });

  test("English", () => {
    expect(en.event.unconfirmed).toBe("not confirmed");
    expect(en.event.addedBy("Alice")).toBe("Added by Alice");
    expect(en.event.dateRange("Sat 13 Jun", "Sun 14 Jun")).toBe("Sat 13 Jun to Sun 14 Jun");
    expect(en.format.max("10h")).toBe("max 10h");
    expect(en.format.elevation("2,400 m")).toBe("2,400 m gain");
  });
});
