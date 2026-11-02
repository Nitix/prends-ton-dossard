import { useEffect, useRef } from "react";
import { afterEach, beforeAll, expect, test } from "vitest";

import { SKIN_DEPTH, chooseSkin, variantOf } from "..";
import { PRIMARY, SECONDARY } from "../../components/buttons";
import { CountdownRing } from "../../components/Dawn";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { ToastProvider, useToast } from "../../components/Toast";
import { AdminLayout } from "../../features/admin/AdminLayout";
import { toEventView } from "../../features/events/api";
import { formatMeasures } from "../../features/events/formatName";
import { FormatTitle } from "../../features/events/FormatTitle";
import { ParticipantChips } from "../../features/events/ParticipantChips";
import {
  eventRecord,
  p2,
  pNinaSupporter,
  withParticipations,
} from "../../features/events/testFixture";
import { MAP_BOX } from "../../features/route/mapBox";
import { TrackFigures } from "../../features/route/TrackFigures";
import { TotalsTable } from "../../features/stats/TotalsTable";
import { fr } from "../../i18n/fr";
import { createFormatters } from "../../lib/format";
import { ensureTemporal } from "../../lib/temporal";
import { colourOf } from "../../test/computed";
import { hex, inApp, plain, said } from "../../test/variant";

import fullCss from "./full.css?raw";
import mixCss from "./mix.css?raw";
import "../../styles.css";
import "../../skins/styles";

// « Chrono » at depth full: every other piece of the watch, over the mix. The
// pieces it redraws (the title of a format, the figures of a track, the ring of
// the days left) keep what Crête's say, which skins/variants.test.tsx holds in
// every shape of an event; here, what is their own. Its sheet is looked at on
// the real pieces of the app, at a phone's width.

const ID = "chrono";
const FULL = SKIN_DEPTH === "full";
const INK = "#101418";
const GREEN = "#00a167";

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
const style = (element: Element | null | undefined, pseudo?: string) =>
  getComputedStyle(must(element), pseudo);

test("chrono — à full trois pièces de plus sont redessinées, à mix et palette aucune", () => {
  for (const name of ["FormatTitle", "TrackFigures", "CountdownRing"] as const) {
    expect(variantOf(ID, name) !== undefined, `${name} is a variant of the skin`).toBe(FULL);
  }
  for (const name of ["EmptyState", "DateChip", "RunnerHero"] as const) {
    expect(variantOf(ID, name)).toBeUndefined();
  }
});

