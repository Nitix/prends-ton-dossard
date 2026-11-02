import { createElement, useEffect, useRef, type ReactNode } from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { page } from "vitest/browser";

import { SKIN_DEPTH, variantOf } from "..";
import { Avatar } from "../../components/Avatar";
import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { INPUT } from "../../components/Field";
import { ToastProvider, useToast } from "../../components/Toast";
import { EventCard } from "../../features/events/EventCard";
import { EventHero } from "../../features/events/EventHero";
import { formatMeasures } from "../../features/events/formatName";
import { FormatTitle } from "../../features/events/FormatTitle";
import { deadlineText, registrationState } from "../../features/events/registration";
import { aliceRunner } from "../../features/events/testFixture";
import { UpcomingSection } from "../../features/home/MyUpcoming";
import { TrackFigures } from "../../features/route/TrackFigures";
import { fr } from "../../i18n/fr";
import { daysBetween } from "../../lib/dates";
import { createFormatters } from "../../lib/format";
import { ensureTemporal } from "../../lib/temporal";
import { contrast } from "../../test/colour";
import { colourOf, rgbaOf } from "../../test/computed";
import { resetMedia } from "../../test/media";
import { EVENT_SHAPES, hex, inApp, plain, said } from "../../test/variant";

import "../../styles.css";
import "../../skins/styles";

// « Piste », depth full: the pieces that its variant dressed beyond the ones of
// mix (a window, a message, the buttons, the reminder and the card of the key,
// the days left as a bib, the route, the agenda, the totals, the avatars, the
// lists of cards) take the tokens of the palette, and the markup of its hero,
// of the title of a format, of the figures of a track and of the ring of the
// days left keeps what Crête's says (the shared feature test,
// skins/variants.test.tsx, holds every shape of event to it). Below the depth
// of full the sheet and the variants are not in the build.

vi.mock("../../lib/pb", async () => (await import("../../test/pbMock")).pbModule);

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(async () => {
  await resetMedia();
  await page.viewport(414, 896);
});

/** A length of the theme (`--radius-lg`…) as the browser computes it, for a border radius. */
function radiusOf(property: string): string {
  const probe = document.createElement("span");
  probe.style.borderTopLeftRadius = `var(${property})`;
  document.body.append(probe);
  const radius = getComputedStyle(probe).borderTopLeftRadius;
  probe.remove();
  return radius;
}

/** The tokens of the palette a test compares with, read while Piste is on the page. */
function tokens() {
  return {
    red: colourOf("--color-iris-500"),
    redBright: colourOf("--color-iris-400"),
    redPale: colourOf("--color-iris-50"),
    pale: colourOf("--color-neutral-100"),
    lane: colourOf("--color-neutral-300"),
    redDeep: colourOf("--color-iris-700"),
    ink: colourOf("--color-neutral-900"),
    cream: colourOf("--color-neutral-50"),
    info: colourOf("--map-start"),
    onInk: colourOf("--dawn-deep-ink"),
    radiusLg: radiusOf("--radius-lg"),
    radiusXl: radiusOf("--radius-xl"),
    radius2xl: radiusOf("--radius-2xl"),
  };
}

/**
 * Brings every transition and animation under `root` to its end (an endless one
 * is left), so that a colour or a shadow is read where it ends and not in the
 * middle of a fade: a piece just drawn may still be fading in from the page it
 * was drawn on.
 */
function settle(root: Element) {
  for (const animation of root.getAnimations({ subtree: true })) {
    if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish();
  }
}

/** What `look` makes of a piece in Piste, in the app, with the tokens of its palette (`tokens`), read once it has settled. */
function inPiste<T extends object>(
  element: ReactNode,
  look: (drawn: HTMLElement) => T,
  options: { today?: string } = {},
) {
  return inApp(
    element,
    (drawn) => {
      settle(drawn);
      return { ...look(drawn), tokens: tokens() };
    },
    {
      skin: "piste",
      ...options,
    },
  );
}

