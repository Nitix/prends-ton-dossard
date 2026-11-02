import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

import "./styles.css";

// What can be clicked shows the hand, as a link does: Tailwind 4 gives buttons
// the arrow of the system. What cannot be clicked keeps its own cursor.

test("cursor — un bouton, un menu dépliant, une case et la carte qui la porte montrent la main ; un bouton désactivé, non", async () => {
  const screen = await render(
    <div>
      <button type="button">Enregistrer</button>
      <button type="button" disabled>
        Bientôt
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
    button: cursor("button:not(:disabled)"),
    disabled: cursor("button:disabled"),
    summary: cursor("summary"),
    select: cursor("select"),
    radio: cursor('input[type="radio"]'),
    radioCard: cursor('label:has(input[type="radio"])'),
    disabledCard: cursor('label:has(input[type="checkbox"])'),
    textField: cursor('input[type="text"]'),
  }).toEqual({
    button: "pointer",
    disabled: "not-allowed",
    summary: "pointer",
    select: "pointer",
    radio: "pointer",
    radioCard: "pointer",
    disabledCard: "not-allowed",
    textField: "text",
  });
  await screen.unmount();
});
