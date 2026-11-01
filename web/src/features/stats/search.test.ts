import { describe, expect, test } from "vitest";

import { validateStatsSearch } from "./search";

describe("validateStatsSearch", () => {
  test("keeps the year", () => {
    expect(validateStatsSearch({ annee: 2025 })).toEqual({ annee: 2025 });
  });

  test("nothing in the URL is the current year", () => {
    expect(validateStatsSearch({})).toEqual({});
  });

  test("a year that is not a whole number of four digits is dropped", () => {
    for (const annee of ["2026", "abc", "", 2026.5, 99, 10_000, -2026, Number.NaN, null, true]) {
      expect(validateStatsSearch({ annee })).toEqual({});
    }
  });

  test("what is not the year is not kept", () => {
    expect(validateStatsSearch({ annee: 2024, personne: "moi" })).toEqual({ annee: 2024 });
  });
});
