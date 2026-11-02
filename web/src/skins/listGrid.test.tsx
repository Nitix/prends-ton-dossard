import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { SKINS, chooseSkin } from ".";
import { ToastProvider } from "../components/Toast";
import {
  aliceRunner,
  bobRunner,
  event2Record,
  eventRecord,
  f15,
  f42,
  fLyon,
  ninaRunner,
  p1,
  p2,
  p3,
  pNinaSupporter,
  pNinaUndecided,
  roadType,
  samRunner,
  trailType,
  withParticipations,
} from "../features/events/testFixture";
import { I18nProvider } from "../i18n/I18nProvider";
import { ensureTemporal } from "../lib/temporal";
import { chooseTheme } from "../lib/theme";
import { TodayProvider } from "../lib/useToday";
import { routeTree } from "../routeTree.gen";
import { fontsReady } from "../test/fontsReady";

import "../styles.css";

// The list of the events, in a grid from `md` in every skin (Crête's too): the
// events of a month in two columns, the cards of one row as tall as each other,
// and nothing of a card cut or past its edge at 768, 1024 and 1280 px (and in
// one column, as before, under 768). The real app is drawn, in each skin, with
// events that fill a card: a long name, two days, a deadline, several formats
// and runners, supporters.

/** A very long name, as an event of a federation could have. */
const LONG = "Championnats de France de course en montagne de la Haute-Maurienne";

const events = [
  // 13 and 14 June, the formats of the fixture with their runners, and Nina.
  withParticipations(eventRecord, [pNinaUndecided, pNinaSupporter]),
  {
    ...eventRecord,
    id: "event3",
    name: LONG,
    location: "Saint-Jean-de-Maurienne",
    start_date: "2026-06-19",
    end_date: "2026-06-21",
    registration_deadline: "2026-06-08",
    registration_url: "https://inscriptions.example.test/maurienne",
    expand: {
      formats_via_event: [
        { ...f42, id: "g42", event: "event3", name: "Ultra des trois vallées", date: "" },
        { ...f15, id: "g15", event: "event3", name: "Vertical de la Croix de Fer", date: "" },
      ],
      participations_via_event: [
        { ...p1, id: "q1", event: "event3", format: "g42" },
        { ...p2, id: "q2", event: "event3", format: "g42" },
        { ...p3, id: "q3", event: "event3", format: "g15" },
        { ...pNinaSupporter, id: "q4", event: "event3" },
      ],
    },
  },
  // A single day, one format.
  event2Record,
  {
    ...event2Record,
    id: "event5",
    name: "Cross du Salève",
    location: "Archamps",
    start_date: "2026-06-27",
    expand: {
      formats_via_event: [{ ...fLyon, id: "fSaleve", event: "event5", distance_km: 6 }],
      participations_via_event: [{ ...pNinaUndecided, id: "r1", event: "event5" }],
    },
  },
];

const lists: Record<string, unknown[]> = {
  events,
  runners: [aliceRunner, bobRunner, samRunner, ninaRunner],
  race_types: [trailType, roadType],
};

vi.mock("../lib/pb", () => ({
  pb: {
    authStore: {
      isValid: true,
      token: "token",
      get record() {
        return { id: "u-alice", collectionName: "users", role: "member", email: "a@example.test" };
      },
      onChange: () => () => {},
    },
    filter: (raw: string) => raw,
    send: () => Promise.resolve({}),
    collection: (name: string) => ({
      getFullList: () => Promise.resolve(lists[name] ?? []),
      getList: () => Promise.resolve({ items: [], page: 1, perPage: 1, totalItems: 0 }),
      getFirstListItem: () => Promise.resolve(aliceRunner),
      getOne: () => Promise.resolve(eventRecord),
    }),
    files: { getURL: () => "" },
  },
}));

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(async () => {
  await page.viewport(1280, 900);
});

