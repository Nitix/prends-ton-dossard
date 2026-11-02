import { afterEach, beforeAll, expect, test } from "vitest";

import { SKIN_DEPTH, chooseSkin, variantOf } from "..";
import { DateChip, DateChipBase } from "../../components/Dawn";
import { toEventView } from "../../features/events/api";
import { EventCard, EventCardBase } from "../../features/events/EventCard";
import { EventHero, EventHeroBase } from "../../features/events/EventHero";
import { formatMeasures } from "../../features/events/formatName";
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
import { groundsBehind, textContrast, toldApart } from "../../test/computed";
import { hex, inApp, keepsEverything, plain } from "../../test/variant";

import mixCss from "./mix.css?raw";
import "../../styles.css";
import "../../skins/styles";

// « Marathon » at depth mix: each piece it redraws keeps what Crête's shows
// (every text, every link, every list with its name), and draws the markup of
// the poster. In a build at palette it redraws nothing: the checks then say the
// piece is Crête's own. The shapes an event takes are held by
// skins/variants.test.tsx; the pieces here are drawn on one rich event.

const ID = "marathon";

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

const f = createFormatters("fr-FR");

/** The parts of an HTML string, to look into what a test has drawn. */
function parsed(html: string): HTMLElement {
  const box = document.createElement("div");
  box.innerHTML = html;
  return box;
}

test("marathon — chaque pièce redessinée vient de mix.tsx : à mix la variante, à palette rien", () => {
  for (const name of ["DateChip", "EventCard", "EventHero"] as const) {
    expect(variantOf(ID, name) !== undefined).toBe(SKIN_DEPTH !== "palette");
  }
  // Left to its CSS: the top of the page of a runner.
  expect(variantOf(ID, "RunnerHero")).toBeUndefined();
});

test("marathon — la carte d'un événement garde tout ce que celle de Crête dit, sur un programme à filets", async () => {
  const [own, crete] = await keepsEverything(
    <EventCard view={view()} list="upcoming" />,
    <EventCardBase view={view()} list="upcoming" />,
    { skin: ID, what: "the card" },
  );
  const card = parsed(own);
  expect(card.querySelector("article.event-card")).not.toBeNull();
  expect(card.querySelector(".date-chip"), "the day").not.toBeNull();
  expect(own !== crete, "drawn by the skin").toBe(SKIN_DEPTH !== "palette");
});

test.skipIf(SKIN_DEPTH === "palette")(
  "marathon — les mesures d'un format sont des étiquettes de borne kilométrique, leurs séparateurs restent dans le texte de la ligne",
  async () => {
    const [own] = await keepsEverything(
      <EventCard view={view()} list="upcoming" />,
      <EventCardBase view={view()} list="upcoming" />,
      { skin: ID, what: "the card" },
    );
    const card = parsed(own);
    // The measures of a format are tags: the words are the same, and each separator
    // stays in the text of the line, after the name and before its measure, hidden
    // from the eye (`li .sr-only` would also find the names of the runners).
    const [firstFormat] = view().formats;
    expect(firstFormat, "the fixture has a format").toBeDefined();
    if (firstFormat === undefined) return;
    const [, ...measures] = formatMeasures(firstFormat.format, firstFormat.raceType.label, f, fr);
    const line = card.querySelector(".format-line");
    expect(line, "the line of the first format").not.toBeNull();
    const separators = [...(line?.querySelectorAll(".sr-only") ?? [])].map(
      (one) => one.textContent,
    );
    expect(measures.length, "the fixture's format has measures").toBeGreaterThan(0);
    expect(separators).toEqual(measures.map(() => " · "));
    for (const measure of measures) {
      const tag = [...(line?.querySelectorAll("span") ?? [])].find(
        (one) => one.children.length === 0 && plain(one.textContent) === plain(measure),
      );
      expect(tag, `the tag of « ${measure} »`).toBeDefined();
    }
  },
);

test("marathon — le jour d'un événement est un numéro de dossard, dit en toutes lettres à un lecteur d'écran", async () => {
  const { start, end } = view();
  const props = { start, end, label: "du 13 au 14 juin" };
  const [own, crete] = await keepsEverything(<DateChip {...props} />, <DateChipBase {...props} />, {
    skin: ID,
    what: "the day",
  });
  const day = parsed(own);
  // The picture is hidden, the words are for the screen readers, and it does not shrink in a row.
  const picture = day.querySelector(".date-chip");
  expect(picture?.getAttribute("aria-hidden")).toBe("true");
  expect(picture?.className).toContain("shrink-0");
  expect(picture?.className).toContain("self-start");
  expect(day.querySelector(".sr-only")?.textContent).toBe("du 13 au 14 juin");
  expect(own !== crete, "drawn by the skin").toBe(SKIN_DEPTH !== "palette");
});

