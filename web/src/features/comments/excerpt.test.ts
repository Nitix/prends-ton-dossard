import { describe, expect, test } from "vitest";

import { excerpt } from "./excerpt";

describe("excerpt", () => {
  test("excerpt — court, inchangé", () => {
    expect(excerpt("Je viens avec Paul.")).toBe("Je viens avec Paul.");
    // Right at the limit: nothing to cut.
    expect(excerpt("a".repeat(140))).toBe("a".repeat(140));
  });

  test("excerpt — long, coupé au mot avec « … »", () => {
    const text = "mot ".repeat(50);
    const short = excerpt(text);

    expect(short.endsWith("…")).toBe(true);
    // The text before the dots is at most 140 characters, and whole words.
    const body = short.slice(0, -1);
    expect(body.length).toBeLessThanOrEqual(140);
    expect(body).toBe(Array.from({ length: 35 }, () => "mot").join(" "));
  });

  test("excerpt — la coupure tombe pile sur un espace : le dernier mot reste", () => {
    // "aaaa bbbb" is 9 characters: with a limit of 9 nothing is cut, with 8 the last word goes.
    expect(excerpt("aaaa bbbb cccc", 9)).toBe("aaaa bbbb…");
    expect(excerpt("aaaa bbbb cccc", 8)).toBe("aaaa…");
  });

  test("excerpt — un seul mot plus long que la limite est coupé à la limite", () => {
    expect(excerpt("abcdefghij", 5)).toBe("abcde…");
  });

  test("excerpt — ne coupe pas un caractère en deux", () => {
    // Each emoji is two UTF-16 code units.
    expect(excerpt("😀😀😀😀", 3)).toBe("😀…");
  });

  test("excerpt — les retours à la ligne deviennent des espaces", () => {
    expect(excerpt("ligne 1\n\nligne   2\t fin")).toBe("ligne 1 ligne 2 fin");
    expect(excerpt("  \n début \n")).toBe("début");
  });
});
