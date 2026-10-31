import { describe, expect, test } from "vitest";

import { newId } from "./ids";

describe("newId", () => {
  test("is 15 characters, lowercase letters and digits: the format of the ids of PocketBase", () => {
    for (let i = 0; i < 20; i++) expect(newId()).toMatch(/^[a-z0-9]{15}$/);
  });

  test("100 calls give 100 different values", () => {
    const ids = new Set(Array.from({ length: 100 }, newId));

    expect(ids.size).toBe(100);
  });
});