test("marathon — le haut de la page d'un événement garde tout ce que celui de Crête dit : le titre de la page, les jours, la date limite, les notes, le lien", async () => {
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
  // The link to register opens another tab, as Crête's does.
  const register = hero.querySelector("a[href='https://example.org/inscription']");
  expect(register?.getAttribute("rel")).toBe("noopener noreferrer");
  expect(own !== crete, "drawn by the skin").toBe(SKIN_DEPTH !== "palette");
});

test.skipIf(SKIN_DEPTH === "palette")(
  "marathon — l'affiche est à l'encre sur le papier, comme celle de la variante : tout y a 4,5:1, « S'inscrire » aussi, et sa phrase est celle de Crête",
  async () => {
    const heading = { id: "title", "data-focus": "page-title", tabIndex: -1 } as const;
    await inApp(
      <EventHero view={view()} heading={heading} />,
      (drawn) => {
        const hero = drawn.querySelector(".event-hero");
        expect(hero, "the hero").not.toBeNull();
        if (hero === null) return;
        // A light head: the paper (the sheet of the page) behind everything, not the ink of the sky.
        for (const ground of groundsBehind(hero)) {
          expect(contrast(ground, "#ffffff"), `the ground of the hero, ${ground}`).toBeLessThan(
            1.3,
          );
        }
        const register = hero.querySelector<HTMLElement>("a.register-link");
        expect(register, "the link to register").not.toBeNull();
        const speaking = [
          hero.querySelector("h1"),
          ...hero.querySelectorAll("p"),
          register,
          // The big numeral of the day, a picture: ink too.
          hero.querySelector('[aria-hidden="true"] > span'),
        ].filter((one): one is HTMLElement => one !== null);
        expect(speaking.length, "the texts of the hero").toBeGreaterThanOrEqual(5);
        for (const one of speaking) {
          expect(
            textContrast(one),
            `the words « ${plain(one.textContent).slice(0, 30)} » of the hero`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        // « S'inscrire » is the blue rectangle of the variant, in the paint of the main button.
        expect(hex(getComputedStyle(register ?? hero).color), "its ink").toBe("#ffffff");
        // The deadline, said in one sentence as Crête's hero says it (`deadlineText`).
        expect(plain(hero.textContent)).toContain(
          "Inscriptions jusqu'au ven. 5 juin · plus que 4 jours",
        );
      },
      { skin: ID },
    );
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "marathon — les numéros des onglets n'ont pas de repli : un navigateur qui ne connaît pas l'alternative vide n'en lit pas « 01Accueil »",
  () => {
    const declarations = [...mixCss.matchAll(/content:\s*([^;]*counter\([^;]*);/g)].map(
      ([, value]) => plain(value),
    );
    expect(declarations.length, "the numbers of the tabs are drawn by a counter").toBeGreaterThan(
      0,
    );
    // Each declaration that writes a counter has the empty alternative after its slash, and is the only one of its rule.
    for (const value of declarations) expect(value).toMatch(/\/ ""$/);
    expect(mixCss.match(/content:\s*counter\(tab[^;]*\/ ""/g)?.length).toBe(1);
    expect(mixCss.match(/content:\s*counter\(tab[^;/]*;/g) ?? []).toEqual([]);
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "marathon — l'onglet courant est la barre bleue de la variante, un trait posé sur la page et non un aplat : il se lit et se distingue",
  async () => {
    await inApp(
      <p>Page</p>,
      (_drawn, page) => {
        const current = page.querySelector<HTMLElement>('.tab[aria-current="page"]');
        const others = [...page.querySelectorAll<HTMLElement>(".tab:not([aria-current])")];
        expect(current, "the current tab").not.toBeNull();
        const other = others[0];
        if (current === null || other === undefined) return;
        // Not the pill of the palette (a gradient of cobalt behind the word, cut to a
        // bar to dodge the check): the bar is a mark drawn on the tab.
        expect(getComputedStyle(current).backgroundImage, "no pill behind the word").toBe("none");
        const bar = getComputedStyle(current, "::after");
        expect(bar.content, "the bar").not.toBe("none");
        expect(hex(bar.backgroundColor), "the bar is the cobalt of the blue line").toBe("#2b59ff");
        expect(Number.parseFloat(bar.height), "the bar is thick").toBeGreaterThanOrEqual(4);
        expect(toldApart(current, other)).toEqual(expect.arrayContaining(["after"]));
        expect(Number(getComputedStyle(current).fontWeight)).toBeGreaterThanOrEqual(700);
        expect(textContrast(current), "the word of the current tab").toBeGreaterThanOrEqual(4.5);
        // The numbers are drawn, and hidden from the name of the link.
        expect(getComputedStyle(current, "::before").content).toContain("counter(tab");
        expect(current.textContent).toBe("Accueil");
      },
      { skin: ID, framed: true },
    );
  },
);
