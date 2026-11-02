import { createRef, type ReactNode } from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

import { SKIN_DEPTH } from "..";
import { toEventView } from "../../features/events/api";
import { EventCard } from "../../features/events/EventCard";
import { EventHero } from "../../features/events/EventHero";
import { aliceRunner, eventRecord } from "../../features/events/testFixture";
import { RunnerHero } from "../../features/runners/RunnerHero";
import { ensureTemporal } from "../../lib/temporal";
import { contrast } from "../../test/colour";
import { colourOf, shadowLayers, textContrast, toldApart } from "../../test/computed";
import { resetMedia } from "../../test/media";
import { hex, inApp } from "../../test/variant";

import "../../styles.css";
import "../../skins/styles";

// « Nuit », depth mix: the pieces restyled in mix.css (the tape of the current
// tab, of the card of an event and of the title of a page, the lime « S'inscrire »
// on a hero, the ring of a runner's photo) take the tokens of the palette.
// Nothing here is Nuit's markup: at mix it has no variant, only a sheet (at
// full, its hero is its own: full.test.tsx). At palette the sheet is not in
// the build.

vi.mock("../../lib/pb", async () => (await import("../../test/pbMock")).pbModule);

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(async () => {
  await resetMedia();
});

/** The tokens of the palette a test compares with, read while Nuit is on the page. */
const tokens = () => ({
  lime: colourOf("--color-iris-600"),
  glow: colourOf("--dawn-glow-warm"),
});

/** What `look` makes of a piece, or of the frame of the page (`AppShell`), in Nuit, with the palette's tokens. */
function inNuit<T extends object>(
  element: ReactNode,
  look: (drawn: HTMLElement, page: HTMLElement) => T,
  options: { framed?: boolean } = {},
) {
  return inApp(element, (drawn, page) => ({ ...look(drawn, page), tokens: tokens() }), {
    skin: "nuit",
    ...options,
  });
}

const event = () =>
  toEventView({
    ...eventRecord,
    notes: "Départ à 7 h.",
    registration_url: "https://example.org/inscription",
    registration_deadline: "2026-06-05",
  });

test.skipIf(SKIN_DEPTH === "palette")(
  "nuit — la barre des onglets est un verre dépoli, l'onglet courant a la bande réfléchissante et une icône lime, sans pastille, et le + brille en lime",
  async () => {
    const seen = await inNuit(
      <p>Contenu</p>,
      (_, drawn) => {
        const bar = drawn.querySelector(".tabbar-list");
        const current = drawn.querySelector('.tab[aria-current="page"]');
        const other = [...drawn.querySelectorAll(".tab")].find((tab) => tab !== current);
        if (!bar || !current || !other) throw new Error("the tabs were not drawn");
        const tape = getComputedStyle(current, "::before");
        return {
          glass: getComputedStyle(bar).backdropFilter,
          tape: tape.backgroundImage,
          tapeHeight: tape.height,
          pill: [getComputedStyle(current).backgroundImage, getComputedStyle(current).boxShadow],
          icon: getComputedStyle(current.querySelector(".tab-icon") ?? current).color,
          otherTape: getComputedStyle(other, "::before").content,
          apart: toldApart(current, other),
          contrast: textContrast(current),
          halo: getComputedStyle(drawn.querySelector(".fab") ?? drawn).boxShadow,
        };
      },
      { framed: true },
    );
    expect(seen.glass).toContain("blur");
    expect(seen.tape, "the tape over the current tab").toContain("repeating-linear-gradient");
    expect(seen.tapeHeight).toBe("3px");
    expect(seen.pill, "no pill under it").toEqual(["none", "none"]);
    expect(seen.icon, "its icon is lime").toBe(seen.tokens.lime);
    expect(seen.otherTape, "no tape on the others").toBe("none");
    expect(seen.apart, "told apart by its weight and its tape").toEqual(
      expect.arrayContaining(["fontWeight", "before"]),
    );
    expect(seen.contrast, "its words on the glass").toBeGreaterThanOrEqual(4.5);
    // Crête's « + » has its glow and its ring of the card; the lime ring round it, 5 px, is the skin's.
    expect(
      shadowLayers(seen.halo).some((layer) => layer.includes("0px 0px 0px 5px")),
      "the lime ring round the « + »",
    ).toBe(true);
    expect(seen.halo, "lit from behind in the lime").toContain(seen.tokens.glow);
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "nuit — la carte d'un événement a sa bande réfléchissante, sa ligne de points et sa date en tuile lime (4,5:1)",
  async () => {
    const seen = await inNuit(<EventCard view={event()} list="upcoming" />, (drawn) => {
      const card = drawn.querySelector(".event-card");
      const chip = drawn.querySelector(".date-chip");
      const under = drawn.querySelector(".event-card-body");
      const tile = getComputedStyle(chip ?? drawn);
      return {
        tape: getComputedStyle(card ?? drawn, "::before").backgroundImage,
        clipped: getComputedStyle(card ?? drawn).overflow,
        dots: under ? getComputedStyle(under).borderTopStyle : "none",
        tileImage: tile.backgroundImage,
        tileInk: tile.color,
        card: getComputedStyle(card ?? drawn).backgroundColor,
      };
    });
    expect(seen.tape).toContain("repeating-linear-gradient");
    expect(seen.clipped, "so that the tape stays on the card").toBe("hidden");
    expect(seen.dots, "the pace line over the runners").toBe("dotted");
    // The day: a lime tile on the card, no longer a flat lime pill.
    expect(seen.tileImage).toBe("none");
    expect(seen.tileInk).toBe(seen.tokens.lime);
    expect(contrast(hex(seen.tileInk), hex(seen.card))).toBeGreaterThanOrEqual(4.5);
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "nuit — « S'inscrire » sur le haut d'une fiche est le lime des boutons principaux, la photo d'un coureur son anneau lime",
  async () => {
    const heading = { id: "t", "data-focus": "title", tabIndex: -1 } as const;
    const register = await inNuit(<EventHero view={event()} heading={heading} />, (drawn) => {
      const link = drawn.querySelector(".event-hero .btn-on-dawn");
      const style = getComputedStyle(link ?? drawn);
      return { ground: style.backgroundColor, ink: style.color, link: link?.textContent };
    });
    expect(register.link, "the link is still there").toContain("S'inscrire");
    expect(register.ground).toBe(register.tokens.lime);
    expect(contrast(hex(register.ink), hex(register.ground))).toBeGreaterThanOrEqual(4.5);
    const ring = await inNuit(
      <RunnerHero
        runner={aliceRunner}
        heading={{ ref: createRef<HTMLHeadingElement>(), tabIndex: -1 }}
      />,
      (drawn) => ({
        ring: getComputedStyle(drawn.querySelector(".runner-hero .avatar-soft") ?? drawn).boxShadow,
      }),
    );
    expect(ring.ring, "the ring of the photo").toContain(ring.tokens.lime);
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "nuit — le titre d'une page a un ruban réfléchissant à la place de la crête",
  async () => {
    const seen = await inNuit(<h1 className="page-title">Accueil</h1>, (drawn) => {
      const style = getComputedStyle(drawn.querySelector(".page-title") ?? drawn, "::after");
      return { tape: style.backgroundImage, mask: style.maskImage, height: style.height };
    });
    expect(seen.tape).toContain("repeating-linear-gradient");
    expect(seen.mask).toBe("none");
    expect(seen.height).toBe("3px");
  },
);
