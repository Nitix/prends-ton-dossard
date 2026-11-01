import { readFileSync } from "node:fs";

// The colours of the theme, as styles.css declares them (`--color-<name>: #hex;`
// in `@theme`), so that a test reads the value the app is painted with and not
// a copy of it. A colour may be given as the `var()` of another one.

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

const declared = new Map<string, string>(
  [...styles.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)].map((match) => [
    match[1] ?? "",
    (match[2] ?? "").trim(),
  ]),
);

/** The `#rrggbb` value of a theme colour (`neutral-50`, `ink`, `blush-600`…). */
export function themeColour(name: string): string {
  let value = declared.get(name);
  for (let hops = 0; value?.startsWith("var(") && hops < 5; hops++) {
    value = declared.get(value.replace(/^var\(--color-|\)$/g, ""));
  }
  if (value === undefined || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`The colour "${name}" is not a #rrggbb colour of the theme in styles.css`);
  }
  return value;
}
