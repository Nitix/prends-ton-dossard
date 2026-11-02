import type { ReactNode } from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { page } from "vitest/browser";

import { SKIN_DEPTH } from "..";
import { Dialog } from "../../components/Dialog";
import { toEventView } from "../../features/events/api";
import { EventCard, EventCardBase } from "../../features/events/EventCard";
import { event2Record, eventRecord } from "../../features/events/testFixture";
import { ensureTemporal } from "../../lib/temporal";
import { colourOf, rgbaOf, textContrast } from "../../test/computed";
import { withoutIds } from "../../test/ids";
import { EVENT_SHAPES, inApp, plain, type DrawOptions } from "../../test/variant";

import "../../styles.css";
import "../../skins/styles";

// « Alpage » at depth full: « Sentier » in « Aurore »'s layout, which is
// Crête's, so its look came with its palette and its mix. What is left of the
// variant: its header (shorter than Crête's, as « Aurore »'s), its window (a
// glow of meadow over the line of the trail), its titles a step lighter, the
// call to action of a row of the home page in sunrise, the ring of today in
// sunrise, contour lines on the card that offers a key, a head of moss for the
// totals, and a card whose formats are on the tint of their terrain. Each rule
// is hit through the semantic class it hooks on. Under a build at palette or at
// mix there is none of it.

vi.mock("../../lib/pb", async () => (await import("../../test/pbMock")).pbModule);

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(async () => {
  await page.viewport(414, 896);
});

const SKIN = "alpage";
/** What `check` finds in a piece drawn in the skin, while the skin is on the page (see mix.test.tsx). */
const within = (
  piece: ReactNode,
  check: (drawn: HTMLElement, page: HTMLElement) => void,
  options: DrawOptions = {},
) => inApp(piece, check, { skin: SKIN, ...options });

const styleOf = (element: Element | null | undefined, pseudo?: "::before" | "::after") =>
  getComputedStyle(element ?? document.body, pseudo);

/** The first element of a selector, which the check needs: its absence is the failure. */
function need(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`nothing matches ${selector}`);
  return found;
}

/**
 * A card as its markup is, with what a variant may add to the formats taken out:
 * the kind of each (`data-format-kind`) and the pieces its marks put in its line.
 * What is left is Crête's own card, whoever drew it; `words` are the texts of the
 * format lines, which are the same whoever marks them.
 */
function skeleton(card: Element | null): { html: string; words: string[] } {
  const copy = card?.cloneNode(true);
  if (!(copy instanceof Element)) throw new Error("no card");
  const words = [...copy.querySelectorAll(".format-line")].map((line) => plain(line.textContent));
  for (const line of copy.querySelectorAll(".format-line")) line.replaceChildren();
  for (const format of copy.querySelectorAll("[data-format-kind]")) {
    format.removeAttribute("data-format-kind");
  }
  return { html: withoutIds(copy.outerHTML), words };
}

/** What the browser computes of a `background-image` written out, in the theme of the page. */
function paintOf(image: string): string {
  const probe = document.createElement("span");
  probe.style.backgroundImage = image;
  document.body.append(probe);
  const painted = getComputedStyle(probe).backgroundImage;
  probe.remove();
  return painted;
}

// ---- The header

