import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { createRef, type ReactNode } from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { SKIN_DEPTH, chooseSkin } from "..";
import { AppShell } from "../../components/AppShell";
import { toEventView } from "../../features/events/api";
import { EventCard } from "../../features/events/EventCard";
import { EventHero, EventHeroBase } from "../../features/events/EventHero";
import { aliceRunner, eventRecord } from "../../features/events/testFixture";
import { RunnerHero, RunnerHeroBase } from "../../features/runners/RunnerHero";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";
import { colourOf } from "../../test/computed";
import { withoutIds } from "../../test/ids";

import "../../styles.css";
import "../../skins/styles";

// « Sentier » at depth mix: its two light heroes keep everything that Crête's
// show, and its CSS (the « + », the tabs, the day, the card, the titles) hits
// the pieces it names. Under a palette build, a skin has no variant and no
// rule of its own on a piece: only what is common to every depth is checked.

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

afterEach(() => {
  chooseSkin("crete");
});

const SKIN = "sentier";
const mixed = SKIN_DEPTH !== "palette";

/** The event of the fixture, with all that its hero shows: notes, a link to register, a deadline 4 days ahead. */
const view = (deadline = "2026-06-05") =>
  toEventView({
    ...eventRecord,
    notes: "Départ à 7 h.",
    registration_url: "https://example.org/inscription",
    registration_deadline: deadline,
  });

