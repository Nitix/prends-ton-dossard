import { createRef, type ReactNode } from "react";
import { beforeAll, expect, test, vi } from "vitest";

import { SKIN_DEPTH } from "..";
import { toEventView } from "../../features/events/api";
import { EventCard } from "../../features/events/EventCard";
import { EventHero, EventHeroBase } from "../../features/events/EventHero";
import { aliceRunner, eventRecord } from "../../features/events/testFixture";
import { RunnerHero, RunnerHeroBase } from "../../features/runners/RunnerHero";
import { ensureTemporal } from "../../lib/temporal";
import { colourOf, rgbaOf, toldApart } from "../../test/computed";
import {
  EVENT_SHAPES,
  inApp,
  keepsEverything,
  plain,
  said,
  type DrawOptions,
} from "../../test/variant";

import "../../styles.css";
import "../../skins/styles";

// « Sentier » at depth mix: its two light heroes keep everything that Crête's
// show (the feature test of every variant, skins/variants.test.tsx, holds that
// over every shape of an event; here the hero is also checked for the order of
// its markup and for its sun), and its CSS (the « + », the tabs, the day, the
// card, the titles) hits the pieces it names. Under a palette build a skin has
// no variant and no rule of its own on a piece: those tests are skipped there.

vi.mock("../../lib/pb", async () => (await import("../../test/pbMock")).pbModule);

beforeAll(async () => {
  await ensureTemporal();
});

const SKIN = "sentier";
const mixed = SKIN_DEPTH !== "palette";
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

const heading = { id: "hero-title", "data-focus": "title", tabIndex: -1 } as const;

/** The event of the fixture, with all that its hero shows: notes, a link to register, a deadline 4 days ahead. */
const view = (deadline = "2026-06-05") =>
  toEventView({
    ...eventRecord,
    notes: "Départ à 7 h.",
    registration_url: "https://example.org/inscription",
    registration_deadline: deadline,
  });

test("« Sentier » mix — le haut d'une fiche est le sien à mix, celui de Crête au palette, et garde tout ce que celui de Crête dit", async () => {
  const [rich] = EVENT_SHAPES();
  if (rich === undefined) throw new Error("no event shape");
  const [own, base] = await keepsEverything(
    <EventHero view={rich.view} heading={heading} />,
    <EventHeroBase view={rich.view} heading={heading} />,
    { skin: SKIN, what: "Sentier's hero" },
  );
  expect(own !== base, "the hero is Sentier's").toBe(mixed);
  // Not an empty search: what the hero is held to say.
  const spoken = await inApp(<EventHeroBase view={rich.view} heading={heading} />, said, {
    skin: SKIN,
  });
  expect(spoken.flat).toContain("Trail des Crêtes");
  expect(spoken.flat).toContain("Annecy");
  expect(spoken.flat).toContain("Départ à 7 h.");
  expect(spoken.links).toEqual([
    "S'inscrire sur le site officiel → https://example.org/inscription",
  ]);
});

test.skipIf(!mixed)(
  "« Sentier » mix — le haut d'une fiche est une balise HEADER, son titre en premier dans le DOM et sa date au-dessus à l'écran",
  async () => {
    await within(<EventHero view={view()} heading={heading} />, (drawn) => {
      const hero = drawn.querySelector<HTMLElement>(".event-hero");
      const title = hero?.querySelector<HTMLElement>("h1");
      const date = [...(hero?.querySelectorAll<HTMLElement>("p") ?? [])].find((p) =>
        /13 juin/.test(plain(p.textContent)),
      );
      expect(hero?.tagName).toBe("HEADER");
      expect(title, "the title").not.toBeUndefined();
      expect(date, "the date").not.toBeUndefined();
      if (!title || !date) return;
      // The title is read first (a screen reader, the tab order, the page's focus): the date comes after it.
      expect(
        Boolean(title.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING),
        "the h1 comes before the date in the DOM",
      ).toBe(true);
      // On the screen the date is over the title, as in the variant.
      expect(
        date.getBoundingClientRect().bottom,
        "the date is drawn over the title",
      ).toBeLessThanOrEqual(title.getBoundingClientRect().top + 1);
      expect(title.id, "the title keeps the id the actions name").toBe("hero-title");
    });
  },
);

