import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { contrast } from "./test/colour";
import {
  DARK_CHOSEN,
  DARK_FOLLOWED,
  DEFAULT_SKIN,
  SKIN_CASES,
  block,
  darkBlocks,
  lightTheme,
  onDawnBlock,
  rules,
  skinDeclarations,
  skinModes,
  skinSelectors,
  skinStylesheet,
  themeColour,
  utilityBody,
  type SkinCase,
} from "./test/theme";

// « Crête » at night: the sky of the header (the dawn, its map, its ridges, its
// sun and the name in white) is the same in both themes, and only what is under
// it turns dark. These are the numbers that make the dark theme as legible as
// the light one: text at 4.5:1 on every ground it sits on (WCAG 2, AA), a mark
// or a line that says something at 3:1, and the white text of the buttons in
// the colours of the dawn as it was. Every skin of the app (src/skins/) is held
// to the same numbers, in each mode it has: Crête by day and at night first.

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

/** The grounds that text sits on: the sheet, a card, a window or a menu, a field, a soft panel, a hover. */
const GROUNDS = ["neutral-50", "card", "raised", "field", "neutral-100"] as const;

/** The contrast of a text (or a mark) on a ground, in a skin and a mode, and what it is, for a failure to say. */
function ratio({ skin, mode, label }: SkinCase, text: string, ground: string): [number, string] {
  const [fore, back] = [themeColour(text, mode, skin), themeColour(ground, mode, skin)];
  return [contrast(fore, back), `${label}: ${text} (${fore}) on ${ground} (${back})`];
}

test("dark — « Sombre » dans les réglages et un téléphone en sombre donnent les mêmes couleurs", () => {
  const { chosen, followed } = darkBlocks();
  // Not an empty search: the greys, the ink, the accents, the grounds.
  expect(chosen.size).toBeGreaterThan(30);
  expect(Object.fromEntries(followed)).toEqual(Object.fromEntries(chosen));
  // The native controls (a date, a select, the scroll bars) are dark too.
  expect(chosen.get("color-scheme")).toBe("dark");
  // The phone's setting gives way to a choice of « Clair ».
  expect(block(styles, "@media (prefers-color-scheme: dark)")).toContain(`${DARK_FOLLOWED} {`);
  expect(styles).toContain(`${DARK_CHOSEN} {`);
  // Light is the theme when nothing says otherwise.
  expect(block(styles, ":root")).toMatch(/color-scheme:\s*light;/);
});

test("dark — le dark ne change que des couleurs qui existent en clair", () => {
  const light = lightTheme();
  for (const property of darkBlocks().chosen.keys()) {
    if (property === "color-scheme") continue;
    expect(
      light.has(property),
      `${property} is changed in the dark, but not declared in @theme`,
    ).toBe(true);
  }
});

