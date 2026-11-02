import type { ReactNode } from "react";
import { beforeAll, expect, test, vi } from "vitest";

import { SKIN_DEPTH } from "..";
import { toEventView } from "../../features/events/api";
import { EventCard } from "../../features/events/EventCard";
import { EventHero } from "../../features/events/EventHero";
import { eventRecord } from "../../features/events/testFixture";
import { ensureTemporal } from "../../lib/temporal";
import { colourOf } from "../../test/computed";
import { inApp, type DrawOptions } from "../../test/variant";

import "../../styles.css";
import "../../skins/styles";

// « Alpage » at depth mix: its CSS (the « + », « S'inscrire », the day, the
// deadline of a card, the title of a page) hits the pieces it names. It has no
// variant at mix: its heroes and its card are Crête's, so what they show is
// Crête's (the smoke battery and skins/variants.test.tsx hold that). Under a
// palette build a skin has no rule of its own on a piece: these tests are
// skipped there.

vi.mock("../../lib/pb", async () => (await import("../../test/pbMock")).pbModule);

beforeAll(async () => {
  await ensureTemporal();
});

const SKIN = "alpage";
/**
 * What `check` finds in a piece drawn in the skin, while the skin is on the page
 * (the colours it reads from the theme, `colourOf`, are the skin's: Crête's are
 * back once the piece is gone).
 */
const within = (
  piece: ReactNode,
  check: (drawn: HTMLElement, page: HTMLElement) => void,
  options: DrawOptions = {},
) => inApp(piece, check, { skin: SKIN, ...options });

/** The event of the fixture, with a link to register and a deadline (4 days ahead by default). */
const view = (deadline = "2026-06-05") =>
  toEventView({
    ...eventRecord,
    notes: "Départ à 7 h.",
    registration_url: "https://example.org/inscription",
    registration_deadline: deadline,
  });

test.skipIf(SKIN_DEPTH === "palette")(
  "« Alpage » mix — le « + » est au lever du jour, sa croix en granit",
  async () => {
    await within(
      <p>Page</p>,
      (_drawn, page) => {
        const plus = page.querySelector<HTMLElement>("a.fab");
        expect(plus).not.toBeNull();
        const style = getComputedStyle(plus ?? document.body);
        // The sunrise, a trail of three oranges, not the forest of the main buttons.
        expect(style.backgroundImage).toContain(colourOf("--color-peach-400"));
        expect(style.backgroundImage).not.toContain(colourOf("--color-iris-600"));
        expect(style.color).toBe(colourOf("--color-neutral-950"));
      },
      { framed: true },
    );
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "« Alpage » mix — « S'inscrire » sur la forêt du haut de fiche est une pilule du lever du jour",
  async () => {
    await within(
      <EventHero
        view={view()}
        heading={{ id: "hero-title", "data-focus": "title", tabIndex: -1 }}
      />,
      (drawn) => {
        const register = drawn.querySelector<HTMLElement>(".event-hero a.btn-on-dawn");
        expect(register).not.toBeNull();
        const style = getComputedStyle(register ?? document.body);
        expect(style.backgroundImage).toContain(colourOf("--color-peach-400"));
        expect(style.color).toBe(colourOf("--color-neutral-950"));
      },
    );
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "« Alpage » mix — le jour d'un événement est un panneau de sentier, et sa carte a la balise de son échéance",
  async () => {
    await within(
      <>
        <EventCard view={view()} list="upcoming" />
        <EventCard view={view("2026-05-30")} list="upcoming" />
      </>,
      (drawn) => {
        const chip = drawn.querySelector<HTMLElement>(".date-chip");
        expect(chip).not.toBeNull();
        // Still the forest of the skin's paint (the palette's), with the band over it.
        expect(getComputedStyle(chip ?? document.body).backgroundImage).toMatch(/gradient/);
        const band = getComputedStyle(chip ?? document.body, "::before");
        expect(band.content).toBe('""');
        expect(band.backgroundColor).toBe(colourOf("--color-peach-400"));
        // Its deadline: a blaze of two bands while the registrations are open, a grey band once closed.
        const [open, closed] = [...drawn.querySelectorAll<HTMLElement>(".event-card-deadline")];
        expect([open?.dataset.kind, closed?.dataset.kind]).toEqual(["open", "closed"]);
        expect(getComputedStyle(open ?? document.body, "::before").backgroundImage).toMatch(
          /gradient/,
        );
        expect(getComputedStyle(closed ?? document.body, "::before").backgroundColor).toBe(
          colourOf("--color-neutral-500"),
        );
      },
    );
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "« Alpage » mix — sous le titre d'une page, le chemin de la forêt au lever du jour, une ligne arrondie",
  async () => {
    await within(<h1 className="page-title">Titre</h1>, (drawn) => {
      const title = drawn.querySelector<HTMLElement>("h1.page-title");
      const line = getComputedStyle(title ?? document.body, "::after");
      expect(line.borderTopLeftRadius).not.toBe("0px");
      expect(Number.parseFloat(line.height)).toBeCloseTo(0.3 * 16, 1);
      // Crête's crest is a mask: none here, the line is whole.
      expect(line.maskImage === "none" || line.maskImage === "").toBe(true);
      expect(line.backgroundImage).toMatch(/gradient/);
    });
  },
);
