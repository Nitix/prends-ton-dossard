import { expect } from "vitest";
import { server, userEvent, type Locator } from "vitest/browser";

/**
 * Presses a button, or follows a link, so that it ends up with the focus, as in every engine
 * for a person who reaches it by the keyboard.
 *
 * Chromium focuses what is clicked, so there it is a real click, which is the pointer path of
 * the app. Safari does not: a click or a tap gives the focus to nothing (and takes it from what
 * had it), so the element is focused and Enter pressed: the keyboard is the only way to have
 * the button hold the focus there. Like a click, it waits until the element is visible and
 * enabled, and scrolls to it. Use it for the tests that check where the focus ends up.
 */
export async function pressFocused(locator: Locator): Promise<void> {
  await expect.element(locator).toBeVisible();
  await expect.element(locator).toBeEnabled();
  if (server.browser === "chromium") {
    await locator.click();
    return;
  }
  await pressByKeyboard(locator);
}

/**
 * A real click, except where a click is known to fail by chance: Chromium on an emulated phone
 * (coarse pointer), for a button inside a <dialog> or under a fixed element (the tab bar).
 * There Playwright's click timed out at times on GitHub's Linux runners, "element is outside of
 * the viewport" (Pixel 7, runs 13 to 22). The cause is NOT known. The measures that were taken
 * (the frame, the dialog and the button inside the screen, Playwright's trial click answering
 * ok) come from runs where the click had not failed, so they say nothing about the failing
 * state. Only there is the button pressed by the keyboard (focus, then Enter), which does not
 * depend on where the page is scrolled. Every other engine and device keeps its real click,
 * which is the pointer path of the app; `tapAfterScroll` keeps one real tap on the Pixel.
 * docs/TODO.md lists it.
 */
export async function clickReachable(locator: Locator): Promise<void> {
  await expect.element(locator).toBeVisible();
  await expect.element(locator).toBeEnabled();
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  if (server.browser === "chromium" && coarse && isInDialogOrFixed(locator.element())) {
    await pressByKeyboard(locator);
    return;
  }
  await locator.click();
}

/**
 * A real click after the button is scrolled to the middle of the screen, as smoke.test.tsx does
 * for the map. Where `clickReachable` takes the keyboard, a test that calls this keeps a real
 * tap, so that a button truly out of reach still fails.
 */
export async function tapAfterScroll(locator: Locator): Promise<void> {
  await expect.element(locator).toBeVisible();
  await expect.element(locator).toBeEnabled();
  locator.element().scrollIntoView({ block: "center" });
  await locator.click();
}

async function pressByKeyboard(locator: Locator): Promise<void> {
  const element = locator.element();
  if (!(element instanceof HTMLElement)) throw new Error("not an element that can have the focus");
  element.scrollIntoView({ block: "center" });
  element.focus();
  await userEvent.keyboard("{Enter}");
}

// A <dialog>, or an ancestor with position: fixed (the tab bar at the bottom of the frame).
function isInDialogOrFixed(element: Element): boolean {
  if (element.closest("dialog") !== null) return true;
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (getComputedStyle(node).position === "fixed") return true;
  }
  return false;
}