afterEach(async () => {
  await chooseSkin("crete");
  chooseTheme("auto");
  window.scrollTo(0, 0);
  await page.viewport(414, 896);
});

/** The columns of a grid, as the browser lays it out (`none`, for what is not a grid, is one). */
const columnsOf = (list: Element) => {
  const tracks = getComputedStyle(list).gridTemplateColumns;
  return tracks === "none" ? 1 : tracks.split(" ").length;
};

/** The cards of the list page, in order. */
function cards() {
  return [...document.querySelectorAll<HTMLElement>(".month-section .event-card")];
}

/**
 * What of a card is cut or past its edge: a piece wider than its own box (the
 * text that a `truncate` or an `overflow: hidden` hides), and a piece whose box
 * goes out of the card's.
 */
function overflowing(card: HTMLElement): string[] {
  const edge = card.getBoundingClientRect();
  const found: string[] = [];
  for (const element of [card, ...card.querySelectorAll<HTMLElement>("*")]) {
    // Text for a screen reader only is a 1 px box, clipped on purpose.
    if (element.closest(".sr-only")) continue;
    const label = `${element.tagName.toLowerCase()}.${(element.getAttribute("class") ?? "").slice(0, 40)}`;
    if (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1) {
      found.push(`${label}: wider than its box (${element.scrollWidth} > ${element.clientWidth})`);
    }
    const box = element.getBoundingClientRect();
    if (box.width > 0 && (box.left < edge.left - 0.5 || box.right > edge.right + 0.5)) {
      found.push(
        `${label}: out of the card (${box.left}-${box.right}, card ${edge.left}-${edge.right})`,
      );
    }
  }
  return found;
}

for (const skin of SKINS) {
  test(`liste en grille — ${skin.id} : deux colonnes dès 768 px, des cartes de même hauteur par rangée, rien de coupé`, async () => {
    await chooseSkin(skin.id);
    chooseTheme("light");
    expect(document.documentElement.dataset.skin).toBe(skin.id === "crete" ? undefined : skin.id);
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/liste"] }),
    });
    const screen = await render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nProvider languages={["fr"]}>
          <TodayProvider value={Temporal.PlainDate.from("2026-06-01")}>
            <ToastProvider>
              <RouterProvider router={router} />
            </ToastProvider>
          </TodayProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
    await expect.element(screen.getByText("Cross du Salève")).toBeVisible();
    await fontsReady();
    const list = document.querySelector(".month-section .event-list");
    if (!list) throw new Error("no list of events");
    expect(cards()).toHaveLength(events.length);

    for (const width of [375, 767, 768, 1024, 1280]) {
      await page.viewport(width, 900);
      await fontsReady();
      const wide = width >= 768;
      expect(columnsOf(list), `${width} px: columns`).toBe(wide ? 2 : 1);
      expect(document.documentElement.scrollWidth, `${width} px: the page`).toBeLessThanOrEqual(
        width,
      );

      const items = cards().map((card) => {
        const box = card.getBoundingClientRect();
        return { card, top: Math.round(box.top), height: box.height };
      });
      // The rows: the cards that start at the same height.
      const rows = Map.groupBy(items, (item) => item.top);
      expect(rows.size, `${width} px: rows`).toBe(wide ? 2 : items.length);
      for (const [top, row] of rows) {
        expect(row.length, `${width} px: the row at ${top}`).toBeLessThanOrEqual(wide ? 2 : 1);
        for (const item of row) {
          expect(item.height, `${width} px: the cards of the row at ${top}`).toBeCloseTo(
            row[0]?.height ?? 0,
            1,
          );
        }
      }
      const problems = items.flatMap(({ card }) => {
        const name = card.querySelector(".event-card-title")?.textContent ?? "?";
        return overflowing(card).map((problem) => `${width} px, ${name}: ${problem}`);
      });
      expect(problems).toEqual([]);
    }
    await screen.unmount();
  });
}
