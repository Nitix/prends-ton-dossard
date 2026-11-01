import { readFileSync } from "node:fs";

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

function themeOf(theme: Theme): Map<string, string> {
  const light = lightTheme();
  if (theme === "light") return light;
  return new Map([...light, ...darkBlocks().chosen]);
}

/** The `#rrggbb` value of a theme colour (`neutral-50`, `ink`, `blush-600`…), in the light theme or the dark one. */
export function themeColour(name: string, theme: Theme = "light"): string {
  const declared = themeOf(theme);
  let value = declared.get(`--color-${name}`);
  for (let hops = 0; value?.startsWith("var(") && hops < 5; hops++) {
    value = declared.get(value.replace(/^var\(|\)$/g, ""));
  }
  if (value === undefined || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(
      `The colour "${name}" is not a #rrggbb colour of the ${theme} theme in styles.css`,
    );
  }
  return value;
}
