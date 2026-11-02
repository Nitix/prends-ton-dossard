import { expect, test } from "vitest";

import { terrainOf } from "./terrain";

// The terrain of a race type, read from the words of its label (the admins type
// the labels): « Sentier » and « Alpage » tint the formats of a card with it.

test("terrain — un libellé dit son terrain, avec ou sans accent, en majuscules ou non", () => {
  expect(terrainOf("Trail")).toBe("trail");
  expect(terrainOf("Route")).toBe("route");
  expect(terrainOf("Course de montagne")).toBe("trail");
  expect(terrainOf("Cross")).toBe("cross");
  expect(terrainOf("BACKYARD")).toBe("backyard");
  expect(terrainOf("Hyrox")).toBe("hyrox");
  expect(terrainOf("Skyrace")).toBe("trail");
  expect(terrainOf("Marathon")).toBe("route");
});

test("terrain — le premier mot qui compte l'emporte : un ultra-trail est un ultra", () => {
  expect(terrainOf("Ultra-trail")).toBe("ultra");
  expect(terrainOf("Cross trail")).toBe("cross");
});

test("terrain — un libellé qui n'en dit aucun a le sable : son nom est écrit à côté, la teinte ne dit rien seule", () => {
  expect(terrainOf("Triathlon")).toBe("other");
  expect(terrainOf("")).toBe("other");
});
