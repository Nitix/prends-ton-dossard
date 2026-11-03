import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { groundsBehind, rgbaOf, textContrast, toldApart } from "./computed";

// What the smoke battery measures of a current tab drawn by a skin at mix and
// full: the colours behind its words, the contrast of its words on them, and
// what tells it apart from the other tabs besides the colour of its words.

test("rgbaOf — une couleur calculée, quelle que soit son écriture, en octets et en alpha", () => {
  expect(rgbaOf("rgb(255, 0, 10)")).toEqual([255, 0, 10, 1]);
  expect(rgbaOf("rgba(36, 27, 53, 0.5)")).toEqual([36, 27, 53, 0.5]);
  expect(rgbaOf("color(srgb 1 0.5 0)")).toEqual([255, 128, 0, 1]);
  expect(rgbaOf("transparent")).toEqual([0, 0, 0, 0]);
});

test("groundsBehind — le fond d'un élément, ses dégradés et ses voiles posés sur ce qu'il y a dessous", async () => {
  const screen = await render(
    <div style={{ backgroundColor: "rgb(255, 255, 255)" }}>
      <div style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}>
        <span
          data-pill=""
          style={{ backgroundImage: "linear-gradient(90deg, rgb(200, 0, 0), rgb(0, 0, 200))" }}
        >
          Pilule
        </span>
        <span
          data-bar=""
          style={{
            backgroundImage: "linear-gradient(rgb(200, 0, 0), rgb(200, 0, 0))",
            backgroundSize: "100% 0.25rem",
            backgroundRepeat: "no-repeat",
          }}
        >
          Barre
        </span>
        <span
          data-gloss=""
          style={{
            backgroundColor: "rgb(255, 255, 255)",
            backgroundImage: "linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0))",
          }}
        >
          Vernis
        </span>
        <span data-plain="">Rien</span>
      </div>
    </div>,
  );
  const pick = (selector: string) => {
    const found = screen.container.querySelector(selector);
    if (found === null) throw new Error(selector);
    return found;
  };
  // A gradient that fills the box: its stops are behind the words.
  expect(groundsBehind(pick("[data-pill]"))).toEqual(["#c80000", "#0000c8"]);
  // A gradient cut to a bar is not behind the words: what is under it is, the half black veil on white.
  expect(groundsBehind(pick("[data-bar]"))).toEqual(["#808080"]);
  expect(groundsBehind(pick("[data-plain]"))).toEqual(["#808080"]);
  // A translucent gloss over a fill of its own: the fill is under it, not what is under the element.
  expect(groundsBehind(pick("[data-gloss]"))).toEqual(["#808080", "#ffffff"]);
  await screen.unmount();
});

test("textContrast — le plus faible contraste des mots d'un élément sur ce qu'il y a derrière eux", async () => {
  const screen = await render(
    <div style={{ backgroundColor: "rgb(255, 255, 255)" }}>
      <span data-ink="" style={{ color: "rgb(0, 0, 0)" }}>
        Encre
      </span>
      <span
        data-pale=""
        style={{
          color: "rgb(255, 255, 255)",
          backgroundImage: "linear-gradient(rgb(0, 0, 0), rgb(255, 200, 200))",
        }}
      >
        Pâle
      </span>
    </div>,
  );
  const ink = screen.container.querySelector("[data-ink]");
  const pale = screen.container.querySelector("[data-pale]");
  if (!ink || !pale) throw new Error("not drawn");
  expect(textContrast(ink)).toBeCloseTo(21, 1);
  // White on the light end of its gradient: the weakest stop counts.
  expect(textContrast(pale)).toBeLessThan(1.5);
  await screen.unmount();
});

test("toldApart — ce qui distingue un onglet d'un autre en plus de la couleur de ses mots", async () => {
  const screen = await render(
    <nav>
      <span data-tab="plain" style={{ color: "rgb(90, 90, 90)" }}>
        Liste
      </span>
      <span data-tab="ink" style={{ color: "rgb(0, 0, 0)" }}>
        Accueil
      </span>
      <span data-tab="bold" style={{ color: "rgb(0, 0, 0)", fontWeight: 800 }}>
        Accueil
      </span>
      <span data-tab="bar" style={{ color: "rgb(90, 90, 90)", boxShadow: "inset 0 -3px 0 red" }}>
        Accueil
      </span>
    </nav>,
  );
  const tab = (name: string) => {
    const found = screen.container.querySelector(`[data-tab="${name}"]`);
    if (found === null) throw new Error(name);
    return found;
  };
  // The colour of its words alone does not tell it apart.
  expect(toldApart(tab("ink"), tab("plain"))).toEqual([]);
  expect(toldApart(tab("bold"), tab("plain"))).toEqual(["fontWeight"]);
  expect(toldApart(tab("bar"), tab("plain"))).toEqual(["boxShadow"]);
  await screen.unmount();
});
