import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { SKINS, chooseSkin, slotOf } from ".";
import { DayList } from "../features/agenda/DayList";
import { MonthGrid } from "../features/agenda/MonthGrid";
import { I18nProvider } from "../i18n/I18nProvider";
import { monthGrid } from "../lib/dates";
import { ensureTemporal } from "../lib/temporal";
import { fontsReady } from "../test/fontsReady";
import { FRAME } from "../test/frame";
import type { Skin } from "./types";

import "../styles.css";

// The sheets of a look meet styles.css in two orders: index.html links those
// of the skin kept before it, and a look chosen later adds them after it. The
// page must be drawn the same in both: the motifs of the skin and the app
// around them (the agenda, whose layout changes at `md`), on a computer.
// Here the sheets of the look are moved before styles.css and back, and every
// box is measured in both orders.

const WIDTH = 1280;

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(async () => {
  await page.viewport(WIDTH, 900);
});

afterEach(async () => {
  await chooseSkin("crete");
  await page.viewport(FRAME.width, FRAME.height);
});

/** The skins but Crête and the one of development. */
const OTHERS = SKINS.filter((skin) => skin.id !== "crete" && !skin.id.startsWith("_"));

/** What a skin draws, as the app places it, and the agenda of a month around it. */
function Scene({ skin }: { skin: Skin }): ReactNode {
  const month = Temporal.PlainYearMonth.from("2026-06");
  const slot = <N extends Parameters<typeof slotOf>[1]>(name: N) => slotOf(skin, name);
  return (
    <I18nProvider languages={["fr"]}>
      <div data-scene="motifs">
        <div className="on-dawn relative h-40 overflow-hidden">
          {createElement(slot("HeaderArt"), { place: "header", sun: true })}
          {createElement(slot("BrandMark"), { size: "lg" })}
        </div>
        <div className="on-dawn relative h-64 overflow-hidden">
          {createElement(slot("HeroArt"), { place: "event" })}
        </div>
        <div className="relative h-48 overflow-hidden">{createElement(slot("EmptyArt"), {})}</div>
        <div className="relative h-48 overflow-hidden">{createElement(slot("PageArt"), {})}</div>
        {createElement(slot("Divider"), {})}
        <h2>{createElement(slot("SectionMarker"), {})}Bloc</h2>
      </div>
      <div data-scene="agenda">
        <MonthGrid
          weeks={monthGrid(month, 1)}
          month={month}
          byDay={new Map()}
          today={Temporal.PlainDate.from("2026-06-01")}
          selected={undefined}
          labelledBy="month"
          busy={false}
          onSelect={() => {}}
        />
        <DayList day={Temporal.PlainDate.from("2026-06-01")} views={[]} />
      </div>
    </I18nProvider>
  );
}

/** The layout of every element of the scene: its box and what places and shows it. */
function layout(scene: Element): string[] {
  return [scene, ...scene.querySelectorAll("*")].map((element, at) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return [
      at,
      element.tagName,
      style.display,
      style.position,
      Math.round(box.width),
      Math.round(box.height),
      Math.round(box.left),
      Math.round(box.top),
      style.opacity,
      style.transform,
      style.fontWeight,
      style.fontSize,
    ].join(" ");
  });
}

/** Where the dev server took a <style> from (`data-vite-dev-id`), with `/` separators. */
const devId = (style: HTMLStyleElement) => (style.dataset.viteDevId ?? "").replaceAll("\\", "/");

/** The <style> elements of the dev server: styles.css's, and those of the look of a skin (its folder, shared/). */
function sheetsOf(skin: Skin) {
  const styles = [...document.querySelectorAll<HTMLStyleElement>("style[data-vite-dev-id]")];
  const entry = styles.find((style) => devId(style).endsWith("/src/styles.css"));
  const look = styles.filter((style) =>
    new RegExp(`/src/skins/(${skin.id}|shared)/`).test(devId(style)),
  );
  return { entry, look };
}

/**
 * The scenes are measured twice, in two orders of the sheets, and must be the
 * same at both: the fonts are loaded (WebKit loads them when it first draws a
 * text, and again when a sheet moves), and the animations that never end, the
 * decorations of a skin, are at their start, not wherever the wait left them.
 */
async function settled(scenes: () => Element[]) {
  scenes().map(layout);
  // WebKit starts the load of a font at the next frame, and fonts.ready would answer before.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await fontsReady();
  for (const animation of document.getAnimations()) {
    animation.pause();
    animation.currentTime = 0;
  }
}

test("cascade — à 1280 px, un skin gardé (ses feuilles avant styles.css) et un skin choisi (après) sont dessinés pareil : ses motifs et l'agenda", async () => {
  const differences: string[] = [];
  for (const skin of OTHERS) {
    await chooseSkin(skin.id);
    const { entry, look } = sheetsOf(skin);
    expect(entry, "the sheet of styles.css").toBeDefined();
    expect(look.length, `the sheets of the look of ${skin.id}`).toBeGreaterThan(1);
    const screen = await render(<Scene skin={skin} />);
    const scenes = () => [...screen.container.querySelectorAll("[data-scene]")];
    // The fonts of the skin load when the page first draws text in them: WebKit has
    // not by the time it is measured, and the two measures would be of two fonts.
    await settled(scenes);
    // Chosen: the dev server added the sheets of the look after styles.css.
    const chosen = scenes().map(layout);
    // Kept: index.html links them before it.
    for (const style of look) entry?.before(style);
    // A sheet that moves is read again with its fonts, which load again.
    await settled(scenes);
    const kept = scenes().map(layout);
    for (const style of look) document.head.append(style);
    for (const [at, lines] of chosen.entries()) {
      const other = kept[at] ?? [];
      lines.forEach((line, row) => {
        if (line !== other[row])
          differences.push(`${skin.id}: chosen « ${line} », kept « ${other[row]} »`);
      });
    }
    // The agenda on a computer, as the app draws it: the grid's cells hold
    // their events, the buttons of a phone's days and the list of a day are hidden.
    const agenda = screen.container.querySelector("[data-scene=agenda]");
    const shown = (selector: string) =>
      [...(agenda?.querySelectorAll(selector) ?? [])].map(
        (element) => getComputedStyle(element).display,
      );
    expect(new Set(shown(".agenda-cell-body")), `${skin.id}: the cells of the grid`).toEqual(
      new Set(["flex"]),
    );
    expect(new Set(shown(".agenda-day")), `${skin.id}: the days of a phone`).toEqual(
      new Set(["none"]),
    );
    expect(new Set(shown(".day-list")), `${skin.id}: the list of a day`).toEqual(new Set(["none"]));
    await screen.unmount();
  }
  expect(differences.slice(0, 20)).toEqual([]);
});
