import { useEffect, useRef } from "react";
import { afterEach, beforeAll, expect, test } from "vitest";

import { SKIN_DEPTH, chooseSkin, variantOf } from "..";
import { PRIMARY, SECONDARY } from "../../components/buttons";
import { CountdownRing } from "../../components/Dawn";
import { Dialog } from "../../components/Dialog";
import { SECTION } from "../../components/section";
import { TextField } from "../../components/TextField";
import { ToastProvider, useToast } from "../../components/Toast";
import { AdminLayout } from "../../features/admin/AdminLayout";
import { toEventView } from "../../features/events/api";
import { formatMeasures } from "../../features/events/formatName";
import { FormatTitle } from "../../features/events/FormatTitle";
import { ParticipantChips } from "../../features/events/ParticipantChips";
import {
  eventRecord,
  pNinaSupporter,
  p2,
  withParticipations,
} from "../../features/events/testFixture";
import { TrackFigures } from "../../features/route/TrackFigures";
import { TotalsTable } from "../../features/stats/TotalsTable";
import { fr } from "../../i18n/fr";
import { createFormatters } from "../../lib/format";
import { ensureTemporal } from "../../lib/temporal";
import { hex, inApp, plain } from "../../test/variant";

import fullCss from "./full.css?raw";
import "../../styles.css";
import "../../skins/styles";

// « Marathon » at depth full: every other piece of the programme, over the mix.
// The pieces it redraws (`FormatTitle`, `TrackFigures`, `CountdownRing`) keep
// what Crête's say, which skins/variants.test.tsx holds in every shape of an
// event; here, what is its own. Its sheet is looked at on the real pieces of
// the app (a window, a message, a field…), at a phone's width.

const ID = "marathon";
const FULL = SKIN_DEPTH === "full";
const COBALT = "#2b59ff";
const INK = "#0b0b0c";

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(() => {
  chooseSkin("crete");
});

const f = createFormatters("fr-FR");
const style = (element: Element | null | undefined, pseudo?: string) => {
  if (!element) throw new Error("the element is missing");
  return getComputedStyle(element, pseudo);
};

test("marathon — à full trois pièces de plus sont redessinées, à mix et palette aucune", () => {
  for (const name of ["FormatTitle", "TrackFigures", "CountdownRing"] as const) {
    expect(variantOf(ID, name) !== undefined, `${name} is a variant of the skin`).toBe(FULL);
  }
  // Left to its motifs and its CSS: the empty list is a course already (`EmptyArt`).
  expect(variantOf(ID, "EmptyState")).toBeUndefined();
});

