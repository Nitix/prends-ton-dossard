import { existsSync, readdirSync, readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { SKINS } from "./skins";
import { appStylesheet, block } from "./test/theme";

// « Crête » is set in Inter and Plus Jakarta Sans. They are served by the site
// itself (the @fontsource-variable packages, built into /assets/ and kept by
// the service worker), not by Google: a font that comes from another host tells
// that host who opens the app, and it is missing when the installed app opens
// without a network. Nothing in these files names that host or breaks that.
// The same goes for the fonts of the other skins (src/skins/<id>/fonts.css).

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = appStylesheet();

/** The stylesheet of fonts of every folder of src/skins/ that has one, by the id of the folder. */
const skinFonts: Record<string, string> = Object.fromEntries(
  readdirSync(new URL("./skins/", import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(skinFontsUrl(entry.name)))
    .map((entry) => [entry.name, readFileSync(skinFontsUrl(entry.name), "utf8")]),
);

function skinFontsUrl(id: string): URL {
  return new URL(`./skins/${id}/fonts.css`, import.meta.url);
}

/** The value of a custom property declared in the theme, on one or several lines. */
function themeValue(css: string, name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (match?.[1] === undefined) throw new Error(`${name} is not declared in styles.css`);
  return match[1].replace(/\s+/g, " ").trim();
}

/** The files named by the `@font-face` rules of a family, in the order of the stylesheet. */
function faceFiles(css: string, family: string): string[] {
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  return faces
    .filter((face) => face.includes(`font-family: "${family}"`))
    .flatMap((face) => [...face.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1] ?? ""));
}

test("fonts — no request leaves the site", () => {
  // Neither the stylesheet, the files, nor the connections opened in advance.
  expect(page).not.toContain("fonts.googleapis.com");
  expect(page).not.toContain("fonts.gstatic.com");
  for (const link of page.match(/<link\b[^>]*>/g) ?? []) {
    // In any order of its attributes.
    const early = /\brel="(?:preconnect|dns-prefetch|preload)"/.test(link);
    expect(early && /https?:/.test(link), `the link ${link}`).toBe(false);
  }
  expect(styles).not.toMatch(/googleapis|gstatic/);

  // The stacks name the self-hosted families first, and keep the system fonts
  // for the time the files are loading and for a file that fails.
  const sans = themeValue(styles, "--font-sans");
  expect(sans).toMatch(/^"Inter Variable",/);
  expect(sans).toContain("system-ui");
  expect(sans).toContain("sans-serif");

  const display = themeValue(styles, "--font-display");
  expect(display).toMatch(/^"Plus Jakarta Sans Variable",/);
  expect(display).toContain('"Inter Variable"');
  expect(display).toContain("system-ui");
  expect(display).toContain("sans-serif");
});

test("fonts — the faces are the files of both packages, latin and latin-ext only", () => {
  // A family that is named but never declared would silently fall back to the
  // system font: the stacks above are only true if the faces exist. They come
  // from the packages (a path of the build, never a host), and only the two
  // subsets that French needs: the others would be built into /assets/ and
  // embedded in the program for nothing.
  expect(faceFiles(styles, "Inter Variable")).toEqual([
    "@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2",
    "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  ]);
  expect(faceFiles(styles, "Plus Jakarta Sans Variable")).toEqual([
    "@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-ext-wght-normal.woff2",
    "@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2",
  ]);
});

test("fonts — nothing imports the packages' own stylesheets, which would bring every script", () => {
  // Their CSS (`@import "@fontsource-variable/inter"`, or an import in a
  // module) declares a face for each script of the font: the build would emit
  // them all into /assets/ and the program. Only the four faces above are
  // declared, by hand. The `url()` of those faces name the packages too, and
  // so do the comments: both are taken out before the search.
  const rules = styles.replace(/\/\*[\s\S]*?\*\//g, "").replace(/url\([^)]*\)/g, "url()");
  expect(rules).not.toContain("@fontsource");
  // A module that names a package of the fonts, in an import of any form.
  const main = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
  expect(main).not.toMatch(/["']@fontsource/);
});

test("fonts — the page names no other host", () => {
  // No stylesheet, script, icon or manifest of the page comes from another site.
  expect(page).not.toMatch(/(?:href|src)="https?:/);
});

test("fonts — every face names a file that the package has", () => {
  // Vite leaves a `url()` it cannot resolve as it is, with a warning only: a
  // package that moves its files would leave the site in the system fonts.
  const files = [
    ...faceFiles(styles, "Inter Variable"),
    ...faceFiles(styles, "Plus Jakarta Sans Variable"),
  ];
  expect(files).toHaveLength(4);
  for (const file of files) {
    expect(
      existsSync(new URL(`../node_modules/${file}`, import.meta.url)),
      `the file of ${file}`,
    ).toBe(true);
  }
});

// --- The fonts of the other skins (src/skins/README.md, « Fonts ») ---
//
// Each skin has a src/skins/<id>/fonts.css: the faces of its fonts, written by
// hand like Crête's (the latin and latin-ext files of a package), and its
// `--font-*` under `:root[data-skin="<id>"]`; the faces that two skins share are
// in src/skins/shared/fonts.css. Each is in the part of the build of its skin's
// look, loaded when the skin is chosen, and the browser fetches a face only when
// a page draws text in its family: a person who stays on « Crête » downloads
// none of them.

type Span = [number, number];
type Subset = "latin-ext" | "latin";
type Kind = "sans" | "display" | "mono" | "serif";

/** What a skin needs of a font: a family, its style, the weights (and widths) the variant was drawn with. */
type Need = {
  family: string;
  style?: "italic";
  weights: Span;
  stretch?: Span;
  /** The subsets of the file, when it is not both of them. */
  subsets?: Subset[];
};

const INTER: Need = { family: "Inter Variable", weights: [400, 700] };
const statics = (family: string, weights: number[], style?: "italic"): Need[] =>
  weights.map((weight) => ({ family, weights: [weight, weight], ...(style ? { style } : {}) }));

/**
 * The ten skins and their fonts, from the plan of v6 (Task 2): the families
 * their stacks name besides the system ones, in order, and the faces they need
 * under them. A family shared by two skins (Outfit, Inter Tight) is declared
 * once, for the weights of both.
 */
const SKIN_FONTS: Record<string, { stacks: Partial<Record<Kind, string[]>>; faces: Need[] }> = {
  piste: {
    stacks: { sans: ["Inter Variable"], display: ["Barlow Condensed", "Inter Variable"] },
    faces: [
      INTER,
      ...statics("Barlow Condensed", [600, 700, 800]),
      ...statics("Barlow Condensed", [700, 800], "italic"),
    ],
  },
  sentier: {
    stacks: { sans: ["Inter Variable"], display: ["Outfit Variable", "Inter Variable"] },
    faces: [INTER, { family: "Outfit Variable", weights: [500, 700] }],
  },
  nuit: {
    stacks: { sans: ["Inter Variable"], display: ["Space Grotesk Variable", "Inter Variable"] },
    faces: [INTER, { family: "Space Grotesk Variable", weights: [500, 700] }],
  },
  dossard: {
    stacks: { sans: ["Inter Variable"], display: ["Archivo Variable"] },
    faces: [INTER, { family: "Archivo Variable", weights: [700, 900], stretch: [62, 125] }],
  },
  marathon: {
    stacks: { sans: ["Inter Variable"], display: ["Inter Tight Variable", "Inter Variable"] },
    faces: [
      INTER,
      { family: "Inter Tight Variable", weights: [600, 900] },
      { family: "Inter Tight Variable", style: "italic", weights: [800, 900] },
    ],
  },
  aurore: {
    stacks: { sans: ["Inter Variable"], display: ["Plus Jakarta Sans Variable", "Inter Variable"] },
    faces: [INTER, { family: "Plus Jakarta Sans Variable", weights: [600, 800] }],
  },
  retro: {
    stacks: {
      sans: ["Inter Variable"],
      display: ["Bricolage Grotesque Variable", "Inter Variable"],
    },
    faces: [INTER, { family: "Bricolage Grotesque Variable", weights: [600, 800] }],
  },
  chrono: {
    // The digits of JetBrains Mono come first, in front of the letters of Inter Tight.
    stacks: {
      sans: ["Chrono Digits", "Inter Tight Variable"],
      display: ["Chrono Digits", "Inter Tight Variable"],
      mono: ["JetBrains Mono Variable"],
    },
    faces: [
      { family: "Inter Tight Variable", weights: [400, 700] },
      { family: "JetBrains Mono Variable", weights: [500, 700] },
      { family: "Chrono Digits", weights: [400, 700], subsets: ["latin"] },
    ],
  },
  alpage: {
    stacks: { sans: ["Inter Variable"], display: ["Outfit Variable", "Inter Variable"] },
    faces: [INTER, { family: "Outfit Variable", weights: [500, 800] }],
  },
  carnet: {
    stacks: {
      sans: ["Geist Variable"],
      display: ["Geist Variable"],
      serif: ["Instrument Serif"],
    },
    faces: [
      { family: "Geist Variable", weights: [300, 700] },
      { family: "Instrument Serif", style: "italic", weights: [400, 400] },
    ],
  },
};

/** A font of the system that a stack may name; any other quoted family has to be declared. */
const SYSTEM_FONTS = [
  "Segoe UI",
  "Arial Narrow",
  "Arial Black",
  "SFMono-Regular",
  "Times New Roman",
  "Helvetica Neue",
];

/** The faces made of a package's file for only a part of its range: the digits of JetBrains Mono. */
const PARTIAL_FACES = ["Chrono Digits"];

type Face = {
  sheet: string;
  family: string;
  style: string;
  weights: Span;
  stretch: Span | undefined;
  /** The file, as the `url()` says it (`@fontsource-variable/inter/files/inter-latin-wght-normal.woff2`). */
  file: string;
  subset: Subset | undefined;
  /** The unicode-range, with no space in it. */
  range: string;
};

const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of a block, by property. */
function declared(body: string): Record<string, string> {
  return Object.fromEntries(
    [...body.matchAll(/([a-z-]+)\s*:\s*([^;}]+)/g)].map((match) => [
      match[1] ?? "",
      (match[2] ?? "").trim(),
    ]),
  );
}

/** `500 800` or `700` or `62% 125%`: the two ends of a range. */
function span(value: string | undefined): Span | undefined {
  if (value === undefined) return undefined;
  const [from, to] = value.replace(/%/g, "").trim().split(/\s+/).map(Number);
  return [from ?? Number.NaN, to ?? from ?? Number.NaN];
}

function subsetOf(file: string): Subset | undefined {
  const subset = /-(latin-ext|latin)-[^/]*$/.exec(file)?.[1];
  return subset === "latin" || subset === "latin-ext" ? subset : undefined;
}

/** The faces that the `@font-face` rules of a stylesheet declare, comments out. */
function facesOf(css: string, sheet: string): Face[] {
  return (noComments(css).match(/@font-face\s*\{[^}]*\}/g) ?? []).map((rule) => {
    const props = declared(rule.slice(rule.indexOf("{") + 1, -1));
    const file = /url\("([^"]+)"\)/.exec(props.src ?? "")?.[1] ?? "";
    return {
      sheet,
      family: (props["font-family"] ?? "").replace(/"/g, ""),
      style: props["font-style"] ?? "",
      weights: span(props["font-weight"]) ?? [Number.NaN, Number.NaN],
      stretch: span(props["font-stretch"]),
      file,
      subset: subsetOf(file),
      range: (props["unicode-range"] ?? "").replace(/\s+/g, ""),
    };
  });
}

const sheets = [
  { sheet: "styles.css", css: styles },
  ...Object.entries(skinFonts).map(([id, css]) => ({ sheet: `skins/${id}/fonts.css`, css })),
];
const allFaces = sheets.flatMap(({ sheet, css }) => facesOf(css, sheet));

/** What the package itself declares for a file of its own: its style, weights, widths and range. */
function packageFace(file: string): Omit<Face, "sheet" | "file" | "subset"> | undefined {
  const [scope, name, , basename] = file.split("/");
  const dir = new URL(`../node_modules/${scope}/${name}/`, import.meta.url);
  if (!existsSync(dir)) return undefined;
  for (const css of readdirSync(dir).filter((entry) => entry.endsWith(".css"))) {
    const text = readFileSync(new URL(css, dir), "utf8");
    for (const rule of text.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
      if (!rule.includes(`./files/${basename})`)) continue;
      const props = declared(rule.slice(rule.indexOf("{") + 1, -1));
      return {
        family: (props["font-family"] ?? "").replace(/'/g, ""),
        style: props["font-style"] ?? "",
        weights: span(props["font-weight"]) ?? [Number.NaN, Number.NaN],
        stretch: span(props["font-stretch"]),
        range: (props["unicode-range"] ?? "").replace(/\s+/g, ""),
      };
    }
  }
  return undefined;
}

/** The stack of a `--font-<kind>` that the fonts.css of a skin sets under its own selector. */
function stackOf(id: string, kind: Kind): string | undefined {
  const rule = new RegExp(`:root\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`).exec(
    noComments(skinFonts[id] ?? ""),
  );
  return declared(rule?.[1] ?? "")[`--font-${kind}`];
}

/** The families of a stack that are not the system's, in order: what has to be declared. */
function fontsOf(stack: string): string[] {
  return [...stack.matchAll(/"([^"]+)"/g)]
    .map((match) => match[1] ?? "")
    .filter((family) => !SYSTEM_FONTS.includes(family));
}

test("fonts — every skin has its fonts.css, and none names a host or imports a package's stylesheet", () => {
  expect(Object.keys(skinFonts)).toEqual(expect.arrayContaining(Object.keys(SKIN_FONTS)));
  for (const [id, css] of Object.entries(skinFonts)) {
    // Neither Google nor any other host, in a face or in a comment.
    expect(css, `skins/${id}/fonts.css`).not.toMatch(/googleapis|gstatic|https?:|\/\//);
    // As Crête's: the faces are written by hand (the package's CSS would bring every script).
    expect(noComments(css).replace(/url\([^)]*\)/g, "url()"), `skins/${id}/fonts.css`).not.toMatch(
      /@import|@fontsource/,
    );
  }
  // Nothing of the page loads a font ahead of the use of its face, whatever the
  // order of the attributes of its links.
  expect(earlyFonts(page)).toEqual([]);
  expect(
    earlyFonts(
      '<link href="/a.woff2" rel="preload" as="font"><link as="font" rel="prefetch" href="/b"><link rel="stylesheet" href="/c.css">',
    ),
  ).toHaveLength(2);
});

/** The links of a page that fetch a font before a face uses it: a preload, a prefetch, in any order of their attributes. */
function earlyFonts(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*>/g)]
    .map((match) => match[0])
    .filter(
      (link) =>
        /\brel="(?:preload|prefetch|modulepreload)"/.test(link) &&
        /\.woff2?\b|\bas="font"|font/.test(link),
    );
}

test("fonts — every family that a fonts.css names in its stacks is declared by a face, of styles.css or of a fonts.css", () => {
  // Every folder that has one, a skin or not yet: not only those of SKIN_FONTS.
  expect(Object.keys(skinFonts).length).toBeGreaterThan(0);
  const declaredFamilies = new Set(allFaces.map((face) => face.family));
  const undeclared = Object.keys(skinFonts).flatMap((id) =>
    KINDS.flatMap((kind) =>
      fontsOf(stackOf(id, kind) ?? "")
        .filter((family) => !declaredFamilies.has(family))
        .map((family) => `${id}: --font-${kind} names "${family}", which no face declares`),
    ),
  );
  expect(undeclared).toEqual([]);
});

test("fonts — the sample of a skin in the picker is the stack of its titles: its fontSample is its --font-display", () => {
  // Every skin of the registry; one with no --font-display of its own has Crête's titles.
  expect(SKINS.length).toBeGreaterThan(1);
  for (const skin of SKINS) {
    const display = stackOf(skin.id, "display") ?? themeValue(styles, "--font-display");
    expect(fontsOf(skin.fontSample), `${skin.id}: fontSample`).toEqual(fontsOf(display));
  }
});

test("fonts — the faces of every skin are the latin and latin-ext woff2 files of the exact packages", () => {
  expect(allFaces.some((face) => face.sheet.startsWith("skins/"))).toBe(true);
  const problems = allFaces.flatMap((face) => {
    const where = `${face.sheet}: ${face.family} ${face.file}`;
    return [
      // A path of the build, never a host...
      /^@fontsource(-variable)?\/[a-z-]+\/files\/[^/]+\.woff2$/.test(face.file)
        ? []
        : [`${where}: not a woff2 file of a package`],
      // ...and the file is there (Vite would leave a `url()` it cannot resolve
      // as it is, with a warning only).
      existsSync(new URL(`../node_modules/${face.file}`, import.meta.url))
        ? []
        : [`${where}: the package has no such file`],
      // Only the two subsets that French needs: the others would be built into
      // /assets/ and embedded in the program for nothing.
      face.subset === undefined ? [`${where}: neither latin nor latin-ext`] : [],
      face.range === "" ? [`${where}: no unicode-range`] : [],
    ].flat();
  });
  expect(problems).toEqual([]);
});

/** Whether a range lies inside another one. */
const within = (inner: Span, outer: Span) => outer[0] <= inner[0] && inner[1] <= outer[1];

test("fonts — each face says what its package says of its file: style, weights, widths, range", () => {
  // A hand-written face copied from another one would keep its range: the
  // browser would then look for the letters of one subset in the file of the
  // other. The package's own declaration is the truth; the weights and widths
  // of a face may only be a part of the ones of the file (the ones the skin uses).
  const problems = allFaces.flatMap((face) => {
    const where = `${face.sheet}: ${face.family} ${face.file}`;
    const own = packageFace(face.file);
    if (own === undefined) return [`${where}: the package does not declare it`];
    // The digits of JetBrains Mono: a part of the range of its latin file, and no other.
    const range = PARTIAL_FACES.includes(face.family)
      ? { subset: "latin", range: "U+0030-0039" }
      : { subset: face.subset, range: own.range };
    return [
      face.style === own.style
        ? []
        : [`${where}: style ${face.style}, the package's is ${own.style}`],
      within(face.weights, own.weights) ? [] : [`${where}: weights ${face.weights.join(" ")}`],
      face.stretch === undefined || (own.stretch && within(face.stretch, own.stretch))
        ? []
        : [`${where}: widths ${face.stretch?.join(" ")}`],
      face.subset === range.subset ? [] : [`${where}: subset ${face.subset}`],
      face.range === range.range ? [] : [`${where}: unicode-range ${face.range}`],
    ].flat();
  });
  expect(problems).toEqual([]);
});

test("fonts — a face is declared once: a file twice under one family and style is a duplicate", () => {
  // Outfit is « Sentier »'s and « Alpage »'s, Inter Tight « Marathon »'s and
  // « Chrono »'s, Inter and Plus Jakarta Sans are Crête's (styles.css): each in one place.
  const keys = allFaces.map((face) => `${face.family}|${face.style}|${face.file}`);
  const twice = keys.filter((key, at) => keys.indexOf(key) !== at);
  expect(twice).toEqual([]);
});

const KINDS = ["sans", "display", "mono", "serif"] as const;

test("fonts — each skin names its families, declared, with system fonts after them", () => {
  const declaredFamilies = new Set(allFaces.map((face) => face.family));
  for (const [id, { stacks }] of Object.entries(SKIN_FONTS)) {
    for (const kind of KINDS) {
      const stack = stackOf(id, kind);
      // A stack the skin does not need is not set: Crête's would stay.
      expect(stack === undefined, `${id}: --font-${kind} only when the skin names one`).toBe(
        stacks[kind] === undefined,
      );
      // The families it names (besides the system ones), in order, and declared:
      // a family that is named but never declared silently falls back to the system font.
      const named = fontsOf(stack ?? "");
      expect(named, `${id}: --font-${kind}`).toEqual(stacks[kind] ?? []);
      expect(
        named.filter((family) => !declaredFamilies.has(family)),
        `${id}: --font-${kind}, the families that no face declares`,
      ).toEqual([]);
      // The system fonts keep the text readable while a file loads, or fails.
      expect(stack ?? "sans-serif", `${id}: --font-${kind}`).toMatch(
        /(?:sans-serif|serif|monospace)$/,
      );
    }
  }
});

test("fonts — each skin has every face it needs, in both subsets, at the weights of its variant", () => {
  const missing = Object.entries(SKIN_FONTS).flatMap(([id, { faces }]) =>
    faces.flatMap((need) =>
      (need.subsets ?? ["latin-ext", "latin"]).flatMap((subset) => {
        const found = allFaces.filter(
          (face) =>
            face.family === need.family &&
            face.style === (need.style ?? "normal") &&
            face.subset === subset &&
            within(need.weights, face.weights) &&
            (need.stretch === undefined ||
              (face.stretch !== undefined && within(need.stretch, face.stretch))),
        );
        // Exactly one: a second one would be declared twice.
        return found.length === 1
          ? []
          : [`${id}: ${need.family} ${need.style ?? ""} ${need.weights.join("–")} ${subset}`];
      }),
    ),
  );
  expect(missing).toEqual([]);
});

/** The value of a custom property that the palette of a skin sets on its page, if any. */
function paletteValue(id: string, property: string): string | undefined {
  const url = new URL(`./skins/${id}/palette.css`, import.meta.url);
  if (!existsSync(url)) return undefined;
  const rule = new RegExp(`:root\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`).exec(
    noComments(readFileSync(url, "utf8")),
  );
  return declared(rule?.[1] ?? "")[property];
}

/** The weights of the titles that take the style of the display face (`.page-title` 800, a block's and a card's 700). */
const TITLE_WEIGHTS = [700, 800];

test("fonts — the titles of a skin in italic or wider (--display-style, --display-stretch) have faces of that style and width", () => {
  // Crête's titles are upright, at the width of the face: its four values are declared.
  const crete = declared(
    /:root\s*\{([^}]*)\}/.exec(noComments(block(styles, "@layer base") ?? ""))?.[1] ?? "",
  );
  expect(
    ["--display-style", "--display-transform", "--display-stretch", "--display-tracking"].map(
      (property) => crete[property],
    ),
  ).toEqual(["normal", "none", "normal", "-0.025em"]);
  // A skin that asks its titles for a style or a width that no face has would
  // have them drawn by the browser: a slanted upright face, a width unchanged.
  // Not an empty search: Piste's titles are italic, Dossard's wider.
  expect(paletteValue("piste", "--display-style")).toBe("italic");
  expect(paletteValue("dossard", "--display-stretch")).toMatch(/%$/);
  const problems = Object.keys(skinFonts).flatMap((id) => {
    const style = paletteValue(id, "--display-style") ?? "normal";
    const stretch = paletteValue(id, "--display-stretch") ?? "normal";
    if (style === "normal" && stretch === "normal") return [];
    const [family] = fontsOf(stackOf(id, "display") ?? themeValue(styles, "--font-display"));
    const width = stretch === "normal" ? undefined : span(stretch);
    return TITLE_WEIGHTS.flatMap((weight) =>
      (["latin-ext", "latin"] as const).flatMap((subset) =>
        allFaces.some(
          (face) =>
            face.family === family &&
            face.subset === subset &&
            face.style === style &&
            within([weight, weight], face.weights) &&
            (width === undefined || (face.stretch !== undefined && within(width, face.stretch))),
        )
          ? []
          : [`${id}: ${family} ${style} ${weight} at ${stretch} (${subset})`],
      ),
    );
  });
  expect(problems).toEqual([]);
});

test("fonts — Crête names only its own families: a skin's are named by its own rule", () => {
  // A face is fetched when text is drawn in its family: with no data-skin on
  // the page, only Inter and Plus Jakarta Sans are, and nothing else is fetched.
  const own = ["Inter Variable", "Plus Jakarta Sans Variable"];
  const named = [...noComments(styles).matchAll(/--font-[a-z]+:\s*([^;]+);/g)].flatMap((match) =>
    fontsOf(match[1] ?? ""),
  );
  expect(new Set(named)).toEqual(new Set(own));
});

/**
 * The stylesheets that the look of a skin imports (`import "…css";` in its
 * look.ts, from its folder or a shared one), as `skins/<folder>/<file>.css`.
 */
function sheetsOfLook(id: string): string[] {
  const url = new URL(`./skins/${id}/look.ts`, import.meta.url);
  if (!existsSync(url)) return [];
  const source = readFileSync(url, "utf8");
  return [...source.matchAll(/^import "(\.\.?\/[^"]+\.css)";$/gm)].map(([, path = ""]) =>
    new URL(path, url).pathname.replace(/^.*\/src\//, ""),
  );
}

test("fonts — the look of each skin brings a face for every family its stacks name: its part of the build is all it needs", () => {
  // A skin is loaded on its own, when it is chosen: a family that only the
  // sheet of another skin declared would be missing (Inter Tight is Marathon's
  // and Chrono's, Outfit Sentier's and Alpage's: they are in skins/shared/).
  const crete = new Set(facesOf(styles, "styles.css").map((face) => face.family));
  expect(sheetsOfLook("chrono")).toContain("skins/shared/fonts.css");
  const missing = SKINS.filter((skin) => skin.id !== "crete").flatMap((skin) => {
    const brought = new Set(
      sheetsOfLook(skin.id).flatMap((sheet) =>
        facesOf(readFileSync(new URL(`./${sheet}`, import.meta.url), "utf8"), sheet).map(
          (face) => face.family,
        ),
      ),
    );
    return KINDS.flatMap((kind) =>
      fontsOf(stackOf(skin.id, kind) ?? "")
        .filter((family) => !crete.has(family) && !brought.has(family))
        .map(
          (family) => `${skin.id}: --font-${kind} names "${family}", which its look does not bring`,
        ),
    );
  });
  expect(missing).toEqual([]);
});

/** The faces of the samples of the picker, which the section of « Apparence » loads. */
const SAMPLES = "skins/samples.css";

test("fonts — the samples of the picker: each skin's « Aa » has a face of its titles' font, the latin file of its own face, at the weight of the sample", () => {
  const css = existsSync(new URL(`./${SAMPLES}`, import.meta.url))
    ? readFileSync(new URL(`./${SAMPLES}`, import.meta.url), "utf8")
    : "";
  const samples = facesOf(css, SAMPLES);
  // Faces only: the section loads no colour, no stack, no other sheet of a skin.
  expect(
    noComments(css)
      .replace(/@font-face\s*\{[^}]*\}/g, "")
      .trim(),
  ).toBe("");
  const problems = samples.flatMap((face) => {
    const where = `${SAMPLES}: ${face.family} ${face.file}`;
    const own = packageFace(face.file);
    return [
      face.subset === "latin" ? [] : [`${where}: not the latin file`],
      face.style === "normal" && face.weights.join() === "700,700"
        ? []
        : [`${where}: ${face.style} ${face.weights.join("–")}, not the sample's normal 700`],
      own !== undefined && within(face.weights, own.weights) && face.range === own.range
        ? []
        : [`${where}: not what the package says of its file`],
      // The very file of the skin's own face: the browser fetches it once for both.
      allFaces.some((one) => one.file === face.file && one.family === face.family)
        ? []
        : [`${where}: no skin declares this file for this family`],
    ].flat();
  });
  expect(problems).toEqual([]);
  // Each skin: the first family of its sample that has the letters (« Chrono
  // Digits » has the digits only) is Crête's, or a face of the samples.
  const crete = new Set(facesOf(styles, "styles.css").map((face) => face.family));
  const drawn = new Set(samples.map((face) => face.family));
  const missing = SKINS.flatMap((skin) => {
    const family = fontsOf(skin.fontSample).find((one) => !PARTIAL_FACES.includes(one));
    return family !== undefined && (crete.has(family) || drawn.has(family))
      ? []
      : [`${skin.id}: ${family ?? "no family"}`];
  });
  expect(missing).toEqual([]);
  expect(drawn.size).toBeGreaterThan(5);
});
