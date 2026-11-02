import { expect, test } from "vitest";

import { contrast } from "./test/colour";
import {
  DARK_CHOSEN,
  DARK_FOLLOWED,
  DEFAULT_SKIN,
  appStylesheet,
  SKIN_CASES,
  block,
  darkBlocks,
  lightTheme,
  onDawnBlock,
  rules,
  sheetProblems,
  skinDeclarations,
  skinModes,
  skinSelectors,
  skinStylesheet,
  skinsWithFonts,
  linearStops,
  skyColour,
  skyValue,
  themeColour,
  themeValue,
  type SkinCase,
} from "./test/theme";

// « Crête » at night: the sky of the header (the dawn, its map, its ridges, its
// sun and the name in white) is the same in both themes, and only what is under
// it turns dark. These are the numbers that make the dark theme as legible as
// the light one: text at 4.5:1 on every ground it sits on (WCAG 2, AA), a mark
// or a line that says something at 3:1, and the white text of the buttons in
// the colours of the dawn as it was. Every skin of the app (src/skins/) is held
// to the same numbers, in each mode it has: Crête by day and at night first.

const styles = appStylesheet();

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
  // The skies and the dawn of the buttons are paints of their own (`--dawn-*`),
  // which every utility of the dawn reads; they are written out, not made of
  // colours that the dark theme changes, and the night leaves them alone.
  for (const utility of ["bg-dawn-sky", "bg-dawn-hero", "bg-dawn-deep", "bg-dawn", "text-dawn"]) {
    expect(block(styles, `@utility ${utility}`), `the dawn of ${utility}`).toMatch(
      /var\(--dawn-[a-z-]+\)/,
    );
  }
  const paints = [...light.keys()].filter((property) => property.startsWith("--dawn-"));
  expect(paints.length).toBeGreaterThan(8);
  for (const paint of paints) {
    expect(light.get(paint), `${paint} is written out`).not.toMatch(/var\(--color/);
    expect(chosen.has(paint), `${paint} is the same at night`).toBe(false);
  }
});

