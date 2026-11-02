import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { expect } from "vitest";
import { render } from "vitest-browser-react";

import { AppShell } from "../components/AppShell";
import { toEventView, type EventView } from "../features/events/api";
import {
  event2Record,
  eventRecord,
  pNinaSupporter,
  pNinaUndecided,
  withParticipations,
} from "../features/events/testFixture";
import { I18nProvider } from "../i18n/I18nProvider";
import { TodayProvider } from "../lib/useToday";
import { chooseSkin } from "../skins";
import { withoutIds } from "./ids";

// What the tests of a skin's pieces share (skins/<id>/*.test.tsx,
// skins/variants.test.tsx): a piece drawn in the app, what it says to a screen
// reader, the check that a variant says everything its base says, the shapes
// an event can take, and a computed colour as `#rrggbb`. The module of
// PocketBase that goes with it is ./pbMock.ts (a test file mocks `lib/pb` with
// it: see there).

/** The day a piece is seen on, unless a test says otherwise: 1 June 2026. */
export const TODAY = "2026-06-01";

/** How a piece is drawn: in a skin (Crête's page is put back after), on a day, in the frame of the app. */
export type DrawOptions = {
  /** The skin of the page while the piece is drawn; the page is Crête's again after it. */
  skin?: string;
  /** The day of the app (`TodayProvider`), `YYYY-MM-DD`. */
  today?: string;
  /** In the frame of a signed-in page (`AppShell`: the header, the tabs, the « + »). */
  framed?: boolean;
};

/**
 * What `look` makes of a piece drawn in the app: in French, on a day, under a
 * router (its links have their addresses), with a client of queries, in the
 * frame of the app when asked. `look` gets the box of the piece (`[data-drawn]`,
 * the piece is its content) and the whole page drawn (for the frame), before
 * they go.
 */
export async function inApp<T>(
  element: ReactNode,
  look: (drawn: HTMLElement, page: HTMLElement) => T,
  { skin, today = TODAY, framed = false }: DrawOptions = {},
): Promise<T> {
  if (skin !== undefined) chooseSkin(skin);
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider languages={["fr"]}>
          <TodayProvider value={Temporal.PlainDate.from(today)}>
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
  // The box is there once the page is: a piece may draw nothing in it.
  await expect.poll(() => screen.container.querySelector("[data-drawn]")).not.toBeNull();
  const box = screen.container.querySelector<HTMLElement>("[data-drawn]");
  try {
    if (box === null) throw new Error("the piece was not drawn");
    return look(box, screen.container);
  } finally {
    await screen.unmount();
    if (skin !== undefined) chooseSkin("crete");
  }
}

/** Text with its whitespace gathered: Intl's non-breaking spaces and the line breaks of the markup are one space. */
export const plain = (text: string | null | undefined) => (text ?? "").replace(/\s+/gu, " ").trim();

/** What a screen reader has of an element: what is hidden from it (`aria-hidden`) left out. */
function heard(element: Element): Element {
  const copy = element.cloneNode(true);
  if (!(copy instanceof Element)) throw new Error("not an element");
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return copy;
}

/** What a piece says to a screen reader. */
export type Said = {
  /** Each of its texts, in order (a text node each), whitespace gathered. */
  texts: string[];
  /** All its text as one line. */
  flat: string;
  /** Its links, as « words → address ». */
  links: string[];
  /** The names it gives (`aria-label`): its lists of runners, its regions. */
  names: string[];
  /** The words of its buttons. */
  buttons: string[];
};

/**
 * What a piece says to a screen reader: each of its texts, its links (their
 * words and their address), the names it gives, its buttons; never what is
 * hidden from it (`aria-hidden`: a big number that repeats a date, a ring).
 */
export function said(box: Element): Said {
  const copy = heard(box);
  const texts: string[] = [];
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = plain(node.textContent);
    if (text !== "") texts.push(text);
  }
  return {
    texts,
    flat: plain(copy.textContent),
    links: [...copy.querySelectorAll("a[href]")].map(
      (link) => `${plain(link.textContent)} → ${link.getAttribute("href")}`,
    ),
    names: [...copy.querySelectorAll("[aria-label]")].map(
      (named) => named.getAttribute("aria-label") ?? "",
    ),
    buttons: [...copy.querySelectorAll("button")].map((button) => plain(button.textContent)),
  };
}

