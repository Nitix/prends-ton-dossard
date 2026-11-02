import { useEffect, useRef, type ReactNode } from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { page } from "vitest/browser";

import { SKIN_DEPTH } from "..";
import { Avatar } from "../../components/Avatar";
import { Dialog } from "../../components/Dialog";
import { INPUT } from "../../components/Field";
import { ToastProvider, useToast } from "../../components/Toast";
import { EventCard } from "../../features/events/EventCard";
import { EventHero } from "../../features/events/EventHero";
import { ParticipantChips } from "../../features/events/ParticipantChips";
import { aliceRunner, bobRunner, ninaRunner, samRunner } from "../../features/events/testFixture";
import { UpcomingSection } from "../../features/home/MyUpcoming";
import { TrackFigures } from "../../features/route/TrackFigures";
import { ensureTemporal } from "../../lib/temporal";
import { contrast } from "../../test/colour";
import { colourOf } from "../../test/computed";
import { resetMedia } from "../../test/media";
import { EVENT_SHAPES, hex, inApp, plain, said } from "../../test/variant";

import "../../styles.css";
import "../../skins/styles";

// « Dossard », depth full: the pieces that its variant dressed beyond the ones of
// mix (a window, a message, the fields and the filters, the sections of an event
// page as white bibs, the chips and the initials of the runners, the rows and
// the days left of the home page, the callouts, the route, the agenda, the admin,
// the totals, the empty lists, the sign-in card) take the tokens of the palette,
// and the markup of the figures of a track and of the ring of the days left
// keeps what Crête's says (the shared feature test, skins/variants.test.tsx,
// holds every shape of event to it). Below the depth of full the sheet and the
// variants are not in the build.

vi.mock("../../lib/pb", async () => (await import("../../test/pbMock")).pbModule);

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(async () => {
  await resetMedia();
  await page.viewport(414, 896);
});

/** A length of the theme (`--radius-2xl`…) as the browser computes it, for a border radius. */
function radiusOf(property: string): string {
  const probe = document.createElement("span");
  probe.style.borderTopLeftRadius = `var(${property})`;
  document.body.append(probe);
  const radius = getComputedStyle(probe).borderTopLeftRadius;
  probe.remove();
  return radius;
}

/** The tokens of the palette a test compares with, read while Dossard is on the page. */
function tokens() {
  return {
    coral: colourOf("--color-peach-500"),
    coralDeep: colourOf("--color-peach-600"),
    coralInk: colourOf("--color-peach-700"),
    coralSoft: colourOf("--color-peach-50"),
    sun: colourOf("--color-blush-200"),
    sunSoft: colourOf("--color-blush-50"),
    sky: colourOf("--color-iris-300"),
    skySoft: colourOf("--color-iris-50"),
    skyInk: colourOf("--color-iris-700"),
    ink: colourOf("--color-ink"),
    onInk: colourOf("--dawn-deep-ink"),
    sand: colourOf("--color-neutral-50"),
    card: colourOf("--color-card"),
    tint: [
      colourOf("--color-peach-100"),
      colourOf("--color-blush-100"),
      colourOf("--color-iris-100"),
      colourOf("--color-neutral-200"),
    ],
    radius2xl: radiusOf("--radius-2xl"),
    radiusCard: radiusOf("--radius-card"),
  };
}

/** What `look` makes of a piece in Dossard, in the app, with the tokens of its palette (`tokens`). */
function inDossard<T extends object>(
  element: ReactNode,
  look: (drawn: HTMLElement) => T,
  options: { today?: string } = {},
) {
  return inApp(element, (drawn) => ({ ...look(drawn), tokens: tokens() }), {
    skin: "dossard",
    ...options,
  });
}

/** The computed style of what a piece drew, found by its selector (and its pseudo-element). */
function styleOf(drawn: ParentNode, selector: string, pseudo?: string): CSSStyleDeclaration {
  const found = drawn.querySelector(selector);
  if (found === null) throw new Error(`nothing drawn for ${selector}`);
  return getComputedStyle(found, pseudo);
}

/** What a list of cards is laid out as. */
const columns = (drawn: HTMLElement) => ({
  display: styleOf(drawn, ".event-list").display,
  tracks: styleOf(drawn, ".event-list").gridTemplateColumns.split(" ").length,
  same:
    drawn.querySelectorAll(".event-card")[0]?.getBoundingClientRect().height ===
    drawn.querySelectorAll(".event-card")[1]?.getBoundingClientRect().height,
});

