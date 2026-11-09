import { afterEach, expect, test } from "vitest";

import { chooseSkin } from "./skins";

import "./styles.css";

// TEMPORARY diagnostic of Linux WebKit (round 7): which mechanism makes <body> take the colour
// of the skin that was just chosen. One line per variant: « DIAG2 variant=… body=… ». It runs on
// CI only (VITE_CI), and is removed after one run.
const onCi = Boolean(import.meta.env.VITE_CI);
const ALPAGE = "rgb(247, 243, 234)";

const body = () => getComputedStyle(document.body).backgroundColor;
const skinStyles = (id: string) =>
  [...document.querySelectorAll<HTMLStyleElement>("style[data-vite-dev-id]")].filter((s) =>
    new RegExp(`/skins/(${id}|shared)/`).test((s.dataset.viteDevId ?? "").replaceAll("\\", "/")),
  );

/** The page one skin behind: Carnet chosen, then Alpage. */
async function prime(): Promise<string> {
  await chooseSkin("crete");
  await chooseSkin("carnet");
  await chooseSkin("alpage");
  return body();
}

const say = (variant: string, before: string, after: string): never => {
  throw new Error(
    `DIAG2 variant=${variant} before=${before} after=${after} ok=${after.split("/").every((one) => one === ALPAGE)} ua=${navigator.userAgent.replace(/^Mozilla\/5.0 /, "").slice(0, 70)}`,
  );
};

afterEach(async () => {
  await chooseSkin("crete");
});

test.skipIf(!onCi)("diag2 — 0 baseline", async () => {
  expect(1).toBe(1);
  const before = await prime();
  say("baseline", before, body());
});

test.skipIf(!onCi)("diag2 — a disabled toggled", async () => {
  expect(1).toBe(1);
  const before = await prime();
  for (const s of skinStyles("alpage")) {
    s.disabled = true;
    s.disabled = false;
  }
  say("a-disabled", before, body());
});

test.skipIf(!onCi)("diag2 — b textContent reparsed", async () => {
  expect(1).toBe(1);
  const before = await prime();
  for (const s of skinStyles("alpage")) s.textContent = (s.textContent ?? "").slice(0);
  say("b-textContent", before, body());
});

test.skipIf(!onCi)("diag2 — c adoptedStyleSheets", async () => {
  expect(1).toBe(1);
  const before = await prime();
  const removed = skinStyles("alpage");
  const adopted = removed.map((s) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(s.textContent ?? "");
    s.remove();
    return sheet;
  });
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, ...adopted];
  const after = body();
  document.adoptedStyleSheets = [];
  document.head.append(...removed);
  say("c-adopted", before, after);
});

test.skipIf(!onCi)("diag2 — d rAF and a task", async () => {
  expect(1).toBe(1);
  const before = await prime();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const one = body();
  await new Promise((resolve) => setTimeout(resolve, 300));
  say("d-wait", before, `${one}/${body()}`);
});

test.skipIf(!onCi)("diag2 — e inline properties on html", async () => {
  expect(1).toBe(1);
  const before = await prime();
  const root = document.documentElement;
  const value = getComputedStyle(root).getPropertyValue("--color-neutral-50");
  root.style.setProperty("--color-neutral-50", value);
  const after = body();
  root.style.removeProperty("--color-neutral-50");
  say("e-inline", before, after);
});

test.skipIf(!onCi)("diag2 — f link rel=stylesheet", async () => {
  expect(1).toBe(1);
  await chooseSkin("crete");
  await chooseSkin("carnet");
  // The sheets of Alpage are made links (the production path), from their text.
  await chooseSkin("alpage");
  const styles = skinStyles("alpage");
  const links = await Promise.all(
    styles.map(
      (s) =>
        new Promise<HTMLLinkElement>((resolve) => {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = URL.createObjectURL(new Blob([s.textContent ?? ""], { type: "text/css" }));
          link.addEventListener("load", () => resolve(link));
          link.addEventListener("error", () => resolve(link));
          document.head.append(link);
        }),
    ),
  );
  for (const s of styles) s.remove();
  await chooseSkin("crete");
  await chooseSkin("carnet");
  const before = body();
  await chooseSkin("alpage");
  const after = body();
  for (const link of links) link.remove();
  document.head.append(...styles);
  say(`f-link(n=${links.length})`, before, after);
});
