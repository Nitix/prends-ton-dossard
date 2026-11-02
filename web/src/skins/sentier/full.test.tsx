import type { ReactNode } from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SKIN_DEPTH } from "..";
import { CountdownRing } from "../../components/Dawn";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { UNCONFIRMED_ROW } from "../../components/section";
import { toEventView } from "../../features/events/api";
import { EventCard, EventCardBase } from "../../features/events/EventCard";
import { EventHero } from "../../features/events/EventHero";
import { FormatTitle } from "../../features/events/FormatTitle";
import { event2Record, eventRecord } from "../../features/events/testFixture";
import { TrackFigures } from "../../features/route/TrackFigures";
import { ensureTemporal } from "../../lib/temporal";
import { colourOf, rgbaOf, textContrast } from "../../test/computed";
import { withoutIds } from "../../test/ids";
import { EVENT_SHAPES, inApp, plain, said, type DrawOptions } from "../../test/variant";

import "../../styles.css";
import "../../skins/styles";

// « Sentier » at depth full: the other pieces of its variant, over its mix:
// the header, the window, the message, the buttons, the sections of an event,
// its formats, the agenda, the rows of the home page, the track and the
// totals; and the pieces it draws itself (its card with a chip for the terrain
// of each format, the title of a format, the figures of a track in one line,
// the empty list, no ring). Each rule is hit through the semantic class it
// hooks on. Under a build at palette or at mix there is none of it.

vi.mock("../../lib/pb", async () => (await import("../../test/pbMock")).pbModule);

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(async () => {
  await page.viewport(414, 896);
});

const SKIN = "sentier";
/** What `check` finds in a piece drawn in the skin, while the skin is on the page (see mix.test.tsx). */
const within = (
  piece: ReactNode,
  check: (drawn: HTMLElement, page: HTMLElement) => void | Promise<void>,
  options: DrawOptions = {},
) => inApp(piece, check, { skin: SKIN, ...options });

const styleOf = (element: Element | null | undefined, pseudo?: "::before" | "::after") =>
  getComputedStyle(element ?? document.body, pseudo);

/** The first element of a selector, which the check needs: its absence is the failure. */
function need(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`nothing matches ${selector}`);
  return found;
}

const [RICH] = EVENT_SHAPES();
const rich = RICH?.view ?? toEventView(eventRecord);

const heading = { id: "hero-title", "data-focus": "title", tabIndex: -1 } as const;

/**
 * A card as its markup is, with what a variant may add to the formats taken out:
 * the kind of each (`data-format-kind`) and the pieces its marks put in its line.
 * What is left is Crête's own card, whoever drew it; `words` are the texts of the
 * format lines, which are the same whoever marks them.
 */
function skeleton(card: Element | null): { html: string; words: string[] } {
  const copy = card?.cloneNode(true);
  if (!(copy instanceof Element)) throw new Error("no card");
  const words = [...copy.querySelectorAll(".format-line")].map((line) => plain(line.textContent));
  for (const line of copy.querySelectorAll(".format-line")) line.replaceChildren();
  for (const format of copy.querySelectorAll("[data-format-kind]")) {
    format.removeAttribute("data-format-kind");
  }
  return { html: withoutIds(copy.outerHTML), words };
}