test.skipIf(!mixed)(
  "« Sentier » mix — la fin des inscriptions du haut d'une fiche est la phrase de Crête, en un seul texte",
  async () => {
    await within(<EventHero view={view()} heading={heading} />, (drawn) => {
      const deadline = drawn.querySelector(".event-hero-deadline");
      expect(plain(deadline?.textContent)).toBe(
        "Inscriptions jusqu'au ven. 5 juin · plus que 4 jours",
      );
      // One text, not two: the sentence of `deadlineText`.
      expect(deadline?.querySelector("span")?.childNodes.length).toBe(1);
    });
  },
);

test.skipIf(!mixed)(
  "« Sentier » mix — le soleil du haut d'une fiche ne se voit pas à travers les crêtes : elles sont pleines",
  async () => {
    await within(<EventHero view={view()} heading={heading} />, (drawn) => {
      const ridges = [
        ...drawn.querySelectorAll<SVGPathElement>('.event-hero svg[viewBox="0 0 1200 120"] path'),
      ];
      expect(ridges.length, "the far and the near ridge").toBe(2);
      // A translucent far ridge showed the lower half of the sun through it, as a muddy disc.
      for (const ridge of ridges) {
        expect(rgbaOf(getComputedStyle(ridge).fill)[3], "a ridge is opaque").toBe(1);
      }
    });
  },
);

test("« Sentier » mix — le haut d'une page de coureur garde sa photo, son nom et son titre", async () => {
  const given = { ref: createRef<HTMLHeadingElement>(), tabIndex: -1 } as const;
  const [own, base] = await keepsEverything(
    <RunnerHero runner={aliceRunner} heading={given} />,
    <RunnerHeroBase runner={aliceRunner} heading={given} />,
    { skin: SKIN, what: "Sentier's runner hero" },
  );
  expect(own !== base, "the hero is Sentier's").toBe(mixed);
  // Their initials (no photo in the fixture) are hidden: their name; « Coureur » while they load.
  const named = await inApp(
    <RunnerHero runner={aliceRunner} heading={given} />,
    (drawn) => said(drawn).texts,
    { skin: SKIN },
  );
  const loading = await inApp(
    <RunnerHero runner={undefined} heading={given} />,
    (drawn) => said(drawn).texts,
    { skin: SKIN },
  );
  expect(named).toEqual(["Alice"]);
  expect(loading).toEqual(["Coureur"]);
});

test.skipIf(!mixed)(
  "« Sentier » mix — le « + » est au lever du jour, sa croix en granit",
  async () => {
    await within(
      <p>Page</p>,
      (_drawn, page) => {
        const plus = page.querySelector<HTMLElement>("a.fab");
        expect(plus).not.toBeNull();
        const style = getComputedStyle(plus ?? document.body);
        expect(style.backgroundColor).toBe(colourOf("--color-peach-400"));
        expect(style.backgroundImage, "no pine paint under the sunrise").toBe("none");
        expect(style.color).toBe(colourOf("--color-neutral-950"));
      },
      { framed: true },
    );
  },
);

