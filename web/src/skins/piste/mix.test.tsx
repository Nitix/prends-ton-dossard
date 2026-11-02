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
import { page } from "vitest/browser";

import { SKIN_DEPTH, chooseSkin, variantOf } from "..";
import { AppShell } from "../../components/AppShell";
import { toEventView } from "../../features/events/api";
import { EventCardBase } from "../../features/events/EventCard";
import { EventHero } from "../../features/events/EventHero";
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
import { resetMedia } from "../../test/media";
import type { EventCardList } from "../types";

import "../../styles.css";
import "../../skins/styles";

// « Piste », depth mix: the card of an event with the measures of its formats
// as chips keeps what Crête's card shows (every text, every link, every list
// of runners), and the pieces restyled in mix.css (the lanes of the tabs, the
// red « + », the number of a lane, the stroke under a title) take the tokens
// of the palette and fit the narrowest phone. At palette the sheet and the
// variant are not in the build.

const session = vi.hoisted(() => ({ role: "member" }));

vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: {
      get record() {
        return { id: "u1", collectionName: "users", role: session.role };
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
  session.role = "member";
  chooseSkin("crete");
  await resetMedia();
  await page.viewport(414, 896);
});

/** What `look` makes of the piece, or of the frame of the page (`AppShell`), in Piste, in the app (French, a day, a router). */
async function inApp<T>(
  element: ReactNode,
  look: (drawn: HTMLElement) => T,
  { framed = false }: { framed?: boolean } = {},
): Promise<T> {
  chooseSkin("piste");
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider languages={["fr"]}>
          <TodayProvider value={Temporal.PlainDate.from("2026-06-01")}>
            {framed ? (
              <AppShell>
                <Outlet />
              </AppShell>
            ) : (
              <Outlet />
            )}
          </TodayProvider>
        </I18nProvider>
      </QueryClientProvider>
    ),
  });
  const index = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <div data-drawn="">{element}</div>,
  });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const screen = await render(<RouterProvider router={router} />);
  await expect.poll(() => screen.container.querySelector("[data-drawn] > *")).not.toBeNull();
  try {
    return look(screen.container);
  } finally {
    await screen.unmount();
  }
}

/** The words a screen reader has in an element (what is hidden from it set aside), the separators « · » left out. */
function words(element: Element): string[] {
  const copy = element.cloneNode(true);
  if (!(copy instanceof Element)) return [];
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return (copy.textContent ?? "").split(/\s+/).filter((word) => word !== "" && word !== "·");
}

/** The words of a list as a count of each, to ask whether a card has all those of another. */
function counted(list: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of list) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
}

