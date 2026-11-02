import { useEffect, useRef } from "react";
import { afterEach, beforeAll, expect, test } from "vitest";

import { SKIN_DEPTH, chooseSkin, variantOf } from "..";
import { BlockTitle } from "../../components/BlockTitle";
import { DANGER_TEXT, SECONDARY } from "../../components/buttons";
import { CountdownRing } from "../../components/Dawn";
import { Dialog } from "../../components/Dialog";
import { ToastProvider, useToast } from "../../components/Toast";
import { AdminLayout } from "../../features/admin/AdminLayout";
import { toEventView } from "../../features/events/api";
import { formatMeasures } from "../../features/events/formatName";
import { FormatTitle } from "../../features/events/FormatTitle";
import { eventRecord } from "../../features/events/testFixture";
import { TrackFigures } from "../../features/route/TrackFigures";
import { fr } from "../../i18n/fr";
import { createFormatters } from "../../lib/format";
import { ensureTemporal } from "../../lib/temporal";
import { contrast } from "../../test/colour";
import { colourOf, rgbaOf } from "../../test/computed";
import { hex, inApp, plain, said } from "../../test/variant";

import "../../styles.css";
import "../../skins/styles";

// « Carnet » at depth full: every other piece of the logbook, over the mix. The
// pieces it redraws (the title of a format, the figures of a track, the ring of
// the days left) keep what Crête's say, which skins/variants.test.tsx holds in
// every shape of an event; here, what is their own. Its sheet is looked at on
// the real pieces of the app, at a phone's width.

const ID = "carnet";
const FULL = SKIN_DEPTH === "full";

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

test("carnet — à full trois pièces de plus sont redessinées, à mix et palette aucune", () => {
  for (const name of ["FormatTitle", "TrackFigures", "CountdownRing"] as const) {
    expect(variantOf(ID, name) !== undefined, `${name} is a variant of the skin`).toBe(FULL);
  }
  // Left to its motifs and its CSS: the empty list is dotted France already (`EmptyArt`).
  for (const name of ["EmptyState", "DateChip", "RunnerHero"] as const) {
    expect(variantOf(ID, name)).toBeUndefined();
  }
});

