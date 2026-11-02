import { existsSync, readFileSync } from "node:fs";

import { SKINS } from "../skins";
import type { Depth } from "../skins/types";

// The colours of the theme, as styles.css declares them, so that a test reads
// the value the app is painted with and not a copy of it. The light theme is
// the `@theme` block (`--color-<name>: #hex;`); the dark theme is what the
// dark blocks change over it, the rest being the same. A colour may be given
// as the `var()` of another one.

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

export type Theme = "light" | "dark";

/** The selectors of the dark theme: chosen in the settings, or followed from the phone. */
export const DARK_CHOSEN = ':root[data-theme="dark"]';
export const DARK_FOLLOWED = ':root:not([data-theme="light"])';

/**
 * The body of the first block that `opener` (a selector or an at-rule, up to
 * its `{`) opens in `css`, inside its braces; `undefined` when there is none.
 */
export function block(css: string, opener: string): string | undefined {
  const at = css.indexOf(`${opener} {`);
  if (at === -1) return undefined;
  const start = at + opener.length + 2;
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") {
      if (depth === 0) return css.slice(start, i);
      depth--;
    }
  }
  return undefined;
}

/** The declarations at the top of a block (not those of the blocks inside it), by property. */
export function declarations(body: string | undefined): Map<string, string> {
  const flat = (body ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{[^{}]*\}/g, "{}")
    .replace(/\{[^{}]*\}/g, "{}");
  return new Map(
    [...flat.matchAll(/(?:^|[;{}\s])(--[a-z0-9-]+|color-scheme)\s*:\s*([^;{}]+);/g)].map(
      (match) => [match[1] ?? "", (match[2] ?? "").replace(/\s+/g, " ").trim()],
    ),
  );
}

/** The two dark blocks: the one of the setting, and the one of the phone's setting (in its media query). */
export function darkBlocks(): { chosen: Map<string, string>; followed: Map<string, string> } {
  return {
    chosen: declarations(block(styles, DARK_CHOSEN)),
    followed: declarations(
      block(block(styles, "@media (prefers-color-scheme: dark)") ?? "", DARK_FOLLOWED),
    ),
  };
}

/** What the sky (`.on-dawn`) puts back, whatever the theme. */
export function onDawnBlock(): Map<string, string> {
  return declarations(block(styles, ".on-dawn"));
}

/** The light theme: the custom properties of `@theme`, and those that `:root` adds (the colour of the shadows…). */
export function lightTheme(): Map<string, string> {
  return new Map([
    ...declarations(block(styles, "@theme")),
    ...declarations(block(styles, ":root")),
  ]);
}

// --- The skins (src/skins/README.md) ---
//
// Another skin than Crête sets the same custom properties in its palette.css,
// under `:root[data-skin="<id>"]`, and for its dark mode, if it has both, under
// `:root[data-skin="<id>"][data-theme="dark"]` and in the media query of the
// phone's setting. Its rules are outside the layers, so they win over every
// value of styles.css (which are in `@layer theme` and `@layer base`). A skin
// with one mode only has the page drawn in it (`data-theme` is that mode), so
// Crête's values of that mode are under its own.

/** The default skin, drawn by styles.css itself. */
export const DEFAULT_SKIN = "crete";

/** The selectors of a skin: its colours, its dark mode chosen and followed, its sky. */
export function skinSelectors(skin: string) {
  const root = `:root[data-skin="${skin}"]`;
  return {
    root,
    darkChosen: `${root}[data-theme="dark"]`,
    darkFollowed: `${root}:not([data-theme="light"])`,
    sky: `${root} .on-dawn`,
  };
}

/**
 * A stylesheet of a skin, by its level: its `palette.css` (its colours, the
 * only one that sets custom properties), `mix.css` or `full.css`; nothing when
 * it has none.
 */
export function skinStylesheet(skin: string, level: Depth = "palette"): string {
  if (skin === DEFAULT_SKIN) return "";
  const url = new URL(`../skins/${skin}/${level}.css`, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8") : "";
}

/** The rules of a stylesheet at its top level (or of a block), comments out: what is before each `{`, and inside it. */
export function rules(css: string): { prelude: string; body: string }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: { prelude: string; body: string }[] = [];
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf("{", at);
    if (open === -1) break;
    let depth = 0;
    let close = open + 1;
    for (; close < text.length; close++) {
      if (text[close] === "{") depth++;
      if (text[close] === "}") {
        if (depth === 0) break;
        depth--;
      }
    }
    found.push({ prelude: text.slice(at, open).trim(), body: text.slice(open + 1, close) });
    at = close + 1;
  }
  return found;
}

const tidy = (selector: string) => selector.replace(/\s+/g, " ").replaceAll("'", '"').trim();

/**
 * The bodies of the rules of `css` that have `selector` in their list of
 * selectors, in their order; in the media query `media` when it is given.
 */
export function bodiesOf(css: string, selector: string, media?: string): string[] {
  const scope =
    media === undefined
      ? rules(css).filter(({ prelude }) => !prelude.startsWith("@"))
      : rules(css)
          .filter(({ prelude }) => tidy(prelude) === media)
          .flatMap(({ body }) => rules(body));
  return scope
    .filter(({ prelude }) => prelude.split(",").map(tidy).includes(selector))
    .map(({ body }) => body);
}

