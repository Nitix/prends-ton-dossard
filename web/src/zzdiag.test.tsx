import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { SKINS, chooseSkin, loadSkin } from "./skins";
import { HeaderArt } from "./skins/carnet/motifs";
import { hasPalette, settleSheets } from "./skins/sheets";

import "./styles.css";

// TEMPORARY diagnostic of Linux WebKit: one fact per failing test, to be read in the annotations.
const fail = (text: string): never => {
  throw new Error(`DIAG ${text}`.slice(0, 280));
};

test("diag 1 — loadSkin carnet", async () => {
  expect(1).toBe(1);
  let said = "ok";
  try {
    await loadSkin("carnet");
  } catch (error) {
    said = String(error);
  }
  fail(`loadSkin: ${said}; skins=${SKINS.map((s) => s.id).join(",")}`);
});

test("diag 2 — sheets", async () => {
  expect(1).toBe(1);
  const styles = [...document.querySelectorAll<HTMLElement>("style[data-vite-dev-id]")].map((s) =>
    s.dataset.viteDevId?.split("/").slice(-2).join("/"),
  );
  const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(
    (l) => `${l.href.slice(-30)}:${l.sheet ? l.sheet?.cssRules.length : "null"}`,
  );
  fail(
    `styles=${styles.length} carnet=${styles.filter((s) => s?.includes("carnet")).join("|")} links=${links.join("|")} styleSheets=${document.styleSheets.length}`,
  );
});

test("diag 3 — palette and choose", async () => {
  expect(1).toBe(1);
  const result = await chooseSkin("carnet");
  const settled = await settleSheets("carnet");
  const first = `n50=${getComputedStyle(document.documentElement).getPropertyValue("--color-neutral-50")} body=${getComputedStyle(document.body).backgroundColor}`;
  const second = await chooseSkin("alpage");
  const after = `alpage=${second} skin=${document.documentElement.dataset.skin} n50=${getComputedStyle(document.documentElement).getPropertyValue("--color-neutral-50")} body=${getComputedStyle(document.body).backgroundColor} palette=${hasPalette("alpage")}`;
  fail(`choose=${result} settled=${settled} ${first} | ${after}`);
});

test("diag 4 — motif", async () => {
  expect(1).toBe(1);
  await chooseSkin("carnet");
  const screen = await render(<HeaderArt place="header" sun />);
  const html = screen.container.innerHTML;
  fail(
    `veil=${screen.container.querySelectorAll(".carnet-veil").length} orbit=${screen.container.querySelectorAll(".carnet-orbit").length} anims=${screen.container.getAnimations({ subtree: true }).length} htmlLen=${html.length} head=${html.slice(0, 120)}`,
  );
  expect(1).toBe(1);
});
