import { createRef, type ReactNode } from "react";
import { beforeAll, expect, test, vi } from "vitest";

import { SKIN_DEPTH } from "..";
import { toEventView } from "../../features/events/api";
import { EventHero } from "../../features/events/EventHero";
import { aliceRunner, eventRecord } from "../../features/events/testFixture";
import { RunnerHero } from "../../features/runners/RunnerHero";
import { ensureTemporal } from "../../lib/temporal";
import { inApp, type DrawOptions } from "../../test/variant";

import "../../styles.css";
import "../../skins/styles";

// « Aurore » at depth mix: its small sheet (the line under a title, the foot
// of its heroes, the glass of the bar of the tabs) hits the pieces it names.
// It has no variant: its layout is Crête's. Under a palette build a skin has no
// rule of its own on a piece: these tests are skipped there.

vi.mock("../../lib/pb", async () => (await import("../../test/pbMock")).pbModule);

beforeAll(async () => {
  await ensureTemporal();
});

const SKIN = "aurore";
/** What `check` finds in a piece drawn in the skin, while the skin is on the page. */
const within = (
  piece: ReactNode,
  check: (drawn: HTMLElement, page: HTMLElement) => void,
  options: DrawOptions = {},
) => inApp(piece, check, { skin: SKIN, ...options });

test.skipIf(SKIN_DEPTH === "palette")(
  "« Aurore » mix — sous le titre d'une page, une ligne ronde d'aube, pas la crête de Crête",
  async () => {
    await within(<h1 className="page-title">Titre</h1>, (drawn) => {
      const title = drawn.querySelector<HTMLElement>("h1.page-title");
      const line = getComputedStyle(title ?? document.body, "::after");
      expect(line.borderTopLeftRadius).not.toBe("0px");
      expect(Number.parseFloat(line.height)).toBeCloseTo(0.3 * 16, 1);
      expect(line.maskImage === "none" || line.maskImage === "").toBe(true);
      expect(line.backgroundImage).toMatch(/gradient/);
    });
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "« Aurore » mix — les hauts de page ne gardent pas le pied que Crête réserve à ses crêtes",
  async () => {
    // On a phone (414 px, under `md`): 3.5rem under the words of an event, 2.25rem under a runner's.
    await within(
      <>
        <EventHero
          view={toEventView({ ...eventRecord, notes: "Départ à 7 h." })}
          heading={{ id: "hero-title", "data-focus": "title", tabIndex: -1 }}
        />
        <RunnerHero
          runner={aliceRunner}
          heading={{ ref: createRef<HTMLHeadingElement>(), tabIndex: -1 }}
        />
      </>,
      (drawn) => {
        const event = drawn.querySelector<HTMLElement>(".event-hero-body");
        const runner = drawn.querySelector<HTMLElement>(".runner-hero");
        expect(event, "the words of the hero of an event").not.toBeNull();
        expect(getComputedStyle(event ?? document.body).paddingBottom).toBe("56px");
        expect(getComputedStyle(runner ?? document.body).paddingBottom).toBe("36px");
      },
    );
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "« Aurore » mix — la barre des onglets est en verre dépoli",
  async () => {
    await within(
      <p>Page</p>,
      (_drawn, page) => {
        const bar = page.querySelector<HTMLElement>(".tabbar-list");
        expect(bar).not.toBeNull();
        expect(getComputedStyle(bar ?? document.body).backdropFilter).toContain("blur(12px)");
      },
      { framed: true },
    );
  },
);
