import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { server } from "vitest/browser";

import { keyboardForDialogs, realClick } from "./touchDialogClicks";

// A click from the keyboard has `detail` 0, a click of a pointer 1: it tells which one was done.
async function clickedDetail(
  inDialog: boolean,
  real = false,
  options?: { position: { x: number; y: number } },
) {
  const details: number[] = [];
  const button = (
    <button type="button" onClick={(event) => details.push(event.detail)}>
      Valider
    </button>
  );
  const screen = await render(
    inDialog ? (
      <dialog open aria-label="Fenêtre">
        {button}
      </dialog>
    ) : (
      button
    ),
  );
  const locator = screen.getByRole("button", { name: "Valider" });
  await (real ? realClick(locator) : locator.click(options));
  await screen.unmount();
  return details;
}

describe("clics des fenêtres sur un téléphone Chromium", () => {
  test("touchDialogClicks — un clic avec des options reste un vrai clic, options gardées", async () => {
    expect(await clickedDetail(true, false, { position: { x: 2, y: 2 } })).toEqual([1]);
  });

  test("touchDialogClicks — le bouton d'une fenêtre est pressé au clavier sur Chromium tactile seulement", async () => {
    expect(await clickedDetail(true)).toEqual([keyboardForDialogs() ? 0 : 1]);
  });

  test("touchDialogClicks — hors d'une fenêtre, et avec realClick, le clic reste un vrai clic", async () => {
    // The title says it: neither a button outside a dialog nor realClick takes the keyboard.
    expect(await clickedDetail(false), "outside").toEqual([1]);
    expect(await clickedDetail(true, true), "real").toEqual([1]);
    expect(server.browser).toBeTypeOf("string");
  });
});
