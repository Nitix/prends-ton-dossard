import { createElement, type ReactNode } from "react";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { SKINS, chooseSkin, slotOf } from ".";
import { SectionMarker } from "../components/Slots";
import { fr } from "../i18n/fr";
import { I18nProvider } from "../i18n/I18nProvider";
import { withoutIds } from "../test/ids";
import { said } from "../test/said";
import { slotted } from "./components";
import type { Skin } from "./types";

import "../styles.css";

// What the app draws of a skin through `slotted` (components.tsx): the motif of
// a slot, the skin's own or Crête's, in each skin; and what its motifs say to a
// screen reader.

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

/** Each motif of a skin, drawn with the props that the app gives its slot (types.ts, `SlotProps`). */
const MOTIFS: readonly (readonly [what: string, draw: (skin: Skin) => ReactNode])[] = [
  [
    "HeaderArt in the header",
    (skin) => createElement(slotOf(skin, "HeaderArt"), { place: "header", sun: true }),
  ],
  [
    "HeaderArt on a sign-in page",
    (skin) => createElement(slotOf(skin, "HeaderArt"), { place: "welcome" }),
  ],
  ["BrandMark", (skin) => createElement(slotOf(skin, "BrandMark"), { size: "md" })],
  ["BrandMark, large", (skin) => createElement(slotOf(skin, "BrandMark"), { size: "lg" })],
  ["HeroArt of an event", (skin) => createElement(slotOf(skin, "HeroArt"), { place: "event" })],
  ["HeroArt of a runner", (skin) => createElement(slotOf(skin, "HeroArt"), { place: "runner" })],
  ["Divider", (skin) => createElement(slotOf(skin, "Divider"), {})],
  ["SectionMarker", (skin) => createElement(slotOf(skin, "SectionMarker"), {})],
  ["EmptyArt", (skin) => createElement(slotOf(skin, "EmptyArt"), {})],
  ["PageArt", (skin) => createElement(slotOf(skin, "PageArt"), {})],
];

test("slots — les motifs de chaque skin ne disent rien à un lecteur d'écran ; la marque dit le nom de l'appli, et rien d'autre", async () => {
  // A motif is decoration (types.ts, `Slots`): a mark before a block's title
  // that said something would rename every block, a header that said
  // something would be read on every page. The mark of the app says its name,
  // in one text or in parts (« Prends ton » and « dossard » in two faces).
  const heard: string[] = [];
  for (const skin of SKINS) {
    await chooseSkin(skin.id);
    for (const [what, draw] of MOTIFS) {
      const screen = await render(<I18nProvider languages={["fr"]}>{draw(skin)}</I18nProvider>);
      const { flat } = said(screen.container);
      const expected = what.startsWith("BrandMark") ? fr.common.appName : "";
      if (flat !== expected) heard.push(`${skin.id}, ${what}: « ${flat} »`);
      await screen.unmount();
    }
  }
  expect(heard).toEqual([]);
});
