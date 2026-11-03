import { expect, test } from "vitest";

import { lightTheme, linearStops, sheetProblems, splitTopLevel } from "./theme";

// The rules that the stylesheets of a skin keep (src/skins/README.md), on
// sheets written here: the forms a skin may use, and those it may not. The
// sheets of the real skins are held to them in src/dark.test.ts.

const known = new Set(lightTheme().keys());
const problems = (css: string) => sheetProblems(css, "x", known);

test("skinSheets — une palette : des propriétés de Crête sur la page, la nuit et le ciel du skin", () => {
  expect(
    problems(
      `
      :root[data-skin="x"] { --color-ink: #000000; --dawn-deep: linear-gradient(#000000, #111111); --dawn-glow-warm: rgb(0 0 0 / 0.5); --radius-card: 0; --map-line: #000000; --motif-sun-core: #ffffff; }
      :root[data-skin="x"][data-theme="dark"] { color-scheme: dark; --color-ink: #ffffff; }
      @media (prefers-color-scheme: dark) {
        :root[data-skin="x"]:not([data-theme="light"]) { color-scheme: dark; --color-ink: #ffffff; }
      }
      :root[data-skin="x"] .on-dawn, :root[data-skin='x'] { --color-ink: #000000; }
      `,
    ),
  ).toEqual([]);
});

test("skinSheets — une palette ne repeint pas de classe, ne règle ni ombre ni police, rien que Crête ne déclare", () => {
  expect(
    problems(
      `
      :root[data-skin="x"] .bg-dawn-deep { background-image: none; }
      :root[data-skin="x"] { --shadow-glow: none; --font-display: serif; --color-unknown: #000000; background: red; }
      :root[data-skin="y"] { --color-ink: #000000; }
      @media (min-width: 40rem) { :root[data-skin="x"] { --color-ink: #000000; } }
      @import "other.css";
      :root[data-skin="x"] { --color-ink: #000000; }
      `,
    ),
  ).toEqual([
    'x, palette.css: the selector :root[data-skin="x"] .bg-dawn-deep',
    "x, palette.css: background-image, which is not a custom property",
    "x, palette.css: --shadow-glow, which a palette cannot change",
    "x, palette.css: --font-display, which a palette cannot change",
    "x, palette.css: --color-unknown, which Crête does not declare",
    "x, palette.css: background, which is not a custom property",
    'x, palette.css: the selector :root[data-skin="y"]',
    "x, palette.css: the at-rule @media (min-width: 40rem)",
    'x, palette.css: a statement @import "other.css"',
  ]);
});

test("skinSheets — une liste de sélecteurs se coupe à ses virgules, pas à celles de :is() ni des chaînes", () => {
  expect(splitTopLevel(':root .a:is(.b, .c), :root [title="a, b"], .d')).toEqual([
    ":root .a:is(.b, .c)",
    ':root [title="a, b"]',
    ".d",
  ]);
});

test("skinSheets — les arrêts d'un dégradé linéaire sont des #rrggbb, ou une erreur", () => {
  expect(
    linearStops(
      "radial-gradient(rgb(1 2 3 / 0.5) 0%, transparent 70%), linear-gradient(150deg, #4b37c4 0%, #5e4ae3 30%, #c2367f)",
    ),
  ).toEqual(["#4b37c4", "#5e4ae3", "#c2367f"]);
  expect(linearStops("linear-gradient(to right, #000000, #ffffff 50%)")).toEqual([
    "#000000",
    "#ffffff",
  ]);
  expect(() => linearStops("linear-gradient(110deg, #000000 0%, rgb(255 0 0) 50%)")).toThrow(
    /rgb\(255 0 0\)/,
  );
  expect(() => linearStops("linear-gradient(oklch(0.5 0.1 200), #ffffff)")).toThrow(/oklch/);
});
