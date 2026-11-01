import { expect, test } from "vitest";

import { initials } from "./initials";

test.each([
  { name: "Alice Martin", expected: "AM" },
  { name: "Bob", expected: "B" },
  // The first letter of the first and of the last word.
  { name: "Marie-Claire Dupont", expected: "MD" },
  { name: "Jean de la Fontaine", expected: "JF" },
  { name: "  Léa   Roux  ", expected: "LR" },
  { name: "alice", expected: "A" },
  // A letter may take two UTF-16 units.
  { name: "𝒜lice 𝒵ed", expected: "𝒜𝒵" },
  { name: "", expected: "" },
])("initials of « $name » are « $expected »", ({ name, expected }) => {
  expect(initials(name)).toBe(expected);
});
