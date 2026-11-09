import { server } from "vitest/browser";

/**
 * What the browser of the run has, for the tests that check the browser's own
 * behaviour on it: they cannot run where the browser lacks it.
 */

/** `<input type="date">` is a real date field: Playwright's WebKit on Windows makes it a text field, which has no minimum. */
export const hasDateInput = (() => {
  const input = document.createElement("input");
  input.type = "date";
  return input.type === "date";
})();

/** The run is on a touch screen (an emulated phone): a mouse is not what the page expects there. */
export const isTouchDevice = matchMedia("(pointer: coarse)").matches;

/**
 * Playwright's WebKit on a Linux runner (GitHub's): the first skin chosen in a page, with the dev
 * server's `<style>` sheets, stays unresolved there (docs/TODO.md, « Skins sur WebKit Linux »).
 * CI is Linux; a run on Windows or a Mac is not concerned.
 */
export const isLinuxWebkit = server.browser === "webkit" && Boolean(import.meta.env.VITE_CI);
