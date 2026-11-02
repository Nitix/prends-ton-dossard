import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { page } from "vitest/browser";

import { SKIN_DEPTH, chooseSkin, variantOf } from "..";
import { toEventView } from "../../features/events/api";
import { EventCardBase } from "../../features/events/EventCard";
import { EventHero } from "../../features/events/EventHero";
import {
  eventRecord,
  pNinaSupporter,
  pNinaUndecided,
  withParticipations,
} from "../../features/events/testFixture";
import { ensureTemporal } from "../../lib/temporal";
import { contrast } from "../../test/colour";
import { colourOf, textContrast, toldApart } from "../../test/computed";
import { resetMedia } from "../../test/media";
import { pbSession } from "../../test/pbMock";
import { EVENT_SHAPES, hex, inApp, keepsEverything, plain } from "../../test/variant";
import type { EventCardList } from "../types";

import "../../styles.css";
import "../../skins/styles";

// « Piste », depth mix: the card of an event with the measures of its formats
// as chips keeps what Crête's card shows (every text, every link, every list
// of runners, in every shape an event takes), and the pieces restyled in
// mix.css (the lanes of the tabs, the red « + », the number of a lane, the
// stroke under a title) take the tokens of the palette and fit the narrowest
// phone. At palette the sheet and the variant are not in the build.

vi.mock("../../lib/pb", async () => (await import("../../test/pbMock")).pbModule);

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(async () => {
  pbSession.role = "member";
  chooseSkin("crete");
  await resetMedia();
  await page.viewport(414, 896);
});

/** The tokens of the palette a test compares with, read while Piste is on the page. */
const tokens = () => ({
  red: colourOf("--color-iris-500"),
  redDeep: colourOf("--color-iris-600"),
  ink: colourOf("--color-neutral-900"),
});

/** What `look` makes of a piece, or of the frame of the page (`AppShell`), in Piste, with the palette's tokens. */
function inPiste<T extends object>(
  element: ReactNode,
  look: (drawn: HTMLElement, page: HTMLElement) => T,
  options: { framed?: boolean } = {},
) {
  return inApp(element, (drawn, whole) => ({ ...look(drawn, whole), tokens: tokens() }), {
    skin: "piste",
    ...options,
  });
}

const LISTS: EventCardList[] = ["home", "upcoming", "past", "agenda"];

/** The format lines of a card, as they read: the name and its measures, whitespace gathered. */
const formatLines = (drawn: HTMLElement) =>
  [...drawn.querySelectorAll(".format-line")].map((line) => plain(line.textContent));