// ---- The frame

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — l'en-tête d'un téléphone est le bandeau court de la variante, ses crêtes à sa mesure",
  async () => {
    await within(
      <p>Page</p>,
      (_drawn, root) => {
        const header = need(root, ".app-header");
        const bar = need(root, ".app-header-bar");
        // Crête's sky is 124 px tall here (16 + 44 + 64); the variant's masthead keeps 40 under the name.
        expect(header.getBoundingClientRect().height, "the header").toBeLessThanOrEqual(104);
        expect(styleOf(bar).paddingBottom).toBe("40px");
        expect(styleOf(need(root, ".header-ridges")).height, "its ridges are low").toBe("36px");
      },
      { framed: true },
    );
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — du md, les onglets sont sur la barre de pin de l'en-tête, l'onglet courant souligné de la balise",
  async () => {
    await page.viewport(1024, 768);
    await within(
      <p>Page</p>,
      (_drawn, root) => {
        const header = need(root, ".app-header").getBoundingClientRect();
        const nav = need(root, ".tabbar").getBoundingClientRect();
        expect(header.height, "the header").toBe(112);
        expect(nav.top).toBeGreaterThanOrEqual(header.top);
        expect(nav.bottom).toBeLessThanOrEqual(header.bottom);
        // The capsule is the pine of the bar, with white words: they read, the current one and the others.
        const list = need(root, ".tabbar-list");
        expect(styleOf(list).backgroundColor).toBe(colourOf("--color-iris-600"));
        const current = need(root, '.tab[aria-current="page"]');
        const other = need(root, ".tab:not([aria-current])");
        expect(textContrast(current), "the current tab").toBeGreaterThanOrEqual(4.5);
        expect(textContrast(other), "another tab").toBeGreaterThanOrEqual(4.5);
        // Its blaze is under it, not over it.
        const blaze = styleOf(current, "::before");
        expect(blaze.bottom).toBe("0px");
        expect(blaze.backgroundColor).toBe(colourOf("--color-peach-400"));
        expect(styleOf(current).color).toBe(colourOf("--color-card"));
        // The sheet of the page starts under the tabs.
        const sheet = need(root, ".sheet").getBoundingClientRect();
        expect(sheet.top).toBeGreaterThanOrEqual(nav.bottom - 4);
      },
      { framed: true },
    );
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — du md, en haut de la page la capsule des onglets reste dans la barre de pin, sous la ligne des crêtes ; défilée, elle flotte sur la page",
  async () => {
    for (const width of [1024, 1280]) {
      await page.viewport(width, 800);
      await within(
        <div style={{ height: 3000 }}>Page</div>,
        (_drawn, root) => {
          // The cream of the page rises into the bar as the near ridge: its highest point is
          // the top of that path, in the units of its 120-high box.
          const ridges = need(root, ".header-ridges");
          const near = ridges.querySelectorAll("path")[1];
          if (!(near instanceof SVGPathElement)) throw new Error("no near ridge");
          const box = ridges.getBoundingClientRect();
          const crest = box.top + (near.getBBox().y / 120) * box.height;
          const capsule = need(root, ".tabbar-list").getBoundingClientRect();
          expect(
            capsule.bottom,
            `the capsule ends over the ridge line at ${width} px`,
          ).toBeLessThanOrEqual(crest);
          expect(capsule.top, "and under the top of the bar").toBeGreaterThanOrEqual(0);
          // Scrolled, it floats over the page: the pine pill, at the top of the screen.
          window.scrollTo(0, 600);
          const nav = need(root, ".tabbar");
          expect(styleOf(nav).position).toBe("sticky");
          const pill = need(root, ".tabbar-list");
          expect(styleOf(pill).backgroundColor).toBe(colourOf("--color-iris-600"));
          expect(pill.getBoundingClientRect().top).toBeLessThanOrEqual(16);
          window.scrollTo(0, 0);
        },
        { framed: true },
      );
    }
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — la bande hors ligne est au lever du jour, le message est une carte de pin avec la balise",
  async () => {
    await within(
      <>
        <p className="offline-banner">Hors ligne</p>
        <p className="toast">
          <span className="toast-dot" aria-hidden="true" />
          Enregistré
        </p>
      </>,
      (drawn) => {
        const banner = styleOf(need(drawn, ".offline-banner"));
        expect(banner.backgroundColor).toBe(colourOf("--color-peach-100"));
        expect(banner.color).toBe(colourOf("--color-peach-800"));
        const toast = styleOf(need(drawn, ".toast"));
        expect(toast.borderTopLeftRadius, "rounded like a card of the variant").toBe("20px");
        const dot = styleOf(need(drawn, ".toast-dot"));
        // The blaze of the trail: two bands, sunrise over pine, a little tilted.
        expect(dot.backgroundImage).toMatch(/gradient/);
        expect(dot.borderTopLeftRadius).toBe("2px");
        expect(dot.width).toBe("14px");
        expect(dot.transform).not.toBe("none");
      },
    );
  },
);

// ---- A window

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — la fenêtre a la balise avant son titre, ni lueur ni trait d'aube, et sa croix est en pin",
  async () => {
    await within(
      <Dialog open title="Une fenêtre" onClose={() => {}}>
        <p>Son contenu</p>
      </Dialog>,
      (drawn) => {
        const dialog = need(drawn, ".dialog");
        for (const part of [".dialog-glow", ".dialog-band"]) {
          expect(styleOf(need(dialog, part)).display, `${part} is hidden`).toBe("none");
        }
        const title = need(dialog, ".dialog-title");
        expect(styleOf(title).display).toBe("flex");
        const blaze = styleOf(title, "::before");
        expect(blaze.content).toBe('""');
        expect(blaze.backgroundImage).toMatch(/gradient/);
        expect(styleOf(title).fontWeight).toBe("600");
        expect(styleOf(need(dialog, ".dialog-close")).color).toBe(colourOf("--color-neutral-600"));
        // The edge of the window is the sand of the page, and its shade the skin's own.
        expect(styleOf(dialog).borderTopColor).toBe(colourOf("--color-neutral-200"));
      },
    );
  },
);

// ---- The buttons

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — les boutons sont des rectangles arrondis, le secondaire a le bord du granit",
  async () => {
    await within(
      <>
        <button type="button" className="btn-primary">
          Principal
        </button>
        <button type="button" className="btn-secondary">
          Secondaire
        </button>
        <button type="button" className="btn-danger">
          Supprimer
        </button>
      </>,
      (drawn) => {
        for (const kind of ["btn-primary", "btn-secondary", "btn-danger"]) {
          expect(
            styleOf(need(drawn, `.${kind}`)).borderTopLeftRadius,
            `${kind} is a rounded rectangle`,
          ).toBe("16px");
        }
        expect(styleOf(need(drawn, ".btn-secondary")).borderTopColor).toBe(
          colourOf("--color-neutral-300"),
        );
      },
    );
  },
);

