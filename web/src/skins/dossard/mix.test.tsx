import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { page } from "vitest/browser";

import { SKIN_DEPTH, chooseSkin, variantOf } from "..";
import { PRIMARY } from "../../components/buttons";
import { toEventView } from "../../features/events/api";
import { EventCard, EventCardBase } from "../../features/events/EventCard";
import { EventHeroBase } from "../../features/events/EventHero";
import { deadlineText, registrationState } from "../../features/events/registration";
import {
  eventRecord,
  pNinaSupporter,
  pNinaUndecided,
  withParticipations,
} from "../../features/events/testFixture";
import { fr } from "../../i18n/fr";
import { createFormatters } from "../../lib/format";
import { ensureTemporal } from "../../lib/temporal";
import { contrast } from "../../test/colour";
import { colourOf, rgbaOf, textContrast, toldApart } from "../../test/computed";
import { emulateMedia, resetMedia } from "../../test/media";
import { EVENT_SHAPES, hex, inApp, keepsEverything, plain } from "../../test/variant";
import type { EventCardList } from "../types";

import "../../styles.css";
import "../../skins/styles";

// « Dossard », depth mix: the bib card and the big bib of an event keep what
// Crête's card and hero show (every text, every link, every list of runners,
// the title the page gives its hero, in every shape an event takes), and the
// pieces restyled in mix.css take the tokens of the palette: the header on the
// sand of the page, the flat white bar of the tabs and its sun pill. At
// palette there is nothing to see: the sheets and the variants of a deeper
// depth are not in the build.

vi.mock("../../lib/pb", async () => (await import("../../test/pbMock")).pbModule);

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(async () => {
  chooseSkin("crete");
  await resetMedia();
  await page.viewport(414, 896);
});

const f = createFormatters("fr-FR");

/** The tokens of the palette a test compares with, read while Dossard is on the page. */
const tokens = () => ({
  coral: colourOf("--color-peach-500"),
  sun: colourOf("--color-blush-200"),
  sky: colourOf("--color-iris-300"),
  ink: colourOf("--color-ink"),
  sand: colourOf("--color-neutral-50"),
  card: colourOf("--color-card"),
});

/** What `look` makes of a piece, or of the frame of the page (`AppShell`), in Dossard, with the palette's tokens. */
function inDossard<T extends object>(
  element: ReactNode,
  look: (drawn: HTMLElement, whole: HTMLElement) => T,
  options: { framed?: boolean; today?: string } = {},
) {
  return inApp(element, (drawn, whole) => ({ ...look(drawn, whole), tokens: tokens() }), {
    skin: "dossard",
    ...options,
  });
}

/** Rich: two days, a deadline in four days, notes and a link to register, runners on each format, interested and supporters. */
const rich = () =>
  toEventView({
    ...withParticipations(eventRecord, [pNinaUndecided, pNinaSupporter]),
    notes: "Départ à 7 h.\nNavette à 6 h 30.",
    registration_url: "https://example.org/inscription",
    registration_deadline: "2026-06-05",
  });

const LISTS: EventCardList[] = ["home", "upcoming", "past", "agenda"];

