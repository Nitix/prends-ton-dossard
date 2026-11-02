import { useEffect, useRef } from "react";
import { afterEach, beforeAll, expect, test } from "vitest";

import { SKIN_DEPTH, chooseSkin, variantOf } from "..";
import { Avatar } from "../../components/Avatar";
import { PRIMARY, SECONDARY } from "../../components/buttons";
import { CountdownRing } from "../../components/Dawn";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { ToastProvider, useToast } from "../../components/Toast";
import { AdminLayout } from "../../features/admin/AdminLayout";
import { toEventView } from "../../features/events/api";
import { EventHero } from "../../features/events/EventHero";
import { formatMeasures } from "../../features/events/formatName";
import { FormatTitle } from "../../features/events/FormatTitle";
import {
  aliceRunner,
  eventRecord,
  pNinaSupporter,
  withParticipations,
} from "../../features/events/testFixture";
import { TrackFigures } from "../../features/route/TrackFigures";
import { fr } from "../../i18n/fr";
import { createFormatters } from "../../lib/format";
import { ensureTemporal } from "../../lib/temporal";
import { contrast } from "../../test/colour";
import { groundsBehind, textContrast } from "../../test/computed";
import { hex, inApp, plain } from "../../test/variant";

import "../../styles.css";
import "../../skins/styles";

// « Rétro » at depth full: every other piece of the club house, over the mix.
// The pieces it redraws (the top of an event's page, the title of a format, the
// figures of a track, the ring of the days left) keep what Crête's say, which
// skins/variants.test.tsx holds in every shape of an event; here, what is
// their own. Its sheet is looked at on the real pieces of the app, at a
// phone's width.

const ID = "retro";
const FULL = SKIN_DEPTH === "full";
const INK = "#3b2a20";
const MUSTARD = "#f2b134";
const PAPER = "#fffbf3";

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(() => {
  chooseSkin("crete");
});

const f = createFormatters("fr-FR");
/** An element that the test needs: it fails with a name when it is missing. */
const must = <T,>(element: T | null | undefined): T => {
  if (element === null || element === undefined) throw new Error("the element is missing");
  return element;
};
const style = (element: Element | null | undefined, pseudo?: string) => {
  if (!element) throw new Error("the element is missing");
  return getComputedStyle(element, pseudo);
};

/** The event of the fixture with all that its hero can show. */
const view = () =>
  toEventView(
    withParticipations(
      {
        ...eventRecord,
        notes: "Départ à 7 h.",
        registration_url: "https://example.org/inscription",
        registration_deadline: "2026-06-05",
      },
      [pNinaSupporter],
    ),
  );

test("retro — à full quatre pièces de plus sont redessinées, à mix et palette aucune", () => {
  for (const name of ["EventHero", "FormatTitle", "TrackFigures", "CountdownRing"] as const) {
    expect(variantOf(ID, name) !== undefined, `${name} is a variant of the skin`).toBe(FULL);
  }
  // Left to its CSS: the stamp of the day and the top of the page of a runner.
  for (const name of ["DateChip", "RunnerHero", "EmptyState"] as const) {
    expect(variantOf(ID, name)).toBeUndefined();
  }
});

