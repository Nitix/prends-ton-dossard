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

describe("home texts", () => {
  test("French", () => {
    expect(fr.home.addedYou("Alice", "Trail 42 km")).toBe(
      "Alice a ajouté ta participation à « Trail 42 km »",
    );
    expect(fr.home.confirmFor("Trail des Crêtes")).toBe("Confirmer pour Trail des Crêtes");
    expect(fr.home.removeFor("Trail des Crêtes")).toBe("Retirer de Trail des Crêtes");
  });

  test("English", () => {
    expect(en.home.addedYou("Alice", "Trail 42 km")).toBe("Alice added you to “Trail 42 km”");
    expect(en.home.confirmFor("Trail des Crêtes")).toBe("Confirm for Trail des Crêtes");
    expect(en.home.removeFor("Trail des Crêtes")).toBe("Remove from Trail des Crêtes");
  });
});

describe("agenda texts", () => {
  test("French", () => {
    expect(fr.agenda.previous).toBe("Mois précédent");
    expect(fr.agenda.next).toBe("Mois suivant");
    expect(fr.agenda.day("dim. 14 juin", 0)).toBe("dim. 14 juin, aucun événement");
    expect(fr.agenda.day("dim. 14 juin", 1)).toBe("dim. 14 juin, 1 événement");
    expect(fr.agenda.day("dim. 14 juin", 3)).toBe("dim. 14 juin, 3 événements");
  });

  test("English", () => {
    expect(en.agenda.previous).toBe("Previous month");
    expect(en.agenda.next).toBe("Next month");
    expect(en.agenda.day("Sun 14 Jun", 0)).toBe("Sun 14 Jun, no events");
    expect(en.agenda.day("Sun 14 Jun", 1)).toBe("Sun 14 Jun, 1 event");
    expect(en.agenda.day("Sun 14 Jun", 3)).toBe("Sun 14 Jun, 3 events");
  });
});

describe("admin texts", () => {
  test("French", () => {
    expect(fr.admin.membersTitle).toBe("Membres");
    expect(fr.admin.stateInvited("sam. 7 nov. 2026")).toBe(
      "Invitation en attente · expire le sam. 7 nov. 2026",
    );
    expect(fr.admin.forRunner("Renommer", "Alice")).toBe("Renommer · Alice");
    expect(fr.admin.shareTitle.invite("Alice")).toBe("Lien d'invitation pour Alice");
    expect(fr.admin.shareTitle.reset("Alice")).toBe("Lien de réinitialisation pour Alice");
    expect(fr.admin.expires("sam. 7 nov. 2026")).toBe("Valable jusqu'au sam. 7 nov. 2026.");
    expect(fr.admin.share).toBe("Partager");
    expect(fr.admin.copy).toBe("Copier");
  });

  test("English", () => {
    expect(en.admin.membersTitle).toBe("Members");
    expect(en.admin.stateInvited("Sat 7 Nov 2026")).toBe(
      "Invitation pending · expires on Sat 7 Nov 2026",
    );
    expect(en.admin.forRunner("Rename", "Alice")).toBe("Rename · Alice");
    expect(en.admin.shareTitle.invite("Alice")).toBe("Invitation link for Alice");
    expect(en.admin.shareTitle.reset("Alice")).toBe("Reset link for Alice");
    expect(en.admin.expires("Sat 7 Nov 2026")).toBe("Valid until Sat 7 Nov 2026.");
    expect(en.admin.share).toBe("Share");
    expect(en.admin.copy).toBe("Copy");
  });
});