/** What a piece says, and its HTML with its ids set aside. */
function saidAndDrawn(box: HTMLElement) {
  return { said: said(box), html: withoutIds(box.innerHTML) };
}

/**
 * Checks that a skin's piece says everything its base says: each of the base's
 * texts is in its text (in its own markup: a title split in two faces, a
 * measure in a tag), and each of its links, names and buttons is one of its
 * own. Both are drawn in the app (`options`, `what` naming the case in a
 * failure). Gives the HTML of both, their ids set aside, for a test that looks
 * further (the variant's first).
 */
export async function keepsEverything(
  skinned: ReactNode,
  base: ReactNode,
  { what = "the variant", ...options }: DrawOptions & { what?: string } = {},
): Promise<[string, string]> {
  const own = await inApp(skinned, saidAndDrawn, options);
  const theirs = await inApp(base, saidAndDrawn, options);
  for (const text of theirs.said.texts) {
    expect(own.said.flat, `${what}: the text « ${text} »`).toContain(text);
  }
  expect(own.said.links, `${what}: its links`).toEqual(expect.arrayContaining(theirs.said.links));
  expect(own.said.names, `${what}: its named lists`).toEqual(
    expect.arrayContaining(theirs.said.names),
  );
  expect(own.said.buttons, `${what}: its buttons`).toEqual(
    expect.arrayContaining(theirs.said.buttons),
  );
  return [own.html, theirs.html];
}

/** An event the tests of the pieces draw, and the day it is seen on when it is not `TODAY`. */
export type EventShape = { what: string; view: EventView; today?: string };

/**
 * The shapes an event takes on a card or a hero, from the fixture: what a
 * variant must hold, each of them.
 *
 * - « rich »: two days (13–14 June), the deadline in 4 days (so its days left
 *   are said), notes, a link to register, two formats with their runners (one
 *   confirmed, two not), someone interested and a supporter;
 * - « registrations closed »: the deadline passed, the event to come;
 * - « no format »: neither format nor runner;
 * - « a single day, no deadline »: 22 June, one format;
 * - « under way »: the rich event seen on its first day (the ring at 0);
 * - « a one-word name »: « Backyard » (a title in two voices has one);
 * - « next year »: the rich event a year later (the day says its year).
 */
export function EVENT_SHAPES(): EventShape[] {
  const rich = {
    ...withParticipations(eventRecord, [pNinaUndecided, pNinaSupporter]),
    notes: "Départ à 7 h.\nNavette à 6 h 30.",
    registration_url: "https://example.org/inscription",
    registration_deadline: "2026-06-05",
  };
  return [
    { what: "rich", view: toEventView(rich) },
    {
      what: "registrations closed",
      view: toEventView({ ...eventRecord, registration_deadline: "2026-05-20" }),
    },
    {
      what: "no format",
      view: toEventView({
        ...eventRecord,
        expand: { formats_via_event: [], participations_via_event: [] },
      }),
    },
    { what: "a single day, no deadline", view: toEventView(event2Record) },
    { what: "under way", view: toEventView(rich), today: "2026-06-13" },
    { what: "a one-word name", view: toEventView({ ...rich, name: "Backyard" }) },
    {
      what: "next year",
      view: toEventView({
        ...rich,
        start_date: "2027-06-13",
        end_date: "2027-06-14",
        registration_deadline: "2027-06-05",
      }),
    },
  ];
}

/** A computed `rgb(r, g, b)` (or `rgba`) as `#rrggbb`, for the contrast of a colour the browser has computed. */
export function hex(rgb: string): string {
  const [r, g, b] = (rgb.match(/\d+(?:\.\d+)?/g) ?? []).map((part) => Math.round(Number(part)));
  return `#${[r, g, b].map((part) => (part ?? 0).toString(16).padStart(2, "0")).join("")}`;
}
