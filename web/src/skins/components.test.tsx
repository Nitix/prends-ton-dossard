import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { SKINS, chooseSkin, slotOf } from ".";
import { SectionMarker } from "../components/Slots";
import { withoutIds } from "../test/ids";
import { slotted } from "./components";

import "../styles.css";

// What the app draws of a skin through `slotted` (components.tsx): the motif of
// a slot, the skin's own or Crête's, in each skin.

afterEach(async () => {
  await chooseSkin("crete");
});

/** What a component draws, on its own, its ids (`useId`, new at each render) set aside. */
async function html(element: Parameters<typeof render>[0]): Promise<string> {
  const screen = await render(element);
  const drawn = withoutIds(screen.container.innerHTML);
  await screen.unmount();
  return drawn;
}

test("slotted — chaque skin dessine son motif dans l'emplacement, ou celui de Crête", async () => {
  for (const skin of SKINS) {
    await chooseSkin(skin.id);
    const expected = await html(createElement(slotOf(skin, "SectionMarker")));
    expect(await html(<SectionMarker />), `the mark of ${skin.id}`).toBe(expected);
  }
  // A slot made at the top of a module, as components/Slots.tsx does: the same.
  const Marker = slotted("SectionMarker");
  expect(Marker.displayName).toBe("Slot(SectionMarker)");
  await chooseSkin("crete");
  expect(await html(<Marker />)).toBe(await html(<SectionMarker />));
});