// ---- The page of an event

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — la section d'une épreuve a, au bord gauche, la bande de son terrain, et son titre le dit",
  async () => {
    const [first] = rich.formats;
    if (first === undefined) throw new Error("no format");
    const road = toEventView(event2Record).formats[0];
    if (road === undefined) throw new Error("no road format");
    await within(
      <>
        <section className="format-section event-section card" data-case="trail">
          <h2 className="section-title">
            <FormatTitle formatView={first} parts={["Trail 42 km", "2 400 m D+"]} />
          </h2>
        </section>
        <section className="format-section event-section card" data-case="road">
          <h2 className="section-title">
            <FormatTitle formatView={road} parts={["Route 10 km"]} />
          </h2>
        </section>
      </>,
      (drawn) => {
        const band = (name: string) =>
          styleOf(need(drawn, `[data-case="${name}"]`), "::before").backgroundColor;
        // A trail is the green of the forest, a road the blue of the lake: the palette's slope colours.
        expect(band("trail")).toBe(colourOf("--color-slope-2"));
        expect(band("road")).toBe(colourOf("--color-slope-1"));
        const section = styleOf(need(drawn, '[data-case="trail"]'));
        expect(section.position).toBe("relative");
        expect(section.overflow).toBe("hidden");
        // Its words stay one title.
        expect(plain(need(drawn, '[data-case="trail"] h2').textContent)).toBe(
          "Trail 42 km · 2 400 m D+",
        );
      },
    );
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — une ligne de participant a le fond du sable, une ligne non confirmée reste en pointillés",
  async () => {
    await within(
      <ul>
        <li className="participant-row" data-confirmed="true">
          <span className="avatar avatar-soft">AL</span>
        </li>
        <li className={`participant-row ${UNCONFIRMED_ROW}`} data-confirmed="false">
          <span className="avatar avatar-soft">BO</span>
        </li>
      </ul>,
      (drawn) => {
        const confirmed = styleOf(need(drawn, '.participant-row[data-confirmed="true"]'));
        expect(confirmed.borderTopLeftRadius).toBe("16px");
        expect(rgbaOf(confirmed.backgroundColor)[3]).toBeGreaterThan(0);
        // The initials are on the moss of the variant, not on Crête's gradient of dawn.
        const avatar = styleOf(need(drawn, ".avatar-soft"));
        expect(avatar.backgroundImage).toBe("none");
        expect(avatar.backgroundColor).toBe(colourOf("--color-blush-100"));
        expect(avatar.color).toBe(colourOf("--color-iris-800"));
        // What is not confirmed is dashed (the words say it too): the rule never takes that away.
        expect(
          styleOf(need(drawn, '.participant-row[data-confirmed="false"]')).borderTopStyle,
        ).toBe("dashed");
      },
    );
  },
);

