import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { SKIN_DEPTH, chooseSkin, variantOf } from "..";
import { AppShell } from "../../components/AppShell";
import { PRIMARY } from "../../components/buttons";
import { toEventView } from "../../features/events/api";
import { EventCard, EventCardBase } from "../../features/events/EventCard";
import { EventHeroBase } from "../../features/events/EventHero";
import {
  event2Record,
  eventRecord,
  pNinaSupporter,
  pNinaUndecided,
  withParticipations,
} from "../../features/events/testFixture";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";
import { contrast } from "../../test/colour";
import { colourOf } from "../../test/computed";
import { emulateMedia, resetMedia } from "../../test/media";
import type { EventCardList } from "../types";

import "../../styles.css";
import "../../skins/styles";

// « Dossard », depth mix: the bib card and the big bib of an event keep what
// Crête's card and hero show (every text, every link, every list of runners,
// the title the page gives its hero), and the pieces restyled in mix.css take
// the tokens of the palette. At palette there is nothing to see: the
// sheets and the variants of a deeper depth are not in the build.

vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: {
      get record() {
        return { id: "u1", collectionName: "users", role: "member" };
      },
      onChange: () => () => {},
    },
    filter: (raw: string) => raw,
    collection: () => ({
      getFirstListItem: () => Promise.resolve({ id: "r1", name: "Alice", user: "u1" }),
    }),
  },
}));

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(async () => {
  chooseSkin("crete");
  await resetMedia();
});

/** What `look` makes of the piece, drawn in the app (a router for its links, French, a day), the skin chosen. */
async function inApp<T>(
  element: ReactNode,
  look: (drawn: HTMLElement) => T,
  today = "2026-06-01",
): Promise<T> {
  chooseSkin("dossard");
  const root = createRootRoute({
    component: () => (
      <I18nProvider languages={["fr"]}>
        <TodayProvider value={Temporal.PlainDate.from(today)}>
          <div data-drawn="">
            <Outlet />
          </div>
        </TodayProvider>
      </I18nProvider>
    ),
  });
  const index = createRoute({ getParentRoute: () => root, path: "/", component: () => element });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const screen = await render(<RouterProvider router={router} />);
  await expect.poll(() => screen.container.querySelector("[data-drawn] > *")).not.toBeNull();
  const box = screen.container.querySelector<HTMLElement>("[data-drawn]");
  if (box === null) throw new Error("nothing was drawn");
  try {
    return look(box);
  } finally {
    await screen.unmount();
  }
}

/** The texts a screen reader has in an element: its text nodes, without what is hidden from it. */
function texts(element: Element): string[] {
  const copy = element.cloneNode(true);
  if (!(copy instanceof Element)) return [];
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  const found: string[] = [];
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (text) found.push(text);
  }
  return found;
}

/** What a piece has that a person can follow or count: its texts, its links, its lists of runners. */
function features(drawn: HTMLElement) {
  return {
    texts: texts(drawn),
    links: [...drawn.querySelectorAll("a")]
      .map((a) => `${a.getAttribute("href")} ${a.target} ${a.rel} ${a.textContent}`)
      .toSorted(),
    lists: [...drawn.querySelectorAll("ul[aria-label]")].map(
      (ul) =>
        `${ul.getAttribute("aria-label")}: ${[...ul.children].map((li) => li.textContent).join("|")}`,
    ),
    ring: drawn.querySelector(".ring-draw") !== null,
    headings: [...drawn.querySelectorAll("h1, h2, h3")].map((h) => h.tagName),
  };
}

/** Rich: two days, a deadline in four days, notes and a link to register, runners on each format, interested and supporters. */
const rich = () =>
  toEventView({
    ...withParticipations(eventRecord, [pNinaUndecided, pNinaSupporter]),
    notes: "Départ à 7 h.\nNavette à 6 h 30.",
    registration_url: "https://example.org/inscription",
    registration_deadline: "2026-06-05",
  });

/** Events of every shape that a card or a hero draws. */
const VIEWS: Record<string, () => ReturnType<typeof toEventView>> = {
  "a rich event": rich,
  "a single day, no runner, no deadline": () => toEventView(event2Record),
  "registrations closed": () =>
    toEventView({ ...eventRecord, registration_deadline: "2026-05-20" }),
  "a deadline in three weeks": () =>
    toEventView({ ...eventRecord, registration_deadline: "2026-06-21" }),
  "no format": () => toEventView({ ...event2Record, expand: { formats_via_event: [] } }),
};

