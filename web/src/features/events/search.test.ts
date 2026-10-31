import { describe, expect, test } from "vitest";

import { validateListSearch } from "./search";

describe("validateListSearch", () => {
  test("keeps what the page understands", () => {
    expect(validateListSearch({ personne: "moi", type: "abc123", periode: "passees" })).toEqual({
      personne: "moi",
      type: "abc123",
      periode: "passees",
    });
  });

  test("nothing in the URL is no filter", () => {
    expect(validateListSearch({})).toEqual({});
  });

  test("an unknown period, an empty value or the wrong type of value is dropped", () => {
    expect(validateListSearch({ periode: "demain", personne: "", type: 12 })).toEqual({});
  });

  test("a parameter that belongs to another page is not kept", () => {
    expect(validateListSearch({ mois: "2026-06", personne: "moi" })).toEqual({ personne: "moi" });
  });
});
