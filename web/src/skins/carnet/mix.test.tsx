import { afterEach, beforeAll, expect, test } from "vitest";
import { userEvent } from "vitest/browser";

import { SKIN_DEPTH, chooseSkin, variantOf } from "..";
import { toEventView } from "../../features/events/api";
import { EventCard, EventCardBase } from "../../features/events/EventCard";
import { EventHero, EventHeroBase } from "../../features/events/EventHero";
import {
  eventRecord,
  pNinaSupporter,
  pNinaUndecided,
  withParticipations,
} from "../../features/events/testFixture";
import { ensureTemporal } from "../../lib/temporal";
import { contrast } from "../../test/colour";
import { colourOf, groundsBehind, textContrast, toldApart } from "../../test/computed";
import { hex, inApp, keepsEverything, plain } from "../../test/variant";

import mixCss from "./mix.css?raw";
import "../../styles.css";
import "../../skins/styles";

// « Carnet » at depth mix: the card and the top of the page of an event keep
// what Crête's show (every text, every link, every list with its name), and draw
// the markup of a sheet of the logbook; the card that offers a key to sign in is
// the navy card of the variant, and what is under the pointer takes a visible
// tint of coral. In a build at palette it redraws nothing: the checks then say
// the piece is Crête's own. The shapes an event takes are held by
// skins/variants.test.tsx.

const ID = "carnet";

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(() => {
  chooseSkin("crete");
});

/** The event of the fixture with all that its pieces can show: a deadline in 4 days, notes, a link to register, someone interested and a supporter. */
const view = () =>
  toEventView(
    withParticipations(
      {
        ...eventRecord,
        notes: "Départ à 7 h.",
        registration_url: "https://example.org/inscription",
        registration_deadline: "2026-06-05",
      },
      [pNinaUndecided, pNinaSupporter],
    ),
  );

/** An element that the test needs: it fails with a name when it is missing. */
const must = <T,>(element: T | null | undefined): T => {
  if (element === null || element === undefined) throw new Error("the element is missing");
  return element;
};

/** The parts of an HTML string, to look into what a test has drawn. */
function parsed(html: string): HTMLElement {
  const box = document.createElement("div");
  box.innerHTML = html;
  return box;
}

test("carnet — la carte et le haut de la page viennent de mix.tsx : à mix la variante, à palette rien ; le jour est la puce de Crête", () => {
  for (const name of ["EventCard", "EventHero"] as const) {
    expect(variantOf(ID, name) !== undefined).toBe(SKIN_DEPTH !== "palette");
  }
  for (const name of ["DateChip", "RunnerHero"] as const) {
    expect(variantOf(ID, name)).toBeUndefined();
  }
});

test("carnet — la carte d'un événement garde tout ce que celle de Crête dit, avec son nom en deux voix et le carré de chaque épreuve", async () => {
  const [own, crete] = await keepsEverything(
    <EventCard view={view()} list="upcoming" />,
    <EventCardBase view={view()} list="upcoming" />,
    { skin: ID, what: "the card" },
  );
  const card = parsed(own);
  expect(card.querySelector("article.event-card")).not.toBeNull();
  expect(card.querySelector(".date-chip"), "the day").not.toBeNull();
  // The title is the same text, in the link.
  expect(card.querySelector("h3 a")?.textContent).toBe("Trail des Crêtes");
  expect(own !== crete, "drawn by the skin").toBe(SKIN_DEPTH !== "palette");
  expect(card.textContent?.includes("dans 12 jours")).toBe(SKIN_DEPTH !== "palette");
});

test.skipIf(SKIN_DEPTH === "palette")(
  "carnet — le nom d'une carte est en deux voix : son dernier mot en serif italique (il y a bien un mot en serif), ses carrés sont des images cachées",
  async () => {
    const [own] = await keepsEverything(
      <EventCard view={view()} list="upcoming" />,
      <EventCardBase view={view()} list="upcoming" />,
      { skin: ID, what: "the card" },
    );
    const card = parsed(own);
    // No fallback: a card without its serif word fails here (`?? "Crêtes"` would pass anyway).
    expect(card.querySelector("h3 a .font-serif")?.textContent).toBe("Crêtes");
    // The squares of the kinds of race are pictures: each is hidden, in the line of its format.
    const squares = [...card.querySelectorAll(".format-line [style]")];
    expect(squares.length, "a square for each format").toBe(view().formats.length);
    for (const mark of squares) expect(mark.getAttribute("aria-hidden")).toBe("true");
  },
);

