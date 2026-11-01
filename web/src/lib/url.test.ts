import { describe, expect, test } from "vitest";

import { webAddress } from "./url";

describe("webAddress", () => {
  test("an http or https address is kept as it is written", () => {
    expect(webAddress("https://inscriptions.example.test/trail?x=1")).toBe(
      "https://inscriptions.example.test/trail?x=1",
    );
    expect(webAddress("http://example.test")).toBe("http://example.test");
  });

  test("nothing, an empty text or text that is not an address gives null", () => {
    expect(webAddress(undefined)).toBeNull();
    expect(webAddress("")).toBeNull();
    expect(webAddress("pas une adresse")).toBeNull();
  });

  test("an address that is not http(s) is never one: javascript: and the others", () => {
    expect(webAddress("javascript:alert(1)")).toBeNull();
    expect(webAddress("data:text/html,<p>x</p>")).toBeNull();
    expect(webAddress("ftp://example.test/file")).toBeNull();
  });
});
