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

import { ON_DAWN } from "./components/buttons";
import { DateChip } from "./components/Dawn";
import { ToastProvider } from "./components/Toast";
import { AdminLayout } from "./features/admin/AdminLayout";
import { MonthGrid } from "./features/agenda/MonthGrid";
import { ParticipantChips } from "./features/events/ParticipantChips";
import { aliceRunner, bobRunner, p1, p2 } from "./features/events/testFixture";
import { ParticipationMenu } from "./features/participations/ParticipationMenu";
import { I18nProvider } from "./i18n/I18nProvider";
import { ensureTemporal } from "./lib/temporal";
import { applyTheme } from "./lib/theme";
import type { ParticipationRecord } from "./lib/types";
import { TodayProvider } from "./lib/useToday";
import { emulateMedia, resetMedia } from "./test/media";

import "./styles.css";

// Forced colours (a high contrast mode of Windows): the browser drops what the
// dawn paints (a gradient is a background image, and a plain background is
// replaced too) and puts its own few colours instead. What was a pill of
// sunrise must still be told apart by an edge, whichever theme the app has.
// The tab bar, the « + », the main buttons and the delete button are in
// components/AppShell.test.tsx; these are the other pills of the app.

// Nothing here asks the server: the menu is only opened.
vi.mock("./lib/pb", () => ({ pb: { collection: () => ({}) } }));

const TODAY = "2026-06-10";

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(async () => {
  await resetMedia();
  applyTheme("auto");
  document.documentElement.style.colorScheme = "";
});

/** The providers of the app around what a row renders. */
function inApp(children: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider languages={["fr"]}>
        <TodayProvider value={Temporal.PlainDate.from(TODAY)}>
          <ToastProvider>{children}</ToastProvider>
        </TodayProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

/** The admin menu on its first page, in a router (its items are links). */
function adminMenu() {
  const root = createRootRoute({ component: Outlet });
  const admin = createRoute({ getParentRoute: () => root, path: "/admin", component: AdminLayout });
  const members = createRoute({
    getParentRoute: () => admin,
    path: "/membres",
    component: () => null,
  });
  const router = createRouter({
    routeTree: root.addChildren([admin.addChildren([members])]),
    history: createMemoryHistory({ initialEntries: ["/admin/membres"] }),
  });
  return <RouterProvider router={router} />;
}

/** The days of a week of June 2026, from Monday 8 to Sunday 14. */
const week = () =>
  Array.from({ length: 7 }, (_, i) => Temporal.PlainDate.from("2026-06-08").add({ days: i }));

const confirmed: ParticipationRecord = { ...p1, status: "registered" };
const interested: ParticipationRecord = { ...p2, status: "interested" };

type Row = {
  what: string;
  ui: () => ReactNode;
  /** The element that must keep an edge; it may need a gesture first (the menu opens). */
  find: (container: HTMLElement) => Promise<Element | null>;
  /** Those beside it that are not chosen: its edge must tell it from theirs. */
  others?: (container: HTMLElement) => Element[];
};

const ROWS: Row[] = [
  {
    what: "the date chip of an event",
    ui: () =>
      inApp(<DateChip start={Temporal.PlainDate.from("2026-06-14")} label="dim. 14 juin" />),
    find: async (container) => container.querySelector(".bg-dawn-deep"),
  },
  {
    what: "the chip of a confirmed participant",
    ui: () =>
      inApp(
        <ParticipantChips participations={[{ participation: confirmed, runner: aliceRunner }]} />,
      ),
    find: async (container) => container.querySelector("li"),
  },
  {
    what: "the selected day of the agenda",
    ui: () =>
      inApp(
        <MonthGrid
          weeks={[week()]}
          month={Temporal.PlainYearMonth.from("2026-06")}
          byDay={new Map()}
          today={Temporal.PlainDate.from(TODAY)}
          selected="2026-06-12"
          labelledBy="month"
          busy={false}
          onSelect={() => {}}
        />,
      ),
    find: async (container) => container.querySelector('button[aria-pressed="true"]'),
    others: (container) => [...container.querySelectorAll('button[aria-pressed="false"]')],
  },
  {
    what: "the current page of the admin menu",
    ui: () => inApp(adminMenu()),
    find: async (container) => {
      await expect.poll(() => container.querySelector('a[aria-current="page"]')).not.toBeNull();
      return container.querySelector('a[aria-current="page"]');
    },
    others: (container) => [...container.querySelectorAll("nav a:not([aria-current])")],
  },
  {
    what: "the current status in the menu of a participation",
    ui: () =>
      inApp(
        <ParticipationMenu
          eventId="event"
          participation={interested}
          runner={bobRunner}
          label="Trail 42 km"
          started
          canConfirm={false}
          onRemoved={() => {}}
        />,
      ),
    find: async (container) => {
      const button = container.querySelector<HTMLButtonElement>("button[popovertarget]");
      button?.click();
      await expect.poll(() => container.querySelector('[aria-current="true"]')).not.toBeNull();
      // The check in a sun beside the words: the item itself is only bolder.
      return container.querySelector('[aria-current="true"] > span');
    },
    others: (container) => [
      ...container.querySelectorAll("li > button[popovertarget]:not([aria-current]) > span"),
    ],
  },
  {
    what: "a white pill on the sky (ON_DAWN)",
    ui: () => (
      <header className="on-dawn bg-dawn-hero p-4">
        <a href="/x" className={ON_DAWN}>
          S'inscrire
        </a>
      </header>
    ),
    find: async (container) => container.querySelector("a"),
  },
];

/** The edge of an element, as it is drawn: none, or its style, width and colour. */
function edge(element: Element) {
  const style = getComputedStyle(element);
  return {
    style: style.borderTopStyle,
    width: Number.parseFloat(style.borderTopWidth),
    colour: style.borderTopColor,
  };
}

test("couleurs forcées — chaque pastille de l'aube garde un bord, avec le thème clair, le sombre ou celui du téléphone", async () => {
  await emulateMedia({ forcedColors: "active" });
  expect(matchMedia("(forced-colors: active)").matches).toBe(true);
  for (const theme of ["auto", "light", "dark"] as const) {
    applyTheme(theme);
    for (const { what, ui, find, others } of ROWS) {
      const screen = await render(ui());
      const element = await find(screen.container);
      expect(element, `${what}: found`).not.toBeNull();
      const drawn = edge(element ?? document.body);
      const where = `${what} (${theme})`;
      // Every row is told, not only the first that fails.
      expect.soft(drawn.style, `${where}: its edge`).not.toBe("none");
      expect.soft(drawn.width, `${where}: its edge`).toBeGreaterThanOrEqual(1);
      expect
        .soft(drawn.colour, `${where}: its edge`)
        .not.toMatch(/^rgba\(.*,\s*0\)$|^transparent$/);
      // Not the edge that all of them have: the chosen one is told apart.
      const beside = others?.(screen.container);
      expect.soft(beside?.length ?? 1, `${where}: the others`).toBeGreaterThan(0);
      for (const other of beside ?? []) {
        expect.soft(edge(other), `${where}: told from the others`).not.toEqual(drawn);
      }
      await screen.unmount();
    }
  }
});

test("couleurs forcées — sans elles, ces pastilles n'ont pas de bord de plus", async () => {
  // The chip of a participant and the day keep their look: no edge where none was drawn.
  for (const { what, ui, find } of ROWS.filter((row) => !row.what.includes("admin menu"))) {
    const screen = await render(ui());
    const element = await find(screen.container);
    expect(edge(element ?? document.body).width, `${what}: no edge`).toBe(0);
    await screen.unmount();
  }
});