test.skipIf(SKIN_DEPTH === "palette")(
  "piste — la carte d'un événement garde tout ce que montre celle de Crête, dans chaque forme d'événement et chaque liste",
  async () => {
    const Lane = variantOf("piste", "EventCard");
    if (Lane === undefined) throw new Error("Piste has no event card at this depth");
    for (const { what, view, today } of EVENT_SHAPES()) {
      const base = await inApp(
        createElement(EventCardBase, { view, list: "upcoming" }),
        formatLines,
        {
          today,
        },
      );
      for (const list of LISTS) {
        const where = `${what}, in the ${list} list`;
        const given = { key: undefined, view, list, Base: EventCardBase };
        // Every text, link, name and button of Crête's card (the shared feature test holds the variant to it too).
        await keepsEverything(
          createElement(Lane, given),
          createElement(EventCardBase, { view, list }),
          {
            what: where,
            today,
            skin: "piste",
          },
        );
        const own = await inApp(
          createElement(Lane, given),
          (drawn) => ({
            lines: formatLines(drawn),
            outer: drawn.firstElementChild?.matches("article.event-card"),
            cards: drawn.querySelectorAll(".event-card").length,
            chip: drawn.querySelector(".date-chip") !== null,
            chips: drawn.querySelectorAll(".format-measure").length,
          }),
          { today, skin: "piste" },
        );
        expect(own.outer, `the lane is the card, ${where}`).toBe(true);
        expect(own.cards, `one card, ${where}`).toBe(1);
        expect(own.chip, `the day of the event, ${where}`).toBe(true);
        expect(own.lines, `the formats read as Crête's, ${where}`).toEqual(base);
        // A chip for every measure after the name of a format.
        const measures = base.flatMap((line) => line.split(" · ").slice(1));
        expect(own.chips, `a chip for each measure, ${where}`).toBe(measures.length);
      }
    }
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "piste — sur le téléphone le plus étroit, les cinq onglets en capitales tiennent dans une barre à plat de toute la largeur, 44 px de haut, sans icône",
  async () => {
    await page.viewport(320, 700);
    pbSession.role = "admin";
    const seen = await inPiste(
      <p>Contenu</p>,
      (_, whole) => {
        const bar = whole.querySelector(".tabbar-list");
        const tabs = [...whole.querySelectorAll<HTMLElement>(".tab")];
        return {
          bar: bar?.getBoundingClientRect(),
          flat: bar === null ? "" : getComputedStyle(bar).borderTopLeftRadius,
          barScroll: bar ? [bar.scrollWidth, bar.clientWidth] : [],
          tabs: tabs.map((tab) => ({
            name: tab.textContent,
            scroll: [tab.scrollWidth, tab.clientWidth],
            height: tab.getBoundingClientRect().height,
            right: tab.getBoundingClientRect().right,
            capitals: getComputedStyle(tab).textTransform,
            icon: [...tab.children].map((child) => getComputedStyle(child).display),
            line: getComputedStyle(tab).boxShadow,
          })),
        };
      },
      { framed: true },
    );
    expect(seen.tabs.map((tab) => tab.name)).toEqual([
      "Accueil",
      "Liste",
      "Agenda",
      "Profil",
      "Admin",
    ]);
    expect(seen.bar?.left, "as wide as the screen").toBe(0);
    expect(seen.bar?.right).toBe(320);
    expect(seen.flat, "a flat bar, not a capsule").toBe("0px");
    expect(seen.barScroll[0], "nothing past the bar").toBeLessThanOrEqual(seen.barScroll[1] ?? 0);
    for (const tab of seen.tabs) {
      expect(tab.scroll[0], `« ${tab.name} » fits its tab`).toBeLessThanOrEqual(tab.scroll[1] ?? 0);
      expect(tab.height, `« ${tab.name} »`).toBeGreaterThanOrEqual(44);
      expect(tab.right, `« ${tab.name} » inside the phone`).toBeLessThanOrEqual(320);
      expect(tab.capitals).toBe("uppercase");
      expect(tab.icon, "the icon is gone").toEqual(["none"]);
      expect(tab.line, `a line between the lanes, « ${tab.name} »`).not.toBe("none");
    }
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "piste — l'onglet courant est en gras sous le trait penché rouge de la piste, sans pastille, ses mots s'y lisent (4,5:1) ; le + est rouge, son signe s'y lit (4,5:1)",
  async () => {
    const seen = await inPiste(
      <p>Contenu</p>,
      (_, whole) => {
        const tab = whole.querySelector('.tab[aria-current="page"]');
        const other = [...whole.querySelectorAll(".tab")].find((one) => one !== tab);
        const plus = whole.querySelector(".fab");
        if (!tab || !other || !plus) throw new Error("the tabs were not drawn");
        const stroke = getComputedStyle(tab, "::before");
        const style = getComputedStyle(plus);
        return {
          stroke: [stroke.content, stroke.backgroundColor, stroke.transform],
          pill: [getComputedStyle(tab).backgroundImage, getComputedStyle(tab).backgroundColor],
          otherStroke: getComputedStyle(other, "::before").content,
          apart: toldApart(tab, other),
          words: textContrast(tab),
          ground: style.backgroundColor,
          image: style.backgroundImage,
          ink: style.color,
        };
      },
      { framed: true },
    );
    expect(seen.stroke[0]).not.toBe("none");
    expect(seen.stroke[1], "the red of the track").toBe(seen.tokens.red);
    expect(seen.stroke[2], "skewed").not.toBe("none");
    expect(seen.pill, "no pill under the words").toEqual(["none", "rgba(0, 0, 0, 0)"]);
    expect(seen.otherStroke, "no stroke on the others").toBe("none");
    expect(seen.apart).toEqual(expect.arrayContaining(["fontWeight", "before"]));
    expect(seen.words, "the words of the current tab").toBeGreaterThanOrEqual(4.5);
    expect(seen.ground).toBe(seen.tokens.red);
    expect(seen.image).toBe("none");
    expect(contrast(hex(seen.ink), hex(seen.ground))).toBeGreaterThanOrEqual(4.5);
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "piste — dès md, les onglets sont une capsule d'encre dans la bande, leurs noms en crème, le trait sous l'onglet courant",
  async () => {
    await page.viewport(1024, 800);
    const seen = await inPiste(
      <p>Contenu</p>,
      (_, whole) => {
        const bar = whole.querySelector(".tabbar-list");
        const tab = whole.querySelector('.tab[aria-current="page"]');
        if (!bar || !tab) throw new Error("the tabs were not drawn");
        const stroke = getComputedStyle(tab, "::before");
        return {
          ground: getComputedStyle(bar).backgroundColor,
          words: textContrast(tab),
          strokeTop: stroke.top,
          strokeBottom: stroke.bottom,
        };
      },
      { framed: true },
    );
    expect(seen.ground, "ink").toBe(seen.tokens.ink);
    expect(seen.words, "cream on the ink").toBeGreaterThanOrEqual(4.5);
    expect(seen.strokeTop, "under the tab, not over it").not.toBe("0px");
    expect(seen.strokeBottom).toBe("4px");
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "piste — le jour d'un événement est le numéro d'un couloir peint en rouge, son texte s'y lit (4,5:1) sur les deux bouts du dégradé",
  async () => {
    const [rich] = EVENT_SHAPES();
    if (rich === undefined) throw new Error("no event");
    const seen = await inPiste(
      createElement(EventCardBase, { view: rich.view, list: "upcoming" }),
      (drawn) => {
        const chip = drawn.querySelector(".date-chip");
        const style = getComputedStyle(chip ?? drawn);
        return {
          image: style.backgroundImage,
          ink: style.color,
          line: getComputedStyle(chip ?? drawn, "::before").content,
          day: getComputedStyle(drawn.querySelector(".date-chip-day") ?? drawn).fontStyle,
          ends: [colourOf("--color-iris-500"), colourOf("--color-iris-600")],
        };
      },
    );
    expect(seen.image).toContain("linear-gradient");
    expect(seen.line, "a lane line on each side").not.toBe("none");
    expect(seen.day, "the day in italic").toBe("italic");
    for (const end of seen.ends) {
      expect(contrast(hex(seen.ink), hex(end)), `its text on ${end}`).toBeGreaterThanOrEqual(4.5);
    }
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "piste — « S'inscrire » sur le haut d'une fiche est rouge, et la bande est plus courte sous son texte",
  async () => {
    const heading = { id: "t", "data-focus": "title", tabIndex: -1 } as const;
    const view = toEventView({
      ...withParticipations(eventRecord, [pNinaUndecided, pNinaSupporter]),
      registration_url: "https://example.org/inscription",
    });
    const seen = await inPiste(<EventHero view={view} heading={heading} />, (drawn) => {
      const link = drawn.querySelector(".event-hero .btn-on-dawn");
      const style = getComputedStyle(link ?? drawn);
      const inner = drawn.querySelector(".event-hero-body");
      return {
        ground: style.backgroundColor,
        ink: style.color,
        below: getComputedStyle(inner ?? drawn).paddingBottom,
      };
    });
    expect(seen.ground).toBe(seen.tokens.red);
    expect(contrast(hex(seen.ink), hex(seen.ground))).toBeGreaterThanOrEqual(4.5);
    expect(seen.below).toBe("24px");
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "piste — les titres ont leur trait penché et leurs trois lignes de couloir",
  async () => {
    const seen = await inPiste(
      <>
        <h1 className="page-title">Accueil</h1>
        <h2 className="block-title section-title">Un bloc</h2>
      </>,
      (drawn) => {
        const title = getComputedStyle(drawn.querySelector(".page-title") ?? drawn, "::after");
        const block = getComputedStyle(drawn.querySelector(".block-title") ?? drawn, "::after");
        return {
          mask: title.maskImage,
          skew: title.transform,
          lanes: block.backgroundImage,
          run: block.flexGrow,
        };
      },
    );
    expect(seen.mask).toBe("none");
    expect(seen.skew, "skewed").toMatch(/^matrix\(/);
    expect(seen.lanes).toContain("repeating-linear-gradient");
    expect(seen.run).toBe("1");
  },
);

/** The rules of the skin's sheets that animate, and where they sit (inside `prefers-reduced-motion: no-preference` or not). */
function animations(): { selector: string; calm: boolean }[] {
  const found: { selector: string; calm: boolean }[] = [];
  const visit = (rules: CSSRuleList, calm: boolean) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        if (
          rule.selectorText.includes('data-skin="piste"') &&
          (rule.style.getPropertyValue("animation") !== "" ||
            rule.style.getPropertyValue("animation-name") !== "")
        ) {
          found.push({ selector: rule.selectorText, calm });
        }
      } else if (rule instanceof CSSMediaRule) {
        visit(
          rule.cssRules,
          calm || /prefers-reduced-motion:\s*no-preference/.test(rule.conditionText),
        );
      } else if (rule instanceof CSSGroupingRule) visit(rule.cssRules, calm);
    }
  };
  for (const sheet of document.styleSheets) visit(sheet.cssRules, false);
  return found;
}

test.skipIf(SKIN_DEPTH === "palette")(
  "piste — ses mouvements ne se font qu'avec le mouvement permis, une fois, sous un nom de keyframes de Piste",
  async () => {
    chooseSkin("piste");
    const moving = animations();
    expect(moving.length, "the strokes that land").toBeGreaterThan(0);
    expect(moving.filter(({ calm }) => !calm).map(({ selector }) => selector)).toEqual([]);
    // With nothing asked against it, the stroke under a title lands once.
    const seen = await inPiste(<h1 className="page-title">Accueil</h1>, (drawn) => {
      const style = getComputedStyle(drawn.querySelector(".page-title") ?? drawn, "::after");
      return { name: style.animationName, count: style.animationIterationCount };
    });
    expect([seen.name, seen.count]).toEqual(["piste-lane-in", "1"]);
  },
);
