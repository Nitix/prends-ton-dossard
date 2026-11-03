/**
 * What the page has of the stylesheets of a skin's look. A look is its code and
 * its stylesheets (README.md); a page with the code and not the sheets is
 * neither Crête nor the skin: Crête's colours under the skin's motifs.
 *
 * Vite's preload helper loads a look's stylesheets with its code. It remembers
 * a stylesheet that failed as done, and never asks for it again in that page;
 * and it takes a link that the page already has (the ones index.html writes for
 * the skin kept on the device) for a sheet that is there, failed or not. So
 * neither a second choice of the same skin nor the start of the page would fetch
 * a sheet that failed once: `settleSheets` looks, and asks again itself.
 */

/**
 * Whether a stylesheet of the page has the palette of a skin: rules for its
 * page, `:root[data-skin="<id>"]`, at the top of the sheet or in an at-rule
 * (`@media`, `@layer`).
 */
export function hasPalette(id: string): boolean {
  const mark = `[data-skin="${id}"]`;
  const has = (rules: CSSRuleList): boolean =>
    [...rules].some(
      (rule) =>
        (rule instanceof CSSStyleRule && rule.selectorText.includes(mark)) ||
        (rule instanceof CSSGroupingRule && has(rule.cssRules)),
    );
  return [...document.styleSheets].some((sheet) => {
    try {
      return has(sheet.cssRules);
    } catch {
      // The rules of a sheet of another origin cannot be read: not one of the app's.
      return false;
    }
  });
}

/**
 * Whether a stylesheet link has no sheet worth the name: none (a load still on
 * its way, or failed, in the browsers that give a failed link no sheet), or one
 * without a rule (the empty sheet that Chromium gives a link whose load failed:
 * a 404, a network error). None of the app's sheets is empty.
 */
function hasNoSheet(link: HTMLLinkElement): boolean {
  if (link.sheet === null) return true;
  try {
    return link.sheet.cssRules.length === 0;
  } catch {
    // The rules of a sheet of another origin cannot be read: it is there.
    return false;
  }
}

/** The stylesheet links whose sheet is not there: a load that failed, or is still on its way. */
function missingSheets(): HTMLLinkElement[] {
  return [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter(
    hasNoSheet,
  );
}

/** Asks again for the sheet of a link, with a link of its own: it settles when that one has loaded or failed. */
function askAgain(link: HTMLLinkElement): Promise<void> {
  return new Promise((resolve) => {
    const again = document.createElement("link");
    again.rel = "stylesheet";
    again.href = link.href;
    if (link.crossOrigin !== null) again.crossOrigin = link.crossOrigin;
    again.addEventListener("load", () => {
      // A response that is not a stylesheet can load too, with no rule in it: that is no sheet either.
      if (hasNoSheet(again)) again.remove();
      else link.remove();
      resolve();
    });
    again.addEventListener("error", () => {
      again.remove();
      resolve();
    });
    document.head.append(again);
  });
}

/**
 * Whether the look of a skin is whole in the page, once its code has loaded:
 * its palette is there, and no stylesheet of the page is missing. A look has
 * more sheets than its palette (its faces, its trail: some are shared with
 * other looks), and one of them can fail while the palette's loads: all or
 * nothing. The sheets that are missing are asked for again (a failure of the
 * network may be over), and the answer is given once they have loaded or
 * failed. A look that is not whole is not to be put on the page.
 *
 * It looks at every stylesheet link of the page, since a look's own sheets are
 * not told apart from the others': a sheet of another route that failed and
 * cannot be had again keeps a skin from being chosen until the page is
 * reloaded. That is rare (it takes a failed sheet and no network, with the look
 * kept by the service worker), and it fails safe: the choice is said to have
 * failed, and the page keeps its skin.
 */
export async function settleSheets(id: string): Promise<boolean> {
  await Promise.all(missingSheets().map(askAgain));
  return hasPalette(id) && missingSheets().length === 0;
}
