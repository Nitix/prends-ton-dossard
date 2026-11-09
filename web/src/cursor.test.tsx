import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { server } from "vitest/browser";

import "./styles.css";

// What can be clicked shows the hand, as a link does: Tailwind 4 gives buttons
// the arrow of the system. What cannot be clicked keeps its own cursor.

test("cursor — un bouton, un menu dépliant, une case et la carte qui la porte montrent la main ; un bouton désactivé, ou « aria-disabled », non", async () => {
  const screen = await render(
    <div>
      <button type="button">Enregistrer</button>
      <button type="button" disabled>
        Bientôt
      </button>
      {/* The project's own way to say a button is busy or out of reach (it keeps the focus). */}
      <button type="button" aria-disabled="true">
        Occupé
      </button>
      <button type="button" aria-disabled="false">
        Libre
      </button>
      <details>
        <summary>Plus</summary>
      </details>
      <select aria-label="Type">
        <option>Trail</option>
      </select>
      <label>
        <input type="radio" name="skin" /> Nuit
      </label>
      <label>
        <input type="checkbox" disabled /> Hors d'atteinte
      </label>
      <label>
        Nom <input type="text" />
      </label>
    </div>,
  );
  const cursor = (selector: string) => {
    const found = screen.container.querySelector(selector);
    if (found === null) throw new Error(selector);
    return getComputedStyle(found).cursor;
  };
  expect({
    button: cursor("button:not(:disabled):not([aria-disabled])"),
    disabled: cursor("button:disabled"),
    ariaDisabled: cursor('button[aria-disabled="true"]'),
    ariaEnabled: cursor('button[aria-disabled="false"]'),
    summary: cursor("summary"),
    select: cursor("select"),
    radio: cursor('input[type="radio"]'),
    radioCard: cursor('label:has(input[type="radio"])'),
    disabledCard: cursor('label:has(input[type="checkbox"])'),
    textField: cursor('input[type="text"]'),
  }).toEqual({
    button: "pointer",
    disabled: "not-allowed",
    ariaDisabled: "not-allowed",
    ariaEnabled: "pointer",
    summary: "pointer",
    select: "pointer",
    radio: "pointer",
    radioCard: "pointer",
    disabledCard: "not-allowed",
    // The browser's own: Chromium says "text", WebKit "auto", which draws the same I-beam.
    textField: server.browser === "webkit" ? "auto" : "text",
  });
  await screen.unmount();
});
