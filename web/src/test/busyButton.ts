import { expect, vi } from "vitest";

// The submit button of a dialog says it is busy while the request is on its
// way (`aria-disabled`), and is never `disabled`: a button that becomes
// disabled loses the focus to the page, and when the server refuses for a
// reason that is not about a field there is no field to give it to. A second
// tap, which can come before the page has drawn the busy state, is ignored by
// the form. These help a test say so.

/** The button a locator found: its `disabled` property is the one the browser follows. */
export function buttonOf(locator: { element(): Element }): HTMLButtonElement {
  const element = locator.element();
  if (!(element instanceof HTMLButtonElement)) throw new Error("not a button");
  return element;
}

/** Two clicks in the same tick, as a double tap does, on a button that has the focus. */
export function clickTwice(button: HTMLButtonElement): void {
  button.focus();
  button.click();
  button.click();
}

/** The button says it is busy, and keeps the focus: it is not disabled. */
export async function expectBusy(button: HTMLButtonElement): Promise<void> {
  await vi.waitFor(() => {
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });
  expect(button.disabled).toBe(false);
  expect(document.activeElement).toBe(button);
}

/** The request is over and refused: the button has the focus still, and is available for another try. */
export async function expectAvailable(button: HTMLButtonElement): Promise<void> {
  await vi.waitFor(() => {
    expect(button.getAttribute("aria-disabled")).toBeNull();
  });
  expect(button.disabled).toBe(false);
  expect(document.activeElement).toBe(button);
}