/** What the page draws in the frame of the app, in « Sentier », on 1 June 2026. */
async function show(content: ReactNode) {
  chooseSkin(SKIN);
  const root = createRootRoute({
    component: () => (
      <AppShell>
        <Outlet />
      </AppShell>
    ),
  });
  const index = createRoute({ getParentRoute: () => root, path: "/", component: () => content });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider languages={["fr"]}>
        <TodayProvider value={Temporal.PlainDate.from("2026-06-01")}>
          <RouterProvider router={router} />
        </TodayProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

/** Every text a piece draws (its text nodes) and every link it has (its words and its address). */
function features(root: Element | null) {
  const texts: string[] = [];
  const walker = document.createTreeWalker(root ?? document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent?.trim();
    if (text) texts.push(text);
    node = walker.nextNode();
  }
  const links = [...(root?.querySelectorAll("a[href]") ?? [])].map(
    (link) => `${link.textContent?.trim()} -> ${link.getAttribute("href")}`,
  );
  return { texts, links };
}

/** What a piece of the page, found by its semantic class, draws: its features, its element, its tag. */
async function drawn(piece: ReactNode, selector: string) {
  const screen = await show(piece);
  await expect.poll(() => document.querySelector(selector)).not.toBeNull();
  const element = document.querySelector(selector);
  const seen = {
    ...features(element),
    tag: element?.tagName,
    html: withoutIds(element?.outerHTML ?? ""),
  };
  await screen.unmount();
  return seen;
}

test("« Sentier » mix — le haut d'une fiche garde tout ce que montre celui de Crête : textes, liens, titre", async () => {
  const heading = { id: "hero-title", "data-focus": "title", tabIndex: -1 } as const;
  const base = await drawn(<EventHeroBase view={view()} heading={heading} />, ".event-hero");
  const own = await drawn(<EventHero view={view()} heading={heading} />, ".event-hero");
  // Not an empty search: the name, the days, the place, the deadline and its days left, the notes, the link.
  for (const text of [
    "Trail des Crêtes",
    "Annecy",
    "Départ à 7 h.",
    "S'inscrire sur le site officiel",
  ]) {
    expect(base.texts.join(" "), `Crête's hero says ${text}`).toContain(text);
  }
  expect(base.links).toEqual([
    "S'inscrire sur le site officiel -> https://example.org/inscription",
  ]);
  for (const text of base.texts) {
    expect(own.texts.join(" "), `the hero of Sentier says ${text}`).toContain(text);
  }
  expect(own.links).toEqual(base.links);
  expect(own.tag).toBe("HEADER");
  // At mix it is a hero of its own, not Crête's.
  expect(own.html !== base.html, "the hero is Sentier's").toBe(mixed);
});

test("« Sentier » mix — un événement le jour même ou sans date limite garde ce que dit Crête", async () => {
  // A single day, the deadline over (closed), no notes: nothing is missing from the variant.
  const single = toEventView({
    ...eventRecord,
    end_date: "",
    registration_url: "https://example.org/inscription",
    registration_deadline: "2026-05-30",
  });
  const heading = { id: "hero-title", "data-focus": "title", tabIndex: -1 } as const;
  const base = await drawn(<EventHeroBase view={single} heading={heading} />, ".event-hero");
  const own = await drawn(<EventHero view={single} heading={heading} />, ".event-hero");
  expect(base.texts.length).toBeGreaterThan(3);
  for (const text of base.texts) {
    expect(own.texts.join(" "), `the hero of Sentier says ${text}`).toContain(text);
  }
  expect(own.links).toEqual(base.links);
});

test("« Sentier » mix — le haut d'une page de coureur garde sa photo, son nom et son titre", async () => {
  const given = { ref: createRef<HTMLHeadingElement>(), tabIndex: -1 } as const;
  const base = await drawn(<RunnerHeroBase runner={aliceRunner} heading={given} />, ".runner-hero");
  const own = await drawn(<RunnerHero runner={aliceRunner} heading={given} />, ".runner-hero");
  // Their initials (no photo in the fixture) and their name.
  expect(base.texts).toEqual(["A", "Alice"]);
  expect(own.texts).toEqual(base.texts);
  expect(own.tag).toBe("HEADER");
  expect(own.html !== base.html, "the hero is Sentier's").toBe(mixed);
  // While the runner loads: « Coureur » and no photo.
  const loading = await drawn(<RunnerHero runner={undefined} heading={given} />, ".runner-hero");
  expect(loading.texts).toEqual(["Coureur"]);
});

test("« Sentier » mix — le « + » est au lever du jour, sa croix en granit", async () => {
  if (!mixed) return;
  await show(<p>Page</p>);
  const plus = document.querySelector<HTMLElement>("a.fab");
  expect(plus).not.toBeNull();
  const style = getComputedStyle(plus ?? document.body);
  expect(style.backgroundColor).toBe(colourOf("--color-peach-400"));
  expect(style.backgroundImage, "no pine paint under the sunrise").toBe("none");
  expect(style.color).toBe(colourOf("--color-neutral-950"));
});

test("« Sentier » mix — l'onglet courant garde son aplat de pin et porte la balise au lever du jour", async () => {
  if (!mixed) return;
  await show(<p>Page</p>);
  const current = document.querySelector<HTMLElement>('.tab[aria-current="page"]');
  expect(current).not.toBeNull();
  const blaze = getComputedStyle(current ?? document.body, "::before");
  expect(blaze.content).toBe('""');
  expect(blaze.backgroundColor).toBe(colourOf("--color-peach-400"));
  // Another tab has no blaze.
  const other = document.querySelector<HTMLElement>(".tab:not([aria-current])");
  expect(getComputedStyle(other ?? document.body, "::before").content).toBe("none");
  // On a phone (414 px, under `md`) the bar is flat and as wide as the screen, not a floating pill.
  const bar = document.querySelector<HTMLElement>(".tabbar ul");
  const box = bar?.getBoundingClientRect();
  expect(getComputedStyle(bar ?? document.body).borderTopLeftRadius).toBe("0px");
  expect(box?.left).toBe(0);
  expect(box?.right).toBe(document.documentElement.clientWidth);
});

test("« Sentier » mix — le jour d'un événement est un panneau de sentier, et sa carte a la balise de son échéance", async () => {
  if (!mixed) return;
  await show(
    <>
      <EventCard view={view()} list="upcoming" />
      <EventCard view={view("2026-05-30")} list="upcoming" />
    </>,
  );
  const chip = document.querySelector<HTMLElement>(".date-chip");
  expect(chip).not.toBeNull();
  expect(getComputedStyle(chip ?? document.body).backgroundColor).toBe(colourOf("--color-iris-50"));
  const band = getComputedStyle(chip ?? document.body, "::before");
  expect(band.content).toBe('""');
  expect(band.backgroundColor).toBe(colourOf("--color-peach-400"));
  // Its deadline: a blaze of two bands while the registrations are open, a grey band once closed.
  const [open, closed] = [...document.querySelectorAll<HTMLElement>(".event-card p.rounded-full")];
  expect(getComputedStyle(open ?? document.body, "::before").backgroundImage).toMatch(/gradient/);
  expect(getComputedStyle(closed ?? document.body, "::before").backgroundColor).toBe(
    colourOf("--color-neutral-500"),
  );
});

test("« Sentier » mix — le titre d'une page est en pin, sans trait dessous", async () => {
  if (!mixed) return;
  await show(<h1 className="page-title">Titre</h1>);
  const title = document.querySelector<HTMLElement>("h1.page-title");
  expect(getComputedStyle(title ?? document.body).color).toBe(colourOf("--color-iris-900"));
  expect(getComputedStyle(title ?? document.body, "::after").display).toBe("none");
});

test("« Sentier » mix — « S'inscrire » dans le haut d'une fiche est au lever du jour", async () => {
  if (!mixed) return;
  await show(
    <EventHero view={view()} heading={{ id: "hero-title", "data-focus": "title", tabIndex: -1 }} />,
  );
  const register = document.querySelector<HTMLElement>(".event-hero a.btn-primary");
  expect(register).not.toBeNull();
  const style = getComputedStyle(register ?? document.body);
  expect(style.backgroundColor).toBe(colourOf("--color-peach-400"));
  expect(style.color).toBe(colourOf("--color-neutral-950"));
});