test("carnet — le haut de la page d'un événement garde tout ce que celui de Crête dit : le titre de la page en deux voix, les jours, la date limite, les notes, le lien", async () => {
  const heading = { id: "title", "data-focus": "page-title", tabIndex: -1 } as const;
  const [own, crete] = await keepsEverything(
    <EventHero view={view()} heading={heading} />,
    <EventHeroBase view={view()} heading={heading} />,
    { skin: ID, what: "the hero" },
  );
  const hero = parsed(own);
  expect(hero.querySelector("header.event-hero")).not.toBeNull();
  const title = hero.querySelector("h1");
  expect(title?.id).toBe("title");
  expect(title?.getAttribute("data-focus")).toBe("page-title");
  expect(title?.textContent).toBe("Trail des Crêtes");
  const register = hero.querySelector("a[href='https://example.org/inscription']");
  expect(register?.getAttribute("rel")).toBe("noopener noreferrer");
  expect(own !== crete, "drawn by the skin").toBe(SKIN_DEPTH !== "palette");
});

test.skipIf(SKIN_DEPTH === "palette")(
  "carnet — le haut de la page est du papier, comme celui de la variante : le titre en deux voix, la grille encadrée de la date et du lieu, tout à 4,5:1, « S'inscrire » aussi",
  async () => {
    const heading = { id: "title", "data-focus": "page-title", tabIndex: -1 } as const;
    await inApp(
      <EventHero view={view()} heading={heading} />,
      (drawn) => {
        const hero = must(drawn.querySelector(".event-hero"));
        // Paper: the page behind everything, not the navy of the sky.
        for (const ground of groundsBehind(hero)) {
          expect(contrast(ground, "#ffffff"), `the ground of the hero, ${ground}`).toBeLessThan(
            1.3,
          );
        }
        const register = must(hero.querySelector<HTMLElement>("a.register-link"));
        const speaking = [
          hero.querySelector("h1"),
          ...hero.querySelectorAll("p, li"),
          register,
        ].filter((one): one is HTMLElement => one !== null);
        expect(speaking.length, "the texts of the hero").toBeGreaterThanOrEqual(6);
        for (const one of speaking) {
          expect(
            textContrast(one),
            `the words « ${plain(one.textContent).slice(0, 30)} » of the hero`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        // The title comes first, as the title of the page is read; the kinds of the races are
        // drawn above it (`order-first`).
        const title = must(hero.querySelector("h1"));
        const kinds = must(hero.querySelector("p.eyebrow"));
        expect(
          title.compareDocumentPosition(kinds) & Node.DOCUMENT_POSITION_FOLLOWING,
          "the title first in the page",
        ).not.toBe(0);
        expect(
          kinds.getBoundingClientRect().bottom,
          "the kinds above the title",
        ).toBeLessThanOrEqual(title.getBoundingClientRect().top + 1);
        // The title in two voices: the same text, its last word in the serif.
        expect(hero.querySelector("h1 .font-serif")?.textContent).toBe("Crêtes");
        // The date, the place and where the registration stands: a grid framed by hairlines.
        const facts = must(hero.querySelector(".event-hero-facts"));
        expect(facts.querySelectorAll("li").length, "date, place, registration").toBe(3);
        expect(Number.parseFloat(getComputedStyle(facts).borderTopWidth)).toBeGreaterThanOrEqual(1);
        // The days left: a ring of dots and the words under it, read once.
        expect(plain(hero.textContent).match(/dans 12 jours/g)?.length).toBe(1);
        // The deadline in one sentence, as Crête's hero says it (`deadlineText`).
        expect(plain(hero.textContent)).toContain(
          "Inscriptions jusqu'au ven. 5 juin · plus que 4 jours",
        );
      },
      { skin: ID },
    );
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "carnet — l'onglet courant a la ligne de corail de la variante : courte, droite, posée sur l'onglet, et non la pilule rognée par ses coins",
  async () => {
    await inApp(
      <p>Page</p>,
      (_drawn, page) => {
        const current = must(page.querySelector<HTMLElement>('.tab[aria-current="page"]'));
        const other = must(page.querySelector<HTMLElement>(".tab:not([aria-current])"));
        expect(getComputedStyle(current).backgroundImage, "no pill behind the word").toBe("none");
        const line = getComputedStyle(current, "::after");
        expect(line.content, "the line").not.toBe("none");
        expect(hex(line.backgroundColor)).toBe(hex(colourOf("--color-iris-600")));
        expect(Number.parseFloat(line.height), "a short line").toBeLessThanOrEqual(4);
        expect(Number.parseFloat(line.width), "narrower than the tab").toBeLessThan(
          current.getBoundingClientRect().width,
        );
        expect(
          Number.parseFloat(line.borderBottomLeftRadius),
          "straight, not the pill's curve",
        ).toBeLessThanOrEqual(2);
        expect(toldApart(current, other)).toEqual(expect.arrayContaining(["after"]));
        expect(textContrast(current)).toBeGreaterThanOrEqual(4.5);
        expect(Number(getComputedStyle(current).fontWeight)).toBeGreaterThanOrEqual(600);
      },
      { skin: ID, framed: true },
    );
  },
);

test("carnet — la feuille de mix n'a plus de sélecteur sur une classe de couleur de Tailwind (`.bg-iris-50`, `.ring-iris-100`…) ni sur une variante (`.hover\\:bg-iris-50`)", () => {
  const rules = mixCss.replace(/\/\*[\s\S]*?\*\//g, "");
  expect(rules).not.toMatch(/\.(?:bg|ring|text|border)-[a-z]+-\d+|\\:/);
});

/** The card that offers a key to sign in, with the classes of the component (`PasskeyBanner`). */
const passkeyCard = (
  <section className="passkey-card relative flex flex-col gap-2 overflow-hidden rounded-[1.25rem] bg-iris-50 p-4 ring-1 ring-iris-100">
    <span
      aria-hidden="true"
      className="passkey-card-glow absolute -top-12 -right-10 size-36 rounded-full"
    />
    <h2 className="passkey-card-title card-title relative">Ajoute une clé d'accès</h2>
    <p className="passkey-card-text relative text-sm text-neutral-700">
      Une clé d'accès te connecte.
    </p>
    <div className="passkey-card-actions relative mt-1 flex flex-wrap gap-2">
      <button type="button" className="btn-secondary">
        Masquer
      </button>
    </div>
  </section>
);

test("carnet — la carte de la clé d'accès est la carte marine de la variante à mix, ses mots lisibles ; à palette, le papier", async () => {
  await inApp(
    passkeyCard,
    (drawn) => {
      const card = must(drawn.querySelector(".passkey-card"));
      const glow = must(drawn.querySelector(".passkey-card-glow"));
      const hide = must(drawn.querySelector("button"));
      const deep = SKIN_DEPTH !== "palette";
      expect(getComputedStyle(card).backgroundColor).toBe(
        colourOf(deep ? "--dawn-sky-color" : "--color-iris-50"),
      );
      expect(getComputedStyle(glow).display !== "none", "the glow").toBe(!deep);
      // Its words: white on the navy, and the button keeps its ink.
      expect(getComputedStyle(must(drawn.querySelector("h2"))).color).toBe(
        deep ? colourOf("--color-card") : colourOf("--color-ink"),
      );
      // A white pill, its words in ink; at full, an outline (full.test.tsx).
      expect(getComputedStyle(hide).color).toBe(
        colourOf(SKIN_DEPTH === "full" ? "--color-card" : "--color-ink"),
      );
    },
    { skin: ID },
  );
});

/** The pieces that take the tint of coral under the pointer (`hover:bg-iris-50` in the app), by their semantic class. */
const HOVERED = [
  "btn-secondary",
  "tab",
  "admin-tab",
  "nav-arrow",
  "dialog-close",
  "menu-item",
  "agenda-day",
  "event-picker-option",
  "skin-choice",
  "mode-choice",
] as const;

test("carnet — ce qui est sous le pointeur prend une teinte de corail visible, sur chaque pièce de l'app : plus le papier d'iris-50, presque le blanc d'une feuille", async () => {
  await inApp(
    <div>
      {HOVERED.map((name) => (
        <button key={name} type="button" className={`${name} bg-card hover:bg-iris-50`}>
          {name}
        </button>
      ))}
    </div>,
    async (drawn) => {
      for (const button of drawn.querySelectorAll("button")) {
        const tint = colourOf(SKIN_DEPTH === "palette" ? "--color-iris-50" : "--color-iris-100");
        expect(getComputedStyle(button).backgroundColor, `${button.className} at rest`).not.toBe(
          tint,
        );
        await userEvent.hover(button);
        expect(getComputedStyle(button).backgroundColor, `${button.className} hovered`).toBe(tint);
      }
    },
    { skin: ID },
  );
});
