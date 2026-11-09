import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { SKINS, chooseSkin } from ".";
import { HeaderArt } from "./carnet/motifs";

import "../styles.css";

// WebKit on Linux resolved the page wrongly for the first skin chosen in a page (see `settleFirstChoice` in
// index.ts): the colours that depend on the palette, and the animations of the motifs.

afterEach(async () => {
  await chooseSkin("crete");
});

/** The colour that the sheet of the page should have in the skin: what its `--color-neutral-50` paints. */
function expected(): string {
  const span = document.createElement("span");
  span.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue(
    "--color-neutral-50",
  );
  document.body.append(span);
  const colour = getComputedStyle(span).backgroundColor;
  span.remove();
  return colour;
}

test("restyle — choose a skin, then another: the page wears the skin that was chosen last, at once", async () => {
  const [, first, second] = SKINS;
  if (!first || !second) throw new Error("two skins other than Crête");
  for (const skin of [first, second, first]) {
    await chooseSkin(skin.id);
    expect(getComputedStyle(document.body).backgroundColor).toBe(expected());
  }
});

test("restyle — the motifs that are drawn after a skin is chosen move", async () => {
  await chooseSkin("carnet");
  const screen = await render(<HeaderArt place="header" sun />);
  expect(screen.container.getAnimations({ subtree: true }).length).toBeGreaterThan(0);
});
