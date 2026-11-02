import { contrast } from "./colour";

// What the browser computes of the theme, here and now, for the browser tests
// of the skins (skins/tokens.test.tsx, skins/smoke.test.tsx): a colour of a
// property, the layers of a shadow, and what a skin's own stylesheet declares.

/** The empty layer that Tailwind puts in a `box-shadow` for a ring or an inset shadow it does not draw. */
export const EMPTY_LAYER = "rgba(0, 0, 0, 0) 0px 0px 0px 0px";

/** A colour of the theme (`--shade-welcome`…) as the browser computes it, here and now. */
export function colourOf(property: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${property}, transparent)`;
  document.body.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}

/** The layers of a computed `box-shadow`, without Tailwind's empty ones. */
export function shadowLayers(shadow: string): string[] {
  if (shadow === "none") return [];
  return shadow
    .split(/,(?![^(]*\))/)
    .map((layer) => layer.trim())
    .filter((layer) => layer !== EMPTY_LAYER);
}

/** The style rules of every stylesheet of the page, those inside `@media`, `@layer` and such too. */
function styleRules(): CSSStyleRule[] {
  const of = (rules: CSSRuleList): CSSStyleRule[] =>
    [...rules].flatMap((rule) => [
      ...(rule instanceof CSSStyleRule ? [rule] : []),
      ...(rule instanceof CSSGroupingRule ? of(rule.cssRules) : []),
    ]);
  return [...document.styleSheets].flatMap((sheet) => of(sheet.cssRules));
}

/**
 * The value that the skin's own stylesheet gives a custom property on its page
 * (Crête's `:root` in styles.css; another skin's `:root[data-skin="<id>"]`, in
 * its palette), or `""` when it gives none. Crête declares every property of
 * the theme, so a value read on the page is never missing: only the skin's own
 * rule says whether the skin set it, or left Crête's.
 */
export function ownDeclaration(skin: string, property: string): string {
  const selector = skin === "crete" ? ":root" : `:root[data-skin="${skin}"]`;
  const values = styleRules()
    .filter((rule) => rule.selectorText.split(",").some((one) => one.trim() === selector))
    .flatMap((rule) => [rule.style, ...nestedDeclarations(rule.cssRules)])
    .map((style) => style.getPropertyValue(property).trim())
    .filter((value) => value !== "");
  return values.at(-1) ?? "";
}

/**
 * The declarations that follow a rule nested in a style rule. The stylesheets
 * of the tests are not flattened: where Tailwind gives a declaration a fallback
 * (a `color-mix()` in an `@supports`), the declarations after it are a block of
 * their own in the rule, not in its `style`.
 */
function nestedDeclarations(rules: CSSRuleList): CSSStyleDeclaration[] {
  return [...rules].flatMap((rule) => [
    ...(rule instanceof CSSNestedDeclarations ? [rule.style] : []),
    ...(rule instanceof CSSGroupingRule ? nestedDeclarations(rule.cssRules) : []),
  ]);
}

/** A colour as the browser computes it (`rgb()`, `rgba()`, `color(srgb …)`, `oklab()`…), as `[r, g, b, alpha]`, the channels 0–255. */
export function rgbaOf(colour: string): [number, number, number, number] {
  // `rgb()` and `rgba()` as they are: a canvas would round a translucent one (it keeps its colours premultiplied).
  const legacy = /^rgba?\(([^()]*)\)$/.exec(colour.trim());
  if (legacy) {
    const [r = 0, g = 0, b = 0, a = 1] = (legacy[1] ?? "").split(/[\s,/]+/).map(Number);
    return [r, g, b, a];
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("no 2d canvas");
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = colour;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b, Math.round((a / 255) * 100) / 100];
}

const toHex = ([r, g, b]: readonly number[]) =>
  `#${[r, g, b]
    .map((channel) =>
      Math.round(channel ?? 0)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** `top` laid over `under` (an opaque colour, `#rrggbb`). */
function over(top: readonly [number, number, number, number], under: string): string {
  const base = [1, 3, 5].map((at) => Number.parseInt(under.slice(at, at + 2), 16));
  const alpha = top[3];
  return toHex(base.map((channel, i) => (top[i] ?? 0) * alpha + channel * (1 - alpha)));
}

/** The colours of a computed `background-image` (the stops of its gradients), in order. */
function stopsOf(image: string): string[] {
  return [...image.matchAll(/(?:rgba?|color|oklab|oklch|lab|lch|hsla?|hwb)\([^()]*\)/g)].map(
    (match) => match[0],
  );
}

/** Whether the background image of an element fills its box (a pill), rather than a bar or a mark in it. */
function fills(style: CSSStyleDeclaration): boolean {
  return style.backgroundSize
    .split(",")
    .every((size) => ["auto", "auto auto", "100% 100%", "cover"].includes(size.trim()));
}

/**
 * The colours behind the words of an element, as `#rrggbb`: its own
 * background where it fills its box (each stop of a gradient, then its colour
 * under them), else the first one under it, with the translucent ones laid over
 * what is under them, down to an opaque one (the page's `--color-neutral-50` if
 * none is). A gradient cut to a bar or a mark (`background-size` of a line) is
 * not behind the words, nor is a pill drawn by `::before` or `::after`.
 */
export function groundsBehind(element: Element): string[] {
  const layers: string[][] = [];
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    const style = getComputedStyle(at);
    const stops =
      style.backgroundImage === "none" || !fills(style) ? [] : stopsOf(style.backgroundImage);
    if (stops.length > 0) {
      layers.push(stops);
      if (stops.every((stop) => rgbaOf(stop)[3] === 1)) break;
    }
    // Under its images, the element's own colour (a fill under a gloss).
    const colour = rgbaOf(style.backgroundColor);
    if (colour[3] === 0) continue;
    layers.push([style.backgroundColor]);
    if (colour[3] === 1) break;
  }
  // From the bottom up: each layer over every colour under it.
  let grounds = [colourOf("--color-neutral-50")].map((colour) => toHex(rgbaOf(colour)));
  for (const layer of layers.toReversed()) {
    grounds = [
      ...new Set(layer.flatMap((top) => grounds.map((under) => over(rgbaOf(top), under)))),
    ];
  }
  return grounds;
}

