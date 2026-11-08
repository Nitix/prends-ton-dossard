import { userEvent } from "vitest/browser";

/**
 * Presses a button, or follows a link, with the keyboard: the element has the
 * focus, then Enter. A click does not do for a test that says "the button
 * keeps the focus": Safari gives the focus to nothing when a button is clicked
 * or tapped (and takes it from what had it), where Chromium gives it to the
 * button. Only the keyboard has the button hold the focus in every engine, and
 * it is what a person who reaches it by the keyboard does.
 */
export async function pressFocused(locator: { element(): Element }): Promise<void> {
  const element = locator.element();
  if (!(element instanceof HTMLElement)) throw new Error("not an element that can have the focus");
  element.focus();
  await userEvent.keyboard("{Enter}");
}
