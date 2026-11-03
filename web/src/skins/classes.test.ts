import { readFileSync } from "node:fs";

import { compile } from "tailwindcss";
import { expect, test } from "vitest";

// The semantic classes of the README (« Semantic classes ») are hooks for the
// sheets of a skin, never utilities of Tailwind as well: a name that is both
// styles every element that carries it, and a skin's rule on it restyles any
// later use of the utility.

const readme = readFileSync(new URL("README.md", import.meta.url), "utf8");
const section = readme.slice(readme.indexOf("## Semantic classes"), readme.indexOf("## Tests"));
const classes = [
  ...new Set(Array.from(section.matchAll(/`\.([a-z][a-z0-9-]*)/g), ([, name = ""]) => name)),
];

test("classes — le README nomme les classes sémantiques", () => {
  expect(classes.length).toBeGreaterThan(100);
  expect(classes).toContain("event-card");
});

test("classes — aucune classe sémantique n'est aussi une classe de Tailwind", async () => {
  // Tailwind's utilities alone: those that need a value of the theme are not
  // made, and no semantic class names a value.
  const tailwind = await compile("@tailwind utilities;");
  const utilities = classes.filter((name) => tailwind.build([name]).includes(`.${name}`));
  expect(utilities).toEqual([]);
});
