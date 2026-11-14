import { expect } from "vitest";
import { page, server, userEvent, type Locator } from "vitest/browser";

// Setup file of the browser project (see vite.config.ts).
//
// On Chromium with a coarse pointer (the Pixel 7 of the CI matrix), a real click on a button
// inside a <dialog>, or under a fixed element (the tab bar), failed at times on GitHub's Linux
// runners with « element is outside of the viewport » (runs 13 to 24). It was not one call site:
// run 24 failed a plain `.click()` of Dialog.test.tsx three times in a row, so it is a state of
// the page, and the cause is NOT known. Nothing is known to fix it, so the clicks of that one
// target are done by the keyboard, which does not depend on where the page is scrolled: the
// element is focused, and Enter (a button, a link) or Space (a checkbox, a radio) is pressed.
//
// It is done here, once, on the click of every locator, rather than at each call site: a call
// site cannot tell that it is on the one target where the click is unreliable. Every other
// engine and device keeps its real click, which is the pointer path of the app, and
// `realClick` is the real click for a test that wants one anyway. docs/TODO.md lists it.

type Click = (this: Locator, options?: unknown) => Promise<void>;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the class of the locators is not exported
const prototype = Object.getPrototypeOf(page.getByRole("button")) as { click: Click };
// The setup file and the tests may each get their own copy of this module: the click of Vitest is
// kept on the prototype, so that a second copy does not take the replaced one for the real one.
const kept = Symbol.for("ptd.realLocatorClick");
const holder = prototype as typeof prototype & { [kept]?: typeof prototype.click };
const original = (holder[kept] ??= prototype.click);

/** The click of Vitest, whatever the target (what the page does when a person taps). */
export function realClick(locator: Locator): Promise<void> {
  return original.call(locator);
}

/** True where the clicks inside a dialog or under a fixed element are done by the keyboard. */
export function keyboardForDialogs(): boolean {
  return server.browser === "chromium" && window.matchMedia("(pointer: coarse)").matches;
}

/** Focuses the element and presses the key that does what a click does to it. */
export async function pressByKeyboard(element: Element, key = "{Enter}"): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error("not an element that can have the focus");
  element.scrollIntoView({ block: "center" });
  element.focus();
  await userEvent.keyboard(key);
}

// What the keyboard can do like a click: its key, or undefined.
function keyFor(element: Element): string | undefined {
  if (element instanceof HTMLInputElement) {
    return element.type === "checkbox" || element.type === "radio" ? "{ }" : undefined;
  }
  if (element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement) {
    return "{Enter}";
  }
  return element.getAttribute("role") === "button" ? "{Enter}" : undefined;
}

// A <dialog>, or an ancestor with position: fixed (the tab bar at the bottom of the frame).
export function isInDialogOrFixed(element: Element): boolean {
  if (element.closest("dialog") !== null) return true;
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (getComputedStyle(node).position === "fixed") return true;
  }
  return false;
}

async function keyboardClick(this: Locator, options?: unknown): Promise<void> {
  // Like a click, wait until it can be pressed; a locator that never matches fails here.
  await expect.element(this).toBeVisible();
  await expect.element(this).toBeEnabled();
  const element = this.query();
  const key = element === null ? undefined : keyFor(element);
  if (element !== null && key !== undefined && isInDialogOrFixed(element)) {
    await pressByKeyboard(element, key);
    return;
  }
  await original.call(this, options);
}

if (keyboardForDialogs() && prototype.click === original) prototype.click = keyboardClick;