/** The format lines of a card, as they read: the name and its measures, whitespace gathered. */
function formatLines(drawn: HTMLElement): string[] {
  return [...drawn.querySelectorAll("li > p:not(.eyebrow)")].map((line) =>
    (line.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
}

/** What a card has that a person can follow or count. */
function features(drawn: HTMLElement) {
  return {
    words: words(drawn),
    lines: formatLines(drawn),
    links: [...drawn.querySelectorAll("a")]
      .map((a) => `${a.getAttribute("href")} ${a.textContent}`)
      .toSorted(),
    lists: [...drawn.querySelectorAll("ul[aria-label]")].map(
      (ul) =>
        `${ul.getAttribute("aria-label")}: ${[...ul.children].map((li) => li.textContent).join("|")}`,
    ),
    headings: [...drawn.querySelectorAll("h1, h2, h3")].map((h) => h.tagName),
    chip: drawn.querySelector(".date-chip") !== null,
  };
}

/** Rich: two days, a deadline, runners on each format, interested and supporters. */
const rich = () =>
  toEventView({
    ...withParticipations(eventRecord, [pNinaUndecided, pNinaSupporter]),
    registration_deadline: "2026-06-05",
  });

const VIEWS: Record<string, () => ReturnType<typeof toEventView>> = {
  "a rich event": rich,
  "a single day, no runner, no deadline": () => toEventView(event2Record),
  "registrations closed": () =>
    toEventView({ ...eventRecord, registration_deadline: "2026-05-20" }),
  "no format": () => toEventView({ ...event2Record, expand: { formats_via_event: [] } }),
};

const LISTS: EventCardList[] = ["home", "upcoming", "past", "agenda"];

test.skipIf(SKIN_DEPTH === "palette")(
  "piste — la carte d'un événement garde tout ce que montre celle de Crête",
  async () => {
    const Lane = variantOf("piste", "EventCard");
    if (Lane === undefined) throw new Error("Piste has no event card at this depth");
    for (const [what, view] of Object.entries(VIEWS)) {
      const shown = view();
      const base = await inApp(
        createElement(EventCardBase, { view: shown, list: "upcoming" }),
        features,
      );
      for (const list of LISTS) {
        const own = await inApp(
          createElement(Lane, { view: shown, list, Base: EventCardBase }),
          (drawn) => ({
            ...features(drawn),
            outer: drawn.querySelector("[data-drawn] > *")?.matches("article.event-card"),
            cards: drawn.querySelectorAll(".event-card").length,
          }),
        );
        const where = `${what}, in the ${list} list`;
        expect(own.outer, `the lane is the card, ${where}`).toBe(true);
        expect(own.cards, `one card, ${where}`).toBe(1);
        // Every word of Crête's card, as many times, and its day (the number of a lane).
        const mine = counted(own.words);
        for (const [word, count] of counted(base.words)) {
          expect(mine.get(word) ?? 0, `« ${word} », ${where}`).toBeGreaterThanOrEqual(count);
        }
        expect(own.lines, `the formats read as Crête's, ${where}`).toEqual(base.lines);
        expect(own.links, `the links, ${where}`).toEqual(base.links);
        expect(own.lists, `the runners, ${where}`).toEqual(base.lists);
        expect(own.headings, `the title, ${where}`).toEqual(base.headings);
        expect(own.chip, `the day of the event, ${where}`).toBe(base.chip);
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
  "piste — sur le téléphone le plus étroit, les cinq onglets en capitales tiennent dans leur barre, 44 px de haut, sans icône",
  async () => {
    await page.viewport(320, 700);
    session.role = "admin";
    const seen = await inApp(
      <p>Contenu</p>,
      (drawn) => {
        const bar = drawn.querySelector(".tabbar ul");
        const tabs = [...drawn.querySelectorAll<HTMLElement>(".tab")];
        return {
          bar: bar?.getBoundingClientRect(),
          barScroll: bar ? [bar.scrollWidth, bar.clientWidth] : [],
          tabs: tabs.map((tab) => ({
            name: tab.textContent,
            scroll: [tab.scrollWidth, tab.clientWidth],
            height: tab.getBoundingClientRect().height,
            right: tab.getBoundingClientRect().right,
            capitals: getComputedStyle(tab).textTransform,
            icon: [...tab.children].map((child) => getComputedStyle(child).display),
          })),
        };
      },
      { framed: true },
    );
    expect(seen.tabs.map((tab) => tab.name)).toEqual([
      "Accueil",
      "Liste",
      "Agenda",
      "Profil",
      "Admin",
    ]);
    expect(seen.barScroll[0], "nothing past the bar").toBeLessThanOrEqual(seen.barScroll[1] ?? 0);
    for (const tab of seen.tabs) {
      expect(tab.scroll[0], `« ${tab.name} » fits its tab`).toBeLessThanOrEqual(tab.scroll[1] ?? 0);
      expect(tab.height, `« ${tab.name} »`).toBeGreaterThanOrEqual(44);
      expect(tab.right, `« ${tab.name} » inside the phone`).toBeLessThanOrEqual(320);
      expect(tab.capitals).toBe("uppercase");
      expect(tab.icon, "the icon is gone").toEqual(["none"]);
    }
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "piste — l'onglet courant a le trait rouge de la piste, le + est rouge, son signe s'y lit (4,5:1)",
  async () => {
    const seen = await inApp(
      <p>Contenu</p>,
      (drawn) => {
        const tab = drawn.querySelector('.tab[aria-current="page"]');
        const plus = drawn.querySelector(".fab");
        const stroke = getComputedStyle(tab ?? drawn, "::before");
        const style = getComputedStyle(plus ?? drawn);
        return {
          stroke: [stroke.content, stroke.backgroundColor, stroke.transform],
          ground: style.backgroundColor,
          image: style.backgroundImage,
          ink: style.color,
        };
      },
      { framed: true },
    );
    expect(seen.stroke[0]).not.toBe("none");
    expect(seen.stroke[1], "the red of the track").toBe(colourOf("--color-iris-500"));
    expect(seen.stroke[2], "skewed").not.toBe("none");
    expect(seen.ground).toBe(colourOf("--color-iris-500"));
    expect(seen.image).toBe("none");
    expect(contrast(hex(seen.ink), hex(seen.ground))).toBeGreaterThanOrEqual(4.5);
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "piste — le jour d'un événement est le numéro d'un couloir peint en rouge, son texte s'y lit (4,5:1) sur les deux bouts du dégradé",
  async () => {
    const seen = await inApp(
      createElement(EventCardBase, { view: rich(), list: "upcoming" }),
      (drawn) => {
        const chip = drawn.querySelector(".date-chip");
        const style = getComputedStyle(chip ?? drawn);
        return {
          image: style.backgroundImage,
          ink: style.color,
          line: getComputedStyle(chip ?? drawn, "::before").content,
          day: getComputedStyle(chip?.children[1] ?? drawn).fontStyle,
        };
      },
    );
    expect(seen.image).toContain("linear-gradient");
    expect(seen.line, "a lane line on each side").not.toBe("none");
    expect(seen.day, "the day in italic").toBe("italic");
    for (const token of ["--color-iris-500", "--color-iris-600"]) {
      expect(
        contrast(hex(seen.ink), hex(colourOf(token))),
        `its text on ${token}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "piste — « S'inscrire » sur le haut d'une fiche est rouge, et la bande est plus courte sous son texte",
  async () => {
    const heading = { id: "t", "data-focus": "title", tabIndex: -1 } as const;
    const view = toEventView({
      ...eventRecord,
      registration_url: "https://example.org/inscription",
    });
    const seen = await inApp(<EventHero view={view} heading={heading} />, (drawn) => {
      const link = drawn.querySelector(".event-hero .btn-on-dawn");
      const style = getComputedStyle(link ?? drawn);
      const inner = drawn.querySelector(".event-hero > div");
      return {
        ground: style.backgroundColor,
        ink: style.color,
        below: getComputedStyle(inner ?? drawn).paddingBottom,
      };
    });
    expect(seen.ground).toBe(colourOf("--color-iris-500"));
    expect(contrast(hex(seen.ink), hex(seen.ground))).toBeGreaterThanOrEqual(4.5);
    expect(seen.below).toBe("24px");
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "piste — les titres ont leur trait penché et leurs trois lignes de couloir",
  async () => {
    const seen = await inApp(
      <>
        <h1 className="page-title">Accueil</h1>
        <h2 className="block-title section-title">Un bloc</h2>
      </>,
      (drawn) => {
        const title = getComputedStyle(drawn.querySelector(".page-title") ?? drawn, "::after");
        const block = getComputedStyle(drawn.querySelector(".block-title") ?? drawn, "::after");
        return {
          mask: title.maskImage,
          skew: title.transform,
          lanes: block.backgroundImage,
          run: block.flexGrow,
        };
      },
    );
    expect(seen.mask).toBe("none");
    expect(seen.skew, "skewed").toMatch(/^matrix\(/);
    expect(seen.lanes).toContain("repeating-linear-gradient");
    expect(seen.run).toBe("1");
  },
);

/** The rules of the skin's sheets that animate, and where they sit (inside `prefers-reduced-motion: no-preference` or not). */
function animations(): { selector: string; calm: boolean }[] {
  const found: { selector: string; calm: boolean }[] = [];
  const visit = (rules: CSSRuleList, calm: boolean) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        if (
          rule.selectorText.includes('data-skin="piste"') &&
          (rule.style.getPropertyValue("animation") !== "" ||
            rule.style.getPropertyValue("animation-name") !== "")
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

test.skipIf(SKIN_DEPTH === "palette")(
  "piste — ses mouvements ne se font qu'avec le mouvement permis, une fois, sous un nom de keyframes de Piste",
  async () => {
    chooseSkin("piste");
    const moving = animations();
    expect(moving.length, "the strokes that land").toBeGreaterThan(0);
    expect(moving.filter(({ calm }) => !calm).map(({ selector }) => selector)).toEqual([]);
    // With nothing asked against it, the stroke under a title lands once.
    const seen = await inApp(<h1 className="page-title">Accueil</h1>, (drawn) => {
      const style = getComputedStyle(drawn.querySelector(".page-title") ?? drawn, "::after");
      return [style.animationName, style.animationIterationCount];
    });
    expect(seen).toEqual(["piste-lane-in", "1"]);
  },
);
