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
 */
export async function pressFocused(locator: Locator): Promise<void> {
  await expect.element(locator).toBeVisible();
  await expect.element(locator).toBeEnabled();
  if (server.browser === "chromium") {
    await locator.click();
    return;
  }
  const element = locator.element();
  if (!(element instanceof HTMLElement)) throw new Error("not an element that can have the focus");
  element.scrollIntoView({ block: "center" });
  element.focus();
  await userEvent.keyboard("{Enter}");
}