test.skipIf(SKIN_DEPTH !== "full")(
  "dossard — une fenêtre a la bande corail de dix pixels d'un dossard, sans lueur, et le coin du thème ; un message est une pastille marine cerclée de soleil, sans repère",
  async () => {
    const seen = await inDossard(
      <>
        <Dialog open title="Une fenêtre" onClose={() => {}}>
          <p>Son contenu</p>
        </Dialog>
        <ToastProvider>
          <Toaster message="Enregistré" />
        </ToastProvider>
      </>,
      (drawn) => ({
        height: styleOf(drawn, ".dialog-band").height,
        band: styleOf(drawn, ".dialog-band").backgroundColor,
        bandImage: styleOf(drawn, ".dialog-band").backgroundImage,
        bandWidth: drawn.querySelector(".dialog-band")?.getBoundingClientRect().width,
        contentWidth: drawn.querySelector(".dialog-content")?.getBoundingClientRect().width,
        glow: styleOf(drawn, ".dialog-glow").display,
        radius: styleOf(drawn, ".dialog").borderTopLeftRadius,
        ring: [styleOf(drawn, ".toast").outlineStyle, styleOf(drawn, ".toast").outlineColor],
        dot: styleOf(drawn, ".toast-dot").display,
      }),
    );
    expect(seen.height).toBe("10px");
    expect(seen.band, "coral").toBe(seen.tokens.coral);
    expect(seen.bandImage, "flat").toBe("none");
    expect(seen.bandWidth, "edge to edge").toBe(seen.contentWidth);
    expect(seen.glow).toBe("none");
    expect(seen.radius).toBe(seen.tokens.radius2xl);
    expect(seen.ring, "a ring of sun round the message").toEqual(["solid", seen.tokens.sun]);
    expect(seen.dot, "no mark in it").toBe("none");
  },
);

/** Shows a message once, as the page would after an action. */
function Toaster({ message }: { message: string }) {
  const toasts = useToast();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    toasts.show(message);
  }, [toasts, message]);
  return null;
}

