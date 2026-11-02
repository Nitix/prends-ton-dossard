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
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { SKIN_DEPTH, chooseSkin } from "..";
import { AppShell } from "../../components/AppShell";
import { toEventView } from "../../features/events/api";
import { EventCard } from "../../features/events/EventCard";
import { EventHero } from "../../features/events/EventHero";
import { eventRecord } from "../../features/events/testFixture";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";
import { colourOf } from "../../test/computed";

import "../../styles.css";
import "../../skins/styles";

// « Alpage » at depth mix: its CSS (the « + », « S'inscrire », the day, the
// deadline of a card, the title of a page) hits the pieces it names. It has no
// variant: its heroes and its card are Crête's, so what they show is Crête's
// (the smoke battery and components.test.tsx hold that). Under a palette
// build, a skin has no rule of its own on a piece: nothing is checked here.

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

const mixed = SKIN_DEPTH !== "palette";

/** The event of the fixture, with a link to register and a deadline (4 days ahead by default). */
const view = (deadline = "2026-06-05") =>
  toEventView({
    ...eventRecord,
    notes: "Départ à 7 h.",
    registration_url: "https://example.org/inscription",
    registration_deadline: deadline,
  });

/** What the page draws in the frame of the app, in « Alpage », on 1 June 2026. */
async function show(content: ReactNode) {
  chooseSkin("alpage");
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

test("« Alpage » mix — le « + » est au lever du jour, sa croix en granit", async () => {
  if (!mixed) return;
  await show(<p>Page</p>);
  const plus = document.querySelector<HTMLElement>("a.fab");
  expect(plus).not.toBeNull();
  const style = getComputedStyle(plus ?? document.body);
  // The sunrise, a trail of three oranges, not the forest of the main buttons.
  expect(style.backgroundImage).toContain(colourOf("--color-peach-400"));
  expect(style.backgroundImage).not.toContain(colourOf("--color-iris-600"));
  expect(style.color).toBe(colourOf("--color-neutral-950"));
});

test("« Alpage » mix — « S'inscrire » sur la forêt du haut de fiche est une pilule du lever du jour", async () => {
  if (!mixed) return;
  await show(
    <EventHero view={view()} heading={{ id: "hero-title", "data-focus": "title", tabIndex: -1 }} />,
  );
  const register = document.querySelector<HTMLElement>(".event-hero a.btn-on-dawn");
  expect(register).not.toBeNull();
  const style = getComputedStyle(register ?? document.body);
  expect(style.backgroundImage).toContain(colourOf("--color-peach-400"));
  expect(style.color).toBe(colourOf("--color-neutral-950"));
});

test("« Alpage » mix — le jour d'un événement est un panneau de sentier, et sa carte a la balise de son échéance", async () => {
  if (!mixed) return;
  await show(
    <>
      <EventCard view={view()} list="upcoming" />
      <EventCard view={view("2026-05-30")} list="upcoming" />
    </>,
  );
  const chip = document.querySelector<HTMLElement>(".date-chip");
  expect(chip).not.toBeNull();
  // Still the forest of the skin's paint (the palette's), with the band over it.
  expect(getComputedStyle(chip ?? document.body).backgroundImage).toMatch(/gradient/);
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

test("« Alpage » mix — sous le titre d'une page, le chemin de la forêt au lever du jour, une ligne arrondie", async () => {
  if (!mixed) return;
  await show(<h1 className="page-title">Titre</h1>);
  const title = document.querySelector<HTMLElement>("h1.page-title");
  const line = getComputedStyle(title ?? document.body, "::after");
  expect(line.borderTopLeftRadius).not.toBe("0px");
  expect(Number.parseFloat(line.height)).toBeCloseTo(0.3 * 16, 1);
  // Crête's crest is a mask: none here, the line is whole.
  expect(line.maskImage === "none" || line.maskImage === "").toBe(true);
  expect(line.backgroundImage).toMatch(/gradient/);
});