test("dark — le ciel de l'entête et des bandeaux reste celui de l'aube", () => {
  const { chosen } = darkBlocks();
  const light = lightTheme();
  // What is on the sky puts back the light value of every colour the dark
  // theme changes: the wordmark, a white pill on a hero, its notes.
  const sky = onDawnBlock();
  for (const [property] of chosen) {
    if (property === "color-scheme") continue;
    expect(sky.get(property), `.on-dawn puts back ${property}`).toBe(light.get(property));
  }
  expect(sky.get("color-scheme")).toBe("light");
  // White stays white (the text on the sky and on the buttons), and the
  // glows of the sky keep their colours.
  for (const kept of ["--color-white", "--color-iris-400", "--color-peach-300"]) {
    expect(chosen.has(kept), `${kept} is kept`).toBe(false);
  }
  // The skies and the dawn of the buttons are written out, not made of
  // colours that the dark theme changes.
  for (const utility of ["bg-dawn-sky", "bg-dawn-hero", "bg-dawn-deep", "bg-dawn"]) {
    expect(block(styles, `@utility ${utility}`), `the dawn of ${utility}`).not.toMatch(
      /var\(--color/,
    );
  }
});

test("dark — le texte blanc des boutons en dégradé ne change pas : 4,5:1 sur chaque couleur de l'aube", () => {
  // The text is `text-white`, and the dark theme leaves white alone (see above).
  expect(darkBlocks().chosen.has("--color-white")).toBe(false);
  for (const { skin, label } of SKIN_CASES) {
    const stops = utilityBody("bg-dawn-deep", skin).match(/#[0-9a-f]{6}/gi) ?? [];
    expect(stops.length, `stops of ${label}`).toBeGreaterThanOrEqual(skin === DEFAULT_SKIN ? 3 : 2);
    for (const stop of stops) {
      expect(contrast("#ffffff", stop), `${label}: white on ${stop}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

/** Each pair of a text and its ground, with the least contrast it must have. */
const PAIRS: readonly [text: string, ground: string, least: number][] = [
  // The text, on every ground it sits on.
  ...["ink", "neutral-600", "neutral-700", "neutral-800", "neutral-900"].flatMap((text) =>
    GROUNDS.map((ground): [string, string, number] => [text, ground, 4.5]),
  ),
  // The links and the accents in words (« D+ », a month, « Voir tout »).
  ...["neutral-50", "card", "raised", "iris-50"].map((ground): [string, string, number] => [
    "iris-700",
    ground,
    4.5,
  ]),
  // The text of a soft chip: an event in the agenda, the current status of a menu.
  ["iris-800", "iris-50", 4.5],
  ["iris-800", "iris-100", 4.5],
  ["ink", "iris-50", 4.5],
  // « Inscriptions jusqu'au… », the reminder to register.
  ["peach-800", "peach-50", 4.5],
  ["neutral-900", "peach-50", 4.5],
  // An error, under a field or for a whole form, and the text of a delete action.
  ...["neutral-50", "card", "raised", "red-50"].map((ground): [string, string, number] => [
    "red-700",
    ground,
    4.5,
  ]),
  // Text on a fill: the button that deletes (at rest and under the pointer)
  // and today in the agenda on a large screen; their text has the colour of a card.
  ["card", "red-700", 4.5],
  ["card", "red-800", 4.5],
  ["card", "iris-600", 4.5],
  // The ring of the focus, and the icons in colour.
  ...["neutral-50", "card", "raised"].map((ground): [string, string, number] => [
    "iris-600",
    ground,
    3,
  ]),
  ["peach-700", "peach-50", 3],
];

test("dark — le texte a 4,5:1 sur la feuille, les cartes, les fenêtres, les champs et les panneaux ; les liens, les erreurs, les pastilles et l'anneau du focus aussi", () => {
  for (const one of SKIN_CASES) {
    for (const [text, ground, least] of PAIRS) {
      const [value, label] = ratio(one, text, ground);
      expect(value, `contrast of ${label}`).toBeGreaterThanOrEqual(least);
    }
  }
});

test("dark — un message (toast, hors ligne) : du blanc sur sa pastille", () => {
  for (const { skin, mode, label } of SKIN_CASES) {
    const toast = themeColour("toast", mode, skin);
    expect(contrast("#ffffff", toast), `${label}: white on ${toast}`).toBeGreaterThanOrEqual(4.5);
  }
});

test("dark — l'épingle d'un lieu, rose sur une carte la nuit, a 3:1", () => {
  // By day, the words beside it say the place; the pink is lighter than 3:1 on white.
  for (const one of SKIN_CASES.filter(({ mode }) => mode === "dark")) {
    const [value, label] = ratio(one, "blush-500", "card");
    expect(value, `contrast of ${label}`).toBeGreaterThanOrEqual(3);
  }
});

// --- The other skins (src/skins/README.md) ---

const OTHER_SKINS = [...new Set(SKIN_CASES.map(({ skin }) => skin))].filter(
  (skin) => skin !== DEFAULT_SKIN,
);

test("dark — un skin ne change que des propriétés que Crête déclare, sous son propre sélecteur", () => {
  // Not an empty search: the example skin of development is one.
  expect(OTHER_SKINS.length).toBeGreaterThan(0);
  const known = lightTheme();
  for (const skin of OTHER_SKINS) {
    const css = skinStylesheet(skin);
    const { root, darkChosen, darkFollowed, sky } = skinSelectors(skin);
    const own = [
      ...skinDeclarations(css, root).keys(),
      ...skinDeclarations(css, darkChosen).keys(),
      ...skinDeclarations(css, darkFollowed, "@media (prefers-color-scheme: dark)").keys(),
      ...skinDeclarations(css, sky).keys(),
    ];
    expect(own.length, `${skin} sets no colour`).toBeGreaterThan(0);
    for (const property of own) {
      if (property === "color-scheme") continue;
      expect(known.has(property), `${skin} sets ${property}, which Crête does not declare`).toBe(
        true,
      );
    }
    // Every rule is the skin's, in a media query or not: a page in another skin never sees it.
    const selectors = rules(css)
      .flatMap((rule) => (rule.prelude.startsWith("@media") ? rules(rule.body) : [rule]))
      .flatMap(({ prelude }) => prelude.split(","))
      .map((selector) => selector.trim());
    expect(selectors.length, `skin ${skin}`).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector.startsWith(root), `${skin}: ${selector}`).toBe(true);
    }
  }
});

test("dark — un skin à deux modes : son sombre est le même choisi ou suivi, et redit la nuit ce qu'il change le jour", () => {
  const night = darkBlocks().chosen;
  for (const skin of OTHER_SKINS.filter((one) => skinModes(one).length > 1)) {
    const css = skinStylesheet(skin);
    const { root, darkChosen, darkFollowed } = skinSelectors(skin);
    const chosen = skinDeclarations(css, darkChosen);
    const followed = skinDeclarations(css, darkFollowed, "@media (prefers-color-scheme: dark)");
    expect(chosen.size, `skin ${skin}`).toBeGreaterThan(0);
    expect(Object.fromEntries(followed), `skin ${skin}`).toEqual(Object.fromEntries(chosen));
    // Its colours of the day are outside the layers: one that Crête changes at
    // night would stay the day's in the dark, unless the skin says it again.
    const redone = [...skinDeclarations(css, root).keys()].filter((property) =>
      night.has(property),
    );
    for (const property of redone) {
      expect(chosen.has(property), `${skin} sets ${property} by day, not at night`).toBe(true);
    }
  }
});
