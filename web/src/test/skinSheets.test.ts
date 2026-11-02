import { expect, test } from "vitest";

import { lightTheme, linearStops, sheetProblems, splitTopLevel } from "./theme";

// The rules that the stylesheets of a skin keep (src/skins/README.md), on
// sheets written here: the forms a skin may use, and those it may not. The
// sheets of the real skins are held to them in src/dark.test.ts.

const known = new Set(lightTheme().keys());
const problems = (css: string, level: "palette" | "mix" | "full") =>
  sheetProblems(css, "x", level, known);

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
      "palette",
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
      "palette",
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

test("skinSheets — mix et full : les pièces sous le skin, pour un mode, dans @media, @supports ou @container, des @keyframes à son nom", () => {
  const sheet = `
    :root[data-skin="x"] .event-card { border-radius: 0; }
    :root[data-skin="x"][data-theme="dark"] .event-card { border-color: black; }
    :root[data-skin="x"][data-theme="light"] .tab { color: black; }
    :root[data-skin="x"]:not([data-theme="light"]) .tab { color: white; }
    :root[data-skin="x"] .a:is(.b, .c), :root[data-skin="x"] > .shell .d { color: black; }
    :root[data-skin="x"] .chip::before { content: ""; }
    @media (min-width: 48rem) { :root[data-skin="x"] .tabbar { top: 0; } }
    @supports (backdrop-filter: blur(1px)) {
      @media (prefers-color-scheme: dark) { :root[data-skin="x"] .card { color: black; } }
    }
    @container (min-width: 20rem) { :root[data-skin="x"] .stat-tile { padding: 0; } }
    @media (forced-colors: active) { :root[data-skin="x"] .chip { border: 1px solid ButtonText; } }
    @keyframes x-shine { from { opacity: 0; } 50% { opacity: 0.5; } to { opacity: 1; } }
    :root[data-skin="x"] .event-card { animation: x-shine 1s 1; }
  `;
  expect(problems(sheet, "mix")).toEqual([]);
  expect(problems(sheet, "full")).toEqual([]);
});

test("skinSheets — mix et full : rien hors du skin, aucune propriété personnalisée, aucune autre règle @", () => {
  expect(
    problems(
      `
      .event-card { color: black; }
      :root[data-skin="x"] .a, .b { color: black; }
      :root[data-skin="x"] { color: black; }
      :root[data-skin="y"] .a { color: black; }
      :root[data-skin="x"] .a { --color-ink: #000000; }
      @keyframes shine { from { opacity: 0; } }
      @keyframes x-glow { from { --x: 0; } }
      @font-face { font-family: "X"; }
      @layer pieces { :root[data-skin="x"] .a { color: black; } }
      @media (min-width: 1px) { .b { color: black; } }
      :root[data-skin="x"] .a { color: black; .b { color: black; } }
      `,
      "mix",
    ),
  ).toEqual([
    "x, mix.css: the selector .event-card",
    "x, mix.css: the selector .b",
    'x, mix.css: the selector :root[data-skin="x"]',
    'x, mix.css: the selector :root[data-skin="y"] .a',
    "x, mix.css: a custom property --color-ink",
    'x, mix.css: the keyframes shine (its name starts with "x-")',
    "x, mix.css: a keyframe sets --x",
    "x, mix.css: the at-rule @font-face",
    "x, mix.css: the at-rule @layer pieces",
    "x, mix.css: the selector .b",
    'x, mix.css: a rule nested in :root[data-skin="x"] .a',
  ]);
});

test("skinSheets — mix et full : un sélecteur nomme les pièces par leurs classes et leurs attributs, jamais par le type d'un élément", () => {
  expect(
    problems(
      `
      :root[data-skin="x"] .totals-header th { color: black; }
      :root[data-skin="x"] img.avatar, :root[data-skin="x"] .chip > span { color: black; }
      :root[data-skin="x"] .profile-section:has(> ul) { color: black; }
      :root[data-skin="x"] .tab[aria-current="page"]::before { color: black; }
      :root[data-skin="x"]:not([data-theme="light"]) .format-line .format-parts:is(:hover, :focus-visible) { color: black; }
      :root[data-skin="x"] [data-block="history"] .block-title { content: "a div"; }
      `,
      "full",
    ),
  ).toEqual([
    'x, full.css: the selector :root[data-skin="x"] .totals-header th names an element',
    'x, full.css: the selector :root[data-skin="x"] img.avatar names an element',
    'x, full.css: the selector :root[data-skin="x"] .chip > span names an element',
    'x, full.css: the selector :root[data-skin="x"] .profile-section:has(> ul) names an element',
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
