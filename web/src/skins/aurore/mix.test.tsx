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
import { EventHero } from "../../features/events/EventHero";
import { aliceRunner, eventRecord } from "../../features/events/testFixture";
import { RunnerHero } from "../../features/runners/RunnerHero";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";

import "../../styles.css";
import "../../skins/styles";

// « Aurore » at depth mix: its small sheet (the line under a title, the foot
// of its heroes, the glass of the bar of the tabs) hits the pieces it names.
// It has no variant: its layout is Crête's. Under a palette build, a skin has
// no rule of its own on a piece: nothing is checked here.

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

/** What the page draws in the frame of the app, in « Aurore », on 1 June 2026. */
async function show(content: ReactNode) {
  chooseSkin("aurore");
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

test("« Aurore » mix — sous le titre d'une page, une ligne ronde d'aube, pas la crête de Crête", async () => {
  if (!mixed) return;
  await show(<h1 className="page-title">Titre</h1>);
  const title = document.querySelector<HTMLElement>("h1.page-title");
  const line = getComputedStyle(title ?? document.body, "::after");
  expect(line.borderTopLeftRadius).not.toBe("0px");
  expect(Number.parseFloat(line.height)).toBeCloseTo(0.3 * 16, 1);
  expect(line.maskImage === "none" || line.maskImage === "").toBe(true);
  expect(line.backgroundImage).toMatch(/gradient/);
});

test("« Aurore » mix — les hauts de page ne gardent pas le pied que Crête réserve à ses crêtes", async () => {
  if (!mixed) return;
  // On a phone (414 px, under `md`): 3.5rem under the words of an event, 2.25rem under a runner's.
  await show(
    <>
      <EventHero
        view={toEventView({ ...eventRecord, notes: "Départ à 7 h." })}
        heading={{ id: "hero-title", "data-focus": "title", tabIndex: -1 }}
      />
      <RunnerHero
        runner={aliceRunner}
        heading={{ ref: createRef<HTMLHeadingElement>(), tabIndex: -1 }}
      />
    </>,
  );
  const event = document.querySelector<HTMLElement>(".event-hero > div");
  const runner = document.querySelector<HTMLElement>(".runner-hero");
  expect(getComputedStyle(event ?? document.body).paddingBottom).toBe("56px");
  expect(getComputedStyle(runner ?? document.body).paddingBottom).toBe("36px");
});

test("« Aurore » mix — la barre des onglets est en verre dépoli", async () => {
  if (!mixed) return;
  await show(<p>Page</p>);
  const bar = document.querySelector<HTMLElement>(".tabbar ul");
  expect(bar).not.toBeNull();
  expect(getComputedStyle(bar ?? document.body).backdropFilter).toContain("blur(12px)");
});
