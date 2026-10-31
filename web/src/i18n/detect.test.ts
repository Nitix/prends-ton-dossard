import { describe, expect, test } from "vitest";

import { detectLocale } from "./detect";

describe("detectLocale", () => {
  test.each([
    { languages: ["en-GB", "fr"], expected: { lang: "en", formatLocale: "en-GB" } },
    { languages: ["de-DE"], expected: { lang: "fr", formatLocale: "fr-FR" } },
    { languages: ["fr-CA", "en"], expected: { lang: "fr", formatLocale: "fr-CA" } },
    { languages: [], expected: { lang: "fr", formatLocale: "fr-FR" } },
    { languages: ["EN-us"], expected: { lang: "en", formatLocale: "en-US" } },
  ])("$languages gives $expected", ({ languages, expected }) => {
    expect(detectLocale(languages)).toEqual(expected);
  });

  test("skips the languages it does not handle, in order", () => {
    expect(detectLocale(["de-DE", "es", "en-AU", "fr"])).toEqual({
      lang: "en",
      formatLocale: "en-AU",
    });
  });

  test("skips a malformed tag instead of throwing", () => {
    expect(detectLocale(["not a tag", "", "en-GB"])).toEqual({
      lang: "en",
      formatLocale: "en-GB",
    });
  });

  test("a bare language keeps its own label", () => {
    expect(detectLocale(["fr"])).toEqual({ lang: "fr", formatLocale: "fr" });
  });
});