test.skipIf(!FULL)(
  "chrono — le titre d'un format : la barre de la zone de son type de course avant ses mots, qui sont ceux de Crête",
  async () => {
    const formatView = toEventView(eventRecord).formats[0];
    if (formatView === undefined) throw new Error("no format");
    const parts = formatMeasures(formatView.format, formatView.raceType.label, f, fr);
    await inApp(
      <FormatTitle formatView={formatView} parts={parts} />,
      (drawn) => {
        const title = drawn.querySelector(".format-title");
        expect(plain(title?.textContent)).toBe(plain(parts.join(" · ")));
        // The bar is a picture: it says nothing, and is the colour of a zone of the slope.
        const bar = title?.querySelector("[aria-hidden=true][style*=slope]");
        expect(bar, "the bar of the zone of the kind of race").not.toBeNull();
        expect(
          Number.parseFloat(style(bar).height),
          "taller than on a card",
        ).toBeGreaterThanOrEqual(18);
        expect(said(must(title)).texts.join(" ")).toBe(plain(parts.join(" · ")));
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "chrono — les chiffres d'un tracé sont en mono sur une ligne ; l'altitude dessous, plus de tuiles",
  async () => {
    const figures = ["12,6 km", "724 m D+", "728 m D−"];
    await inApp(
      <TrackFigures figures={figures} altitude="altitude 450 m à 1 157 m" />,
      (drawn) => {
        const line = drawn.querySelector(".route-figures");
        expect(plain(line?.textContent)).toBe(figures.join(" · "));
        expect(drawn.querySelector(".stat-tile"), "no tile").toBeNull();
        expect(style(line).fontFamily).toContain("JetBrains Mono");
        expect(plain(drawn.querySelector(".route-altitude")?.textContent)).toBe(
          "altitude 450 m à 1 157 m",
        );
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "chrono — les jours qui restent sont l'anneau d'une montre, sur la zone du moment, muet pour un lecteur d'écran",
  async () => {
    await inApp(
      <CountdownRing days={9} />,
      (drawn) => {
        const ring = must(drawn.firstElementChild);
        expect(ring.getAttribute("aria-hidden")).toBe("true");
        expect(plain(said(drawn).flat)).toBe("");
        // On the fourth zone (a week to two), as the ring of a card has it.
        const arc = [...ring.querySelectorAll("circle")].find((circle) =>
          circle.getAttribute("style")?.includes("slope"),
        );
        expect(arc?.getAttribute("style")).toContain("--color-slope-4");
        expect(plain(ring.textContent)).toContain("9");
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "chrono — la fenêtre a la bande des cinq zones sur son bord haut, sans halo ; son titre est net",
  async () => {
    await inApp(
      <Dialog open onClose={() => {}} title="Ajouter quelqu'un">
        <p>Corps</p>
      </Dialog>,
      (drawn) => {
        const dialog = drawn.querySelector(".dialog");
        expect(style(dialog).borderTopWidth).toBe("0px");
        expect(style(drawn.querySelector(".dialog-glow")).display).toBe("none");
        const band = drawn.querySelector(".dialog-band");
        expect(style(band).height, "a strip").toBe("3px");
        const image = style(band).backgroundImage;
        expect(image).toContain("linear-gradient");
        // Each of the five zones is in the strip, in its own colour (`--color-slope-1…5`).
        for (const zone of [1, 2, 3, 4, 5]) {
          expect(image, `zone ${zone}`).toContain(colourOf(`--color-slope-${zone}`));
        }
        expect(Number.parseFloat(style(band).borderTopLeftRadius)).toBe(0);
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

test.skipIf(!FULL)("chrono — un message est une pastille d'encre avec un point vert", async () => {
  await inApp(
    <ToastProvider>
      <Message />
    </ToastProvider>,
    (drawn) => {
      expect(hex(style(drawn.querySelector(".toast")).backgroundColor)).toBe(INK);
      const dot = drawn.querySelector(".toast-dot");
      expect(hex(style(dot).backgroundColor)).toBe(GREEN);
      expect(style(dot).backgroundImage, "not the paint of the dawn").toBe("none");
    },
    { skin: ID },
  );
});

test.skipIf(!FULL)(
  "chrono — un champ a un trait fin et franc, des angles d'instrument ; un bouton aussi, sans halo",
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
        // The edge of a field has 3:1 on white (neutral-400 and no paler).
        expect(hex(style(input).borderTopColor)).toBe("#858d98");
        expect(Number.parseFloat(style(input).borderTopLeftRadius)).toBe(10);
        const [main, other] = [...drawn.querySelectorAll("button")];
        for (const button of [main, other]) {
          expect(Number.parseFloat(style(button).borderTopLeftRadius)).toBe(10);
        }
        expect(style(other).boxShadow, "no shadow under the secondary").toBe("none");
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "chrono — les puces confirmées sont d'encre ; une puce à confirmer reste en pointillés",
  async () => {
    const view = toEventView(withParticipations(eventRecord, [p2, pNinaSupporter]));
    const chips = [...view.formats.flatMap((format) => format.participations), ...view.supporters];
    await inApp(
      <ParticipantChips participations={chips} />,
      (drawn) => {
        const confirmed = drawn.querySelector('.chip[data-confirmed="true"]');
        const unconfirmed = drawn.querySelector('.chip[data-confirmed="false"]');
        expect(hex(style(confirmed).backgroundColor)).toBe(INK);
        expect(style(confirmed).backgroundImage).toBe("none");
        expect(style(unconfirmed).borderTopStyle).toBe("dashed");
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "chrono — l'administration : des pastilles au trait fin, la page en cours d'encre, sans halo",
  async () => {
    await inApp(
      <AdminLayout />,
      (drawn) => {
        const [first, second] = [...drawn.querySelectorAll(".admin-tab")];
        if (first instanceof HTMLElement) first.style.transition = "none";
        first?.setAttribute("aria-current", "page");
        expect(style(first).boxShadow).toBe("none");
        expect(style(second).borderTopWidth).toBe("1px");
        expect(style(first).backgroundImage).toContain("linear-gradient");
        expect(Number(style(first).fontWeight)).toBeGreaterThanOrEqual(700);
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "chrono — la carte en attente de la carte est sur le quadrillage d'un graphique ; les mois d'une liste ont la règle d'un axe, plus d'horizon",
  async () => {
    await inApp(
      <>
        <div className={`map-loading ${MAP_BOX} flex items-center justify-center`}>Chargement</div>
        <h2 className="month-title">juin 2026</h2>
        <span className="filter-label eyebrow">Personne</span>
      </>,
      (drawn) => {
        const loading = drawn.querySelector(".map-loading");
        expect(style(loading).backgroundImage, "the grid of a chart").toContain("linear-gradient");
        const month = drawn.querySelector(".month-title");
        expect(style(month).fontFamily).toContain("JetBrains Mono");
        expect(style(month, "::after").content).not.toBe("none");
        expect(style(month, "::after").height, "the ruler of an axis").toBe("8px");
        expect(style(drawn.querySelector(".filter-label")).fontFamily).toContain("JetBrains Mono");
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "chrono — les totaux ont leurs chiffres en mono, sur la ligne d'un instrument",
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
        const tile = drawn.querySelector(".totals .stat-tile");
        expect(style(tile).fontFamily).toContain("JetBrains Mono");
        expect(style(drawn.querySelector(".totals-row")).borderTopLeftRadius).toBe("14px");
      },
      { skin: ID },
    );
  },
);

/** The names of the elements of a page: a selector of a sheet may not name one (README, « Semantic classes »). */
const ELEMENTS =
  /(^|[\s>+~(,])(?:a|abbr|article|aside|b|button|dd|details|div|dl|dt|em|fieldset|figure|footer|form|h[1-6]|header|i|img|input|label|legend|li|main|nav|ol|option|output|p|section|select|small|span|strong|summary|svg|table|tbody|td|textarea|tfoot|th|thead|time|tr|ul)(?![\w-])/;

test("chrono — les feuilles ne nomment aucun type d'élément : seulement les classes et les attributs des pièces", () => {
  const named: string[] = [];
  for (const [level, css] of [
    ["mix.css", mixCss],
    ["full.css", fullCss],
  ] as const) {
    for (const [, prelude] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}@]+)\{/g)) {
      if (prelude === undefined || /^\s*(?:[\d.]+%|from|to)\s*$/.test(prelude)) continue;
      for (const selector of prelude.split(/,(?![^(]*\))/)) {
        // What is left once the classes, the attributes and the pseudo-classes are set aside: elements, if any.
        const bare = selector
          .replace(/"[^"]*"/g, '""')
          .replace(/\[[^\]]*\]/g, "")
          .replace(/::[a-z-]+/g, "")
          .replace(/:(?:root|is|not|hover|focus|where|has|active|disabled)\b/g, " ")
          .replace(/\.[\w-]+/g, ".");
        if (ELEMENTS.test(bare.trim()))
          named.push(`${level}: ${selector.trim().replace(/\s+/g, " ")}`);
      }
    }
  }
  expect(named, "selectors that name an element type").toEqual([]);
});
