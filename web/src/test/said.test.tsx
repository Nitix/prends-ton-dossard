import { expect, test } from "vitest";

import { said } from "./said";

// What a piece says to a screen reader (said.ts).

test("said — ce qu'un lecteur d'écran a : les textes sans ce qui lui est caché, les liens, les noms, les boutons", () => {
  const box = document.createElement("div");
  box.innerHTML = `
    <span aria-hidden="true">12</span>
    <span class="sr-only">le 12 juin</span>
    <a href="/a">Aller   voir</a>
    <ul aria-label="Coureurs"><li>Alice</li></ul>
    <button type="button">Ajouter</button>
    <span aria-hidden="true"><a href="/hidden">caché</a></span>`;
  const what = said(box);
  expect(what.texts).toEqual(["le 12 juin", "Aller voir", "Alice", "Ajouter"]);
  expect(what.flat).toBe("le 12 juin Aller voir Alice Ajouter");
  expect(what.links).toEqual(["Aller voir → /a"]);
  expect(what.names).toEqual(["Coureurs"]);
  expect(what.buttons).toEqual(["Ajouter"]);
});