/** The computed style of what a piece drew, found by its selector (and its pseudo-element). */
function styleOf(drawn: ParentNode, selector: string, pseudo?: string): CSSStyleDeclaration {
  const found = drawn.querySelector(selector);
  if (found === null) throw new Error(`nothing drawn for ${selector}`);
  return getComputedStyle(found, pseudo);
}

/** A computed colour as `rgb(r, g, b)`, once laid over the white of a card if it is translucent. */
function onWhite(colour: string): string {
  const [r, g, b, a] = rgbaOf(colour);
  const over = (channel: number) => Math.round(channel * a + 255 * (1 - a));
  return `rgb(${over(r)}, ${over(g)}, ${over(b)})`;
}

const f = createFormatters("fr-FR");

/** What a list of cards is laid out as. */
const columns = (drawn: HTMLElement) => ({
  display: styleOf(drawn, ".event-list").display,
  tracks: styleOf(drawn, ".event-list").gridTemplateColumns.split(" ").length,
  same:
    drawn.querySelectorAll(".event-card")[0]?.getBoundingClientRect().height ===
    drawn.querySelectorAll(".event-card")[1]?.getBoundingClientRect().height,
});

test.skipIf(SKIN_DEPTH !== "full")(
  "piste — une fenêtre a le trait rouge de la piste sur toute sa largeur, sans lueur, et le coin du thème",
  async () => {
    const seen = await inPiste(
      <Dialog open title="Une fenêtre" onClose={() => {}}>
        <p>Son contenu</p>
      </Dialog>,
      (drawn) => ({
        band: styleOf(drawn, ".dialog-band"),
        bandWidth: drawn.querySelector(".dialog-band")?.getBoundingClientRect().width,
        contentWidth: drawn.querySelector(".dialog-content")?.getBoundingClientRect().width,
        height: styleOf(drawn, ".dialog-band").height,
        paint: styleOf(drawn, ".dialog-band").backgroundImage,
        glow: styleOf(drawn, ".dialog-glow").display,
        radius: styleOf(drawn, ".dialog").borderTopLeftRadius,
      }),
    );
    expect(seen.height, "5 px of the track red").toBe("5px");
    expect(seen.paint).toContain("linear-gradient");
    expect(seen.bandWidth, "from edge to edge of the window").toBe(seen.contentWidth);
    expect(seen.glow, "no glow of dawn").toBe("none");
    expect(seen.radius).toBe(seen.tokens.radius2xl);
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
  "piste — un message n'est plus une pastille, son repère est un trait penché du rouge de la piste ; champs et boutons ont le coin du thème",
  async () => {
    const seen = await inPiste(
      <>
        <ToastProvider>
          <Toaster message="Enregistré" />
        </ToastProvider>
        <input aria-label="Nom" className={INPUT} />
        <button type="button" className={PRIMARY}>
          Envoyer
        </button>
        <button type="button" className={SECONDARY}>
          Annuler
        </button>
      </>,
      (drawn) => {
        const [primary, secondary] = [...drawn.querySelectorAll("button")];
        return {
          toastRadius: styleOf(drawn, ".toast").borderTopLeftRadius,
          markTransform: styleOf(drawn, ".toast-dot").transform,
          markWidth: styleOf(drawn, ".toast-dot").width,
          markHeight: styleOf(drawn, ".toast-dot").height,
          markGround: styleOf(drawn, ".toast-dot").backgroundColor,
          field: styleOf(drawn, ".field-input").borderTopLeftRadius,
          primary: getComputedStyle(primary ?? drawn).borderTopLeftRadius,
          secondary: getComputedStyle(secondary ?? drawn).borderTopLeftRadius,
        };
      },
    );
    expect(seen.toastRadius).toBe(seen.tokens.radiusXl);
    expect(seen.markTransform, "skewed").toMatch(/^matrix\(/);
    expect(Number.parseFloat(seen.markWidth)).toBeLessThan(Number.parseFloat(seen.markHeight));
    expect(seen.markGround).toBe(seen.tokens.redBright);
    expect(seen.field).toBe(seen.tokens.radiusLg);
    expect(seen.primary, "no pill").toBe(seen.tokens.radiusLg);
    expect(seen.secondary).toBe(seen.tokens.radiusLg);
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "piste — le rappel d'inscription a le bord rouge de la piste ; la carte de la clé est un bloc d'information bleu (le titre s'y lit, 4,5:1)",
  async () => {
    const seen = await inPiste(
      <>
        <aside className="register-reminder">
          <p>Pense à t'inscrire</p>
        </aside>
        <section className="passkey-card">
          <span className="passkey-card-glow" />
          <h2 className="passkey-card-title card-title">Une clé</h2>
        </section>
      </>,
      (drawn) => ({
        reminderEdge: [
          styleOf(drawn, ".register-reminder").borderLeftWidth,
          styleOf(drawn, ".register-reminder").borderLeftColor,
        ],
        keyEdge: [
          styleOf(drawn, ".passkey-card").borderLeftWidth,
          styleOf(drawn, ".passkey-card").borderLeftColor,
        ],
        keyGround: styleOf(drawn, ".passkey-card").backgroundColor,
        keyTitle: styleOf(drawn, ".passkey-card-title").color,
        glow: styleOf(drawn, ".passkey-card-glow").display,
      }),
    );
    expect(seen.reminderEdge).toEqual(["4px", seen.tokens.red]);
    expect(seen.keyEdge).toEqual(["4px", seen.tokens.info]);
    expect(seen.glow).toBe("none");
    expect(
      contrast(hex(onWhite(seen.keyTitle)), hex(onWhite(seen.keyGround))),
      "the title on the blue block",
    ).toBeGreaterThanOrEqual(4.5);
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "piste — le titre d'un format a ses mesures en pastilles (grandes), tous ses mots dans l'ordre, séparateurs lus",
  async () => {
    for (const { what, view } of EVENT_SHAPES()) {
      for (const formatView of view.formats) {
        const parts = formatMeasures(formatView.format, formatView.raceType.label, f, fr);
        const seen = await inPiste(
          <h2 className="block-title section-title">
            <FormatTitle formatView={formatView} parts={parts} />
          </h2>,
          (drawn) => {
            const chips = [...drawn.querySelectorAll(".format-measure")];
            return {
              chips: chips.length,
              spoken: said(drawn).flat,
              ground: chips[0] === undefined ? "" : getComputedStyle(chips[0]).backgroundColor,
              name: drawn.querySelector(".format-name")?.textContent,
              size: chips[0] === undefined ? "" : getComputedStyle(chips[0]).fontSize,
            };
          },
        );
        const where = `${what}, ${formatView.format.id}`;
        expect(seen.name, `the name, ${where}`).toBe(parts[0]);
        expect(seen.chips, `a chip for each measure, ${where}`).toBe(parts.length - 1);
        expect(seen.spoken, `the words of the title, ${where}`).toBe(plain(parts.join(" · ")));
        const withChips = parts.length > 1;
        expect(seen.ground, `a chip, ${where}`).toBe(withChips ? seen.tokens.pale : "");
        expect(Number.parseFloat(seen.size || "0") >= 16, `a big chip, ${where}`).toBe(withChips);
      }
    }
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "piste — « dans 9 jours » est un dossard (capitales, fond rouge pâle, 4,5:1) et l'anneau s'efface",
  async () => {
    const [rich] = EVENT_SHAPES();
    const view = rich?.view;
    if (view === undefined) throw new Error("no event");
    const race = await inPiste(
      <UpcomingSection views={[view]} runnerId={aliceRunner.id} title="Mes courses" />,
      (drawn) => ({
        tag: getComputedStyle(drawn.querySelector(".upcoming-row .days-left") ?? drawn),
        ground: styleOf(drawn, ".upcoming-row .days-left").backgroundColor,
        ink: styleOf(drawn, ".upcoming-row .days-left").color,
        transform: styleOf(drawn, ".upcoming-row .days-left").textTransform,
        radius: styleOf(drawn, ".upcoming-row .days-left").borderTopLeftRadius,
        rings: drawn.querySelectorAll(".countdown-ring, .upcoming-row svg").length,
        words: said(drawn).flat,
      }),
    );
    expect(race.rings, "the ring is gone, the words stay").toBe(0);
    expect(race.words).toMatch(/dans \d+ jours?|aujourd'hui|demain/i);
    expect(race.transform).toBe("uppercase");
    expect(race.ground).toBe(race.tokens.redPale);
    expect(race.radius, "a tag, not a pill").toBe("6px");
    expect(contrast(hex(race.ink), hex(race.ground))).toBeGreaterThanOrEqual(4.5);
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "piste — sous le parcours, les chiffres sont une ligne de grands chiffres et le profil est sur un panneau crème",
  async () => {
    const figures = await inPiste(
      <TrackFigures
        figures={["12,6 km", "724 m D+", "728 m D−"]}
        altitude="altitude 450 m à 1 157 m"
      />,
      (drawn) => ({
        lines: drawn.querySelectorAll(".route-figures").length,
        tiles: drawn.querySelectorAll(".stat-tile").length,
        spoken: plain(drawn.querySelector(".route-figures")?.textContent),
        size: styleOf(drawn, ".route-figures").fontSize,
        altitude: plain(drawn.querySelector(".route-altitude")?.textContent),
      }),
    );
    expect(figures.tiles, "no tiles").toBe(0);
    expect(figures.lines, "one line").toBe(1);
    expect(figures.spoken).toBe("12,6 km · 724 m D+ · 728 m D−");
    expect(Number.parseFloat(figures.size), "big").toBeGreaterThanOrEqual(24);
    expect(figures.altitude).toBe("altitude 450 m à 1 157 m");

    const panel = await inPiste(
      <div className="route-section">
        <h3 className="route-title card-title">Parcours</h3>
        <div className="elevation-profile" />
      </div>,
      (drawn) => ({
        ground: styleOf(drawn, ".elevation-profile").backgroundColor,
        radius: styleOf(drawn, ".elevation-profile").borderTopLeftRadius,
        title: styleOf(drawn, ".route-title").textTransform,
      }),
    );
    expect(panel.ground, "the cream of the page").toBe(panel.tokens.cream);
    expect(panel.radius).toBe(panel.tokens.radiusXl);
    expect(panel.title, "a label in capitals").toBe("uppercase");
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "piste — l'agenda cerne aujourd'hui de rouge, penche ses repères, borde ses événements de rouge",
  async () => {
    const seen = await inPiste(
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
              <button type="button" className="agenda-day" aria-pressed="false" aria-label="Demain">
                <span className="agenda-day-number border-2 border-transparent">2</span>
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
        const [today, other] = [...drawn.querySelectorAll("button .agenda-day-number")].map((n) =>
          getComputedStyle(n),
        );
        const desktop = styleOf(drawn, "time.agenda-day-number");
        return {
          ring: today?.borderTopColor ?? "",
          otherRing: other?.borderTopColor ?? "",
          filled: desktop.backgroundColor,
          desktopRing: desktop.borderTopColor,
          dot: styleOf(drawn, ".agenda-dot").transform,
          dotGround: styleOf(drawn, ".agenda-dot").backgroundColor,
          edge: styleOf(drawn, ".agenda-event").borderLeftColor,
          edgeWidth: styleOf(drawn, ".agenda-event").borderLeftWidth,
          ground: styleOf(drawn, ".agenda-event").backgroundColor,
        };
      },
    );
    expect(seen.ring, "today is ringed in red").toBe(seen.tokens.red);
    expect(seen.otherRing, "another day is not").toBe("rgba(0, 0, 0, 0)");
    expect(seen.desktopRing).toBe(seen.tokens.red);
    expect(seen.filled, "ringed, not filled").toBe("rgba(0, 0, 0, 0)");
    expect(seen.dot, "a skewed mark").toMatch(/^matrix\(/);
    expect(seen.dotGround).toBe(seen.tokens.red);
    expect(seen.edge).toBe(seen.tokens.red);
    expect(seen.edgeWidth).toBe("3px");
    expect(seen.ground).toBe(seen.tokens.redPale);
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "piste — le tableau des totaux a un en-tête d'encre en capitales ; un résultat est un chiffre ; la coche du menu n'a pas de disque ; les initiales sont sur l'encre",
  async () => {
    const seen = await inPiste(
      <>
        <table>
          <thead className="totals-header">
            <tr>
              <th className="eyebrow">Coureur</th>
            </tr>
          </thead>
        </table>
        <p className="result-tag">1 h 02 min</p>
        <span className="menu-check">✓</span>
        <Avatar runner={aliceRunner} thumb="96x96" className="size-11" />
      </>,
      (drawn) => ({
        head: styleOf(drawn, ".totals-header").backgroundColor,
        headInk: styleOf(drawn, ".totals-header .eyebrow").color,
        tag: styleOf(drawn, ".result-tag").backgroundColor,
        tagFont: styleOf(drawn, ".result-tag").fontFamily,
        check: styleOf(drawn, ".menu-check").backgroundImage,
        initials: styleOf(drawn, ".avatar").backgroundColor,
        initialsInk: styleOf(drawn, ".avatar").color,
      }),
    );
    expect(seen.head).toBe(seen.tokens.ink);
    expect(contrast(hex(seen.headInk), hex(seen.head))).toBeGreaterThanOrEqual(4.5);
    expect(seen.tag, "a figure, not a pill").toBe("rgba(0, 0, 0, 0)");
    expect(seen.tagFont).toContain("Barlow Condensed");
    expect(seen.check, "no disc under the check").toBe("none");
    expect(seen.initials).toBe(seen.tokens.ink);
    expect(contrast(hex(seen.initialsInk), hex(seen.initials))).toBeGreaterThanOrEqual(4.5);
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "piste — les cartes d'une liste vont par deux dès md, une par ligne en dessous",
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
    const wide = await inPiste(list, columns);
    expect(wide.display).toBe("grid");
    expect(wide.tracks).toBe(2);
    expect(wide.same, "the two cards of a row are as tall").toBe(true);
    await page.viewport(414, 896);
    expect((await inPiste(list, columns)).display, "one by one on a phone").toBe("flex");
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "piste — le haut d'une fiche est une bande d'encre : le numéro de couloir à côté du titre (dès sm), qui reste le premier de la page, sans anneau, l'échéance en une phrase",
  async () => {
    const Band = variantOf("piste", "EventHero");
    if (Band === undefined) throw new Error("Piste has no event hero at full depth");
    const heading = { id: "hero-title", "data-focus": "title", tabIndex: -1 } as const;
    for (const { what, view, today } of EVENT_SHAPES()) {
      const seen = await inPiste(
        createElement(EventHero, { view, heading }),
        (drawn) => {
          const hero = drawn.querySelector(".event-hero");
          const title = drawn.querySelector("h1");
          const dates = drawn.querySelector(".event-hero-dates");
          const chip = drawn.querySelector(".date-chip");
          const deadline = drawn.querySelector(".event-hero-deadline");
          const days = drawn.querySelector(".event-hero .days-left");
          return {
            days: plain(days?.textContent),
            daysTag: days === null ? "" : getComputedStyle(days).backgroundColor,
            outer: drawn.firstElementChild === hero,
            ground: hero === null ? "" : getComputedStyle(hero).backgroundColor,
            title: [title?.id, title?.dataset.focus, title?.tabIndex],
            headings: drawn.querySelectorAll("h1").length,
            titleFirst:
              title !== null &&
              dates !== null &&
              Boolean(title.compareDocumentPosition(dates) & Node.DOCUMENT_POSITION_FOLLOWING),
            chipBeside:
              chip !== null &&
              title !== null &&
              chip.getBoundingClientRect().right <= title.getBoundingClientRect().left,
            chipShown: chip !== null && chip.checkVisibility(),
            rings: drawn.querySelectorAll(".ring-draw").length,
            deadline: plain(deadline?.textContent),
          };
        },
        { today },
      );
      expect(seen.outer, `the hero is the piece, ${what}`).toBe(true);
      expect(seen.ground, `a flat band of ink, ${what}`).toBe(seen.tokens.ink);
      expect(seen.title, `what the page gives its title, ${what}`).toEqual([
        "hero-title",
        "title",
        -1,
      ]);
      expect(seen.headings, `one title, ${what}`).toBe(1);
      expect(seen.titleFirst, `the title comes first in the page, ${what}`).toBe(true);
      expect(seen.rings, `no ring, ${what}`).toBe(0);
      const state = registrationState(view.event, Temporal.PlainDate.from(today ?? "2026-06-01"));
      const sentence = state === null ? "" : deadlineText(state, f, fr);
      expect(seen.deadline, `the deadline, ${what}`).toBe(sentence);
      // The days left before the event, in words, as a bib (Crête shows them in a ring, which this band has not),
      // and nothing once the event is under way.
      const ahead = daysBetween(Temporal.PlainDate.from(today ?? "2026-06-01"), view.start);
      expect(seen.days, `the days left, ${what}`).toBe(ahead > 0 ? plain(f.inDays(ahead)) : "");
      expect(seen.daysTag, `as a bib, ${what}`).toBe(ahead > 0 ? seen.tokens.redPale : "");
      // On a phone the date is written large in the band: no number of a lane there.
      expect(seen.chipShown, `no number of a lane on a phone, ${what}`).toBe(false);
    }
    await page.viewport(800, 900);
    const [rich] = EVENT_SHAPES();
    if (rich === undefined) throw new Error("no event");
    const wide = await inPiste(createElement(EventHero, { view: rich.view, heading }), (drawn) => {
      const chip = drawn.querySelector(".date-chip");
      const title = drawn.querySelector("h1");
      return {
        shown: chip?.checkVisibility(),
        beside:
          chip !== null &&
          title !== null &&
          chip.getBoundingClientRect().right <= title.getBoundingClientRect().left,
      };
    });
    expect(wide.shown, "the number of a lane from sm").toBe(true);
    expect(wide.beside, "beside the title").toBe(true);
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "piste — une liste vide est cadrée en tirets, comme dans la variante, ses mots à gauche sous le damier",
  async () => {
    const seen = await inPiste(
      <div className="empty-state card flex flex-col items-center text-center">
        <span aria-hidden="true">damier</span>
        <p className="card-title">Rien ici</p>
      </div>,
      (drawn) => ({
        frame: [
          styleOf(drawn, ".empty-state").borderTopStyle,
          styleOf(drawn, ".empty-state").borderTopWidth,
        ],
        edge: styleOf(drawn, ".empty-state").borderTopColor,
        align: [
          styleOf(drawn, ".empty-state").alignItems,
          styleOf(drawn, ".empty-state").textAlign,
        ],
        shadow: styleOf(drawn, ".empty-state").boxShadow,
      }),
    );
    expect(seen.frame).toEqual(["dashed", "2px"]);
    expect(seen.edge, "the lane lines' colour").toBe(seen.tokens.lane);
    expect(seen.align, "to the left").toEqual(["flex-start", "start"]);
    expect(seen.shadow, "a frame, not a card").toBe("none");
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "piste — ce que le test lit est le bout d'une transition, pas son milieu (le test de l'agenda a lu une couleur en plein fondu)",
  () => {
    const probe = document.createElement("p");
    probe.style.cssText = "transition: color 10s linear; color: rgb(255, 0, 0)";
    document.body.append(probe);
    try {
      expect(getComputedStyle(probe).color).toBe("rgb(255, 0, 0)");
      probe.style.color = "rgb(0, 0, 255)";
      // Read at once, the colour is still where the fade began.
      expect(getComputedStyle(probe).color, "mid-fade").not.toBe("rgb(0, 0, 255)");
      settle(probe);
      expect(getComputedStyle(probe).color, "settled").toBe("rgb(0, 0, 255)");
    } finally {
      probe.remove();
    }
  },
);
