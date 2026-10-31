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