test.skipIf(!FULL)(
  "marathon — le titre d'un format : ses mesures sont des étiquettes de borne, leurs séparateurs restent dans le texte",
  async () => {
    const view = toEventView(eventRecord);
    const formatView = view.formats[0];
    if (formatView === undefined) throw new Error("no format");
    const parts = formatMeasures(formatView.format, formatView.raceType.label, f, fr);
    await inApp(
      <FormatTitle formatView={formatView} parts={parts} />,
      (drawn) => {
        const title = drawn.querySelector(".format-title");
        expect(title, "the title").not.toBeNull();
        expect(
          [...(title?.querySelectorAll(".sr-only") ?? [])].map((one) => one.textContent),
        ).toEqual(parts.slice(1).map(() => " · "));
        expect(plain(title?.textContent)).toBe(plain(parts.join(" · ")));
        for (const measure of parts.slice(1)) {
          const tag = [...(title?.querySelectorAll("span") ?? [])].find(
            (one) => one.children.length === 0 && plain(one.textContent) === plain(measure),
          );
          expect(tag, `the tag of « ${measure} »`).toBeDefined();
          expect(Number.parseFloat(style(tag).borderTopWidth), "its frame").toBeGreaterThanOrEqual(
            1,
          );
          expect(hex(style(tag).borderTopColor), "its frame is ink").toBe(INK);
        }
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "marathon — les chiffres d'un tracé sont des temps de passage : une ligne en chiffres gras et tabulaires, l'altitude dessous, plus de tuiles",
  async () => {
    const figures = ["12,6 km", "724 m D+", "728 m D−"];
    await inApp(
      <TrackFigures figures={figures} altitude="altitude 450 m à 1 157 m" />,
      (drawn) => {
        const line = drawn.querySelector(".route-figures");
        expect(plain(line?.textContent)).toBe(figures.join(" · "));
        expect(drawn.querySelector(".stat-tile"), "no tile").toBeNull();
        expect(Number.parseFloat(style(line).fontSize)).toBeGreaterThanOrEqual(20);
        expect(Number(style(line).fontWeight)).toBeGreaterThanOrEqual(800);
        expect(style(line).fontVariantNumeric).toContain("tabular-nums");
        expect(plain(drawn.querySelector(".route-altitude")?.textContent)).toBe(
          "altitude 450 m à 1 157 m",
        );
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "marathon — les jours qui restent sont un grand chiffre cobalt, caché à un lecteur d'écran (sur le ciel d'un héros, blanc)",
  async () => {
    await inApp(
      <>
        <CountdownRing days={9} />
        <CountdownRing days={9} tone="light" />
      </>,
      (drawn) => {
        const [onCard, onSky] = [...drawn.querySelectorAll(".countdown-ring")];
        for (const ring of [onCard, onSky]) {
          expect(ring?.getAttribute("aria-hidden")).toBe("true");
          expect(plain(ring?.textContent)).toBe("9");
          expect(Number.parseFloat(style(ring).fontSize), "a big figure").toBeGreaterThanOrEqual(
            32,
          );
        }
        expect(hex(style(onCard).color)).toBe(COBALT);
        expect(hex(style(onSky).color)).toBe("#ffffff");
      },
      { skin: ID },
    );
  },
);

/** A stage of the home page: the title of its block, on the course. */
const stage = (title: string) => (
  <section className="page-block flex flex-col gap-3">
    <h2 className="block-title section-title">{title}</h2>
    <p>Ligne</p>
  </section>
);

test.skipIf(!FULL)(
  "marathon — l'accueil est un parcours : chaque bloc a son borne « KM » (lue pour personne), la ligne bleue à gauche, plus de filet noir au-dessus",
  async () => {
    // Each declaration that writes a counter has the empty alternative (no fallback: « KM 0Bloc »).
    for (const [, value] of fullCss.matchAll(/content:\s*([^;]*counter\([^;]*);/g)) {
      expect(plain(value)).toMatch(/\/ ""$/);
    }
    await inApp(
      <div className="home-page flex flex-col gap-6">
        {stage("Premier")}
        {stage("Second")}
      </div>,
      (drawn) => {
        const [first, second] = [...drawn.querySelectorAll(".page-block")];
        const label = (block: Element | undefined) => style(block, "::before").content;
        expect(label(first), "the marker of the first stage").toContain("counter(km");
        expect(label(second), "the marker of the second stage").toContain("counter(km");
        // The line of the course runs down the left of the block, in the blue of the line.
        const line = style(first, "::after");
        expect(line.content).not.toBe("none");
        expect(Number.parseFloat(line.width), "the line is thin").toBeLessThanOrEqual(4);
        expect(Number.parseFloat(style(first).paddingLeft), "room for the line").toBeGreaterThan(
          16,
        );
        // A stage, not a section of a page: no black rule above its title.
        expect(style(first?.querySelector("h2")).borderTopWidth).toBe("0px");
        // A block of another page (a runner's) is still a section under its rule.
      },
      { skin: ID },
    );
    await inApp(
      <div className="flex flex-col gap-6">{stage("Années")}</div>,
      (drawn) => {
        const block = drawn.querySelector(".page-block");
        expect(style(block).paddingLeft).toBe("0px");
        expect(style(block?.querySelector("h2")).borderTopWidth).toBe("2px");
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "marathon — la fenêtre est carrée sous le trait bleu, son titre est sur un filet ; ni halo ni bandeau",
  async () => {
    await inApp(
      <Dialog open onClose={() => {}} title="Ajouter quelqu'un">
        <p>Corps</p>
      </Dialog>,
      (drawn) => {
        const dialog = drawn.querySelector(".dialog");
        expect(
          Number.parseFloat(style(dialog).borderTopWidth),
          "the blue line on top",
        ).toBeGreaterThanOrEqual(4);
        expect(hex(style(dialog).borderTopColor)).toBe(COBALT);
        expect(Number.parseFloat(style(dialog).borderTopLeftRadius)).toBeLessThanOrEqual(4);
        expect(style(drawn.querySelector(".dialog-glow")).display).toBe("none");
        expect(style(drawn.querySelector(".dialog-band")).display).toBe("none");
        expect(
          Number.parseFloat(style(drawn.querySelector(".dialog-head")).borderBottomWidth),
          "a rule under the title",
        ).toBeGreaterThanOrEqual(1);
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
  "marathon — un message est une pastille d'encre au bord cobalt, carrée, sans point",
  async () => {
    await inApp(
      <ToastProvider>
        <Message />
      </ToastProvider>,
      (drawn) => {
        const toast = drawn.querySelector(".toast");
        expect(hex(style(toast).backgroundColor)).toBe(INK);
        expect(Number.parseFloat(style(toast).borderLeftWidth)).toBeGreaterThanOrEqual(4);
        expect(hex(style(toast).borderLeftColor)).toBe(COBALT);
        expect(Number.parseFloat(style(toast).borderTopLeftRadius)).toBeLessThanOrEqual(4);
        expect(style(drawn.querySelector(".toast-dot")).display).toBe("none");
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "marathon — un champ est carré, au trait gris qui noircit sous le pointeur ; ses boutons sont carrés, sans halo, le secondaire au trait gris",
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
        const input = drawn.querySelector(".field-input");
        expect(
          Number.parseFloat(style(input).borderTopLeftRadius),
          "a square field",
        ).toBeLessThanOrEqual(4);
        expect(style(drawn.querySelector("label")).fontWeight).toBe("600");
        const [main, other] = [...drawn.querySelectorAll("button")];
        for (const button of [main, other]) {
          expect(
            Number.parseFloat(style(button).borderTopLeftRadius),
            "a square button",
          ).toBeLessThanOrEqual(4);
          expect(style(button).boxShadow, "no halo").toBe("none");
        }
        expect(hex(style(other).borderTopColor), "the grey outline").toBe("#8a8a84");
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "marathon — une section de la page est une feuille sous un filet noir ; une puce confirmée est d'encre, une puce à confirmer reste en pointillés",
  async () => {
    const view = toEventView(withParticipations(eventRecord, [p2, pNinaSupporter]));
    const chips = [...view.formats.flatMap((format) => format.participations), ...view.supporters];
    await inApp(
      <>
        <section className={SECTION}>
          <h2>Titre</h2>
          <ParticipantChips participations={chips} />
        </section>
      </>,
      (drawn) => {
        const section = drawn.querySelector(".event-section");
        expect(style(section).borderTopWidth).toBe("2px");
        expect(hex(style(section).borderTopColor)).toBe(INK);
        expect(Number.parseFloat(style(section).borderTopLeftRadius)).toBeLessThanOrEqual(0);
        const confirmed = drawn.querySelector('.chip[data-confirmed="true"]');
        const unconfirmed = drawn.querySelector('.chip[data-confirmed="false"]');
        expect(confirmed, "a confirmed chip in the fixture").not.toBeNull();
        expect(unconfirmed, "an unconfirmed chip in the fixture").not.toBeNull();
        expect(hex(style(confirmed).backgroundColor)).toBe(INK);
        expect(style(confirmed).backgroundImage, "no pill of sunrise").toBe("none");
        expect(style(unconfirmed).borderTopStyle, "dashed says « not confirmed »").toBe("dashed");
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "marathon — l'administration : des onglets soulignés par la ligne bleue, plus de pilules",
  async () => {
    await inApp(
      <AdminLayout />,
      (drawn) => {
        const [first, second] = [...drawn.querySelectorAll(".admin-tab")];
        first?.setAttribute("aria-current", "page");
        expect(style(first).backgroundImage, "no pill").toBe("none");
        expect(style(first).borderTopLeftRadius).toBe("0px");
        expect(hex(style(first).borderBottomColor), "the blue line under the current one").toBe(
          COBALT,
        );
        expect(Number.parseFloat(style(first).borderBottomWidth)).toBeGreaterThanOrEqual(3);
        expect(Number(style(first).fontWeight)).toBeGreaterThanOrEqual(700);
        expect(style(second).borderBottomColor, "none under the others").toBe("rgba(0, 0, 0, 0)");
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "marathon — les totaux, sur un téléphone, sont des blocs sous un filet noir, chiffres en gras",
  async () => {
    await inApp(
      <TotalsTable
        caption="Totaux"
        firstColumn="Coureur"
        lines={[
          {
            key: "a",
            head: "Alice",
            totals: { finished: 3, dnf: 0, km: 42.2, elevation: 1200, seconds: 14000 },
          },
        ]}
      />,
      (drawn) => {
        const row = drawn.querySelector(".totals-row");
        expect(style(row).borderTopWidth).toBe("2px");
        expect(hex(style(row).borderTopColor)).toBe(INK);
        expect(Number.parseFloat(style(row).borderTopLeftRadius)).toBeLessThanOrEqual(0);
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "marathon — sur un téléphone la barre des onglets court d'un bord à l'autre, à plat sur le bas de l'écran",
  async () => {
    await inApp(
      <p>Page</p>,
      (_drawn, page) => {
        const bar = page.querySelector(".tabbar-list");
        const box = bar?.getBoundingClientRect();
        expect(box?.width, "from edge to edge").toBe(window.innerWidth);
        expect(box?.bottom, "on the foot of the screen").toBe(window.innerHeight);
        expect(style(bar).borderTopLeftRadius).toBe("0px");
        expect(style(bar).borderLeftWidth, "no side rule").toBe("0px");
        expect(style(bar).borderTopWidth, "an ink rule on top").toBe("1px");
      },
      { skin: ID, framed: true },
    );
  },
);