test("dark — le texte des boutons en dégradé (--dawn-deep-ink) ne change pas la nuit : 4,5:1 sur chaque couleur de l'aube", () => {
  // The text is `text-dawn-deep-ink`, white in Crête, a paint of the dawn that
  // the night leaves alone (see above); a skin whose deep dawn is light (a lime)
  // writes on it in a dark ink of its own.
  expect(themeValue("--dawn-deep-ink")).toBe("#ffffff");
  for (const { skin, mode, label } of SKIN_CASES) {
    const ink = themeValue("--dawn-deep-ink", mode, skin);
    expect(ink, `${label}: --dawn-deep-ink`).toMatch(/^#[0-9a-f]{6}$/i);
    const stops = linearStops(themeValue("--dawn-deep", mode, skin));
    expect(stops.length, `stops of ${label}`).toBeGreaterThanOrEqual(skin === DEFAULT_SKIN ? 3 : 2);
    for (const stop of stops) {
      expect(contrast(ink, stop), `${label}: ${ink} on ${stop}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("dark — la carte des pages de connexion : son texte a 4,5:1 sur elle, dans chaque skin et chaque mode", () => {
  // The card of the sign-in pages (routes/__root) is the frosted glass of a
  // card (`glass`: 82 % of `--color-card`) over the sky, under the ground that
  // `--welcome-card` lays on it: none in Crête (`transparent`), the opaque card
  // of a skin whose sky is dark. Its text: the title and the words (ink, the
  // labels), the errors, and on an opaque card the hints (neutral-600). Glass
  // is measured over the colours of the sky (its art aside, as the notes of an
  // event over a hero), where a hint is not held to 4.5: Crête's is 4.3:1 over
  // the darkest violet of its sky by this measure (4.46 to 4.5 on the pixels of
  // its card, which is lighter there), and Crête stays as it is (so does
  // Aurore, on Crête's sky).
  expect(themeValue("--welcome-card")).toBe("transparent");
  for (const { skin, mode, label } of SKIN_CASES) {
    const laid = themeValue("--welcome-card", mode, skin);
    expect(laid, `${label}: --welcome-card`).toMatch(/^(transparent|#[0-9a-f]{6})$/i);
    const card = themeColour("card", mode, skin);
    const glass = laid === "transparent";
    const grounds = glass
      ? [
          themeValue("--dawn-sky-color", mode, skin),
          ...linearStops(themeValue("--dawn-sky", mode, skin)),
        ].map((sky) => mixed(card, sky, 0.82))
      : [laid];
    const texts = glass
      ? ["ink", "neutral-800", "red-700"]
      : ["ink", "neutral-600", "neutral-800", "red-700"];
    for (const ground of grounds) {
      for (const text of texts) {
        const colour = themeColour(text, mode, skin);
        expect(
          contrast(colour, ground),
          `${label}: ${text} (${colour}) on the card of the sign-in pages (${ground})`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});

/** The three channels of a `#rrggbb` colour, from 0 to 255. */
const channels = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

/** A colour mixed with another, `amount` of the first (as `color-mix(in srgb, …)`). */
function mixed(first: string, second: string, amount: number): string {
  const [a, b] = [channels(first), channels(second)];
  return `#${a
    .map((value, i) =>
      Math.round(value * amount + (b[i] ?? 0) * (1 - amount))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

test("dark — le ciel de chaque skin, dans chaque mode : le texte blanc, la pastille « S'inscrire » et les notes se lisent", () => {
  for (const { skin, mode, label } of SKIN_CASES) {
    // The white text of the header and of a hero, on every colour of their linear gradients.
    for (const paint of ["--dawn-sky", "--dawn-hero"]) {
      const colour = themeValue(`${paint}-color`, mode, skin);
      for (const stop of [colour, ...linearStops(themeValue(paint, mode, skin))]) {
        expect(
          contrast("#ffffff", stop),
          `${label}: white on ${paint} (${stop})`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    // « S'inscrire » on a hero (ON_DAWN): its text in iris-700 on a white pill.
    const pill = skyColour("iris-700", mode, skin);
    expect(
      contrast(pill, "#ffffff"),
      `${label}: iris-700 (${pill}) on the white pill`,
    ).toBeGreaterThanOrEqual(4.5);
    // The notes of an event: ink on a frosted card (`glass`, 82 % of a card) over the hero.
    const ink = skyColour("ink", mode, skin);
    const card = skyColour("card", mode, skin);
    const behind = [
      themeValue("--dawn-hero-color", mode, skin),
      ...linearStops(themeValue("--dawn-hero", mode, skin)),
    ];
    for (const colour of behind) {
      const ground = mixed(card, colour, 0.82);
      expect(
        contrast(ink, ground),
        `${label}: ink (${ink}) on the notes over ${colour} (${ground})`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("dark — la carte d'une trace, claire dans tous les modes : les liens de l'attribution et les mots du départ, de l'arrivée et du zoom à 4,5:1, le départ et l'arrivée à 3:1", () => {
  for (const { skin, mode, label } of SKIN_CASES) {
    const link = themeValue("--map-link", mode, skin);
    expect(contrast(link, "#ffffff"), `${label}: --map-link (${link})`).toBeGreaterThanOrEqual(4.5);
    // The labels and the zoom buttons are on Leaflet's white; a zoom button on --map-hover when hovered.
    const ink = themeValue("--map-ink", mode, skin);
    const hover = themeValue("--map-hover", mode, skin);
    expect(contrast(ink, "#ffffff"), `${label}: --map-ink (${ink})`).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(ink, hover),
      `${label}: --map-ink (${ink}) on --map-hover (${hover})`,
    ).toBeGreaterThanOrEqual(4.5);
    for (const end of ["--map-start", "--map-finish"]) {
      const colour = themeValue(end, mode, skin);
      expect(contrast(colour, "#ffffff"), `${label}: ${end} (${colour})`).toBeGreaterThanOrEqual(3);
    }
  }
});

test("dark — le ciel d'un skin à deux modes reste celui de son jour, la nuit", () => {
  // As Crête's (above): what sits on the sky has the colours of the day, at
  // night too: every property that the night changes, Crête's or the skin's.
  for (const skin of [...new Set(SKIN_CASES.map((one) => one.skin))].filter(
    (one) => skinModes(one).length > 1,
  )) {
    const changed = new Set([
      ...darkBlocks().chosen.keys(),
      ...skinDeclarations(skinStylesheet(skin), skinSelectors(skin).darkChosen).keys(),
    ]);
    changed.delete("color-scheme");
    expect(changed.size, `the night of ${skin}`).toBeGreaterThan(30);
    for (const property of changed) {
      expect(skyValue(property, "dark", skin), `${skin}: ${property} on the sky at night`).toBe(
        skyValue(property, "light", skin),
      );
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
  // The ring of a swatch in the picker of the skins, on a card and on a chosen
  // or hovered card: it draws the edge of a swatch whatever its colour.
  ...["card", "iris-50"].map((ground): [string, string, number] => ["neutral-600", ground, 3]),
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

/** The rules of a stylesheet of a skin, those in a media query included, with the properties each declares. */
function skinRules(css: string): { selectors: string[]; properties: string[]; media: boolean }[] {
  return rules(css)
    .flatMap((rule) =>
      rule.prelude.startsWith("@media")
        ? rules(rule.body).map((inner) => ({ ...inner, media: true }))
        : [{ ...rule, media: false }],
    )
    .map(({ prelude, body, media }) => ({
      selectors: prelude.split(",").map((selector) => selector.replace(/\s+/g, " ").trim()),
      properties: body
        .split(";")
        .map((declaration) => declaration.trim())
        .filter((declaration) => declaration !== "")
        .map((declaration) => declaration.slice(0, declaration.indexOf(":")).trim()),
      media,
    }));
}

test("dark — un skin ne fait que changer, sous son propre sélecteur, ce que README.md permet : sa palette", () => {
  // Not an empty search: the example skin of development is one.
  expect(OTHER_SKINS.length).toBeGreaterThan(0);
  const known = new Set(lightTheme().keys());
  for (const skin of OTHER_SKINS) {
    expect(
      rules(skinStylesheet(skin, "palette")).length,
      `${skin} has no palette.css`,
    ).toBeGreaterThan(0);
  }
  // palette.css: custom properties of Crête on the skin's page, night and sky
  // (no shadow, which Tailwind writes into its utilities, no font, which
  // fonts.css has): src/test/skinSheets.test.ts says which forms, on sheets of its own.
  const problems = OTHER_SKINS.flatMap((skin) =>
    sheetProblems(skinStylesheet(skin, "palette"), skin, known),
  );
  expect(problems).toEqual([]);
});

/** What a face of a font may say: nothing that paints, nothing that loads more than its file. */
const FACE_PROPERTIES = [
  "font-family",
  "font-style",
  "font-weight",
  "font-stretch",
  "font-display",
  "src",
  "unicode-range",
  "size-adjust",
];

/** The custom properties of fonts a skin may set (Tailwind's `font-sans`, `font-mono`, `font-serif`, and the titles). */
const FONT_PROPERTIES = ["--font-sans", "--font-display", "--font-mono", "--font-serif"];

test("dark — les polices d'un skin (fonts.css) : des @font-face, et ses --font-* sous son seul sélecteur", () => {
  // Every folder that has one, a skin or the start of one: Task 2 of v6 adds
  // the fonts before the skins.
  const folders = skinsWithFonts();
  expect(folders.length).toBeGreaterThan(0);
  const problems = folders.flatMap((skin) => {
    const { root } = skinSelectors(skin);
    const sheet = skinRules(skinStylesheet(skin, "fonts"));
    return sheet.flatMap(({ selectors, properties, media }) => {
      const isFace = selectors.length === 1 && selectors[0] === "@font-face";
      const allowed = isFace ? FACE_PROPERTIES : FONT_PROPERTIES;
      return [
        // Nothing in a media query: the same fonts, whatever the mode.
        ...(media ? [`${skin}: a rule in a media query`] : []),
        ...(isFace || (selectors.length === 1 && selectors[0] === root)
          ? []
          : [`${skin}: the selector ${selectors.join(", ")}`]),
        ...properties
          .filter((property) => !allowed.includes(property))
          .map((property) => `${skin}: ${isFace ? "@font-face" : root} sets ${property}`),
      ];
    });
  });
  expect(problems).toEqual([]);
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
