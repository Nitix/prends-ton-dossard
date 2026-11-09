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