/** The custom properties (and colour scheme) that the rules of `selector` declare in `css`, the last one winning. */
export function skinDeclarations(
  css: string,
  selector: string,
  media?: string,
): Map<string, string> {
  return new Map(bodiesOf(css, selector, media).flatMap((body) => [...declarations(body)]));
}

/** The modes of a skin, as the registry has them. */
export function skinModes(skin: string): readonly Theme[] {
  return SKINS.find(({ id }) => id === skin)?.modes ?? [];
}

function themeOf(theme: Theme, skin = DEFAULT_SKIN): Map<string, string> {
  const light = lightTheme();
  const crete = theme === "light" ? light : new Map([...light, ...darkBlocks().chosen]);
  if (skin === DEFAULT_SKIN) return crete;
  const css = skinStylesheet(skin);
  const { root, darkChosen } = skinSelectors(skin);
  const ownDark =
    theme === "dark" && skinModes(skin).length > 1 ? skinDeclarations(css, darkChosen) : new Map();
  return new Map([...crete, ...skinDeclarations(css, root), ...ownDark]);
}

/**
 * What sits on the sky (`.on-dawn`: the header, the heroes) is painted with:
 * for Crête, the colours of the day that its `.on-dawn` puts back; under
 * another skin, the colours of the page, and over them what its own `.on-dawn`
 * (`:root[data-skin="<id>"] .on-dawn`) puts back.
 */
function skyOf(theme: Theme, skin = DEFAULT_SKIN): Map<string, string> {
  const page = themeOf(theme, skin);
  const sky =
    skin === DEFAULT_SKIN
      ? onDawnBlock()
      : skinDeclarations(skinStylesheet(skin), skinSelectors(skin).sky);
  return new Map([...page, ...sky]);
}

/** The value of a custom property in a set of declarations, its `var()` followed. */
function valueIn(declared: Map<string, string>, property: string): string | undefined {
  let value = declared.get(property);
  for (let hops = 0; value?.startsWith("var(") && hops < 5; hops++) {
    value = declared.get(value.replace(/^var\(|\)$/g, ""));
  }
  return value;
}

function hexIn(declared: Map<string, string>, name: string, what: string): string {
  const value = valueIn(declared, `--color-${name}`);
  if (value === undefined || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`The colour "${name}" is not a #rrggbb colour of ${what}`);
  }
  return value;
}

const where = (theme: Theme, skin: string) =>
  `the ${theme} theme in ${skin === DEFAULT_SKIN ? "styles.css" : `the skin ${skin}`}`;

/**
 * The `#rrggbb` value of a theme colour (`neutral-50`, `ink`, `blush-600`…), in
 * the light theme or the dark one, of Crête or of another skin.
 */
export function themeColour(name: string, theme: Theme = "light", skin = DEFAULT_SKIN): string {
  return hexIn(themeOf(theme, skin), name, where(theme, skin));
}

/** A theme colour as it is under the sky (`.on-dawn`), in a mode, in a skin. */
export function skyColour(name: string, theme: Theme = "light", skin = DEFAULT_SKIN): string {
  return hexIn(skyOf(theme, skin), name, `the sky of ${where(theme, skin)}`);
}

/**
 * The value of any custom property of the theme (`--dawn-deep`, `--focus-glow`…),
 * in a mode, in a skin: a paint of the dawn is one, which a skin sets.
 */
export function themeValue(property: string, theme: Theme = "light", skin = DEFAULT_SKIN): string {
  const value = valueIn(themeOf(theme, skin), property);
  if (value === undefined) throw new Error(`${property} is not set in ${where(theme, skin)}`);
  return value;
}

/** The parts of a list of backgrounds (`--dawn-sky`…) that are a `linear-gradient(…)`, in order. */
function linearParts(value: string): string[] {
  const parts: string[] = [];
  for (let at = value.indexOf("linear-gradient("); at !== -1;) {
    let depth = 0;
    let end = at + "linear-gradient(".length;
    for (; end < value.length; end++) {
      if (value[end] === "(") depth++;
      if (value[end] === ")") {
        if (depth === 0) break;
        depth--;
      }
    }
    parts.push(value.slice(at, end + 1));
    at = value.indexOf("linear-gradient(", end);
  }
  return parts;
}

/**
 * The `#rrggbb` stops of the linear gradients of a paint of the dawn (its
 * radial glows, where no text sits, are left out), in order.
 */
export function linearStops(value: string): string[] {
  return linearParts(value).flatMap((part) => part.match(/#[0-9a-fA-F]{6}\b/g) ?? []);
}

/** A skin in one of its modes: what a test of the colours measures. */
export type SkinCase = { skin: string; mode: Theme; label: string };

/** Every skin of the app (`SKINS`, by their ids), in every mode it has: Crête by day and at night first. */
export function skinCases(skins: readonly { id: string; modes: readonly Theme[] }[]): SkinCase[] {
  return skins.flatMap(({ id, modes }) =>
    modes.map((mode) => ({ skin: id, mode, label: id === DEFAULT_SKIN ? mode : `${id}, ${mode}` })),
  );
}

/** Every skin of the app in every mode it has, as the tests of the colours go through them. */
export const SKIN_CASES: readonly SkinCase[] = skinCases(SKINS);