test.skipIf(!FULL)(
  "retro — le haut de la page d'un événement est une affiche sur le papier : tout y a 4,5:1, « S'inscrire » aussi, la date limite est une pastille de moutarde",
  async () => {
    const heading = { id: "title", "data-focus": "page-title", tabIndex: -1 } as const;
    await inApp(
      <EventHero view={view()} heading={heading} />,
      (drawn) => {
        const hero = drawn.querySelector(".event-hero");
        expect(hero, "the hero").not.toBeNull();
        if (hero === null) return;
        // A light poster: the paper of a card behind everything, not the brown of the sky.
        for (const ground of groundsBehind(hero.querySelector("h1") ?? hero)) {
          expect(contrast(ground, "#ffffff"), `the ground of the hero, ${ground}`).toBeLessThan(
            1.3,
          );
        }
        const register = hero.querySelector<HTMLElement>("a.register-link");
        expect(register, "the link to register").not.toBeNull();
        const speaking = [hero.querySelector("h1"), ...hero.querySelectorAll("p"), register].filter(
          (one): one is HTMLElement => one !== null,
        );
        expect(speaking.length, "the texts of the hero").toBeGreaterThanOrEqual(5);
        for (const one of speaking) {
          expect(
            textContrast(one),
            `the words « ${plain(one.textContent).slice(0, 30)} » of the hero`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        // The deadline: a mustard pill in an ink outline, said as Crête's hero says it.
        const deadline = hero.querySelector(".event-hero-deadline");
        expect(plain(deadline?.textContent)).toBe(
          "Inscriptions jusqu'au ven. 5 juin · plus que 4 jours",
        );
        expect(hex(style(deadline).backgroundColor)).toBe(MUSTARD);
        expect(Number.parseFloat(style(deadline).borderTopWidth)).toBeGreaterThanOrEqual(2);
        // The stripes along its foot and the rays of its sun are drawn, with nothing to read.
        expect(style(hero, "::after").content).not.toBe("none");
        expect(style(hero, "::before").content).not.toBe("none");
        expect(style(hero).borderTopWidth).toBe("2px");
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "retro — le titre d'un format : ses mesures sont des étiquettes imprimées, leurs séparateurs restent dans le texte",
  async () => {
    const formatView = view().formats[0];
    if (formatView === undefined) throw new Error("no format");
    const parts = formatMeasures(formatView.format, formatView.raceType.label, f, fr);
    await inApp(
      <FormatTitle formatView={formatView} parts={parts} />,
      (drawn) => {
        const title = drawn.querySelector(".format-title");
        expect(
          [...(title?.querySelectorAll(".sr-only") ?? [])].map((one) => one.textContent),
        ).toEqual(parts.slice(1).map(() => " · "));
        expect(plain(title?.textContent)).toBe(plain(parts.join(" · ")));
        for (const measure of parts.slice(1)) {
          const tag = [...(title?.querySelectorAll("span") ?? [])].find(
            (one) => one.children.length === 0 && plain(one.textContent) === plain(measure),
          );
          expect(tag, `the tag of « ${measure} »`).toBeDefined();
          expect(Number.parseFloat(style(tag).borderTopWidth), "its edge").toBeGreaterThanOrEqual(
            1,
          );
          expect(Number.parseFloat(style(tag).borderTopLeftRadius), "a pill").toBeGreaterThan(8);
        }
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "retro — les chiffres d'un tracé sont en Bricolage, sur une ligne ; l'altitude dessous, plus de tuiles",
  async () => {
    const figures = ["12,6 km", "724 m D+", "728 m D−"];
    await inApp(
      <TrackFigures figures={figures} altitude="altitude 450 m à 1 157 m" />,
      (drawn) => {
        const line = drawn.querySelector(".route-figures");
        expect(plain(line?.textContent)).toBe(figures.join(" · "));
        expect(drawn.querySelector(".stat-tile"), "no tile").toBeNull();
        expect(style(line).fontFamily).toContain("Bricolage");
        expect(Number(style(line).fontWeight)).toBeGreaterThanOrEqual(700);
        expect(plain(drawn.querySelector(".route-altitude")?.textContent)).toBe(
          "altitude 450 m à 1 157 m",
        );
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "retro — le cercle des jours qui restent ne dessine rien : les mots à côté sont l'étiquette de moutarde",
  async () => {
    await inApp(
      <>
        <CountdownRing days={9} />
        <p className="days-left">dans 9 jours</p>
      </>,
      (drawn) => {
        // Nothing to see or to read: no ring at all.
        expect(drawn.querySelector(".countdown-ring")).toBeNull();
        const tag = drawn.querySelector(".days-left");
        expect(hex(style(tag).backgroundColor)).toBe(MUSTARD);
        expect(hex(style(tag).color)).toBe(INK);
        expect(Number.parseFloat(style(tag).borderTopWidth)).toBeGreaterThanOrEqual(2);
        expect(textContrast(must(tag))).toBeGreaterThanOrEqual(4.5);
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "retro — la fenêtre a les trois bandes sur son bord haut, un contour d'encre et une ombre dure ; son titre est lourd",
  async () => {
    await inApp(
      <Dialog open onClose={() => {}} title="Ajouter quelqu'un">
        <p>Corps</p>
      </Dialog>,
      (drawn) => {
        const dialog = drawn.querySelector(".dialog");
        expect(style(dialog).borderTopWidth).toBe("2px");
        expect(hex(style(dialog).borderTopColor)).toBe(INK);
        expect(style(dialog).boxShadow, "a hard shadow under it").toContain("0px 6px 0px 0px");
        const band = drawn.querySelector(".dialog-band");
        expect(style(band).backgroundImage, "three stripes").toContain("linear-gradient");
        expect(
          Number.parseFloat(style(band).height),
          "as tall as three stripes",
        ).toBeGreaterThanOrEqual(9);
        expect(style(drawn.querySelector(".dialog-glow")).display).toBe("none");
      },
      { skin: ID },
    );
  },
);

/** A message shown as soon as it is drawn, once. */
function Message() {
  const toast = useToast();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    toast.show("Enregistré");
  }, [toast]);
  return null;
}

test.skipIf(!FULL)(
  "retro — un message est une pastille brune au contour d'encre, sur une ombre dure de moutarde",
  async () => {
    await inApp(
      <ToastProvider>
        <Message />
      </ToastProvider>,
      (drawn) => {
        const toast = drawn.querySelector(".toast");
        expect(hex(style(toast).borderTopColor)).toBe(INK);
        expect(Number.parseFloat(style(toast).borderTopWidth)).toBeGreaterThanOrEqual(2);
        expect(style(toast).boxShadow).toContain("0px 4px 0px 0px");
        expect(style(drawn.querySelector(".toast-dot")).display).toBe("none");
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "retro — un champ a deux traits ; un bouton est imprimé : contour d'encre, ombre dure dessous",
  async () => {
    await inApp(
      <>
        <TextField name="nom" label="Nom" autoComplete="off" defaultValue="" error={null} />
        <button type="button" className={PRIMARY}>
          Valider
        </button>
        <button type="button" className={SECONDARY}>
          Annuler
        </button>
      </>,
      (drawn) => {
        expect(style(drawn.querySelector(".field-input")).borderTopWidth).toBe("2px");
        for (const button of drawn.querySelectorAll("button")) {
          expect(style(button).borderTopWidth, "an ink outline").toBe("2px");
          expect(hex(style(button).borderTopColor)).toBe(INK);
          expect(style(button).boxShadow, "its hard shadow").toContain("0px 2px 0px 0px");
        }
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "retro — les initiales d'un coureur sont un écusson d'un des trois tons du club ; un écusson à confirmer est pâle",
  async () => {
    const runners = ["a", "b", "c", "d", "e", "f"].map((id) => ({
      ...aliceRunner,
      id: `runner-${id}-000000`,
      name: `Alice ${id}`,
    }));
    await inApp(
      <>
        {runners.map((runner) => (
          <Avatar key={runner.id} runner={runner} thumb="96x96" className="size-11" />
        ))}
      </>,
      (drawn) => {
        const backgrounds = new Set<string>();
        for (const patch of drawn.querySelectorAll(".avatar")) {
          backgrounds.add(hex(style(patch).backgroundColor));
          expect(style(patch).borderTopWidth, "an ink edge").toBe("2px");
          expect(hex(style(patch).borderTopColor)).toBe(INK);
        }
        // Orange, teal or mustard: never anything else, and more than one over six runners.
        expect(
          [...backgrounds].every((colour) => ["#c24a17", "#1f7a7a", MUSTARD].includes(colour)),
        ).toBe(true);
        expect(backgrounds.size).toBeGreaterThan(1);
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "retro — l'administration : des pastilles au contour fin, la page en cours pleine de teal",
  async () => {
    await inApp(
      <AdminLayout />,
      (drawn) => {
        const [first, second] = [...drawn.querySelectorAll(".admin-tab")];
        // No transition under the checks: the colours are read where they settle.
        if (first instanceof HTMLElement) first.style.transition = "none";
        first?.setAttribute("aria-current", "page");
        expect(style(first).backgroundImage, "not the orange paint").toBe("none");
        expect(hex(style(first).backgroundColor)).toBe("#1f7a7a");
        expect(Number(style(first).fontWeight)).toBeGreaterThanOrEqual(700);
        expect(hex(style(second).backgroundColor), "the others are paper").toBe(PAPER);
        expect(textContrast(must(first))).toBeGreaterThanOrEqual(4.5);
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "retro — sur un téléphone la barre des onglets court d'un bord à l'autre sur un trait d'encre, la page en cours porte les trois bandes",
  async () => {
    await inApp(
      <p>Page</p>,
      (_drawn, page) => {
        const bar = page.querySelector(".tabbar-list");
        const box = bar?.getBoundingClientRect();
        expect(box?.width, "from edge to edge").toBe(window.innerWidth);
        expect(box?.bottom, "on the foot of the screen").toBe(window.innerHeight);
        expect(style(bar).borderTopWidth, "an ink rule on top").toBe("2px");
        expect(style(bar).borderBottomWidth).toBe("0px");
        const current = page.querySelector<HTMLElement>('.tab[aria-current="page"]');
        expect(style(current).backgroundImage, "not the orange pill").toBe("none");
        expect(style(current, "::before").backgroundImage, "the three stripes").toContain(
          "linear-gradient",
        );
        expect(textContrast(must(current))).toBeGreaterThanOrEqual(4.5);
      },
      { skin: ID, framed: true },
    );
  },
);
