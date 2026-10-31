import { describe, expect, test } from "vitest";

import { plural } from "./plural";

const forms = { one: "course", other: "courses" };

describe("plural", () => {
  test("French treats 0 as singular", () => {
    expect(plural("fr", 0, forms)).toBe("course");
    expect(plural("fr", 1, forms)).toBe("course");
    expect(plural("fr", 2, forms)).toBe("courses");
  });

  test("English treats 0 as plural", () => {
    expect(plural("en", 0, forms)).toBe("courses");
    expect(plural("en", 1, forms)).toBe("course");
    expect(plural("en", 2, forms)).toBe("courses");
  });
});
