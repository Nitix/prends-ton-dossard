import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { SKIN_DEPTH, SKINS, chooseSkin, slotOf, variantOf } from ".";
import { EmptyState, EmptyStateBase } from "../components/EmptyState";
import { SectionMarker } from "../components/Slots";
import { slotted } from "./components";

import "../styles.css";

// What the app draws of a skin, through the two factories of components.tsx:
// the motif of a slot, and a component that a skin replaces at depth mix or
// full. In each skin, at the depth of the run (`VITE_SKIN_DEPTH`): the suite
// runs at each depth.

afterEach(() => {
  chooseSkin("crete");
});

/** What a component draws, on its own, its ids (`useId`, new at each render) set aside. */
async function html(element: Parameters<typeof render>[0]): Promise<string> {
  const screen = await render(element);
  const drawn = screen.container.innerHTML.replace(/«[^»]*»|_r_[0-9a-z]+_|:r[0-9a-z]+:/g, "ID");
  await screen.unmount();
  return drawn;
}

test("slotted — chaque skin dessine son motif dans l'emplacement, ou celui de Crête", async () => {
  for (const skin of SKINS) {
    chooseSkin(skin.id);
    const expected = await html(createElement(slotOf(skin, "SectionMarker")));
    expect(await html(<SectionMarker />), `the mark of ${skin.id}`).toBe(expected);
  }
  // A slot made at the top of a module, as components/Slots.tsx does: the same.
  const Marker = slotted("SectionMarker");
  expect(Marker.displayName).toBe("Slot(SectionMarker)");
  chooseSkin("crete");
  expect(await html(<Marker />)).toBe(await html(<SectionMarker />));
});

test("skinnable — une liste vide est la variante du skin à la profondeur du build, ou celle de Crête", async () => {
  const props = { title: "Rien ici", hint: "Ajoute un événement." };
  let replaced = 0;
  for (const skin of SKINS) {
    chooseSkin(skin.id);
    const Variant = variantOf(skin.id, "EmptyState") ?? EmptyStateBase;
    if (Variant !== EmptyStateBase) replaced++;
    // Crête's, with the motifs of the skin (its `EmptyArt`), or the skin's variant.
    const base = await html(<EmptyStateBase {...props} />);
    const expected = await html(<Variant {...props} />);
    const drawn = await html(<EmptyState {...props} />);
    expect(drawn, `the empty state of ${skin.id} at ${SKIN_DEPTH}`).toBe(expected);
    expect(drawn === base, `${skin.id} at ${SKIN_DEPTH}`).toBe(Variant === EmptyStateBase);
  }
  // A palette build replaces nothing.
  expect(SKIN_DEPTH === "palette" ? replaced : 0).toBe(0);
});
