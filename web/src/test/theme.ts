import { existsSync, readdirSync, readFileSync } from "node:fs";

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
 * only one that sets custom properties of the theme), `mix.css` or `full.css`,
 * or its `fonts.css` (its faces and `--font-*`, whatever the depth); nothing
 * when it has none.
 */
export function skinStylesheet(skin: string, level: Depth | "fonts" = "palette"): string {
  if (skin === DEFAULT_SKIN) return "";
  const url = new URL(`../skins/${skin}/${level}.css`, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8") : "";
}

/**
 * The folders of src/skins/ that have a `fonts.css`, skins or not yet (a folder
 * with that file only is the start of a skin): the guards of the stylesheets
 * read the fonts of all of them.
 */
export function skinsWithFonts(): string[] {
  return readdirSync(new URL("../skins/", import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && skinStylesheet(entry.name, "fonts") !== "")
    .map((entry) => entry.name);
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

/** The parts of a list, split at its commas that are not in parentheses, brackets or quotes. */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let at = 0; at < text.length; at++) {
    const char = text[at] ?? "";
    if (quote !== "") {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, at).trim());
      start = at + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter((part) => part !== "");
}

/**
 * The stops of the linear gradients of a paint of the dawn (its radial glows,
 * where no text sits, are left out), in order. Each must be a `#rrggbb` colour,
 * the one the contrast tests can measure: any other (`rgb()`, `oklch()`, a name)
 * is an error, not a stop left out.
 */
export function linearStops(value: string): string[] {
  return linearParts(value).flatMap((part) => {
    const parts = splitTopLevel(part.slice("linear-gradient(".length, -1));
    const [first = ""] = parts;
    // An angle or a direction first, if any.
    const stops = /^(to\s|-?[\d.]+(deg|turn|rad|grad)$)/.test(first) ? parts.slice(1) : parts;
    return stops.map((stop) => {
      const colour = stop.replace(/(\s+-?[\d.]+(%|px|rem|em)?)+$/, "").trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(colour)) {
        throw new Error(`A stop of ${part} is not a #rrggbb colour: ${colour}`);
      }
      return colour;
    });
  });
}

/** The value of a custom property under the sky (`.on-dawn`), in a mode, in a skin. */
export function skyValue(property: string, theme: Theme = "light", skin = DEFAULT_SKIN): string {
  return valueIn(skyOf(theme, skin), property) ?? "";
}

// --- The rules of the stylesheets of a skin (README.md) ---

/** A stylesheet of a skin, by its level. */
export type SheetLevel = "palette" | "mix" | "full";

/**
 * What a palette may not set, though Crête declares it: the shadows (Tailwind
 * writes them into its utilities, so only the variables in them reach a page:
 * `--shade-*`, `--dawn-glow-*`), and the fonts (`fonts.css` has them).
 */
export const NOT_IN_PALETTE = /^--(shadow|inset-shadow|drop-shadow|text-shadow|font)-/;

/** The at-rules that a sheet of mix or full may wrap its rules in. */
const WRAPPERS = /^@(media|supports|container)\b/;

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The names of the properties that a block declares, in order. */
function propertiesOf(body: string): string[] {
  return body
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration !== "")
    .map((declaration) => declaration.slice(0, declaration.indexOf(":")).trim());
}

/**
 * What is wrong with a stylesheet of a skin, by the rules of README.md (an
 * empty list when nothing is). `known` is what Crête declares: the custom
 * properties a palette may set.
 *
 * - palette.css: rules on the skin's page (`:root[data-skin="<id>"]`), its
 *   night chosen (`…[data-theme="dark"]`) and its sky (`… .on-dawn`), and its
 *   night followed (`…:not([data-theme="light"])`) in
 *   `@media (prefers-color-scheme: dark)`; custom properties of Crête only,
 *   and `color-scheme`; no shadow, no font.
 * - mix.css and full.css: every selector is `:root[data-skin="<id>"]`, then
 *   `[data-theme="dark"]`, `[data-theme="light"]` or `:not([data-theme="light"])`
 *   if the rule is for a mode, then a combinator and the piece; a list is
 *   split at its own commas (not those of `:is(a, b)`); rules may be wrapped in
 *   `@media`, `@supports` or `@container`, as deep as needed; `@keyframes`
 *   whose name starts with `<id>-`; no custom property, no other at-rule.
 */