test.skipIf(SKIN_DEPTH !== "full")(
  "« Alpage » full — l'en-tête d'un téléphone est plus court que celui de Crête : 3 rem sous le nom, 1,25 rem au-dessus",
  async () => {
    await within(
      <p>Page</p>,
      (_drawn, root) => {
        const bar = styleOf(need(root, ".app-header-bar"));
        expect(bar.paddingTop).toBe("20px");
        expect(bar.paddingBottom).toBe("48px");
        const header = need(root, ".app-header").getBoundingClientRect().height;
        const link = need(root, ".brand-link");
        // The link of the name has a margin of -0.375 rem round it (the room of its focus ring).
        const margins =
          Number.parseFloat(styleOf(link).marginTop) +
          Number.parseFloat(styleOf(link).marginBottom);
        const brand = link.getBoundingClientRect().height + margins;
        expect(header).toBeCloseTo(20 + brand + 48, 0);
      },
      { framed: true },
    );
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Alpage » full — du md, l'en-tête fait 7 rem, les onglets sur lui, la feuille de la page juste dessous",
  async () => {
    await page.viewport(1024, 768);
    await within(
      <p>Page</p>,
      (_drawn, root) => {
        const header = need(root, ".app-header").getBoundingClientRect();
        expect(header.height).toBe(112);
        const bar = styleOf(need(root, ".app-header-bar"));
        expect(bar.alignItems).toBe("center");
        expect(bar.paddingBottom).toBe("24px");
        const nav = need(root, ".tabbar").getBoundingClientRect();
        expect(nav.top).toBeGreaterThanOrEqual(header.top);
        expect(nav.bottom).toBeLessThanOrEqual(header.bottom);
        const sheet = need(root, ".sheet");
        expect(styleOf(sheet).marginTop).toBe("0px");
        const top = sheet.getBoundingClientRect().top;
        expect(top).toBeGreaterThanOrEqual(nav.bottom);
        expect(top).toBeLessThan(header.bottom);
      },
      { framed: true },
    );
  },
);

// ---- A window and the titles

test.skipIf(SKIN_DEPTH !== "full")(
  "« Alpage » full — la fenêtre a une lueur de prairie sous le trait du sentier, et son titre est un cran plus léger",
  async () => {
    await within(
      <Dialog open title="Une fenêtre" onClose={() => {}}>
        <p>Son contenu</p>
      </Dialog>,
      (drawn) => {
        const dialog = need(drawn, ".dialog");
        // The moss of the meadow, then a haze of sunrise, then nothing.
        expect(styleOf(need(dialog, ".dialog-glow")).backgroundImage).toBe(
          paintOf(
            "linear-gradient(to bottom, color-mix(in srgb, var(--color-blush-100) 80%, transparent), color-mix(in srgb, var(--color-peach-50) 50%, transparent), transparent)",
          ),
        );
        // The line over it stays the trail of the palette (forest to sunrise).
        expect(styleOf(need(dialog, ".dialog-band")).backgroundImage).toMatch(/gradient/);
        expect(styleOf(need(dialog, ".dialog-title")).fontWeight).toBe("700");
      },
    );
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Alpage » full — les titres sont un cran plus légers que ceux de Crête : page et héros en gras, blocs et cartes en demi-gras",
  async () => {
    await within(
      <>
        <h1 className="page-title">Titre</h1>
        <h2 className="block-title">Un bloc</h2>
        <h3 className="card-title">Une carte</h3>
        <h2 className="month-nav-title">Juin 2026</h2>
        <h1 className="event-hero-title">Un événement</h1>
        <h1 className="runner-hero-title">Alice</h1>
      </>,
      (drawn) => {
        const weight = (selector: string) => styleOf(need(drawn, selector)).fontWeight;
        expect(weight(".page-title")).toBe("700");
        expect(weight(".block-title")).toBe("600");
        expect(weight(".card-title")).toBe("600");
        expect(weight(".month-nav-title")).toBe("700");
        expect(weight(".event-hero-title")).toBe("700");
        expect(weight(".runner-hero-title")).toBe("700");
      },
    );
  },
);

// ---- The home page

test.skipIf(SKIN_DEPTH !== "full")(
  "« Alpage » full — « Je m'inscris » d'une ligne de l'accueil est en lever du jour, sa croix en granit ; celui d'une autre page reste de la forêt",
  async () => {
    await within(
      <>
        <div className="todo-row">
          <a href="#s" className="btn-primary">
            S'inscrire
          </a>
        </div>
        <a href="#o" className="btn-primary" data-case="other">
          Ailleurs
        </a>
      </>,
      (drawn) => {
        const todo = styleOf(need(drawn, ".todo-row .btn-primary"));
        expect(todo.backgroundImage).toContain(colourOf("--color-peach-400"));
        expect(todo.backgroundImage).not.toContain(colourOf("--color-iris-600"));
        expect(todo.color).toBe(colourOf("--color-neutral-950"));
        // The rest of the app keeps the forest.
        expect(styleOf(need(drawn, '[data-case="other"]')).backgroundImage).not.toContain(
          colourOf("--color-peach-400"),
        );
      },
    );
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Alpage » full — la carte de clé a des courbes de niveau sous ses mots",
  async () => {
    await within(
      <section className="passkey-card relative overflow-hidden">
        <h2 className="passkey-card-title relative">Une clé</h2>
      </section>,
      (drawn) => {
        const lines = styleOf(need(drawn, ".passkey-card"), "::before");
        expect(lines.content).toBe('""');
        expect(lines.position).toBe("absolute");
        expect(lines.backgroundImage).toContain("repeating-radial-gradient");
        expect(lines.pointerEvents, "decoration, it takes no click").toBe("none");
        // Faint: the words over them keep their contrast.
        expect(Number(lines.opacity)).toBeLessThanOrEqual(0.12);
        expect(textContrast(need(drawn, ".passkey-card-title"))).toBeGreaterThanOrEqual(4.5);
      },
    );
  },
);

// ---- The agenda and the totals

test.skipIf(SKIN_DEPTH !== "full")(
  "« Alpage » full — aujourd'hui est cerclé de lever du jour sur un téléphone, plein de lever du jour du md",
  async () => {
    await within(
      <>
        <button type="button" className="agenda-day" aria-pressed="false">
          <span className="agenda-day-number" aria-current="date" data-case="phone">
            13
          </span>
        </button>
        <div className="agenda-cell-body">
          <time className="agenda-day-number" aria-current="date" data-case="desktop">
            13
          </time>
        </div>
      </>,
      (drawn) => {
        const phone = styleOf(need(drawn, '[data-case="phone"]'));
        expect(phone.borderTopColor).toBe(colourOf("--color-peach-500"));
        expect(phone.color).toBe(colourOf("--color-peach-800"));
        const desktop = styleOf(need(drawn, '[data-case="desktop"]'));
        expect(desktop.backgroundColor).toBe(colourOf("--color-peach-400"));
        expect(desktop.borderTopColor).toBe(colourOf("--color-peach-400"));
        expect(desktop.color).toBe(colourOf("--color-neutral-950"));
      },
    );
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Alpage » full — la tête des totaux est de mousse, ses mots en pin",
  async () => {
    await within(
      <table>
        <thead className="totals-header">
          <tr>
            <th className="eyebrow">Courses</th>
          </tr>
        </thead>
      </table>,
      (drawn) => {
        expect(rgbaOf(styleOf(need(drawn, ".totals-header")).backgroundColor)[3]).toBeGreaterThan(
          0,
        );
        expect(styleOf(need(drawn, ".totals-header .eyebrow")).color).toBe(
          colourOf("--color-iris-800"),
        );
      },
    );
  },
);

// ---- The card

test.skipIf(SKIN_DEPTH !== "full")(
  "« Alpage » full — sa carte pose les épreuves sur la teinte de leur terrain, un point devant, et garde les classes de celle de Crête",
  async () => {
    const rich = toEventView({
      ...eventRecord,
      registration_url: "https://example.org/inscription",
      registration_deadline: "2026-06-05",
    });
    await within(
      <>
        <EventCard view={rich} list="upcoming" />
        <EventCard view={toEventView(event2Record)} list="upcoming" />
      </>,
      (drawn) => {
        const [cardTrail, cardRoad] = [...drawn.querySelectorAll<HTMLElement>(".event-card")];
        if (!cardTrail || !cardRoad) throw new Error("two cards");
        // What Crête's card has, in its places: the day, the title that leads to the page, the deadline.
        expect(cardTrail.querySelector(".date-chip")).not.toBeNull();
        expect(cardTrail.querySelector(".event-card-title a")).not.toBeNull();
        expect(cardTrail.querySelector(".event-card-deadline")?.getAttribute("data-kind")).toBe(
          "open",
        );
        expect(cardTrail.querySelector(".event-card-head")).not.toBeNull();
        expect(cardTrail.querySelector(".event-card-body")).not.toBeNull();
        // A format is a panel on the tint of its terrain, with a point before its words.
        const trail = need(cardTrail, ".event-card-format");
        expect(trail.dataset.formatKind).toBe("trail");
        // A point of 8 px before the words: the line is flex, so that the mark has a box.
        expect(need(trail, ".terrain-mark").getBoundingClientRect().width).toBe(8);
        expect(styleOf(need(trail, ".terrain-mark")).backgroundColor).toBe(
          colourOf("--color-slope-2"),
        );
        expect(styleOf(trail).backgroundColor).not.toBe(colourOf("--color-neutral-50"));
        expect(textContrast(need(trail, ".format-line"))).toBeGreaterThanOrEqual(4.5);
        const road = need(cardRoad, ".event-card-format");
        expect(road.dataset.formatKind).toBe("route");
        expect(styleOf(need(road, ".terrain-mark")).backgroundColor).toBe(
          colourOf("--color-slope-1"),
        );
        // The words of the format stay beside its mark, as Crête's card draws them (it does not
        // write the type of a race either: the tint and the mark are the skin's addition).
        expect(plain(need(road, ".format-line").textContent)).toContain("10 km");
      },
    );
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Alpage » full — sa carte n'est pas une copie : ôtés le genre et les marques des épreuves, c'est la carte de Crête, dans chaque forme d'événement",
  async () => {
    for (const { what, view, today } of EVENT_SHAPES()) {
      const props = { view, list: "upcoming" } as const;
      const base = await inApp(
        <EventCardBase {...props} />,
        (drawn) => skeleton(drawn.querySelector(".event-card")),
        { skin: SKIN, today },
      );
      const own = await inApp(
        <EventCard {...props} />,
        (drawn) => skeleton(drawn.querySelector(".event-card")),
        { skin: SKIN, today },
      );
      expect(own.html, `the card of Alpage, ${what}`).toBe(base.html);
      expect(own.words, `its format lines, ${what}`).toEqual(base.words);
    }
  },
);