const LISTS: EventCardList[] = ["home", "upcoming", "past", "agenda"];

test.skipIf(SKIN_DEPTH === "palette")(
  "dossard — la carte d'un événement garde tout ce que montre celle de Crête",
  async () => {
    const Bib = variantOf("dossard", "EventCard");
    if (Bib === undefined) throw new Error("Dossard has no event card at this depth");
    for (const [what, view] of Object.entries(VIEWS)) {
      const shown = view();
      const base = await inApp(
        createElement(EventCardBase, { view: shown, list: "upcoming" }),
        features,
      );
      for (const list of LISTS) {
        const own = await inApp(
          createElement(Bib, { view: shown, list, Base: EventCardBase }),
          (drawn) => ({
            ...features(drawn),
            outer: drawn.firstElementChild?.matches("article.event-card"),
            list: drawn.firstElementChild?.getAttribute("data-list"),
            // The base is not drawn under it: one card, one title.
            cards: drawn.querySelectorAll(".event-card").length,
          }),
        );
        const where = `${what}, in the ${list} list`;
        expect(own.outer, `the bib is the card, ${where}`).toBe(true);
        expect(own.cards, `one card, ${where}`).toBe(1);
        expect(own.list, `the list it is in, ${where}`).toBe(list);
        expect(own.texts, `the texts of Crête's card, ${where}`).toEqual(
          expect.arrayContaining(base.texts),
        );
        expect(own.links, `the links, ${where}`).toEqual(base.links);
        expect(own.lists, `the runners, ${where}`).toEqual(base.lists);
        expect(own.headings, `the title, ${where}`).toEqual(base.headings);
      }
    }
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "dossard — le haut d'une fiche garde tout ce que montre celui de Crête, et le titre que la page lui donne",
  async () => {
    const Bib = variantOf("dossard", "EventHero");
    if (Bib === undefined) throw new Error("Dossard has no event hero at this depth");
    const heading = { id: "hero-title", "data-focus": "title", tabIndex: -1 } as const;
    const days = [
      ["2026-06-01", "before the start"],
      ["2026-06-13", "on the first day"],
    ] as const;
    for (const [what, view] of Object.entries(VIEWS)) {
      for (const [today, when] of days) {
        const shown = view();
        const base = await inApp(
          createElement(EventHeroBase, { view: shown, heading }),
          features,
          today,
        );
        const own = await inApp(
          createElement(Bib, { view: shown, heading, Base: EventHeroBase }),
          (drawn) => {
            const title = drawn.querySelector("h1");
            return {
              ...features(drawn),
              outer: drawn.firstElementChild?.matches("header.event-hero"),
              title: [title?.id, title?.dataset.focus, title?.tabIndex],
            };
          },
          today,
        );
        const where = `${what}, ${when}`;
        expect(own.outer, `the bib is the hero, ${where}`).toBe(true);
        // What the page gives its title: its id (the actions name it), its focus mark, its tabIndex.
        expect(own.title, `the title the page gives, ${where}`).toEqual([
          "hero-title",
          "title",
          -1,
        ]);
        expect(own.texts, `the texts of Crête's hero, ${where}`).toEqual(
          expect.arrayContaining(base.texts),
        );
        expect(own.links, `the links (« S'inscrire »), ${where}`).toEqual(base.links);
        expect(own.ring, `the days left, ${where}`).toBe(base.ring);
        expect(own.headings, `one title, ${where}`).toEqual(["H1"]);
      }
    }
  },
);

/** A computed `rgb(r, g, b)` as `#rrggbb`, for the contrast of a colour the browser has computed. */
function hex(rgb: string): string {
  const [r, g, b] = (rgb.match(/\d+(?:\.\d+)?/g) ?? []).map((part) => Math.round(Number(part)));
  return `#${[r, g, b].map((part) => (part ?? 0).toString(16).padStart(2, "0")).join("")}`;
}

test.skipIf(SKIN_DEPTH === "palette")(
  "dossard — la bande d'un bib prend la couleur de sa liste, et son texte s'y lit (4,5:1)",
  async () => {
    const tones: [EventCardList, string][] = [
      ["home", "--color-peach-500"],
      ["upcoming", "--color-peach-500"],
      ["past", "--color-blush-200"],
      ["agenda", "--color-iris-300"],
    ];
    for (const [list, token] of tones) {
      const band = await inApp(<EventCard view={rich()} list={list} />, (drawn) => {
        const style = getComputedStyle(drawn.querySelector(".bib-band") ?? drawn);
        const tear = drawn.querySelector(".bib-tear");
        return {
          ground: style.backgroundColor,
          ink: style.color,
          tear: tear ? getComputedStyle(tear).borderTopStyle : "none",
        };
      });
      expect(band.ground, `the band in the ${list} list`).toBe(colourOf(token));
      expect(band.tear, `the tear-off line in the ${list} list`).toBe("dashed");
      expect(
        contrast(hex(band.ink), hex(band.ground)),
        `its words in the ${list} list`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    // The hero of an event: the coral band of the big bib.
    const Bib = variantOf("dossard", "EventHero");
    if (Bib === undefined) throw new Error("Dossard has no event hero at this depth");
    const hero = await inApp(
      createElement(Bib, {
        view: rich(),
        heading: { id: "t", "data-focus": "title", tabIndex: -1 },
        Base: EventHeroBase,
      }),
      (drawn) => {
        const style = getComputedStyle(drawn.querySelector(".bib-band") ?? drawn);
        return { ground: style.backgroundColor, ink: style.color };
      },
    );
    expect(hero.ground).toBe(colourOf("--color-peach-500"));
    expect(contrast(hex(hero.ink), hex(hero.ground))).toBeGreaterThanOrEqual(4.5);
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "dossard — en couleurs forcées, la bande d'un bib garde un trait dessous",
  async () => {
    await emulateMedia({ forcedColors: "active" });
    const edge = await inApp(<EventCard view={rich()} list="upcoming" />, (drawn) => {
      const band = drawn.querySelector(".bib-band");
      return band ? getComputedStyle(band).borderBottomWidth : "none";
    });
    expect(edge).toBe("2px");
  },
);

/** The frame of the app, with a page in it. */
async function shell<T>(look: (drawn: HTMLElement) => T): Promise<T> {
  chooseSkin("dossard");
  const root = createRootRoute({
    component: () => (
      <AppShell>
        <Outlet />
      </AppShell>
    ),
  });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <p>Contenu de la page</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([home]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider languages={["fr"]}>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  await expect.element(screen.getByText("Contenu de la page")).toBeVisible();
  try {
    return look(screen.container);
  } finally {
    await screen.unmount();
  }
}

test.skipIf(SKIN_DEPTH === "palette")(
  "dossard — le + est le corail des inscriptions avec le bleu marine de la bande d'un bib, la pastille courante et le bouton principal ont leur bord corail",
  async () => {
    chooseSkin("dossard");
    const coral = colourOf("--color-peach-500");
    const seen = await shell((drawn) => {
      const plus = drawn.querySelector(".fab");
      const tab = drawn.querySelector('.tab[aria-current="page"]');
      const style = getComputedStyle(plus ?? drawn);
      return {
        ground: style.backgroundColor,
        image: style.backgroundImage,
        ink: style.color,
        tab: tab ? getComputedStyle(tab).boxShadow : "none",
        header: getComputedStyle(drawn.querySelector(".app-header") ?? drawn, "::after").content,
      };
    });
    expect(seen.ground, "the « + »").toBe(coral);
    expect(seen.image, "painted flat").toBe("none");
    expect(contrast(hex(seen.ink), hex(seen.ground)), "its sign on it").toBeGreaterThanOrEqual(4.5);
    expect(seen.tab, "the current tab").toContain(coral);
    expect(seen.header, "the tear-off line of the header").not.toBe("none");
    // The main button: the coral edge under it, gone when it is disabled.
    const screen = await render(
      <>
        <button type="button" className={PRIMARY}>
          Envoyer
        </button>
        <button type="button" className={PRIMARY} disabled>
          Envoyer
        </button>
      </>,
    );
    const [on, off] = screen.container.querySelectorAll("button");
    expect(getComputedStyle(on ?? screen.container).boxShadow).toContain(coral);
    expect(getComputedStyle(off ?? screen.container).boxShadow).toBe("none");
  },
);
