import { afterEach, beforeAll, expect, test } from "vitest";
import { render } from "vitest-browser-react";

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
import { groundsBehind, textContrast } from "../../test/computed";
import { hex, inApp, keepsEverything, plain } from "../../test/variant";
import { HeaderArt } from "./motifs";

import "../../styles.css";
import "../../skins/styles";

// « Chrono » at depth mix: the card and the top of the page of an event keep
// what Crête's show (every text, every link, every list with its name), and draw
// the markup of a watch. In a build at palette it redraws nothing: the checks
// then say the piece is Crête's own. The shapes an event takes are held by
// skins/variants.test.tsx.

const ID = "chrono";

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

test("chrono — la carte et le haut de la page viennent de mix.tsx : à mix la variante, à palette rien ; le jour est la puce de Crête", () => {
  for (const name of ["EventCard", "EventHero"] as const) {
    expect(variantOf(ID, name) !== undefined).toBe(SKIN_DEPTH !== "palette");
  }
  for (const name of ["DateChip", "RunnerHero"] as const) {
    expect(variantOf(ID, name)).toBeUndefined();
  }
});

test("chrono — la carte d'un événement garde tout ce que celle de Crête dit, avec l'anneau des jours et la barre de zone de chaque épreuve", async () => {
  const [own, crete] = await keepsEverything(
    <EventCard view={view()} list="upcoming" />,
    <EventCardBase view={view()} list="upcoming" />,
    { skin: ID, what: "the card" },
  );
  const card = parsed(own);
  expect(card.querySelector("article.event-card")).not.toBeNull();
  expect(card.querySelector(".date-chip"), "the day").not.toBeNull();
  // The marks are pictures: each is hidden, and what it means is written beside it.
  for (const mark of card.querySelectorAll("[style*=slope]")) {
    expect(mark.closest("[aria-hidden=true]"), "hidden from a screen reader").not.toBeNull();
  }
  expect(own !== crete, "drawn by the skin").toBe(SKIN_DEPTH !== "palette");
  expect(card.querySelectorAll("[aria-hidden=true][style*=slope]").length > 0).toBe(
    SKIN_DEPTH !== "palette",
  );
  // The ring says the days left in words, for a screen reader (the event is in 12 days).
  expect(card.textContent?.includes("dans 12 jours")).toBe(SKIN_DEPTH !== "palette");
});

