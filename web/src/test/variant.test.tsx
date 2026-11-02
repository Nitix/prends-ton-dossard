import { Link } from "@tanstack/react-router";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

import { useI18n } from "../i18n/I18nProvider";
import { ensureTemporal } from "../lib/temporal";
import { useToday } from "../lib/useToday";
import { chooseSkin, currentSkin } from "../skins";
import { hex, inApp, keepsEverything, said } from "./variant";

// The harness that the tests of a skin's variants share (variant.tsx): a piece
// drawn in the app, what it says to a screen reader, and the check that a
// variant says all its base says.

vi.mock("../lib/pb", async () => (await import("./pbMock")).pbModule);

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(() => {
  chooseSkin("crete");
});

/** What the app gives a piece: its language, its day, a router for its links. */
function Probe() {
  const { t } = useI18n();
  return (
    <p data-probe="">
      <Link to="/evenements/$id" params={{ id: "e1" }}>
        {t.nav.home}
      </Link>
      <span>{useToday().toString()}</span>
    </p>
  );
}

test("inApp — la pièce a sa langue, son jour (1er juin 2026 par défaut) et un routeur pour ses liens", async () => {
  const seen = await inApp(<Probe />, (drawn) => ({
    text: drawn.querySelector("[data-probe]")?.textContent,
    href: drawn.querySelector("a")?.getAttribute("href"),
    first: drawn.firstElementChild?.hasAttribute("data-probe"),
  }));
  expect(seen).toEqual({ text: "Accueil2026-06-01", href: "/evenements/e1", first: true });
  const later = await inApp(<Probe />, (drawn) => drawn.textContent, { today: "2026-07-14" });
  expect(later).toBe("Accueil2026-07-14");
});

test("inApp — le skin demandé est celui de la page pendant le dessin, et Crête revient après", async () => {
  const during = await inApp(<Probe />, () => currentSkin().id, { skin: "nuit" });
  expect(during).toBe("nuit");
  expect(currentSkin().id).toBe("crete");
});

test("inApp — dans le cadre de l'app (framed), la barre des onglets est là, hors de la pièce", async () => {
  const seen = await inApp(
    <Probe />,
    (drawn, page) => ({
      inPiece: drawn.querySelector(".tabbar") !== null,
      inPage: page.querySelector(".tabbar") !== null,
    }),
    { framed: true },
  );
  expect(seen).toEqual({ inPiece: false, inPage: true });
});

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

test("keepsEverything — passe quand la variante dit tout ce que dit la base, et échoue sinon", async () => {
  const base = (
    <div>
      <a href="/e">Trail des Crêtes</a>
      <p>Annecy</p>
    </div>
  );
  const html = await keepsEverything(
    <article>
      <span aria-hidden="true">13</span>
      <h3>
        <a href="/e">Trail des Crêtes</a>
      </h3>
      <p>Annecy</p>
      <p>de plus</p>
    </article>,
    base,
  );
  expect(html[0]).toContain("<article>");
  await expect(
    keepsEverything(
      <div>
        <a href="/e">Trail des Crêtes</a>
      </div>,
      base,
    ),
  ).rejects.toThrow(/Annecy/);
  await expect(
    keepsEverything(
      <div>
        <a href="/autre">Trail des Crêtes</a>
        <p>Annecy</p>
      </div>,
      base,
    ),
  ).rejects.toThrow(/links/);
  // A text hidden from a screen reader does not count as said.
  await expect(
    keepsEverything(
      <div>
        <a href="/e">Trail des Crêtes</a>
        <p aria-hidden="true">Annecy</p>
      </div>,
      base,
    ),
  ).rejects.toThrow(/Annecy/);
});

test("hex — une couleur calculée rgb() ou rgba() en #rrggbb", () => {
  expect(hex("rgb(255, 0, 10)")).toBe("#ff000a");
  expect(hex("rgba(36, 27, 53, 0.5)")).toBe("#241b35");
  expect(hex("rgb(12.6 200 3)")).toBe("#0dc803");
});