test.skipIf(SKIN_DEPTH !== "full")(
  "dossard — un champ a un bord de deux pixels, un filtre est une pastille ronde, le bouton d'un fichier est un soleil pâle",
  async () => {
    const seen = await inDossard(
      <>
        <input aria-label="Nom" className={INPUT} />
        <div className="filter-field">
          <select aria-label="Période" className={INPUT}>
            <option>À venir</option>
          </select>
        </div>
        <input aria-label="Trace" type="file" className={INPUT} />
      </>,
      (drawn) => ({
        border: styleOf(drawn, 'input[aria-label="Nom"]').borderTopWidth,
        filterRadius: styleOf(drawn, ".filter-field .field-input").borderTopLeftRadius,
        button: styleOf(drawn, 'input[type="file"]', "::file-selector-button").backgroundColor,
        buttonRadius: styleOf(drawn, 'input[type="file"]', "::file-selector-button")
          .borderTopLeftRadius,
      }),
    );
    expect(seen.border).toBe("2px");
    expect(Number.parseFloat(seen.filterRadius), "a pill").toBeGreaterThan(20);
    expect(seen.button).toBe(seen.tokens.sunSoft);
    expect(Number.parseFloat(seen.buttonRadius), "a pill").toBeGreaterThan(20);
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "dossard — les sections d'une fiche sont des dossards blancs ; une pastille confirmée a l'anneau marine, une non confirmée garde ses tirets ; les initiales ont leur teinte, marine dessus",
  async () => {
    const [rich] = EVENT_SHAPES();
    const runners = rich?.view.formats.flatMap(({ participations }) => participations) ?? [];
    expect(runners.length, "a confirmed and an unconfirmed runner").toBeGreaterThan(1);
    const seen = await inDossard(
      <>
        <section className="event-section card">Une section</section>
        <ParticipantChips participations={runners} />
        <Avatar runner={aliceRunner} thumb="96x96" className="size-11" />
        <Avatar runner={bobRunner} thumb="96x96" className="size-11" />
        <Avatar runner={samRunner} thumb="96x96" className="size-11" />
        <Avatar runner={ninaRunner} thumb="96x96" className="size-11" />
      </>,
      (drawn) => {
        const confirmed = styleOf(drawn, '.chip[data-confirmed="true"]');
        const not = styleOf(drawn, '.chip[data-confirmed="false"]');
        const faces = [...drawn.querySelectorAll(":scope > .avatar")];
        return {
          sectionEdge: styleOf(drawn, ".event-section").borderTopColor,
          sectionShadow: styleOf(drawn, ".event-section").boxShadow,
          ring: [confirmed.borderTopStyle, confirmed.borderTopColor, confirmed.backgroundColor],
          notStyle: not.borderTopStyle,
          faces: faces.map((face) => [
            getComputedStyle(face).backgroundColor,
            getComputedStyle(face).color,
            face.getAttribute("data-tint"),
          ]),
        };
      },
    );
    expect(seen.sectionEdge, "no edge: a white bib with a shadow").toBe("rgba(0, 0, 0, 0)");
    expect(seen.sectionShadow).not.toBe("none");
    expect(seen.ring).toEqual(["solid", seen.tokens.ink, seen.tokens.card]);
    expect(seen.notStyle, "unconfirmed stays dashed").toBe("dashed");
    expect(seen.faces.length, "four runners").toBe(4);
    for (const [ground, ink, tint] of seen.faces) {
      const tinted = seen.tokens.tint[Number(tint) % 4];
      expect(ground, `the tint of ${tint}`).toBe(tinted);
      expect(contrast(hex(ink ?? ""), hex(ground ?? ""))).toBeGreaterThanOrEqual(4.5);
    }
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "dossard — une inscription à faire a son trait corail et son compte à rebours corail, une course son compte à rebours bleu ciel, un résultat son trait de soleil ; l'anneau s'efface",
  async () => {
    const [rich] = EVENT_SHAPES();
    const view = rich?.view;
    if (view === undefined) throw new Error("no event");
    const race = await inDossard(
      <>
        <UpcomingSection views={[view]} runnerId={aliceRunner.id} title="Mes courses" />
        <ul>
          <li className="todo-row card">
            <p className="days-left">dans 3 jours</p>
          </li>
          <li className="result-row card">Un résultat</li>
          <li className="history-row card">Un historique</li>
        </ul>
      </>,
      (drawn) => ({
        sky: [
          styleOf(drawn, ".upcoming-row .days-left").backgroundColor,
          styleOf(drawn, ".upcoming-row .days-left").color,
          styleOf(drawn, ".upcoming-row .days-left").borderTopLeftRadius,
        ],
        coral: [
          styleOf(drawn, ".todo-row .days-left").backgroundColor,
          styleOf(drawn, ".todo-row .days-left").color,
        ],
        todoEdge: [
          styleOf(drawn, ".todo-row").borderLeftWidth,
          styleOf(drawn, ".todo-row").borderLeftColor,
        ],
        resultEdge: styleOf(drawn, ".result-row").borderLeftColor,
        historyEdge: styleOf(drawn, ".history-row").borderLeftColor,
        rings: drawn.querySelectorAll(".countdown-ring, .upcoming-row svg").length,
        words: said(drawn).flat,
      }),
    );
    expect(race.rings, "the ring is gone, the words stay").toBe(0);
    expect(race.words).toMatch(/dans \d+ jours?|aujourd'hui|demain/i);
    expect(race.sky.slice(0, 2), "sky").toEqual([race.tokens.skySoft, race.tokens.skyInk]);
    expect(Number.parseFloat(race.sky[2] ?? "0"), "a pill").toBeGreaterThan(20);
    expect(race.coral, "coral").toEqual([race.tokens.coralSoft, race.tokens.coralInk]);
    expect(race.todoEdge).toEqual(["6px", race.tokens.coral]);
    expect(race.resultEdge, "the sun").toBe(race.tokens.sun);
    expect(race.historyEdge, "the sun").toBe(race.tokens.sun);
    for (const [ink, ground] of [
      [race.sky[1], race.sky[0]],
      [race.coral[1], race.coral[0]],
    ]) {
      expect(contrast(hex(ink ?? ""), hex(ground ?? ""))).toBeGreaterThanOrEqual(4.5);
    }
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "dossard — la carte de la clé est un bloc bleu ciel cerclé de ciel, le rappel est cerné de corail, l'avertissement de doublon est un soleil",
  async () => {
    const seen = await inDossard(
      <>
        <section className="passkey-card">
          <span className="passkey-card-glow" />
        </section>
        <aside className="register-reminder">Penser à s'inscrire</aside>
        <div className="duplicate-hint">Un doublon ?</div>
      </>,
      (drawn) => ({
        key: [
          styleOf(drawn, ".passkey-card").backgroundColor,
          styleOf(drawn, ".passkey-card").boxShadow,
        ],
        glow: styleOf(drawn, ".passkey-card-glow").display,
        reminder: [
          styleOf(drawn, ".register-reminder").borderTopWidth,
          styleOf(drawn, ".register-reminder").borderTopColor,
        ],
        hint: [
          styleOf(drawn, ".duplicate-hint").borderTopColor,
          styleOf(drawn, ".duplicate-hint").backgroundColor,
        ],
      }),
    );
    expect(seen.key[0]).toBe(seen.tokens.skySoft);
    expect(seen.key[1], "a ring of sky").not.toBe("none");
    expect(seen.glow).toBe("none");
    expect(seen.reminder).toEqual(["2px", seen.tokens.coral]);
    expect(seen.hint).toEqual([seen.tokens.sun, seen.tokens.sunSoft]);
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "dossard — les chiffres d'une trace sont une ligne dans la police des titres ; sa carte est sur un tapis blanc de quatre pixels",
  async () => {
    const figures = await inDossard(
      <TrackFigures
        figures={["12,6 km", "724 m D+", "728 m D−"]}
        altitude="altitude 450 m à 1 157 m"
      />,
      (drawn) => ({
        lines: drawn.querySelectorAll(".route-figures").length,
        tiles: drawn.querySelectorAll(".stat-tile").length,
        spoken: plain(drawn.querySelector(".route-figures")?.textContent),
        family: styleOf(drawn, ".route-figures").fontFamily,
        altitude: plain(drawn.querySelector(".route-altitude")?.textContent),
      }),
    );
    expect(figures.tiles, "no tiles").toBe(0);
    expect(figures.lines, "one line").toBe(1);
    expect(figures.spoken).toBe("12,6 km · 724 m D+ · 728 m D−");
    expect(figures.family).toContain("Archivo");
    expect(figures.altitude).toBe("altitude 450 m à 1 157 m");

    const mat = await inDossard(<div className="map-box">La carte</div>, (drawn) => ({
      width: styleOf(drawn, ".map-box").borderTopWidth,
    }));
    expect(mat.width).toBe("4px");
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "dossard — l'agenda cerne aujourd'hui de corail (le jour choisi reste marine), met des repères et des événements bleu ciel",
  async () => {
    const seen = await inDossard(
      <table>
        <tbody>
          <tr>
            <td>
              <button
                type="button"
                className="agenda-day"
                aria-pressed="false"
                aria-current="date"
                aria-label="Aujourd'hui"
              >
                <span className="agenda-day-number border-2 font-bold">1</span>
                <span className="agenda-dots">
                  <span className="agenda-dot" />
                </span>
              </button>
            </td>
            <td>
              <button
                type="button"
                className="agenda-day"
                aria-pressed="true"
                aria-current="date"
                aria-label="Choisi"
              >
                <span className="agenda-day-number border-2 font-bold">2</span>
                <span className="agenda-dots">
                  <span className="agenda-dot" />
                </span>
              </button>
            </td>
            <td>
              <time
                className="agenda-day-number border-2 border-iris-600 bg-iris-600 text-card"
                aria-current="date"
                dateTime="2026-06-01"
              >
                1
              </time>
            </td>
            <td>
              <a href="/x" className="agenda-event">
                Trail
              </a>
            </td>
          </tr>
        </tbody>
      </table>,
      (drawn) => {
        const [today, chosen] = [...drawn.querySelectorAll("button .agenda-day-number")].map((n) =>
          getComputedStyle(n),
        );
        const [dot, chosenDot] = [...drawn.querySelectorAll(".agenda-dot")].map((n) =>
          getComputedStyle(n),
        );
        const desktop = styleOf(drawn, "time.agenda-day-number");
        return {
          ring: today?.borderTopColor ?? "",
          chosenRing: chosen?.borderTopColor ?? "",
          desktop: [desktop.borderTopColor, desktop.backgroundColor],
          dot: dot?.backgroundColor ?? "",
          chosenDot: chosenDot?.backgroundColor ?? "",
          edge: styleOf(drawn, ".agenda-event").borderLeftColor,
          ground: styleOf(drawn, ".agenda-event").backgroundColor,
          ink: styleOf(drawn, ".agenda-event").color,
        };
      },
    );
    expect(seen.ring, "coral").toBe(seen.tokens.coralDeep);
    expect(seen.chosenRing, "on the navy of the chosen day").toBe(seen.tokens.onInk);
    expect(seen.desktop).toEqual([seen.tokens.coralDeep, "rgba(0, 0, 0, 0)"]);
    expect(seen.dot).toBe(seen.tokens.sky);
    expect(seen.chosenDot, "white on the navy of the chosen day").toBe(seen.tokens.onInk);
    expect(seen.edge).toBe(seen.tokens.sky);
    expect(seen.ground).toBe(seen.tokens.skySoft);
    expect(contrast(hex(seen.ink), hex(seen.ground))).toBeGreaterThanOrEqual(4.5);
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "dossard — l'onglet courant de l'admin est une pastille de soleil, l'en-tête des totaux est sous un trait d'encre",
  async () => {
    const seen = await inDossard(
      <>
        <ul className="admin-tabs">
          <li>
            <a href="/a" className="admin-tab" aria-current="page">
              Membres
            </a>
          </li>
          <li>
            <a href="/b" className="admin-tab">
              Types
            </a>
          </li>
        </ul>
        <table>
          <thead className="totals-header">
            <tr>
              <th className="eyebrow">Coureur</th>
            </tr>
          </thead>
        </table>
      </>,
      (drawn) => {
        const [current] = [...drawn.querySelectorAll(".admin-tab")].map((tab) =>
          getComputedStyle(tab),
        );
        return {
          ground: current?.backgroundColor ?? "",
          image: current?.backgroundImage ?? "",
          ink: current?.color ?? "",
          rule: [
            styleOf(drawn, ".totals-header").borderBottomWidth,
            styleOf(drawn, ".totals-header").borderBottomColor,
          ],
        };
      },
    );
    expect(seen.ground).toBe(seen.tokens.sun);
    expect(seen.image).toBe("none");
    expect(contrast(hex(seen.ink), hex(seen.ground))).toBeGreaterThanOrEqual(4.5);
    expect(seen.rule).toEqual(["2px", seen.tokens.ink]);
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "dossard — le titre d'un mois a sa ligne de départ, une liste vide est cadrée en tirets, la carte de connexion a sa bande corail",
  async () => {
    const seen = await inDossard(
      <>
        <h2 className="month-title">Juin 2026</h2>
        <div className="empty-state card">Rien ici</div>
        <main className="relative welcome-card">
          <p>Se connecter</p>
        </main>
      </>,
      (drawn) => ({
        line: styleOf(drawn, ".month-title", "::after").height,
        frame: [
          styleOf(drawn, ".empty-state").borderTopStyle,
          styleOf(drawn, ".empty-state").borderTopWidth,
        ],
        band: styleOf(drawn, ".welcome-card", "::before").backgroundColor,
        bandHeight: styleOf(drawn, ".welcome-card", "::before").height,
        padding: styleOf(drawn, ".welcome-card").paddingTop,
      }),
    );
    expect(seen.line).toBe("2px");
    expect(seen.frame).toEqual(["dashed", "2px"]);
    expect(seen.band).toBe(seen.tokens.coral);
    // The words start under the band.
    expect(Number.parseFloat(seen.padding)).toBeGreaterThan(Number.parseFloat(seen.bandHeight));
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "dossard — les cartes d'une liste vont par deux dès md, une par ligne en dessous",
  async () => {
    const [rich, closed] = EVENT_SHAPES();
    if (rich === undefined || closed === undefined) throw new Error("no events");
    const list = (
      <ul className="event-list flex flex-col gap-3">
        {[rich, closed].map(({ view, what }) => (
          <li key={what}>
            <EventCard view={view} list="upcoming" />
          </li>
        ))}
      </ul>
    );
    await page.viewport(1024, 800);
    const wide = await inDossard(list, columns);
    expect(wide.display).toBe("grid");
    expect(wide.tracks).toBe(2);
    expect(wide.same, "the two bibs of a row are as tall").toBe(true);
    await page.viewport(414, 896);
    expect((await inDossard(list, columns)).display, "one by one on a phone").toBe("flex");
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "dossard — l'événement du jour affiche toujours le grand numéro et l'échéance du dossard, sans anneau",
  async () => {
    const [rich] = EVENT_SHAPES();
    if (rich === undefined) throw new Error("no event");
    const heading = { id: "t", "data-focus": "title", tabIndex: -1 } as const;
    const seen = await inDossard(<EventHero view={rich.view} heading={heading} />, (drawn) => ({
      rings: drawn.querySelectorAll(".countdown-ring, .ring-draw").length,
      number: drawn.querySelector(".bib-number")?.textContent,
      band: drawn.querySelectorAll(".bib-band").length,
    }));
    expect(seen.rings, "no ring in the hero at full depth").toBe(0);
    expect(seen.number).toBe("13");
    expect(seen.band).toBe(1);
  },
);