// ---- The lists and the agenda

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — le mois d'une liste est en lettres normales, une balise devant, sans l'horizon",
  async () => {
    await within(<h2 className="month-title">juin 2026</h2>, (drawn) => {
      const title = styleOf(need(drawn, ".month-title"));
      expect(title.textTransform).toBe("capitalize");
      expect(title.fontSize).toBe("20px");
      expect(title.fontWeight).toBe("600");
      expect(title.color).toBe(colourOf("--color-ink"));
      const blaze = styleOf(need(drawn, ".month-title"), "::before");
      expect(blaze.content).toBe('""');
      expect(blaze.backgroundImage).toMatch(/gradient/);
      expect(styleOf(need(drawn, ".month-title"), "::after").display).toBe("none");
    });
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — l'agenda : les jours de la semaine sur la mousse, aujourd'hui cerclé de lever du jour, des traits de balise",
  async () => {
    await within(
      <>
        <div className="month-grid">
          <span className="month-grid-weekday">lun</span>
          <button type="button" className="agenda-day" aria-pressed="false">
            <span className="agenda-day-number" aria-current="date">
              13
            </span>
            <span className="agenda-dots">
              <span className="agenda-dot" />
            </span>
          </button>
          <button type="button" className="agenda-day" aria-pressed="true">
            <span className="agenda-day-number">14</span>
            <span className="agenda-dots">
              <span className="agenda-dot" />
            </span>
          </button>
          <a href="#e" className="agenda-event">
            Trail
          </a>
        </div>
        <button type="button" className="nav-arrow">
          ‹
        </button>
      </>,
      (drawn) => {
        const weekday = styleOf(need(drawn, ".month-grid-weekday"));
        expect(rgbaOf(weekday.backgroundColor)[3], "a moss band").toBeGreaterThan(0);
        expect(weekday.color).toBe(colourOf("--color-iris-800"));
        const today = styleOf(need(drawn, ".agenda-day-number[aria-current]"));
        expect(today.borderTopColor, "today is ringed in sunrise").toBe(
          colourOf("--color-peach-500"),
        );
        // Under the chosen day (pine), a dot of the light sunrise; elsewhere the sunrise.
        expect(
          styleOf(need(drawn, '.agenda-day[aria-pressed="true"] .agenda-dot')).backgroundColor,
        ).toBe(colourOf("--color-peach-300"));
        expect(
          styleOf(need(drawn, '.agenda-day[aria-pressed="false"] .agenda-dot')).backgroundColor,
        ).toBe(colourOf("--color-peach-600"));
        const event = styleOf(need(drawn, ".agenda-event"));
        expect(event.borderLeftColor, "the blaze of an event").toBe(colourOf("--color-peach-400"));
        expect(event.borderLeftWidth).toBe("3px");
        // The arrows of a month are rounded squares.
        expect(styleOf(need(drawn, ".nav-arrow")).borderTopLeftRadius).toBe("16px");
      },
    );
  },
);

// ---- The home page

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — les jours restants sont un badge de sentier avec la balise, la carte de clé est au lever du jour",
  async () => {
    await within(
      <>
        <p className="days-left">dans 9 jours</p>
        <section className="passkey-card">Une clé</section>
      </>,
      (drawn) => {
        const badge = styleOf(need(drawn, ".days-left"));
        expect(badge.display).toBe("inline-flex");
        expect(badge.backgroundColor).toBe(colourOf("--color-blush-100"));
        expect(badge.color).toBe(colourOf("--color-iris-800"));
        expect(textContrast(need(drawn, ".days-left")), "the days left").toBeGreaterThanOrEqual(
          4.5,
        );
        expect(styleOf(need(drawn, ".days-left"), "::before").backgroundImage).toMatch(/gradient/);
        expect(styleOf(need(drawn, ".passkey-card")).backgroundColor).toBe(
          colourOf("--color-peach-50"),
        );
      },
    );
  },
);

