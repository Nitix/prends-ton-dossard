import { describe, expect, test } from "vitest";

import { duplicateFilter, significantWords } from "./duplicates";

const date = (s: string) => Temporal.PlainDate.from(s);

describe("significantWords", () => {
  test("the words of four letters or more, in lowercase, with no figure", () => {
    expect(significantWords("Trail des Crêtes 2026")).toEqual(["trail", "crêtes"]);
  });

  test("a word that comes twice is kept once", () => {
    expect(significantWords("Trail du TRAIL trail")).toEqual(["trail"]);
  });

  test("an accent is a letter, composed or not", () => {
    expect(significantWords("Crêtes".normalize("NFD"))).toEqual(["crêtes"]);
  });

  test("a name made of short words has none", () => {
    expect(significantWords("Le 10 km")).toEqual([]);
    expect(significantWords("")).toEqual([]);
  });

  test("an apostrophe or a hyphen separates words", () => {
    expect(significantWords("Foulées d'automne-hiver")).toEqual(["foulées", "automne", "hiver"]);
  });
});

describe("duplicateFilter", () => {
  test("covers 30 days before and after the date", () => {
    const filter = duplicateFilter("Trail des Crêtes", date("2026-06-14"));

    expect(filter).toContain("2026-05-15");
    expect(filter).toContain("2026-07-14");
  });

  test("asks for the events whose name has one of the words", () => {
    const filter = duplicateFilter("Trail des Crêtes", date("2026-06-14"));

    expect(filter).toBe(
      '(name ~ "trail" || name ~ "crêtes") && start_date >= "2026-05-15" && start_date <= "2026-07-14"',
    );
  });

  test("leaves out the event that is being edited", () => {
    const filter = duplicateFilter("Trail des Crêtes", date("2026-06-14"), "abc123def456ghi");

    expect(filter).toBe(
      '(name ~ "trail" || name ~ "crêtes") && start_date >= "2026-05-15" && start_date <= "2026-07-14" && id != "abc123def456ghi"',
    );
  });

  test("a name with no significant word has nothing to look for", () => {
    expect(duplicateFilter("Le 10", date("2026-06-14"))).toBeNull();
  });

  test("the words are bound as parameters: a quote or a wildcard in the name changes nothing", () => {
    const filter = duplicateFilter('Trail" || 1=1 || "x', date("2026-06-14"));

    expect(filter).toBe(
      '(name ~ "trail") && start_date >= "2026-05-15" && start_date <= "2026-07-14"',
    );
  });
});