/** The weakest contrast of the words of an element on the colours behind them (WCAG 2, 1 to 21). */
export function textContrast(element: Element): number {
  const grounds = groundsBehind(element);
  const ink = rgbaOf(getComputedStyle(element).color);
  return Math.min(...grounds.map((ground) => contrast(over(ink, ground), ground)));
}

/** A mark drawn before or after an element (`::before`, `::after`): what it draws, or "none". */
function pseudoMark(element: Element, which: "::before" | "::after"): string {
  const drawn = getComputedStyle(element, which);
  return drawn.content === "none" || drawn.content === "normal"
    ? "none"
    : [drawn.content, drawn.backgroundImage, drawn.backgroundColor, drawn.width, drawn.height].join(
        " ",
      );
}

/** What can tell a tab apart, by the name of the computed property (or the mark), as the browser computes it. */
function marksOf(element: Element): [string, string][] {
  const style = getComputedStyle(element);
  return [
    ["fontWeight", style.fontWeight],
    ["backgroundImage", style.backgroundImage],
    ["backgroundColor", style.backgroundColor],
    ["boxShadow", style.boxShadow],
    [
      "border",
      [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
        style.borderTopStyle,
      ].join(" "),
    ],
    ["textDecorationLine", style.textDecorationLine],
    ["outlineStyle", style.outlineStyle],
    ["before", pseudoMark(element, "::before")],
    ["after", pseudoMark(element, "::after")],
  ];
}

/**
 * What tells `one` apart from `other` besides the colour of its words: its
 * weight, a fill (a background, a gradient), a shadow or a line, a border, an
 * underline, an outline, or a mark drawn before or after it. The names of the
 * computed properties that differ; none when only the colour of the words does.
 */
export function toldApart(one: Element, other: Element): string[] {
  const theirs = new Map(marksOf(other));
  return marksOf(one)
    .filter(([name, value]) => theirs.get(name) !== value)
    .map(([name]) => name);
}
