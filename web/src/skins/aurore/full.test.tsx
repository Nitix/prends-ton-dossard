import type { ReactNode } from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { page } from "vitest/browser";

import { SKIN_DEPTH } from "..";
import { ensureTemporal } from "../../lib/temporal";
import { inApp, type DrawOptions } from "../../test/variant";

import "../../styles.css";
import "../../skins/styles";

// « Aurore » at depth full: Crête took its layout, its cards, its dialog, its
// toast, its fields and its tabs from « Aurore », so what is left of the variant
// is its header, shorter than Crête's (the page starts higher): a sky of 112 px
// at md, 3 rem of room under the name on a phone, the tabs and the sheet of the
// page placed for it. Under a build at palette or at mix there is none of it.

vi.mock("../../lib/pb", async () => (await import("../../test/pbMock")).pbModule);

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(async () => {
  await page.viewport(414, 896);
});

const SKIN = "aurore";
/** What `check` finds in a piece drawn in the skin, while the skin is on the page. */
const within = (
  piece: ReactNode,
  check: (drawn: HTMLElement, page: HTMLElement) => void,
  options: DrawOptions = {},
) => inApp(piece, check, { skin: SKIN, ...options });

const styleOf = (element: Element) => getComputedStyle(element);

/** The first element of a selector, which the check needs: its absence is the failure. */
function need(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`nothing matches ${selector}`);
  return found;
}

test.skipIf(SKIN_DEPTH !== "full")(
  "« Aurore » full — l'en-tête d'un téléphone est plus court que celui de Crête : 3 rem sous le nom, 1,25 rem au-dessus",
  async () => {
    await within(
      <p>Page</p>,
      (_drawn, root) => {
        const bar = styleOf(need(root, ".app-header-bar"));
        expect(bar.paddingTop).toBe("20px");
        // Crête keeps 4 rem under the name, for its ridges.
        expect(bar.paddingBottom).toBe("48px");
        // 20 + the name (a mark of 36 px, 44 for the link) + 48, against Crête's 16 + … + 64.
        const header = need(root, ".app-header").getBoundingClientRect().height;
        const link = need(root, ".brand-link");
        // The link of the name has a margin of -0.375 rem round it (the room of its focus ring).
        const margins =
          Number.parseFloat(styleOf(link).marginTop) +
          Number.parseFloat(styleOf(link).marginBottom);
        const brand = link.getBoundingClientRect().height + margins;
        expect(header).toBeCloseTo(20 + brand + 48, 0);
      },
      { framed: true },
    );
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Aurore » full — du md, l'en-tête fait 7 rem, le nom au milieu, les onglets sur lui, la feuille de la page juste dessous",
  async () => {
    await page.viewport(1024, 768);
    await within(
      <p>Page</p>,
      (_drawn, root) => {
        const header = need(root, ".app-header").getBoundingClientRect();
        const bar = need(root, ".app-header-bar");
        const barStyle = getComputedStyle(bar);
        // Crête's is 10 rem tall, the name at its top.
        expect(header.height).toBe(112);
        expect(barStyle.alignItems).toBe("center");
        expect(barStyle.paddingTop).toBe("0px");
        expect(barStyle.paddingBottom).toBe("24px");
        // The capsule of the tabs is inside the sky, and the sheet of the page starts at its foot, over the sky.
        const nav = need(root, ".tabbar").getBoundingClientRect();
        expect(nav.top).toBeGreaterThanOrEqual(header.top);
        expect(nav.bottom).toBeLessThanOrEqual(header.bottom);
        const sheet = need(root, ".sheet");
        expect(getComputedStyle(sheet).marginTop).toBe("0px");
        const top = sheet.getBoundingClientRect().top;
        expect(top, "the sheet starts under the tabs").toBeGreaterThanOrEqual(nav.bottom);
        expect(top, "and over the sky").toBeLessThan(header.bottom);
        // The name is level with the tabs, not above them.
        const name = need(root, ".brand-link").getBoundingClientRect();
        const tabs = need(root, ".tabbar-list").getBoundingClientRect();
        expect(Math.abs(name.top + name.height / 2 - (tabs.top + tabs.height / 2))).toBeLessThan(
          12,
        );
      },
      { framed: true },
    );
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Aurore » full — la feuille de la page d'un téléphone monte toujours de 1,75 rem sur le ciel",
  async () => {
    await within(
      <p>Page</p>,
      (_drawn, root) => {
        expect(getComputedStyle(need(root, ".sheet")).marginTop).toBe("-28px");
      },
      { framed: true },
    );
  },
);