test.skipIf(SKIN_DEPTH === "palette")(
  "chrono — sur le plus petit téléphone, la fin des inscriptions de la carte tient sur une ligne : l'anneau des jours ne lui prend plus sa place",
  async () => {
    // 320 px less the gutters of the page: the width of a card on the narrowest phone.
    await inApp(
      <div style={{ width: 288 }}>
        <EventCard view={view()} list="upcoming" />
      </div>,
      (drawn) => {
        const deadline = [...drawn.querySelectorAll("article p")].find((one) =>
          one.textContent?.includes("Inscriptions"),
        );
        if (deadline === undefined) throw new Error("the end of the registrations is missing");
        const lines =
          deadline.getBoundingClientRect().height /
          Number.parseFloat(getComputedStyle(deadline).lineHeight);
        expect(lines, "lines of the end of the registrations").toBeLessThan(1.5);
        // The ring is still on the card, beside its head.
        expect(drawn.querySelector("article svg"), "the ring of the days left").not.toBeNull();
      },
      { skin: ID },
    );
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "chrono — chaque épreuve de la carte a la barre de sa zone avant sa ligne, qui est celle de Crête (le nom, les mesures)",
  async () => {
    const [own] = await keepsEverything(
      <EventCard view={view()} list="upcoming" />,
      <EventCardBase view={view()} list="upcoming" />,
      { skin: ID, what: "the card" },
    );
    const lines = [...parsed(own).querySelectorAll(".format-line")];
    expect(lines.length, "a line for each format").toBe(view().formats.length);
    for (const line of lines) {
      // The bar of the zone is in the line, a picture hidden from a screen reader.
      const bar = line.querySelector("[aria-hidden=true][style*=slope]");
      expect(bar, "the bar of its zone").not.toBeNull();
      expect(plain(line.textContent), "its words").not.toBe("");
    }
  },
);

test("chrono — le haut de la page d'un événement garde tout ce que celui de Crête dit, et montre les chiffres de ses épreuves", async () => {
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
  // The screen of figures: the formats are 15 and 42 km, 700 and 2 400 m, a limit of 10 h.
  const figures = [...hero.querySelectorAll("dl > div")]
    .map((one) => plain(one.textContent))
    .join("|");
  const shown = [/distance.*15.*42.*km/, /D[+].*700.*2.*400.*m/, /temps max.*10h/].map((figure) =>
    figure.test(figures),
  );
  expect(shown).toEqual(SKIN_DEPTH === "palette" ? [false, false, false] : [true, true, true]);
});

test.skipIf(SKIN_DEPTH === "palette")(
  "chrono — le haut de la page est une tête claire, comme celle de la variante : l'écran des chiffres en haut avec l'anneau dedans, tout à 4,5:1, « S'inscrire » aussi",
  async () => {
    const heading = { id: "title", "data-focus": "page-title", tabIndex: -1 } as const;
    await inApp(
      <EventHero view={view()} heading={heading} />,
      (drawn) => {
        const hero = drawn.querySelector(".event-hero");
        expect(hero, "the hero").not.toBeNull();
        if (hero === null) return;
        // A light head: the page behind everything, not the ink of the sky.
        for (const ground of groundsBehind(hero)) {
          expect(contrast(ground, "#ffffff"), `the ground of the hero, ${ground}`).toBeLessThan(
            1.3,
          );
        }
        const register = hero.querySelector<HTMLElement>("a.register-link");
        expect(register, "the link to register").not.toBeNull();
        const speaking = [
          hero.querySelector("h1"),
          ...hero.querySelectorAll("p, dt, dd"),
          register,
        ].filter((one): one is HTMLElement => one !== null);
        expect(speaking.length, "the texts of the hero").toBeGreaterThanOrEqual(8);
        for (const one of speaking) {
          expect(
            textContrast(one),
            `the words « ${plain(one.textContent).slice(0, 30)} » of the hero`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        expect(hex(getComputedStyle(register ?? hero).color), "the ink of « S'inscrire »").not.toBe(
          "#f6f7f9",
        );
        // The screen of the figures is above the end of the registrations, the ring is in it.
        const screen = hero.querySelector(".watch-screen");
        expect(screen, "the screen of the figures").not.toBeNull();
        expect(screen?.querySelector("svg"), "the ring, in the screen").not.toBeNull();
        const deadline = [...hero.querySelectorAll("p")].find((p) =>
          p.textContent?.includes("Inscriptions"),
        );
        expect(deadline, "the end of the registrations").toBeDefined();
        expect(
          must(screen).compareDocumentPosition(must(deadline)) & Node.DOCUMENT_POSITION_FOLLOWING,
          "the screen comes first",
        ).not.toBe(0);
        // The deadline in one sentence, as Crête's hero says it (`deadlineText`).
        expect(plain(hero.textContent)).toContain(
          "Inscriptions jusqu'au ven. 5 juin · plus que 4 jours",
        );
      },
      { skin: ID },
    );
  },
);

test("chrono — le cadran de la page de connexion tient sous la carte : pas plus de 13 rem, entier", async () => {
  chooseSkin(ID);
  const screen = await render(
    <div style={{ position: "relative", width: 375, height: 812 }}>
      <HeaderArt place="welcome" />
    </div>,
  );
  const dial = screen.container.querySelector("svg[viewBox='0 0 200 200']");
  expect(dial).not.toBeNull();
  const box = dial?.getBoundingClientRect();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.width ?? 999).toBeLessThanOrEqual(13 * 16 + 1);
  await screen.unmount();
});