export function sheetProblems(
  css: string,
  skin: string,
  level: SheetLevel,
  known: ReadonlySet<string>,
): string[] {
  const { root, darkChosen, darkFollowed, sky } = skinSelectors(skin);
  const problems: string[] = [];
  const say = (problem: string) => {
    problems.push(`${skin}, ${level}.css: ${problem}`);
  };
  const piece = new RegExp(
    `^${escaped(root)}(\\[data-theme="(dark|light)"\\]|:not\\(\\[data-theme="light"\\]\\))?(\\s+|\\s*[>+~]\\s*)\\S`,
  );
  const visit = (text: string, wrappers: string[]) => {
    const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "");
    const tail = stripped.slice(stripped.lastIndexOf("}") + 1).trim();
    if (tail !== "") say(`a statement ${tidy(tail)}`);
    for (const { prelude, body } of rules(stripped)) {
      const statements = prelude.split(";");
      const head = tidy(statements.pop() ?? "");
      for (const statement of statements.map(tidy).filter((one) => one !== "")) {
        say(`a statement ${statement}`);
      }
      if (head.startsWith("@")) {
        if (level === "palette") {
          if (head === "@media (prefers-color-scheme: dark)" && wrappers.length === 0) {
            visit(body, [head]);
          } else say(`the at-rule ${head}`);
        } else if (WRAPPERS.test(head)) visit(body, [...wrappers, head]);
        else if (head.startsWith("@keyframes ")) {
          const name = head.slice("@keyframes ".length).trim();
          if (!name.startsWith(`${skin}-`))
            say(`the keyframes ${name} (its name starts with "${skin}-")`);
          for (const frame of rules(body)) {
            for (const property of propertiesOf(frame.body).filter((one) => one.startsWith("--"))) {
              say(`a keyframe sets ${property}`);
            }
          }
        } else say(`the at-rule ${head}`);
        continue;
      }
      if (body.includes("{")) {
        say(`a rule nested in ${head}`);
        continue;
      }
      const selectors = splitTopLevel(head).map(tidy);
      const properties = propertiesOf(body);
      if (level === "palette") {
        const allowed = wrappers.length > 0 ? [darkFollowed] : [root, darkChosen, sky];
        for (const selector of selectors.filter((one) => !allowed.includes(one))) {
          say(`the selector ${selector}`);
        }
        for (const property of properties) {
          if (property === "color-scheme") continue;
          if (!property.startsWith("--")) say(`${property}, which is not a custom property`);
          else if (NOT_IN_PALETTE.test(property)) say(`${property}, which a palette cannot change`);
          else if (!known.has(property)) say(`${property}, which Crête does not declare`);
        }
      } else {
        for (const selector of selectors.filter((one) => !piece.test(one))) {
          say(`the selector ${selector}`);
        }
        for (const property of properties.filter((one) => one.startsWith("--"))) {
          say(`a custom property ${property}`);
        }
      }
    }
  };
  visit(css, []);
  return problems;
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

/**
 * Every declaration of a block of a sheet, in order, as `[property, value]`:
 * split at its semicolons outside quotes and parentheses (a `url("data:…;…")`
 * stays whole), whitespace gathered.
 */
function allDeclarations(body: string): [string, string][] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let at = 0; at < body.length; at++) {
    const char = body[at];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === ";" && depth === 0) {
      parts.push(body.slice(start, at));
      start = at + 1;
    }
  }
  parts.push(body.slice(start));
  return parts
    .map((part) => part.trim())
    .filter((part) => part.includes(":"))
    .map((part) => {
      const colon = part.indexOf(":");
      return [
        part.slice(0, colon).trim(),
        part
          .slice(colon + 1)
          .replace(/\s+/g, " ")
          .trim(),
      ];
    });
}

/** The words of a value, split at its spaces outside parentheses: `2px dashed color-mix(in srgb, …)` is three. */
function words(value: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let word = "";
  for (const char of value) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (/\s/.test(char) && depth === 0) {
      if (word !== "") found.push(word);
      word = "";
    } else word += char;
  }
  if (word !== "") found.push(word);
  return found;
}

/** A dashed border or outline of a sheet: its selector (one of a list), its declaration, and the colour of the theme it is in. */
export type SheetDash = {
  selector: string;
  property: string;
  value: string;
  /** The name of the colour of the theme it reads (`var(--color-<name>)`), if it reads one plainly. */
  colour: string | undefined;
};

/**
 * Every dashed border or outline that a sheet of a skin draws (`border`,
 * `border-*`, `outline`, `outline-style`…: a declaration whose value is
 * `dashed`), in its at-rules too (`@media`, `@supports`, `@container`; never a
 * keyframe), once for each selector of its list. The colour is the one of the
 * theme it reads plainly, in the same declaration; a mix (`color-mix(…)`), a
 * written colour or a colour set by another declaration has none.
 */
export function sheetDashes(css: string): SheetDash[] {
  const found: SheetDash[] = [];
  const visit = (text: string) => {
    for (const { prelude, body } of rules(text)) {
      const head = tidy(prelude);
      if (head.startsWith("@")) {
        if (WRAPPERS.test(head)) visit(body);
        continue;
      }
      for (const [property, value] of allDeclarations(body)) {
        if (!/^(border|outline)/.test(property) || !/\bdashed\b/.test(value)) continue;
        // A colour of the theme read plainly, as a word of the value (not inside a mix).
        const colour = words(value)
          .map((word) => /^var\(--color-([a-z]+(?:-\d+)?)\)$/.exec(word)?.[1])
          .find((name) => name !== undefined);
        for (const selector of splitTopLevel(head).map(tidy)) {
          found.push({ selector, property, value, colour });
        }
      }
    }
  };
  visit(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  return found;
}
