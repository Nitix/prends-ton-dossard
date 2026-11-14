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
 * enabled, and scrolls to it.
 *
 * Second exception: Chromium on an emulated phone (coarse pointer), for a button inside a
 * <dialog>. There Playwright's real click intermittently times out with "element is outside of
 * the viewport" on GitHub's Linux runners. It is not the layout: the run-17 diagnostic measured
 * the Pixel 7 frame = window = 412x839, no transform, the dialog fitting, the "Annuler" button
 * inside the screen (157,558, 91x44), and Playwright's own trial click answering ok. So a
 * person can press the button; only the test's click is unreliable, and the keyboard path is
 * deterministic. Desktop Chromium keeps its real click.
 *
 * The same goes for what is fixed at the bottom of the frame (the tab bar): its real click timed
 * out with the same message, and it is the same measured geometry.
 */
export async function pressFocused(locator: Locator): Promise<void> {
  await expect.element(locator).toBeVisible();
  await expect.element(locator).toBeEnabled();
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const fixedOrDialog = isInDialogOrFixed(locator.element());
  if (server.browser === "chromium" && !(coarse && fixedOrDialog)) {
    await locator.click();
    return;
  }
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
