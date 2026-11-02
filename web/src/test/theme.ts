import { existsSync, readFileSync } from "node:fs";

import { SKINS } from "../skins";

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
  const flat = (body ?? "").replace(/\{[^{}]*\}/g, "{}").replace(/\{[^{}]*\}/g, "{}");
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

/** The palette of a skin (its `palette.css`), or nothing. */
export function skinStylesheet(skin: string): string {
  if (skin === DEFAULT_SKIN) return "";
  const url = new URL(`../skins/${skin}/palette.css`, import.meta.url);
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
 * The `#rrggbb` value of a theme colour (`neutral-50`, `ink`, `blush-600`…), in
 * the light theme or the dark one, of Crête or of another skin.
 */
export function themeColour(name: string, theme: Theme = "light", skin = DEFAULT_SKIN): string {
  const declared = themeOf(theme, skin);
  let value = declared.get(`--color-${name}`);
  for (let hops = 0; value?.startsWith("var(") && hops < 5; hops++) {
    value = declared.get(value.replace(/^var\(|\)$/g, ""));
  }
  if (value === undefined || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    const where = skin === DEFAULT_SKIN ? "styles.css" : `the skin ${skin}`;
    throw new Error(
      `The colour "${name}" is not a #rrggbb colour of the ${theme} theme in ${where}`,
    );
  }
  return value;
}

/**
 * What a utility of the dawn (`bg-dawn-deep`…) paints with under a skin: the
 * body of the skin's rule for it (`:root[data-skin="<id>"] .bg-dawn-deep`), or
 * Crête's `@utility` in styles.css.
 */
export function utilityBody(utility: string, skin = DEFAULT_SKIN): string {
  const own = bodiesOf(skinStylesheet(skin), `${skinSelectors(skin).root} .${utility}`);
  return own.at(-1) ?? block(styles, `@utility ${utility}`) ?? "";
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
