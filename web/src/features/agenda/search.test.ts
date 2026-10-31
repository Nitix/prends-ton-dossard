import { describe, expect, test } from "vitest";

import { validateAgendaSearch } from "./search";

describe("validateAgendaSearch", () => {
  test("keeps the month, the day and the filters", () => {
    expect(
      validateAgendaSearch({
        mois: "2026-06",
        jour: "2026-06-14",
        personne: "moi",
        type: "abc123",
      }),
    ).toEqual({ mois: "2026-06", jour: "2026-06-14", personne: "moi", type: "abc123" });
  });

  test("nothing in the URL is the current month and every event", () => {
    expect(validateAgendaSearch({})).toEqual({});
  });

  test("a month that is not YYYY-MM of a real month is dropped", () => {
    for (const mois of ["2026-13", "2026-00", "2026-6", "2026", "juin", "2026-06-15", "", 202606]) {
      expect(validateAgendaSearch({ mois })).toEqual({});
    }
  });

  test("a day that is not YYYY-MM-DD of a real date is dropped", () => {
    for (const jour of ["2026-02-30", "2026-06-31", "2026-06-00", "2026-06", "14", "", 20260614]) {
      expect(validateAgendaSearch({ jour })).toEqual({});
    }
  });

  test("a bad month does not drop the day, nor the other way round", () => {
    expect(validateAgendaSearch({ mois: "nope", jour: "2026-06-14" })).toEqual({
      jour: "2026-06-14",
    });
    expect(validateAgendaSearch({ mois: "2026-06", jour: "nope" })).toEqual({ mois: "2026-06" });
  });

  test("the period belongs to the list: it is not kept", () => {
    expect(validateAgendaSearch({ periode: "passees", personne: "moi" })).toEqual({
      personne: "moi",
    });
  });

  test("an empty filter is dropped", () => {
    expect(validateAgendaSearch({ personne: "", type: 12 })).toEqual({});
  });
});
