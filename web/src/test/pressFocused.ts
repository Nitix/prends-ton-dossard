import { expect } from "vitest";
import { server, type Locator } from "vitest/browser";

import { pressByKeyboard, realClick } from "./touchDialogClicks";

/**
 * Presses a button, or follows a link, so that it ends up with the focus, as in every engine
 * for a person who reaches it by the keyboard.
 *
 * Chromium focuses what is clicked, so there it is a click, which is the pointer path of the
 * app (on a phone, a button of a dialog is pressed by the keyboard, see touchDialogClicks.ts).
 * Safari does not: a click or a tap gives the focus to nothing (and takes it from what had it),
 * so the element is focused and Enter pressed: the keyboard is the only way to have the button
 * hold the focus there. Like a click, it waits until the element is visible and enabled, and
 * scrolls to it. Use it for the tests that check where the focus ends up.
 */
export async function pressFocused(locator: Locator): Promise<void> {
  await expect.element(locator).toBeVisible();
  await expect.element(locator).toBeEnabled();
  if (server.browser === "chromium") {
    await locator.click();
    return;
  }
  const element = locator.element();
  await pressByKeyboard(element);
}

/**
 * A click that waits until the element is visible and enabled. On Chromium with a coarse pointer
 * (the Pixel 7), the click of a button inside a <dialog> or under a fixed element is done by the
 * keyboard, for every test, by src/test/touchDialogClicks.ts (the reason is there): this is the
 * same click, named for the tests that wanted that, and it keeps its call sites.
 */
export async function clickReachable(locator: Locator): Promise<void> {
  await expect.element(locator).toBeVisible();
  await expect.element(locator).toBeEnabled();
  await locator.click();
}

/**
 * A real click after the button is scrolled to the middle of the screen, as smoke.test.tsx does
 * for the map. Not for a button of a <dialog>: on emulated touch Chromium in CI a real tap there
 * fails intermittently even after the scroll (run 26), so those go by the keyboard
 * (touchDialogClicks.ts). A real phone check is still needed.
 *
 * The scroll is only done on a phone (coarse pointer): there the tab bar is fixed at the foot of
 * the screen and a button near the bottom of a page, which Playwright's own scroll leaves at the
 * edge, can sit under it (AgendaPage: the days of the last row). On a computer there is no bar over
 * the page, so the click scrolls by itself, as in every other test. The reason is a supposition: a
 * plain click passed on the iPhone and the Pixel in a local run, where the failure does not show.
 */
export async function tapAfterScroll(locator: Locator): Promise<void> {
  await expect.element(locator).toBeVisible();
  await expect.element(locator).toBeEnabled();
  if (window.matchMedia("(pointer: coarse)").matches) {
    locator.element().scrollIntoView({ block: "center" });
  }
  await realClick(locator);
}