test.skipIf(!mixed)(
  "« Sentier » mix — l'onglet courant est celui de la variante : en gras, en pin, la balise au lever du jour au-dessus, sans pastille",
  async () => {
    await within(
      <p>Page</p>,
      (_drawn, page) => {
        const current = page.querySelector<HTMLElement>('.tab[aria-current="page"]');
        const other = page.querySelector<HTMLElement>(".tab:not([aria-current])");
        const bar = page.querySelector<HTMLElement>(".tabbar-list");
        expect(current).not.toBeNull();
        expect(other).not.toBeNull();
        if (!current || !other || !bar) return;
        const style = getComputedStyle(current);
        const blaze = getComputedStyle(current, "::before");
        expect(blaze.content).toBe('""');
        expect(blaze.backgroundColor).toBe(colourOf("--color-peach-400"));
        expect(getComputedStyle(other, "::before").content, "another tab has no blaze").toBe(
          "none",
        );
        // The paint is the blaze and the weight, not a pill of pine: the current tab reads as in the variant.
        expect(Number(style.fontWeight)).toBeGreaterThanOrEqual(700);
        expect(style.color).toBe(colourOf("--color-iris-700"));
        expect(rgbaOf(style.backgroundColor)[3], "no fill").toBe(0);
        expect(style.backgroundImage).toBe("none");
        expect(style.boxShadow).toBe("none");
        expect(toldApart(current, other), "what tells it apart").toEqual(
          expect.arrayContaining(["fontWeight", "before"]),
        );
        // On a phone (414 px, under `md`) the bar is flat and as wide as the screen, not a floating pill.
        const box = bar.getBoundingClientRect();
        expect(getComputedStyle(bar).borderTopLeftRadius).toBe("0px");
        expect(box.left).toBe(0);
        expect(box.right).toBe(document.documentElement.clientWidth);
      },
      { framed: true },
    );
  },
);

test.skipIf(!mixed)(
  "« Sentier » mix — le jour d'un événement est un panneau de sentier, et sa carte a la balise de son échéance",
  async () => {
    await within(
      <>
        <EventCard view={view()} list="upcoming" />
        <EventCard view={view("2026-05-30")} list="upcoming" />
      </>,
      (drawn) => {
        const chip = drawn.querySelector<HTMLElement>(".date-chip");
        const top = drawn.querySelector<HTMLElement>(".date-chip-top");
        const [open, closed] = [...drawn.querySelectorAll<HTMLElement>(".event-card-deadline")];
        const link = drawn.querySelector<HTMLElement>(".event-card-title a");
        expect(chip).not.toBeNull();
        expect(getComputedStyle(chip ?? document.body).backgroundColor).toBe(
          colourOf("--color-iris-50"),
        );
        const band = getComputedStyle(chip ?? document.body, "::before");
        expect(band.content).toBe('""');
        expect(band.backgroundColor).toBe(colourOf("--color-peach-400"));
        expect(getComputedStyle(top ?? document.body).color, "the weekday over the day").toBe(
          colourOf("--color-iris-600"),
        );
        // Its deadline: a blaze of two bands while the registrations are open, a grey band once closed.
        expect([open?.dataset.kind, closed?.dataset.kind]).toEqual(["open", "closed"]);
        expect(getComputedStyle(open ?? document.body, "::before").backgroundImage).toMatch(
          /gradient/,
        );
        expect(getComputedStyle(closed ?? document.body, "::before").backgroundColor).toBe(
          colourOf("--color-neutral-500"),
        );
        // Its title is underlined in sunrise.
        const underline = getComputedStyle(link ?? document.body);
        expect(underline.textDecorationColor).toBe(colourOf("--color-peach-400"));
        expect(underline.textDecorationThickness).toBe("2px");
      },
    );
  },
);

test.skipIf(!mixed)(
  "« Sentier » mix — le titre d'une page est en pin, sans trait dessous",
  async () => {
    await within(<h1 className="page-title">Titre</h1>, (drawn) => {
      const title = drawn.querySelector<HTMLElement>("h1.page-title");
      expect(getComputedStyle(title ?? document.body).color).toBe(colourOf("--color-iris-900"));
      expect(getComputedStyle(title ?? document.body, "::after").display).toBe("none");
    });
  },
);

test.skipIf(!mixed)(
  "« Sentier » mix — « S'inscrire » dans le haut d'une fiche est au lever du jour",
  async () => {
    await within(<EventHero view={view()} heading={heading} />, (drawn) => {
      const register = drawn.querySelector<HTMLElement>(".event-hero a.btn-primary");
      expect(register).not.toBeNull();
      const style = getComputedStyle(register ?? document.body);
      expect(style.backgroundColor).toBe(colourOf("--color-peach-400"));
      expect(style.color).toBe(colourOf("--color-neutral-950"));
    });
  },
);
