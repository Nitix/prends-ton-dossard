import { afterEach, expect, test } from "vitest";

import { hasPalette, settleSheets } from "./sheets";

// What the page has of a skin's look: its palette, in a stylesheet. The
// stylesheet of a look can fail to load (offline, a 404 after a deploy) while
// its code loads, and Vite's preload helper does not ask for a stylesheet again
// after a failure: `settleSheets` is what says that a look is whole, and asks
// again for a sheet that failed. A real failure, through the real build, is
// lookFailure.test.ts.

const added: Element[] = [];

afterEach(() => {
  for (const element of added.splice(0)) element.remove();
});

/** A <style> in the page, as Vite's dev server puts a look's sheet. */
function style(css: string): HTMLStyleElement {
  const element = document.createElement("style");
  element.textContent = css;
  document.head.append(element);
  added.push(element);
  return element;
}

/** A stylesheet link in the page. */
function link(href: string): HTMLLinkElement {
  const element = document.createElement("link");
  element.rel = "stylesheet";
  element.href = href;
  document.head.append(element);
  added.push(element);
  return element;
}

test("sheets — la palette d'un skin est dans la page quand une feuille a des règles pour sa page", () => {
  expect(hasPalette("sheets-a")).toBe(false);
  style(':root[data-skin="sheets-a"] { --color-ink: #123456; }');
  expect(hasPalette("sheets-a")).toBe(true);
});

test("sheets — la palette se trouve aussi dans un @media, et dans un @layer ; un autre skin au nom voisin n'est pas elle", () => {
  style(
    '@media (prefers-color-scheme: dark) { :root[data-skin="sheets-b"]:not([data-theme="light"]) { --color-ink: #fff; } }',
  );
  style('@layer base { :root[data-skin="sheets-c"][data-theme="dark"] { --color-ink: #fff; } }');
  expect(hasPalette("sheets-b")).toBe(true);
  expect(hasPalette("sheets-c")).toBe(true);
  // « sheets-d » is not « sheets-d2 »: a skin's name is not a part of another's.
  style(':root[data-skin="sheets-d2"] { --color-ink: #fff; }');
  expect(hasPalette("sheets-d")).toBe(false);
  expect(hasPalette("sheets-d2")).toBe(true);
});

test("sheets — une règle qui ne parle pas de la page d'un skin n'est pas sa palette", () => {
  style('.sheets-e { color: red; } [data-other="sheets-e"] { color: blue; }');
  expect(hasPalette("sheets-e")).toBe(false);
});

test("sheets — la palette est là : rien n'est demandé de nouveau", async () => {
  style(':root[data-skin="sheets-f"] { --color-ink: #123456; }');
  const before = document.querySelectorAll("link").length;
  await expect(settleSheets("sheets-f")).resolves.toBe(true);
  expect(document.querySelectorAll("link").length).toBe(before);
});

test("sheets — une feuille qui n'est pas encore là : le skin est entier quand elle est venue", async () => {
  // The palette of the skin of development, in a link that is still on its way
  // (a sheet that failed is a link with no sheet too: it is asked for again).
  expect(hasPalette("_example")).toBe(false);
  link("/src/skins/_example/palette.css");

  await expect(settleSheets("_example")).resolves.toBe(true);
  expect(hasPalette("_example")).toBe(true);
});

test("sheets — une feuille qui manque encore après qu'on l'a redemandée : le skin n'est pas entier", async () => {
  link("/sheets-that-is-not-there.css");

  await expect(settleSheets("sheets-h")).resolves.toBe(false);
  expect(hasPalette("sheets-h")).toBe(false);
});