test.skipIf(!FULL)(
  "carnet — le titre d'un format : le carré de son type de course avant ses mots, le nom en encre, les mesures plus discrètes",
  async () => {
    const formatView = toEventView(eventRecord).formats[0];
    if (formatView === undefined) throw new Error("no format");
    const parts = formatMeasures(formatView.format, formatView.raceType.label, f, fr);
    await inApp(
      <FormatTitle formatView={formatView} parts={parts} />,
      (drawn) => {
        const title = must(drawn.querySelector(".format-title"));
        expect(plain(title.textContent)).toBe(plain(parts.join(" · ")));
        const square = title.querySelector("[aria-hidden=true][style]");
        expect(square, "the square of the kind of race").not.toBeNull();
        expect(said(title).texts.join(" ")).toBe(plain(parts.join(" · ")));
        expect(
          Number(style(title.querySelector(".format-name")).fontWeight),
        ).toBeGreaterThanOrEqual(500);
        expect(
          style(title.querySelector(".format-measures")).color,
          "quieter than the name",
        ).not.toBe(style(title.querySelector(".format-name")).color);
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "carnet — les chiffres d'un tracé sont posés comme sous une capture : la première en encre, les autres plus discrètes, et France en points où le tracé commence",
  async () => {
    const figures = ["12,6 km", "724 m D+", "728 m D−"];
    await inApp(
      <TrackFigures
        figures={figures}
        altitude="altitude 450 m à 1 157 m"
        start={{ lat: 45.9, lon: 6.13 }}
      />,
      (drawn) => {
        const line = must(drawn.querySelector(".route-figures"));
        expect(plain(line.textContent)).toBe(figures.join(" · "));
        expect(drawn.querySelector(".stat-tile"), "no tile").toBeNull();
        expect(plain(drawn.querySelector(".route-altitude")?.textContent)).toBe(
          "altitude 450 m à 1 157 m",
        );
        // France in dots, a picture, with a mark of coral where the track starts.
        const france = must(drawn.querySelector("svg[aria-hidden=true]"));
        expect(france.querySelectorAll("circle").length).toBeGreaterThan(100);
        const start = france.querySelector("[data-start]");
        expect(start, "where the track starts").not.toBeNull();
        expect(said(drawn).texts.join(" ")).not.toContain("France");
      },
      { skin: ID },
    );
    // No point, no mark.
    await inApp(
      <TrackFigures figures={["8,2 km"]} altitude={null} />,
      (drawn) => {
        expect(drawn.querySelector("[data-start]")).toBeNull();
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "carnet — les jours qui restent sont l'anneau de points, muet pour un lecteur d'écran",
  async () => {
    await inApp(
      <CountdownRing days={9} />,
      (drawn) => {
        const ring = must(drawn.firstElementChild);
        expect(ring.getAttribute("aria-hidden")).toBe("true");
        expect(said(drawn).flat).toBe("");
        expect(ring.querySelectorAll("svg circle").length).toBe(2);
        expect(plain(ring.textContent)).toBe("9");
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "carnet — « Masquer », sur la carte marine, est un contour blanc et non une pastille blanche",
  async () => {
    await inApp(
      <section className="passkey-card relative bg-iris-50 p-4">
        <p className="passkey-card-text">Une clé d'accès te connecte.</p>
        <div className="passkey-card-actions">
          <button type="button" className={SECONDARY}>
            Masquer
          </button>
        </div>
      </section>,
      (drawn) => {
        const hide = style(drawn.querySelector("button"));
        expect(hex(hide.color), "white words").toBe(hex(colourOf("--color-card")));
        expect(hide.backgroundColor, "no fill").toBe("rgba(0, 0, 0, 0)");
        expect(Number.parseFloat(hide.borderTopWidth)).toBeGreaterThanOrEqual(1);
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "carnet — la fenêtre a sa tête sur un filet fin et un fond marine ; ni halo ni bandeau",
  async () => {
    await inApp(
      <Dialog open onClose={() => {}} title="Ajouter quelqu'un">
        <p>Corps</p>
      </Dialog>,
      (drawn) => {
        const dialog = must(drawn.querySelector(".dialog"));
        expect(style(drawn.querySelector(".dialog-glow")).display).toBe("none");
        expect(style(drawn.querySelector(".dialog-band")).display).toBe("none");
        const head = style(drawn.querySelector(".dialog-head"));
        expect(Number.parseFloat(head.borderBottomWidth), "a hairline under the head").toBe(1);
        // The backdrop is the navy of the sky, not the scrim of the palette.
        const backdrop = getComputedStyle(dialog, "::backdrop").backgroundColor;
        expect(backdrop).not.toBe(colourOf("--color-scrim"));
        const [r, g, b, alpha] = rgbaOf(backdrop);
        // The navy of the sky (22, 27, 46), as a translucent colour rounds it.
        expect(Math.abs(r - 22)).toBeLessThanOrEqual(2);
        expect(Math.abs(g - 27)).toBeLessThanOrEqual(2);
        expect(Math.abs(b - 46)).toBeLessThanOrEqual(2);
        expect(alpha).toBeGreaterThan(0.3);
        expect(alpha).toBeLessThan(0.6);
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

test.skipIf(!FULL)("carnet — un message est un navy avec un point de corail", async () => {
  await inApp(
    <ToastProvider>
      <Message />
    </ToastProvider>,
    (drawn) => {
      expect(hex(style(drawn.querySelector(".toast")).backgroundColor)).toBe("#161b2e");
      const dot = drawn.querySelector(".toast-dot");
      expect(style(dot).backgroundImage, "not the paint of the dawn").toBe("none");
      expect(hex(style(dot).backgroundColor)).toBe(hex(colourOf("--color-iris-400")));
    },
    { skin: ID },
  );
});

test.skipIf(!FULL)(
  "carnet — l'administration : des segments dans un bandeau, la page en cours en blanc sur le gris",
  async () => {
    await inApp(
      <AdminLayout />,
      (drawn) => {
        const tabs = must(drawn.querySelector(".admin-tabs"));
        expect(style(tabs).display).toBe("inline-flex");
        expect(Number.parseFloat(style(tabs).borderTopWidth)).toBe(1);
        const [first, second] = [...drawn.querySelectorAll(".admin-tab")];
        if (first instanceof HTMLElement) first.style.transition = "none";
        first?.setAttribute("aria-current", "page");
        expect(style(first).backgroundImage, "not the coral paint").toBe("none");
        expect(hex(style(first).backgroundColor)).toBe("#ffffff");
        expect(style(second).borderTopWidth).toBe("0px");
        expect(Number(style(first).fontWeight)).toBeGreaterThanOrEqual(600);
      },
      { skin: ID },
    );
  },
);

/** Every `data-block` that a page of the app writes (the sources of the features are read). */
const SOURCES = import.meta.glob<string>("../../features/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});
const BLOCKS = [
  ...new Set(
    Object.entries(SOURCES)
      .filter(([path]) => !path.includes(".test."))
      .flatMap(([, text]) =>
        [...text.matchAll(/data-block="([a-z-]+)"/gu)].map((one) => one[1] ?? ""),
      ),
  ),
].toSorted();

/** A block of a page, with its title. */
const block = (kind: string) => (
  <section className="page-block flex flex-col gap-3" data-block={kind}>
    <h2 className="block-title section-title">Titre {kind}</h2>
    <p>Ligne</p>
  </section>
);

test("carnet — la source de l'app écrit bien les huit sortes de blocs que les feuilles doivent connaître", () => {
  expect(BLOCKS).toEqual(
    expect.arrayContaining([
      "comments",
      "group",
      "history",
      "pending",
      "registrations",
      "results",
      "upcoming",
      "years",
    ]),
  );
});

test.skipIf(!FULL)(
  "carnet — chaque bloc de la page d'accueil et de celle d'un coureur est une bande entre deux filets, et son titre a une icône en pointillés au-dessus : une icône pour chaque sorte, jamais une barre pleine",
  async () => {
    await inApp(
      <div className="home-page">
        {BLOCKS.map((kind) => (
          <div key={kind}>{block(kind)}</div>
        ))}
      </div>,
      (drawn) => {
        const icons = new Set<string>();
        for (const section of drawn.querySelectorAll<HTMLElement>(".page-block")) {
          const kind = section.dataset.block ?? "";
          expect(style(section).borderTopWidth, `a hairline above the band of ${kind}`).toBe("1px");
          const icon = style(section.querySelector("h2"), "::before");
          expect(icon.content, `an icon over the title of ${kind}`).not.toBe("none");
          expect(icon.maskImage, `drawn by a mask for ${kind}`).toContain("url(");
          expect(Number.parseFloat(icon.width)).toBeGreaterThanOrEqual(20);
          icons.add(icon.maskImage);
        }
        expect(icons.size, "an icon for each kind of block").toBe(BLOCKS.length);
      },
      { skin: ID },
    );
    // A kind that the sheet does not know has no mark at all: never a plain bar.
    await inApp(
      block("inconnu"),
      (drawn) => {
        const icon = style(drawn.querySelector(".page-block h2"), "::before");
        expect(icon.content, "no mark for an unknown kind").toBe("none");
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "carnet — le titre d'un format n'a qu'une marque, le carré de son type ; sur le plus petit téléphone chaque mesure reste d'un bloc, et un « · » les sépare",
  async () => {
    const formats = toEventView(eventRecord).formats;
    await inApp(
      <div style={{ width: 256 }}>
        {formats.map((formatView) => (
          <section key={formatView.format.id} className="format-section">
            <BlockTitle>
              <FormatTitle
                formatView={formatView}
                parts={formatMeasures(formatView.format, formatView.raceType.label, f, fr)}
              />
            </BlockTitle>
          </section>
        ))}
      </div>,
      (drawn) => {
        const headings = [...drawn.querySelectorAll("h2")];
        expect(headings.length).toBe(formats.length);
        for (const heading of headings) {
          // A line may break between two measures (never inside one): the heading does not overflow.
          expect(heading.scrollWidth, "the title fits its heading").toBeLessThanOrEqual(
            heading.clientWidth,
          );
          // The dotted marker of the title is not drawn: the square of the kind is the one mark.
          const marks = [...heading.children].filter(
            (child) =>
              child.getAttribute("aria-hidden") === "true" &&
              getComputedStyle(child).display !== "none",
          );
          const squares = heading.querySelectorAll(".format-title [aria-hidden=true][style]");
          expect(squares.length, "the square of the kind").toBe(1);
          expect(marks.length, "no other mark beside the title").toBe(0);
          const measures = [...heading.querySelectorAll(".format-measures")];
          expect(measures.length).toBeGreaterThan(0);
          for (const measure of measures) {
            expect(style(measure).whiteSpace, "never broken inside").toBe("nowrap");
            expect(
              measure.getClientRects().length,
              `${plain(measure.textContent)} in one piece`,
            ).toBe(1);
            expect(style(measure, "::before").content, "a dot before it").toContain("·");
          }
        }
      },
      { skin: ID },
    );
  },
);

test.skipIf(!FULL)(
  "carnet — une action qui supprime reste rouge, lisible à 4,5:1 sur la feuille",
  async () => {
    await inApp(
      <button type="button" className={`${SECONDARY} ${DANGER_TEXT}`}>
        Supprimer
      </button>,
      (drawn) => {
        const color = style(drawn.querySelector("button")).color;
        expect(hex(color)).toBe(hex(colourOf("--color-red-700")));
        expect(contrast(hex(color), hex(colourOf("--color-card")))).toBeGreaterThanOrEqual(4.5);
      },
      { skin: ID },
    );
  },
);