// ---- A track and the totals

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — la carte est sur un passe-partout blanc, le titre de la trace a la balise, la tête des totaux est de mousse",
  async () => {
    await within(
      <>
        <div className="map-box">carte</div>
        <div className="map-loading">en chargement</div>
        <h3 className="route-title">Parcours</h3>
        <table>
          <thead className="totals-header">
            <tr>
              <th className="eyebrow">Courses</th>
            </tr>
          </thead>
        </table>
      </>,
      (drawn) => {
        expect(styleOf(need(drawn, ".map-box")).borderTopWidth, "a white mat").toBe("4px");
        expect(rgbaOf(styleOf(need(drawn, ".map-loading")).backgroundColor)[3]).toBeGreaterThan(0);
        const title = need(drawn, ".route-title");
        expect(styleOf(title).color).toBe(colourOf("--color-iris-800"));
        expect(styleOf(title, "::before").backgroundImage).toMatch(/gradient/);
        expect(rgbaOf(styleOf(need(drawn, ".totals-header")).backgroundColor)[3]).toBeGreaterThan(
          0,
        );
        expect(styleOf(need(drawn, ".totals-header .eyebrow")).color).toBe(
          colourOf("--color-iris-800"),
        );
      },
    );
  },
);

// ---- The pieces that Sentier draws itself

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — sa carte est celle de Crête, dont chaque épreuve est une pastille du terrain de son type, le jour à côté de toute la colonne",
  async () => {
    await within(
      <>
        <EventCard view={rich} list="upcoming" />
        <EventCard view={toEventView(event2Record)} list="upcoming" />
      </>,
      (drawn) => {
        const [cardTrail, cardRoad] = [...drawn.querySelectorAll<HTMLElement>(".event-card")];
        if (!cardTrail || !cardRoad) throw new Error("two cards");
        // The day is the picture of the day, the title leads to the page, the deadline keeps its kind.
        expect(cardTrail.querySelector(".date-chip")).not.toBeNull();
        expect(cardTrail.querySelector(".event-card-title a")).not.toBeNull();
        expect(cardTrail.querySelector(".event-card-deadline")?.getAttribute("data-kind")).toBe(
          "open",
        );
        // A format is a chip in the tint of its terrain, a mark before its words: the type is in the words.
        const trail = need(cardTrail, ".event-card-format");
        expect(trail.dataset.formatKind).toBe("trail");
        // A point of 8 px before the words: the line is flex, so that the mark has a box.
        expect(need(trail, ".terrain-mark").getBoundingClientRect().width).toBe(8);
        expect(styleOf(need(trail, ".terrain-mark")).backgroundColor).toBe(
          colourOf("--color-slope-2"),
        );
        const chip = styleOf(need(trail, ".format-line"));
        expect(rgbaOf(chip.backgroundColor)[3], "a tint").toBeGreaterThan(0);
        expect(chip.borderTopLeftRadius).toBe("12px");
        expect(textContrast(need(trail, ".format-line"))).toBeGreaterThanOrEqual(4.5);
        const road = need(cardRoad, ".event-card-format");
        expect(road.dataset.formatKind).toBe("route");
        expect(styleOf(need(road, ".terrain-mark")).backgroundColor).toBe(
          colourOf("--color-slope-1"),
        );
        // The runners are under the chip of their format, as in Crête's card.
        expect(trail.querySelector(".chips")).not.toBeNull();
        // The day is beside the whole column (the words, then the formats), not over the formats.
        const day = need(cardTrail, ".date-chip").getBoundingClientRect();
        const title = need(cardTrail, ".event-card-title").getBoundingClientRect();
        const body = need(cardTrail, ".event-card-body").getBoundingClientRect();
        expect(title.left, "the title is beside the day").toBeGreaterThanOrEqual(day.right);
        expect(body.left, "the formats are beside the day").toBeGreaterThanOrEqual(day.right);
        expect(body.top, "and under the title").toBeGreaterThanOrEqual(title.bottom);
      },
    );
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — les chiffres d'une trace sont une ligne, en pin, les altitudes dessous",
  async () => {
    await within(
      <TrackFigures
        figures={["12,6 km", "724 m D+", "728 m D−"]}
        altitude="altitude 450 m à 1 157 m"
      />,
      (drawn) => {
        const figures = need(drawn, ".route-figures");
        expect(plain(figures.textContent)).toBe("12,6 km · 724 m D+ · 728 m D−");
        expect(figures.querySelectorAll(".stat-tile")).toHaveLength(0);
        expect(styleOf(figures).color).toBe(colourOf("--color-iris-800"));
        expect(plain(need(drawn, ".route-altitude").textContent)).toBe("altitude 450 m à 1 157 m");
      },
    );
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — l'anneau des jours restants ne dessine rien, une liste vide est une carte ouverte sur sa carte de montagne",
  async () => {
    await within(<CountdownRing days={9} />, (drawn) => {
      // Nothing: it takes no room, and says nothing to a screen reader.
      expect(drawn.childElementCount).toBe(0);
      expect(said(drawn).texts).toEqual([]);
    });
    await within(<EmptyState title="Rien ici" hint="Ajoute-en un." />, (drawn) => {
      const empty = need(drawn, ".empty-state");
      expect(styleOf(empty).display).toBe("flex");
      expect(styleOf(empty).flexDirection, "the badge, then the words").toBe("row");
      expect(styleOf(empty).textAlign).toBe("left");
      expect(said(empty).texts).toEqual(["Rien ici", "Ajoute-en un."]);
    });
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — le titre d'une carte ou le nom d'un participant est souligné au lever du jour",
  async () => {
    await within(
      <>
        <h3 className="card-title">
          <a href="#e">Un événement</a>
        </h3>
        <p className="participant-name">
          <a href="#r">Alice</a>
        </p>
      </>,
      (drawn) => {
        for (const selector of [".card-title a", ".participant-name a"]) {
          const link = styleOf(need(drawn, selector));
          expect(link.textDecorationColor, `the link of ${selector}`).toBe(
            colourOf("--color-peach-400"),
          );
          expect(link.textDecorationThickness, `the link of ${selector}`).toBe("2px");
        }
      },
    );
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — sous le pointeur, le bouton secondaire prend le bord du pin et la ligne d'un participant son fond pâle",
  async () => {
    await within(
      <>
        <button type="button" className="btn-secondary">
          Annuler
        </button>
        <ul>
          <li className="participant-row" data-confirmed="true">
            Alice
          </li>
        </ul>
      </>,
      async (drawn) => {
        const button = need(drawn, ".btn-secondary");
        const row = need(drawn, ".participant-row");
        const rest = styleOf(row).backgroundColor;
        await userEvent.hover(button);
        expect(styleOf(button).borderTopColor).toBe(colourOf("--color-iris-300"));
        await userEvent.hover(row);
        expect(styleOf(row).backgroundColor).not.toBe(rest);
        expect(
          rgbaOf(styleOf(row).backgroundColor)[3],
          "a veil of pine, not the white",
        ).toBeGreaterThan(0);
      },
    );
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — sa carte n'est pas une copie : ôtés le genre et les marques des épreuves, c'est la carte de Crête, dans chaque forme d'événement",
  async () => {
    for (const { what, view, today } of EVENT_SHAPES()) {
      const props = { view, list: "upcoming" } as const;
      const base = await inApp(
        <EventCardBase {...props} />,
        (drawn) => skeleton(drawn.querySelector(".event-card")),
        { skin: SKIN, today },
      );
      const own = await inApp(
        <EventCard {...props} />,
        (drawn) => skeleton(drawn.querySelector(".event-card")),
        { skin: SKIN, today },
      );
      expect(own.html, `the card of Sentier, ${what}`).toBe(base.html);
      expect(own.words, `its format lines, ${what}`).toEqual(base.words);
    }
  },
);

test.skipIf(SKIN_DEPTH !== "full")(
  "« Sentier » full — sans anneau, le haut d'une fiche écrit les jours qui restent, dans le badge du sentier, et rien un jour d'épreuve",
  async () => {
    await within(<EventHero view={rich} heading={heading} />, (drawn) => {
      const days = need(drawn, ".event-hero-days");
      expect(plain(days.textContent)).toBe("dans 12 jours");
      expect(days.classList.contains("days-left"), "the badge of the days left").toBe(true);
      expect(days.getBoundingClientRect().width, "it shows").toBeGreaterThan(20);
      expect(drawn.querySelector(".countdown-ring"), "no ring beside it").toBeNull();
      // The title stays first in the markup, the days are with the date, over it.
      const title = need(drawn, "h1");
      expect(Boolean(title.compareDocumentPosition(days) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
        true,
      );
      expect(days.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        title.getBoundingClientRect().top + 1,
      );
    });
    // On its first day, and while it is under way, there is nothing to count.
    await within(
      <EventHero view={rich} heading={heading} />,
      (drawn) => {
        expect(drawn.querySelector(".event-hero-days")).toBeNull();
      },
      { today: "2026-06-13" },
    );
  },
);
