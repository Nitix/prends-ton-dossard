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
