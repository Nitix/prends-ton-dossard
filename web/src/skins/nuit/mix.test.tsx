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
import { EventHero } from "../../features/events/EventHero";
import { aliceRunner, eventRecord } from "../../features/events/testFixture";
import { RunnerHero } from "../../features/runners/RunnerHero";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";
import { contrast } from "../../test/colour";
import { colourOf } from "../../test/computed";
import { resetMedia } from "../../test/media";

import "../../styles.css";
import "../../skins/styles";

// « Nuit », depth mix: the pieces restyled in mix.css (the tape of the tab bar,
// of the card of an event and of the title of a page, the lime « S'inscrire »
// on a hero, the ring of a runner's photo) take the tokens of the palette.
// Nothing here is Nuit's markup: it has no variant, only a sheet. At palette
// the sheet is not in the build.

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

/** What `look` makes of the page's frame (`AppShell`) or of a piece, in Nuit, in the app. */
async function inApp<T>(
  element: ReactNode,
  look: (drawn: HTMLElement) => T,
  { framed = false }: { framed?: boolean } = {},
): Promise<T> {
  chooseSkin("nuit");
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

/** A computed `rgb(r, g, b)` as `#rrggbb`, for the contrast of a colour the browser has computed. */
function hex(rgb: string): string {
  const [r, g, b] = (rgb.match(/\d+(?:\.\d+)?/g) ?? []).map((part) => Math.round(Number(part)));
  return `#${[r, g, b].map((part) => (part ?? 0).toString(16).padStart(2, "0")).join("")}`;
}

const event = () =>
  toEventView({
    ...eventRecord,
    notes: "Départ à 7 h.",
    registration_url: "https://example.org/inscription",
    registration_deadline: "2026-06-05",
  });

test.skipIf(SKIN_DEPTH === "palette")(
  "nuit — la barre des onglets est un verre dépoli sous une bande réfléchissante, le + brille en lime",
  async () => {
    const seen = await inApp(
      <p>Contenu</p>,
      (drawn) => {
        const bar = drawn.querySelector(".tabbar ul");
        const plus = drawn.querySelector(".fab");
        return {
          glass: getComputedStyle(bar ?? drawn).backdropFilter,
          tape: getComputedStyle(bar ?? drawn, "::before").backgroundImage,
          halo: getComputedStyle(plus ?? drawn).boxShadow,
        };
      },
      { framed: true },
    );
    expect(seen.glass).toContain("blur");
    expect(seen.tape, "the tape over the bar").toContain("repeating-linear-gradient");
    expect(seen.halo, "the lime glow of the « + »").toContain(colourOf("--dawn-glow-warm"));
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "nuit — la carte d'un événement a sa bande réfléchissante, sa ligne de points et sa date en tuile lime (4,5:1)",
  async () => {
    const seen = await inApp(<EventCard view={event()} list="upcoming" />, (drawn) => {
      const card = drawn.querySelector(".event-card");
      const chip = drawn.querySelector(".date-chip");
      const under = drawn.querySelector(".event-card > div + div");
      const tile = getComputedStyle(chip ?? drawn);
      return {
        tape: getComputedStyle(card ?? drawn, "::before").backgroundImage,
        clipped: getComputedStyle(card ?? drawn).overflow,
        dots: under ? getComputedStyle(under).borderTopStyle : "none",
        tileImage: tile.backgroundImage,
        tileInk: tile.color,
        tileEdge: tile.borderTopColor,
        card: getComputedStyle(card ?? drawn).backgroundColor,
      };
    });
    expect(seen.tape).toContain("repeating-linear-gradient");
    expect(seen.clipped, "so that the tape stays on the card").toBe("hidden");
    expect(seen.dots).toBe("dotted");
    // The day: a lime tile on the card, no longer a flat lime pill.
    expect(seen.tileImage).toBe("none");
    expect(seen.tileInk).toBe(colourOf("--color-iris-600"));
    expect(contrast(hex(seen.tileInk), hex(seen.card))).toBeGreaterThanOrEqual(4.5);
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "nuit — « S'inscrire » sur le haut d'une fiche est le lime des boutons principaux, la photo d'un coureur son anneau lime",
  async () => {
    const heading = { id: "t", "data-focus": "title", tabIndex: -1 } as const;
    const register = await inApp(<EventHero view={event()} heading={heading} />, (drawn) => {
      const link = drawn.querySelector(".event-hero .btn-on-dawn");
      const style = getComputedStyle(link ?? drawn);
      return { ground: style.backgroundColor, ink: style.color, link: link?.textContent };
    });
    expect(register.link, "the link is still there").toContain("S'inscrire");
    expect(register.ground).toBe(colourOf("--color-iris-600"));
    expect(contrast(hex(register.ink), hex(register.ground))).toBeGreaterThanOrEqual(4.5);
    const ring = await inApp(
      <RunnerHero
        runner={aliceRunner}
        heading={{ ref: createRef<HTMLHeadingElement>(), tabIndex: -1 }}
      />,
      (drawn) =>
        getComputedStyle(drawn.querySelector(".runner-hero .avatar-soft") ?? drawn).boxShadow,
    );
    expect(ring, "the ring of the photo").toContain(colourOf("--color-iris-600"));
  },
);

test.skipIf(SKIN_DEPTH === "palette")(
  "nuit — le titre d'une page a un ruban réfléchissant à la place de la crête",
  async () => {
    const seen = await inApp(<h1 className="page-title">Accueil</h1>, (drawn) => {
      const style = getComputedStyle(drawn.querySelector(".page-title") ?? drawn, "::after");
      return { tape: style.backgroundImage, mask: style.maskImage, height: style.height };
    });
    expect(seen.tape).toContain("repeating-linear-gradient");
    expect(seen.mask).toBe("none");
    expect(seen.height).toBe("3px");
  },
);
