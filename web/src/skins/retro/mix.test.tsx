import { afterEach, beforeAll, expect, test } from "vitest";
import { page } from "vitest/browser";

import { SKIN_DEPTH, chooseSkin, variantOf } from "..";
import { toEventView } from "../../features/events/api";
import { EventCard, EventCardBase } from "../../features/events/EventCard";
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
import { colourOf } from "../../test/computed";
import { hex, inApp, keepsEverything, plain } from "../../test/variant";

import "../../styles.css";
import "../../skins/styles";

// « Rétro » at depth mix: its ticket keeps what Crête's card shows (every
// text, every link, every list with its name), and draws the markup of a
// ticket. In a build at palette it redraws nothing: the checks then say the
// card is Crête's own. The shapes an event takes are held by
// skins/variants.test.tsx.

const ID = "retro";

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

test("retro — la carte vient de mix.tsx : à mix la variante, à palette rien ; le reste est à la feuille", () => {
  expect(variantOf(ID, "EventCard") !== undefined).toBe(SKIN_DEPTH !== "palette");
  // The stamp of the day is Crête's chip, dressed by mix.css, and so is the top of a runner's page.
  for (const name of ["DateChip", "RunnerHero"] as const) {
    expect(variantOf(ID, name)).toBeUndefined();
  }
});

test("retro — la carte d'un événement garde tout ce que celle de Crête dit, sous la forme d'un billet", async () => {
  const [own, crete] = await keepsEverything(
    <EventCard view={view()} list="upcoming" />,
    <EventCardBase view={view()} list="upcoming" />,
    { skin: ID, what: "the card" },
  );
  const card = parsed(own);
  expect(card.querySelector("article.event-card")).not.toBeNull();
  expect(card.querySelector(".date-chip"), "the day").not.toBeNull();
  expect(card.querySelector(".date-chip")?.getAttribute("aria-hidden")).toBe("true");
  // The perforation is a picture, with nothing to read.
  const perforation = card.querySelector(".perforation");
  expect(perforation?.getAttribute("aria-hidden") === "true" || perforation === null).toBe(true);
  expect(own !== crete, "drawn by the skin").toBe(SKIN_DEPTH !== "palette");
  expect(perforation !== null, "a ticket has its perforation").toBe(SKIN_DEPTH !== "palette");
});

test.skipIf(SKIN_DEPTH === "palette")(
  "retro — les mesures d'un format sont de petites étiquettes, leurs séparateurs restent dans le texte de la ligne",
  async () => {
    const [own] = await keepsEverything(
      <EventCard view={view()} list="upcoming" />,
      <EventCardBase view={view()} list="upcoming" />,
      { skin: ID, what: "the card" },
    );
    const card = parsed(own);
    // `li .sr-only` would also find the names of the runners: the line of the format is the place.
    const [firstFormat] = view().formats;
    expect(firstFormat, "the fixture has a format").toBeDefined();
    if (firstFormat === undefined) return;
    const [, ...measures] = formatMeasures(firstFormat.format, firstFormat.raceType.label, f, fr);
    const line = card.querySelector(".format-line");
    expect(line, "the line of the first format").not.toBeNull();
    expect(measures.length, "the fixture's format has measures").toBeGreaterThan(0);
    expect([...(line?.querySelectorAll(".sr-only") ?? [])].map((one) => one.textContent)).toEqual(
      measures.map(() => " · "),
    );
    for (const measure of measures) {
      const tag = [...(line?.querySelectorAll("span") ?? [])].find(
        (one) => one.children.length === 0 && plain(one.textContent) === plain(measure),
      );
      expect(tag, `the tag of « ${measure} »`).toBeDefined();
    }
  },
);

test("retro — un événement sans coureur ni épreuve est un billet sans talon : ni perforation, ni liste", async () => {
  const bare = toEventView({ ...eventRecord, expand: {} });
  await inApp(
    <EventCard view={bare} list="past" />,
    (drawn) => {
      expect(drawn.querySelector(".perforation")).toBeNull();
      expect(drawn.querySelector("ul")).toBeNull();
      expect(drawn.querySelector("a[href='/evenements/event']")?.textContent).toBe(
        "Trail des Crêtes",
      );
    },
    { skin: ID },
  );
});

test.skipIf(SKIN_DEPTH === "palette")(
  "retro — de md à 1280 px la capsule des onglets sur l'en-tête brun a un contour de papier et une ombre dure de moutarde : l'encre s'y perdrait",
  async () => {
    await page.viewport(1280, 800);
    try {
      await inApp(
        <p>Page</p>,
        (_drawn, shown) => {
          const bar = shown.querySelector(".tabbar-list");
          if (bar === null) throw new Error("the tab bar is missing");
          const own = getComputedStyle(bar);
          // The brown of the header behind it (the sky of the skin): the outline must stand out of it.
          expect(
            contrast(hex(own.borderTopColor), hex(colourOf("--dawn-sky-color"))),
            "the outline against the header",
          ).toBeGreaterThanOrEqual(3);
          expect(own.boxShadow, "the hard shadow is mustard").toContain(
            colourOf("--color-peach-400"),
          );
        },
        { skin: ID, framed: true },
      );
    } finally {
      await page.viewport(414, 896);
    }
  },
);
