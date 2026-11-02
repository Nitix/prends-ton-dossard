import { createElement, useEffect, useRef, type ReactNode } from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { page } from "vitest/browser";

import { SKIN_DEPTH, chooseSkin, variantOf } from "..";
import { Dialog } from "../../components/Dialog";
import { INPUT } from "../../components/Field";
import { OfflineBanner } from "../../components/OfflineBanner";
import { ToastProvider, useToast } from "../../components/Toast";
import { EventCard } from "../../features/events/EventCard";
import { EventHero } from "../../features/events/EventHero";
import { ParticipantChips } from "../../features/events/ParticipantChips";
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

// « Nuit », depth full: the pieces that its variant dressed beyond the ones of
// mix (a window, a message, a field, the chips, the rows of the home page, the
// card of the key, the route, the agenda, the admin) take the tokens of the
// palette, and the markup of its hero, of the figures of a track and of the
// ring of the days left keeps what Crête's says (the shared feature test,
// skins/variants.test.tsx, holds every shape of event to it). Below the depth
// of full the sheet and the variants are not in the build.

vi.mock("../../lib/pb", async () => (await import("../../test/pbMock")).pbModule);

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(async () => {
  vi.restoreAllMocks();
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

/** The tokens of the palette a test compares with, read while Nuit is on the page. */
function tokens() {
  return {
    lime: colourOf("--color-iris-600"),
    cyan: colourOf("--color-blush-500"),
    coral: colourOf("--color-red-700"),
    night: colourOf("--color-neutral-50"),
    hairline: colourOf("--color-neutral-200"),
    ring: colourOf("--color-neutral-700"),
    card: colourOf("--color-card"),
    raised: colourOf("--color-raised"),
    toast: colourOf("--color-toast"),
    onLime: colourOf("--dawn-deep-ink"),
    glow: colourOf("--dawn-glow-warm"),
    focusGlow: colourOf("--focus-glow"),
    radiusLg: radiusOf("--radius-lg"),
    radiusXl: radiusOf("--radius-xl"),
  };
}

/** What `look` makes of a piece in Nuit, in the app, with the tokens of its palette (`tokens`). */
function inNuit<T extends object>(
  element: ReactNode,
  look: (drawn: HTMLElement) => T,
  options: { today?: string } = {},
) {
  return inApp(element, (drawn) => ({ ...look(drawn), tokens: tokens() }), {
    skin: "nuit",
    ...options,
  });
}

/** The computed style of what a piece drew, found by its selector (and its pseudo-element). */
function styleOf(drawn: ParentNode, selector: string, pseudo?: string): CSSStyleDeclaration {
  const found = drawn.querySelector(selector);
  if (found === null) throw new Error(`nothing drawn for ${selector}`);
  return getComputedStyle(found, pseudo);
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
  "nuit — une fenêtre a un filet, la lueur d'un phare sur toute sa hauteur, pas de bande, une fermeture sans fond",
  async () => {
    const seen = await inNuit(
      <Dialog open title="Une fenêtre" onClose={() => {}}>
        <p>Son contenu</p>
      </Dialog>,
      (drawn) => ({
        edge: styleOf(drawn, ".dialog").borderTopColor,
        ground: styleOf(drawn, ".dialog").backgroundColor,
        lamp: styleOf(drawn, ".dialog-glow").backgroundImage,
        glowHeight: drawn.querySelector(".dialog-glow")?.getBoundingClientRect().height,
        contentHeight: drawn.querySelector(".dialog-content")?.getBoundingClientRect().height,
        band: styleOf(drawn, ".dialog-band").display,
        closeGround: styleOf(drawn, ".dialog-close").backgroundColor,
        closeShadow: styleOf(drawn, ".dialog-close").boxShadow,
      }),
    );
    expect(seen.edge, "the hairline").toBe(seen.tokens.hairline);
    expect(seen.ground, "the surface").toBe(seen.tokens.card);
    expect(seen.lamp, "a cone of light").toContain("radial-gradient");
    expect(seen.glowHeight, "it lights the whole window").toBe(seen.contentHeight);
    expect(seen.band, "no band of dawn").toBe("none");
    expect(seen.closeGround, "the close button has no ground").toBe("rgba(0, 0, 0, 0)");
    expect(seen.closeShadow, "nor a shadow").toBe("none");
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
  "nuit — un message est une vitre aux coins du thème, sa pastille lime luit ; la bande hors ligne est cyan",
  async () => {
    const toast = await inNuit(
      <ToastProvider>
        <Toaster message="Enregistré" />
      </ToastProvider>,
      (drawn) => ({
        radius: styleOf(drawn, ".toast").borderTopLeftRadius,
        glass: styleOf(drawn, ".toast").backdropFilter,
        ink: styleOf(drawn, ".toast").color,
        dot: styleOf(drawn, ".toast-dot").backgroundColor,
        glow: styleOf(drawn, ".toast-dot").boxShadow,
      }),
    );
    expect(toast.radius, "no pill any more").toBe(toast.tokens.radiusXl);
    expect(toast.glass).toContain("blur");
    expect(contrast(hex(toast.ink), hex(toast.tokens.toast))).toBeGreaterThanOrEqual(4.5);
    expect(toast.dot).toBe(toast.tokens.lime);
    expect(toast.glow, "the dot lights").toContain(toast.tokens.glow);

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const banner = await inNuit(<OfflineBanner />, (drawn) => ({
      ground: styleOf(drawn, ".offline-banner").backgroundColor,
      edge: styleOf(drawn, ".offline-banner").borderBottomColor,
      ink: styleOf(drawn, ".offline-banner").color,
    }));
    // The cyan of the information over the night, with the words of the page on it.
    const [red, green, blue, alpha] = rgbaOf(banner.ground);
    expect(alpha, "a ground, not a hole").toBeGreaterThan(0.9);
    expect(blue, "a ground that leans to cyan").toBeGreaterThan(red);
    expect(green).toBeGreaterThan(red);
    expect(banner.edge).not.toBe("rgba(0, 0, 0, 0)");
    const ground = `rgb(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)})`;
    expect(contrast(hex(banner.ink), hex(ground))).toBeGreaterThanOrEqual(4.5);
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "nuit — un champ a le coin du thème, un bord coral quand il est refusé, et garde le halo de son focus",
  async () => {
    const seen = await inNuit(
      <>
        <input aria-label="Nom" className={INPUT} />
        <input aria-label="Refusé" aria-invalid="true" className={INPUT} />
      </>,
      (drawn) => {
        const [calm, refused] = [...drawn.querySelectorAll("input")];
        const rest = getComputedStyle(calm ?? drawn);
        const invalid = getComputedStyle(refused ?? drawn);
        const at = {
          radius: rest.borderTopLeftRadius,
          shadow: rest.boxShadow,
          invalid: invalid.borderTopColor,
        };
        // The field fades its halo in: read it where it ends, not in the middle of the fade.
        if (calm) calm.style.transition = "none";
        calm?.focus();
        return { ...at, focusShadow: getComputedStyle(calm ?? drawn).boxShadow };
      },
    );
    expect(seen.radius).toBe(seen.tokens.radiusLg);
    expect(seen.shadow, "no inset shadow at rest").toBe("none");
    expect(seen.invalid, "coral when refused").toBe(seen.tokens.coral);
    expect(seen.focusShadow, "the halo of the focus stays").toContain(seen.tokens.focusGlow);
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "nuit — les pastilles de coureurs ont l'anneau sombre : plein et clair si confirmé, en tirets sinon",
  async () => {
    const [rich] = EVENT_SHAPES();
    const runners = rich?.view.formats.flatMap(({ participations }) => participations) ?? [];
    expect(runners.length, "a confirmed and an unconfirmed runner").toBeGreaterThan(1);
    const seen = await inNuit(<ParticipantChips participations={runners} />, (drawn) => {
      const confirmed = getComputedStyle(
        drawn.querySelector('.chip[data-confirmed="true"]') ?? drawn,
      );
      const not = getComputedStyle(drawn.querySelector('.chip[data-confirmed="false"]') ?? drawn);
      return {
        confirmedPaint: confirmed.backgroundImage,
        confirmedRing: [confirmed.borderTopStyle, confirmed.borderTopColor],
        notStyle: not.borderTopStyle,
        notGround: not.backgroundColor,
      };
    });
    expect(seen.confirmedPaint, "no lime pill").toBe("none");
    expect(seen.confirmedRing).toEqual(["solid", seen.tokens.ring]);
    expect(seen.notStyle, "unconfirmed stays dashed").toBe("dashed");
    expect(seen.notGround, "a dark ring on both").toBe(seen.tokens.night);
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "nuit — les jours qui restent sont une pastille lime sur une course, cyan pour une inscription, et l'anneau s'efface",
  async () => {
    const [rich] = EVENT_SHAPES();
    const view = rich?.view;
    if (view === undefined) throw new Error("no event");
    const race = await inNuit(
      <UpcomingSection views={[view]} runnerId={aliceRunner.id} title="Mes courses" />,
      (drawn) => ({
        round: styleOf(drawn, ".upcoming-row .days-left").borderTopLeftRadius,
        ink: styleOf(drawn, ".upcoming-row .days-left").color,
        rings: drawn.querySelectorAll(".countdown-ring, .upcoming-row svg").length,
        words: said(drawn).flat,
      }),
    );
    expect(race.rings, "the ring is gone, the words stay").toBe(0);
    expect(race.words).toMatch(/dans \d+ jours?|aujourd'hui|demain/i);
    expect(race.ink, "lime").toBe(race.tokens.lime);
    expect(Number.parseFloat(race.round), "a pill").toBeGreaterThan(20);

    const todo = await inNuit(
      <ul className="race-list">
        <li className="todo-row card">
          <div className="todo-countdown">
            <p className="days-left">dans 3 jours</p>
          </div>
        </li>
      </ul>,
      (drawn) => ({ ink: styleOf(drawn, ".todo-row .days-left").color }),
    );
    expect(todo.ink, "cyan").toBe(todo.tokens.cyan);
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "nuit — la carte de la clé est sous la lueur d'un phare, cernée de lime, sans sa tache de lumière",
  async () => {
    const seen = await inNuit(
      <section className="passkey-card">
        <span className="passkey-card-glow" />
        <h2 className="passkey-card-title">Une clé</h2>
      </section>,
      (drawn) => ({
        lamp: styleOf(drawn, ".passkey-card").backgroundImage,
        edge: styleOf(drawn, ".passkey-card").boxShadow,
        glow: styleOf(drawn, ".passkey-card-glow").display,
      }),
    );
    expect(seen.lamp).toContain("radial-gradient");
    expect(seen.edge, "a line round the card, inside it").toContain("inset");
    expect(seen.glow).toBe("none");
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "nuit — sous le parcours, les tirets d'une route ; les chiffres sont une seule ligne dans la police des titres",
  async () => {
    const route = await inNuit(
      <div className="route-section">
        <h3 className="route-title">Parcours</h3>
      </div>,
      (drawn) => ({
        dashes: styleOf(drawn, ".route-section", "::before").backgroundImage,
        rule: styleOf(drawn, ".route-section").borderTopWidth,
      }),
    );
    expect(route.dashes).toContain("repeating-linear-gradient");
    expect(route.rule, "no rule under it: the dashes are its edge").toBe("0px");

    const figures = await inNuit(
      <TrackFigures
        figures={["12,6 km", "724 m D+", "728 m D−"]}
        altitude="altitude 450 m à 1 157 m"
      />,
      (drawn) => ({
        lines: drawn.querySelectorAll(".route-figures").length,
        tiles: drawn.querySelectorAll(".stat-tile").length,
        spoken: plain(drawn.querySelector(".route-figures")?.textContent),
        dots: [...drawn.querySelectorAll(".route-figures span")]
          .filter((dot) => plain(dot.textContent) === "·")
          .map((dot) => getComputedStyle(dot).color),
        family: styleOf(drawn, ".route-figures").fontFamily,
        altitude: plain(drawn.querySelector(".route-altitude")?.textContent),
      }),
    );
    expect(figures.tiles, "no tiles").toBe(0);
    expect(figures.lines, "one line").toBe(1);
    expect(figures.spoken).toBe("12,6 km · 724 m D+ · 728 m D−");
    // The « · » between the figures are text, not decoration: 4.5:1 on the card and on the page.
    expect(figures.dots.length, "a separator between two figures, twice").toBe(2);
    for (const ink of figures.dots) {
      expect(contrast(hex(ink), hex(figures.tokens.card)), "on the card").toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(hex(ink), hex(figures.tokens.night)), "on the page").toBeGreaterThanOrEqual(
        4.5,
      );
    }
    expect(figures.family).toContain("Space Grotesk");
    expect(figures.altitude).toBe("altitude 450 m à 1 157 m");
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "nuit — l'agenda allume ses repères et ses événements en lime",
  async () => {
    const seen = await inNuit(
      <table>
        <tbody>
          <tr>
            <td>
              <button type="button" className="agenda-day" aria-pressed="false" aria-label="Lundi">
                <span className="agenda-dots">
                  <span className="agenda-dot" />
                </span>
              </button>
            </td>
            <td>
              <button type="button" className="agenda-day" aria-pressed="true" aria-label="Mardi">
                <span className="agenda-dots">
                  <span className="agenda-dot" />
                </span>
              </button>
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
        const [calm, selected] = [...drawn.querySelectorAll(".agenda-dot")];
        return {
          dot: getComputedStyle(calm ?? drawn).backgroundColor,
          halo: getComputedStyle(calm ?? drawn).boxShadow,
          onLime: getComputedStyle(selected ?? drawn).backgroundColor,
          edge: styleOf(drawn, ".agenda-event").borderLeftColor,
          edgeWidth: styleOf(drawn, ".agenda-event").borderLeftWidth,
        };
      },
    );
    expect(seen.dot).toBe(seen.tokens.lime);
    expect(seen.halo, "a halo").not.toBe("none");
    expect(seen.onLime, "a dot on the lime of the chosen day is dark").toBe(seen.tokens.onLime);
    expect(seen.edge).toBe(seen.tokens.lime);
    expect(seen.edgeWidth).toBe("2px");
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "nuit — l'onglet courant de l'admin est une pastille lime bordée de lime, les autres des pastilles sombres",
  async () => {
    const seen = await inNuit(
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
      </ul>,
      (drawn) => {
        const [current, other] = [...drawn.querySelectorAll(".admin-tab")].map((tab) =>
          getComputedStyle(tab),
        );
        return {
          edge: current?.borderTopColor ?? "",
          ink: current?.color ?? "",
          flat: current?.boxShadow ?? "",
          otherGround: other?.backgroundColor ?? "",
        };
      },
    );
    expect(seen.edge).toBe(seen.tokens.lime);
    expect(seen.flat, "no halo on a pill").toBe("none");
    expect(contrast(hex(seen.ink), hex(seen.tokens.lime))).toBeGreaterThanOrEqual(4.5);
    expect(seen.otherGround).toBe(seen.tokens.raised);
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "nuit — les cartes d'une liste vont par deux dès md, une par ligne en dessous",
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
    const wide = await inNuit(list, columns);
    expect(wide.display).toBe("grid");
    expect(wide.tracks).toBe(2);
    expect(wide.same, "the two cards of a row are as tall").toBe(true);
    await page.viewport(414, 896);
    expect((await inNuit(list, columns)).display, "one by one on a phone").toBe("flex");
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "nuit — le haut d'une fiche : la date en lime au-dessus du titre (qui reste le premier de la page), sans anneau, l'échéance dite en une phrase",
  async () => {
    const Night = variantOf("nuit", "EventHero");
    if (Night === undefined) throw new Error("Nuit has no event hero at full depth");
    const heading = { id: "hero-title", "data-focus": "title", tabIndex: -1 } as const;
    for (const { what, view, today } of EVENT_SHAPES()) {
      const seen = await inNuit(
        createElement(EventHero, { view, heading }),
        (drawn) => {
          const hero = drawn.querySelector(".event-hero");
          const title = drawn.querySelector("h1");
          const date = drawn.querySelector(".event-hero-date");
          const deadline = drawn.querySelector(".event-hero-deadline");
          const days = drawn.querySelector(".event-hero .days-left");
          return {
            days: plain(days?.textContent),
            daysPill: days === null ? "" : getComputedStyle(days).color,
            outer: drawn.firstElementChild === hero,
            title: [title?.id, title?.dataset.focus, title?.tabIndex],
            headings: drawn.querySelectorAll("h1").length,
            titleFirst:
              title !== null &&
              date !== null &&
              Boolean(title.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING),
            dateAbove:
              (date?.getBoundingClientRect().bottom ?? Infinity) <=
              (title?.getBoundingClientRect().top ?? 0),
            dateInk: date === null ? "" : getComputedStyle(date).color,
            rings: drawn.querySelectorAll(".ring-draw").length,
            deadline: plain(deadline?.textContent),
          };
        },
        { today },
      );
      expect(seen.outer, `the hero is the piece, ${what}`).toBe(true);
      expect(seen.title, `what the page gives its title, ${what}`).toEqual([
        "hero-title",
        "title",
        -1,
      ]);
      expect(seen.headings, `one title, ${what}`).toBe(1);
      expect(seen.titleFirst, `the title comes first in the page, ${what}`).toBe(true);
      expect(seen.dateAbove, `the date is above the title on screen, ${what}`).toBe(true);
      expect(seen.dateInk, `the date is lime, ${what}`).toBe(seen.tokens.lime);
      expect(seen.rings, `no ring, ${what}`).toBe(0);
      const state = registrationState(view.event, Temporal.PlainDate.from(today ?? "2026-06-01"));
      const sentence = state === null ? "" : deadlineText(state, f, fr);
      expect(seen.deadline, `the deadline, ${what}`).toBe(sentence);
      // The days left before the event, in words (Crête shows them in a ring, which this hero has not),
      // in the lime pill of the days left, and nothing once the event is under way.
      const start = Temporal.PlainDate.from(today ?? "2026-06-01");
      const ahead = daysBetween(start, view.start);
      expect(seen.days, `the days left, ${what}`).toBe(ahead > 0 ? plain(f.inDays(ahead)) : "");
      expect(seen.daysPill, `in the pill, ${what}`).toBe(ahead > 0 ? seen.tokens.lime : "");
    }
  },
);

/** The rules of the skin's sheets that move a piece under the pointer, and where they sit (inside `prefers-reduced-motion: no-preference` or not). */
function lifts(): { selector: string; calm: boolean }[] {
  const found: { selector: string; calm: boolean }[] = [];
  const visit = (rules: CSSRuleList, calm: boolean) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        if (
          rule.selectorText.includes('data-skin="nuit"') &&
          rule.selectorText.includes(":hover") &&
          rule.style.getPropertyValue("transform") !== ""
        ) {
          found.push({ selector: rule.selectorText, calm });
        }
      } else if (rule instanceof CSSMediaRule) {
        visit(
          rule.cssRules,
          calm || /prefers-reduced-motion:\s*no-preference/.test(rule.conditionText),
        );
      } else if (rule instanceof CSSGroupingRule) visit(rule.cssRules, calm);
    }
  };
  for (const sheet of document.styleSheets) visit(sheet.cssRules, false);
  return found;
}

test.skipIf(SKIN_DEPTH !== "full")(
  "nuit — la pastille d'un coureur ne se soulève sous le pointeur qu'avec le mouvement permis, comme les cartes de Crête",
  () => {
    chooseSkin("nuit");
    const moving = lifts();
    expect(moving.length, "the lift of the chips").toBeGreaterThan(0);
    expect(moving.filter(({ calm }) => !calm).map(({ selector }) => selector)).toEqual([]);
    chooseSkin("crete");
  },
);