test.skipIf(SKIN_DEPTH === "palette")(
  "dossard — la carte d'un événement garde tout ce que montre celle de Crête, dans chaque forme d'événement et chaque liste",
  async () => {
    const Bib = variantOf("dossard", "EventCard");
    if (Bib === undefined) throw new Error("Dossard has no event card at this depth");
    for (const { what, view, today } of EVENT_SHAPES()) {
      for (const list of LISTS) {
        const where = `${what}, in the ${list} list`;
        // Every text, link, name and button of Crête's card (the shared feature test holds the variant to it too).
        await keepsEverything(
          createElement(Bib, { key: undefined, view, list, Base: EventCardBase }),
          createElement(EventCardBase, { view, list }),
          { what: where, today, skin: "dossard" },
        );
        const own = await inDossard(
          createElement(Bib, { key: undefined, view, list, Base: EventCardBase }),
          (drawn) => ({
            outer: drawn.firstElementChild?.matches("article.event-card"),
            list: drawn.firstElementChild?.getAttribute("data-list"),
            // The base is not drawn under it: one card, one title.
            cards: drawn.querySelectorAll(".event-card").length,
          }),
          { today },
        );
        expect(own.outer, `the bib is the card, ${where}`).toBe(true);
        expect(own.cards, `one card, ${where}`).toBe(1);
        expect(own.list, `the list it is in, ${where}`).toBe(list);
      }
    }
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "dossard — la bande d'un bib dit l'année d'un événement d'une autre année, comme la tuile de la carte de Crête, et rien d'une année en cours",
  async () => {
    const [, , , , , , nextYear] = EVENT_SHAPES();
    const [thisYear] = EVENT_SHAPES();
    if (nextYear === undefined || thisYear === undefined) throw new Error("no events");
    const band = (view: ReturnType<typeof toEventView>) =>
      inDossard(<EventCard view={view} list="upcoming" />, (drawn) => ({
        words: plain(drawn.querySelector(".bib-band")?.textContent),
        chip: plain(drawn.querySelector(".event-card .date-chip-year")?.textContent),
      }));
    const next = await band(nextYear.view);
    expect(next.words, "the year in the band").toContain("2027");
    const now = await band(thisYear.view);
    expect(now.words, "no year in this year").not.toMatch(/\b20\d\d\b/);
    // The card of Crête, for the same events, shows the year in its chip.
    const base = await inDossard(
      <EventCardBase view={nextYear.view} list="upcoming" />,
      (drawn) => ({ year: plain(drawn.querySelector(".date-chip-year")?.textContent) }),
    );
    expect(base.year).toBe("2027");
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "dossard — le haut d'une fiche garde tout ce que montre celui de Crête, le titre que la page lui donne et l'échéance en une phrase",
  async () => {
    const Bib = variantOf("dossard", "EventHero");
    if (Bib === undefined) throw new Error("Dossard has no event hero at this depth");
    const heading = { id: "hero-title", "data-focus": "title", tabIndex: -1 } as const;
    for (const { what, view, today } of EVENT_SHAPES()) {
      const where = `${what}, on ${today ?? "the usual day"}`;
      const given = { key: undefined, view, heading, Base: EventHeroBase };
      await keepsEverything(
        createElement(Bib, given),
        createElement(EventHeroBase, { view, heading }),
        { what: where, today, skin: "dossard" },
      );
      const own = await inDossard(
        createElement(Bib, given),
        (drawn) => {
          const title = drawn.querySelector("h1");
          return {
            outer: drawn.firstElementChild?.matches("header.event-hero"),
            title: [title?.id, title?.dataset.focus, title?.tabIndex],
            headings: [...drawn.querySelectorAll("h1, h2, h3")].map((h) => h.tagName),
            deadline: plain(drawn.querySelector(".event-hero-deadline")?.textContent),
            ring: drawn.querySelector(".ring-draw") !== null,
          };
        },
        { today },
      );
      const base = await inDossard(
        createElement(EventHeroBase, { view, heading }),
        (drawn) => ({
          deadline: plain(drawn.querySelector(".event-hero-deadline")?.textContent),
          ring: drawn.querySelector(".ring-draw") !== null,
        }),
        { today },
      );
      expect(own.outer, `the bib is the hero, ${where}`).toBe(true);
      // What the page gives its title: its id (the actions name it), its focus mark, its tabIndex.
      expect(own.title, `the title the page gives, ${where}`).toEqual(["hero-title", "title", -1]);
      expect(own.headings, `one title, ${where}`).toEqual(["H1"]);
      expect(own.ring, `the days left, ${where}`).toBe(base.ring);
      // The deadline as one sentence, whichever way it is cut into texts: it is `deadlineText`.
      const state = registrationState(view.event, Temporal.PlainDate.from(today ?? "2026-06-01"));
      const sentence = state === null ? "" : deadlineText(state, f, fr);
      expect(own.deadline, `the deadline, ${where}`).toBe(sentence);
      expect(own.deadline, `the same sentence as Crête's, ${where}`).toBe(base.deadline);
    }
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "dossard — un événement sans notes (jamais écrites, ou vides) n'a pas de paragraphe de notes, et sans rien à dire il n'a pas de ligne de déchirure",
  async () => {
    const Bib = variantOf("dossard", "EventHero");
    if (Bib === undefined) throw new Error("Dossard has no event hero at this depth");
    const heading = { id: "t", "data-focus": "title", tabIndex: -1 } as const;
    const bare = { ...eventRecord, registration_url: "", registration_deadline: "" };
    // The record of an event whose `notes` the server never sent: the type says a text, the data may not.
    const lacking = (change: Partial<typeof bare>) => {
      const record = { ...bare, ...change };
      Reflect.deleteProperty(record, "notes");
      return record;
    };
    // `notes` that the server never sent (undefined) or sent empty: neither is a paragraph.
    const cases = [
      { what: "notes never sent", record: lacking({}) },
      { what: "empty notes", record: { ...bare, notes: "" } },
    ];
    for (const { what, record } of cases) {
      const seen = await inDossard(
        createElement(Bib, {
          key: undefined,
          view: toEventView(record),
          heading,
          Base: EventHeroBase,
        }),
        (drawn) => ({
          tear: drawn.querySelectorAll(".bib-tear").length,
          paragraphs: [...drawn.querySelectorAll("p")].filter((p) => p.textContent === "").length,
        }),
      );
      expect(seen.tear, `no tear-off line with nothing under it, ${what}`).toBe(0);
      expect(seen.paragraphs, `no empty paragraph, ${what}`).toBe(0);
    }
    // With a deadline and no notes, the tear-off line is there for the deadline alone.
    const withDeadline = await inDossard(
      createElement(Bib, {
        key: undefined,
        view: toEventView(lacking({ registration_deadline: "2026-06-05" })),
        heading,
        Base: EventHeroBase,
      }),
      (drawn) => ({
        tear: drawn.querySelectorAll(".bib-tear").length,
        notes: drawn.querySelectorAll(".event-hero-notes").length,
      }),
    );
    expect(withDeadline.tear).toBe(1);
    expect(withDeadline.notes, "and no paragraph of notes").toBe(0);
  },
);

/** The boxes of the number, the title and the ring of the days left of a hero, at a width of the screen. */
async function heroBoxes(width: number) {
  const Bib = variantOf("dossard", "EventHero");
  if (Bib === undefined) throw new Error("Dossard has no event hero at this depth");
  const heading = { id: "t", "data-focus": "title", tabIndex: -1 } as const;
  await page.viewport(width, 900);
  return inDossard(
    createElement(Bib, { key: undefined, view: rich(), heading, Base: EventHeroBase }),
    (drawn) => ({
      number: drawn.querySelector(".bib-number")?.getBoundingClientRect(),
      title: drawn.querySelector("h1")?.getBoundingClientRect(),
      ring: drawn.querySelector(".countdown-ring")?.getBoundingClientRect(),
    }),
  );
}

test.skipIf(SKIN_DEPTH === "palette")(
  "dossard — dans le haut d'une fiche, dès md, le titre est en haut, à côté du numéro",
  async () => {
    const { number, title } = await heroBoxes(1024);
    expect(number, "the number was drawn").toBeDefined();
    expect(title, "the title was drawn").toBeDefined();
    expect(Math.abs((title?.top ?? 0) - (number?.top ?? 99))).toBeLessThanOrEqual(12);
  },
);

test.skipIf(SKIN_DEPTH !== "mix")(
  "dossard — dans le haut d'une fiche, l'anneau des jours qui restent n'est pas empilé sous le numéro (au plein, il s'efface)",
  async () => {
    for (const width of [414, 1024]) {
      const { number, ring } = await heroBoxes(width);
      expect(ring, `the ring was drawn at ${width}`).toBeDefined();
      const under =
        (ring?.top ?? 0) >= (number?.bottom ?? 0) && (ring?.left ?? 0) < (number?.right ?? 0);
      expect(under, `the ring is not under the number at ${width}`).toBe(false);
    }
  },
);

test.skipIf(SKIN_DEPTH !== "mix")(
  "dossard — au mix, les jours qui restent sont dans l'anneau seul : les mots du plein sont là, cachés, pour ne pas dire deux fois la même chose",
  async () => {
    const Bib = variantOf("dossard", "EventHero");
    if (Bib === undefined) throw new Error("Dossard has no event hero at this depth");
    const heading = { id: "t", "data-focus": "title", tabIndex: -1 } as const;
    const seen = await inDossard(
      createElement(Bib, { key: undefined, view: rich(), heading, Base: EventHeroBase }),
      (drawn) => {
        const words = drawn.querySelector(".event-hero-days");
        return {
          ring: drawn.querySelector(".countdown-ring")?.checkVisibility(),
          written: words !== null,
          shown: words?.checkVisibility(),
          heard: plain(drawn.querySelector<HTMLElement>(".event-hero")?.innerText),
        };
      },
    );
    expect(seen.ring, "the ring draws the days left").toBe(true);
    expect(seen.written, "the words are in the markup, for the depth that has no ring").toBe(true);
    expect(seen.shown, "and are not shown beside the ring").toBe(false);
    expect(seen.heard, "nor said").not.toContain(plain(f.inDays(12)));
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "dossard — les épingles d'un dossard sont en acier, pas en sable",
  async () => {
    const Bib = variantOf("dossard", "EventHero");
    if (Bib === undefined) throw new Error("Dossard has no event hero at this depth");
    const heading = { id: "t", "data-focus": "title", tabIndex: -1 } as const;
    const seen = await inDossard(
      createElement(Bib, { key: undefined, view: rich(), heading, Base: EventHeroBase }),
      (drawn) => ({
        wire: getComputedStyle(drawn.querySelector(".event-hero svg path") ?? drawn).stroke,
        sand: colourOf("--color-neutral-300"),
      }),
    );
    const [red, , blue] = rgbaOf(seen.wire);
    expect(seen.wire, "not the sand of a tear-off line").not.toBe(seen.sand);
    expect(blue, "a cool grey: more blue than red").toBeGreaterThan(red);
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "dossard — la bande d'un bib prend la couleur de sa liste, et son texte s'y lit (4,5:1)",
  async () => {
    const tones: [EventCardList, string][] = [
      ["home", "--color-peach-500"],
      ["upcoming", "--color-peach-500"],
      ["past", "--color-blush-200"],
      ["agenda", "--color-iris-300"],
    ];
    for (const [list, token] of tones) {
      const band = await inDossard(<EventCard view={rich()} list={list} />, (drawn) => {
        const style = getComputedStyle(drawn.querySelector(".bib-band") ?? drawn);
        const tear = drawn.querySelector(".bib-tear");
        return {
          ground: style.backgroundColor,
          ink: style.color,
          tear: tear ? getComputedStyle(tear).borderTopStyle : "none",
          expected: colourOf(token),
        };
      });
      expect(band.ground, `the band in the ${list} list`).toBe(band.expected);
      expect(band.tear, `the tear-off line in the ${list} list`).toBe("dashed");
      expect(
        contrast(hex(band.ink), hex(band.ground)),
        `its words in the ${list} list`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    // The hero of an event: the coral band of the big bib.
    const Bib = variantOf("dossard", "EventHero");
    if (Bib === undefined) throw new Error("Dossard has no event hero at this depth");
    const hero = await inDossard(
      createElement(Bib, {
        key: undefined,
        view: rich(),
        heading: { id: "t", "data-focus": "title", tabIndex: -1 },
        Base: EventHeroBase,
      }),
      (drawn) => {
        const style = getComputedStyle(drawn.querySelector(".bib-band") ?? drawn);
        return { ground: style.backgroundColor, ink: style.color };
      },
    );
    expect(hero.ground).toBe(hero.tokens.coral);
    expect(contrast(hex(hero.ink), hex(hero.ground))).toBeGreaterThanOrEqual(4.5);
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "dossard — en couleurs forcées, la bande d'un bib garde un trait dessous",
  async () => {
    await emulateMedia({ forcedColors: "active" });
    const edge = await inDossard(<EventCard view={rich()} list="upcoming" />, (drawn) => ({
      width: getComputedStyle(drawn.querySelector(".bib-band") ?? drawn).borderBottomWidth,
    }));
    expect(edge.width).toBe("2px");
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "dossard — l'en-tête est le sable de la page, le nom de l'application en encre ; sur un téléphone la barre des onglets est blanche, à plat, de toute la largeur, la pastille du soleil sous l'icône de l'onglet courant",
  async () => {
    await page.viewport(320, 700);
    const seen = await inDossard(
      <p>Contenu</p>,
      (_, whole) => {
        const header = whole.querySelector(".app-header");
        const bar = whole.querySelector(".tabbar-list");
        const current = whole.querySelector('.tab[aria-current="page"]');
        const other = [...whole.querySelectorAll(".tab")].find((tab) => tab !== current);
        const name = whole.querySelector(".app-header .brand-name");
        if (!header || !bar || !current || !other || !name)
          throw new Error("the frame was not drawn");
        const icon = current.querySelector(".tab-icon") ?? current;
        return {
          headerGround: [
            getComputedStyle(header).backgroundColor,
            getComputedStyle(header).backgroundImage,
          ],
          headerAfter: getComputedStyle(header, "::after").content,
          nameInk: getComputedStyle(name).color,
          bar: bar.getBoundingClientRect(),
          barGround: getComputedStyle(bar).backgroundColor,
          barRadius: getComputedStyle(bar).borderTopLeftRadius,
          barBorder: getComputedStyle(bar).borderTopStyle,
          tab: [getComputedStyle(current).backgroundColor, getComputedStyle(current).boxShadow],
          pill: getComputedStyle(icon).backgroundColor,
          apart: toldApart(current, other),
          words: textContrast(current),
        };
      },
      { framed: true },
    );
    expect(seen.headerGround, "the sand, no sky").toEqual([seen.tokens.sand, "none"]);
    expect(seen.headerAfter, "no tear-off line in the header").toBe("none");
    expect(seen.nameInk, "the name in ink on the sand").toBe(seen.tokens.ink);
    expect(seen.bar.left).toBe(0);
    expect(seen.bar.right, "as wide as the screen").toBe(320);
    expect(seen.barRadius, "flat").toBe("0px");
    expect(seen.barBorder, "a line, not a dashed ticket").toBe("solid");
    const [r, g, b, a] = rgbaOf(seen.barGround);
    expect([r, g, b], "white").toEqual([255, 255, 255]);
    expect(a, "nearly opaque").toBeGreaterThan(0.9);
    expect(seen.tab, "no pill on the tab itself, nor an edge").toEqual([
      "rgba(0, 0, 0, 0)",
      "none",
    ]);
    expect(seen.pill, "the sun behind the icon").toBe(seen.tokens.sun);
    expect(seen.apart).toContain("fontWeight");
    expect(seen.words).toBeGreaterThanOrEqual(4.5);
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "dossard — dès md, l'en-tête reste court, la capsule blanche des onglets est sous la guirlande sans la recouvrir, et son onglet courant est une pastille de soleil (l'encre dessus, 4,5:1)",
  async () => {
    await page.viewport(1024, 800);
    const seen = await inDossard(
      <p>Contenu</p>,
      (_, whole) => {
        const header = whole.querySelector(".app-header");
        const bar = whole.querySelector(".tabbar-list");
        const current = whole.querySelector('.tab[aria-current="page"]');
        const garland = header?.querySelector("svg");
        const brand = header?.querySelector(".brand-link");
        if (!header || !bar || !current || !garland || !brand) {
          throw new Error("the frame was not drawn");
        }
        return {
          garlandBottom: garland.getBoundingClientRect().bottom,
          brandTop: brand.getBoundingClientRect().top,
          headerHeight: header.getBoundingClientRect().height,
          barTop: bar.getBoundingClientRect().top,
          barBottom: bar.getBoundingClientRect().bottom,
          headerBottom: header.getBoundingClientRect().bottom,
          pill: getComputedStyle(current).backgroundColor,
          words: textContrast(current),
        };
      },
      { framed: true },
    );
    // The bar of the variant: the garland (12 px) and under it the row of the brand and the tabs.
    expect(seen.headerHeight, "the header is a bar, not a block of sky").toBeLessThanOrEqual(80);
    expect(seen.garlandBottom, "the garland is the top of the header").toBeGreaterThan(0);
    expect(seen.barTop, "the capsule is under the garland, not over it").toBeGreaterThanOrEqual(
      seen.garlandBottom,
    );
    expect(seen.brandTop, "so is the name of the app").toBeGreaterThanOrEqual(seen.garlandBottom);
    expect(seen.barBottom, "and it is in the bar").toBeLessThanOrEqual(seen.headerHeight);
    expect(seen.pill).toBe(seen.tokens.sun);
    expect(seen.words).toBeGreaterThanOrEqual(4.5);
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "dossard — le + est le corail des inscriptions avec le bleu marine de la bande d'un bib, et le bouton principal a son bord corail, effacé quand il est inactif",
  async () => {
    const seen = await inDossard(
      <>
        <button type="button" className={PRIMARY}>
          Envoyer
        </button>
        <button type="button" className={PRIMARY} disabled>
          Envoyer
        </button>
      </>,
      (_, whole) => {
        const plus = whole.querySelector(".fab");
        const [on, off] = whole.querySelectorAll("button");
        const style = getComputedStyle(plus ?? whole);
        return {
          ground: style.backgroundColor,
          image: style.backgroundImage,
          ink: style.color,
          on: getComputedStyle(on ?? whole).boxShadow,
          off: getComputedStyle(off ?? whole).boxShadow,
        };
      },
      { framed: true },
    );
    expect(seen.ground, "the « + »").toBe(seen.tokens.coral);
    expect(seen.image, "painted flat").toBe("none");
    expect(contrast(hex(seen.ink), hex(seen.ground)), "its sign on it").toBeGreaterThanOrEqual(4.5);
    expect(seen.on, "the main button").toContain(seen.tokens.coral);
    expect(seen.off, "disabled").toBe("none");
  },
);
