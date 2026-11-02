import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  createElement,
  createRef,
  type Attributes,
  type ComponentType,
  type ReactNode,
} from "react";
import { afterEach, beforeAll, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { SKIN_DEPTH, SKINS, chooseSkin, slotOf, variantOf } from ".";
import { CountdownRing, CountdownRingBase, DateChip, DateChipBase } from "../components/Dawn";
import { EmptyState, EmptyStateBase } from "../components/EmptyState";
import { SectionMarker } from "../components/Slots";
import { toEventView } from "../features/events/api";
import { EventCard, EventCardBase } from "../features/events/EventCard";
import { EventHero, EventHeroBase } from "../features/events/EventHero";
import { FormatTitle, FormatTitleBase } from "../features/events/FormatTitle";
import { aliceRunner, eventRecord } from "../features/events/testFixture";
import { TrackFigures, TrackFiguresBase } from "../features/route/TrackFigures";
import { RunnerHero, RunnerHeroBase } from "../features/runners/RunnerHero";
import { I18nProvider } from "../i18n/I18nProvider";
import { ensureTemporal } from "../lib/temporal";
import { TodayProvider } from "../lib/useToday";
import { withoutIds } from "../test/ids";
// The one direct import of a `mix.tsx`, after the registry ("." above): see
// README, « Markup variants », on the cycle a variant closes.
import { variants as example } from "./_example/mix";
import { slotted } from "./components";
import type { EventCardProps, VariantName, VariantProps, VariantPropsOf } from "./types";

import "../styles.css";

// What the app draws of a skin, through the two factories of components.tsx:
// the motif of a slot, and a component that a skin replaces at depth mix or
// full. In each skin, at the depth of the run (`VITE_SKIN_DEPTH`): the suite
// runs at each depth.

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(() => {
  chooseSkin("crete");
});

/** What a component draws, on its own, its ids (`useId`, new at each render) set aside. */
async function html(element: Parameters<typeof render>[0]): Promise<string> {
  const screen = await render(element);
  const drawn = withoutIds(screen.container.innerHTML);
  await screen.unmount();
  return drawn;
}

/**
 * What a piece draws in the app: in its language, on a day, under a router (an
 * event card links to its page), its ids set aside. `look` sees it drawn, before
 * it goes.
 */
async function inApp(element: ReactNode, look?: (drawn: HTMLElement) => void): Promise<string> {
  const root = createRootRoute({
    component: () => (
      <I18nProvider languages={["fr"]}>
        <TodayProvider value={Temporal.PlainDate.from("2026-06-01")}>
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
  if (look && box) look(box);
  const drawn = withoutIds(box?.innerHTML ?? "");
  await screen.unmount();
  return drawn;
}

/** The event of the fixture, with all that its hero can show: notes, a link to register, a deadline 4 days ahead. */
const view = () =>
  toEventView({
    ...eventRecord,
    notes: "Départ à 7 h.",
    registration_url: "https://example.org/inscription",
    registration_deadline: "2026-06-05",
  });

/**
 * A piece made skinnable, drawn with the same props three ways: through
 * `skinnable`, as its base, and as the variant that a skin gives (with the base).
 */
type Piece = {
  name: VariantName;
  skinnable: () => ReactNode;
  base: () => ReactNode;
  /** The skin's variant, given the base, if the skin has one at the depth of the run. */
  variant: (skinId: string) => ReactNode | undefined;
};

function piece<N extends VariantName>(
  name: N,
  Skinnable: ComponentType<VariantProps[N]>,
  Base: ComponentType<VariantProps[N]>,
  props: () => VariantProps[N],
): Piece {
  return {
    name,
    skinnable: () => createElement(Skinnable, props()),
    base: () => createElement(Base, props()),
    variant: (skinId) => {
      const Variant = variantOf(skinId, name);
      // As `skinnable` gives it (see components.tsx).
      const given: Attributes & VariantPropsOf<N> = { key: undefined, ...props(), Base };
      return Variant && createElement(Variant, given);
    },
  };
}

/** Every piece of `VariantProps`: the test below goes through each. */
const NAMES: Record<VariantName, true> = {
  EmptyState: true,
  EventCard: true,
  EventHero: true,
  DateChip: true,
  RunnerHero: true,
  FormatTitle: true,
  TrackFigures: true,
  CountdownRing: true,
};

const pieces = (): Piece[] => [
  piece("EmptyState", EmptyState, EmptyStateBase, () => ({
    title: "Rien ici",
    hint: "Ajoute un événement.",
  })),
  piece("EventCard", EventCard, EventCardBase, () => ({ view: view(), list: "upcoming" })),
  piece("EventHero", EventHero, EventHeroBase, () => ({
    view: view(),
    heading: { id: "hero-title", "data-focus": "title", tabIndex: -1 },
  })),
  piece("DateChip", DateChip, DateChipBase, () => ({
    start: view().start,
    end: view().end,
    label: "du 13 au 14 juin",
  })),
  piece("RunnerHero", RunnerHero, RunnerHeroBase, () => ({
    runner: aliceRunner,
    heading: { ref: createRef<HTMLHeadingElement>(), tabIndex: -1 },
  })),
  piece("FormatTitle", FormatTitle, FormatTitleBase, () => {
    const formatView = view().formats[0];
    if (formatView === undefined) throw new Error("the fixture has no format");
    return { formatView, parts: ["Trail 42 km", "2 400 m D+", "max 10 h"] };
  }),
  piece("TrackFigures", TrackFigures, TrackFiguresBase, () => ({
    figures: ["12,6 km", "724 m D+", "728 m D−"],
    altitude: "altitude 450 m à 1 157 m",
    start: { lat: 45.9, lon: 6.13 },
  })),
  piece("CountdownRing", CountdownRing, CountdownRingBase, () => ({ days: 9 })),
];

test("slotted — chaque skin dessine son motif dans l'emplacement, ou celui de Crête", async () => {
  for (const skin of SKINS) {
    chooseSkin(skin.id);
    const expected = await html(createElement(slotOf(skin, "SectionMarker")));
    expect(await html(<SectionMarker />), `the mark of ${skin.id}`).toBe(expected);
  }
  // A slot made at the top of a module, as components/Slots.tsx does: the same.
  const Marker = slotted("SectionMarker");
  expect(Marker.displayName).toBe("Slot(SectionMarker)");
  chooseSkin("crete");
  expect(await html(<Marker />)).toBe(await html(<SectionMarker />));
});

test("skinnable — chaque pièce dessine sa base sans variante, et la variante du skin, qui reçoit la base, quand il en donne une", async () => {
  expect(pieces().map(({ name }) => name)).toEqual(Object.keys(NAMES));
  const replaced: string[] = [];
  const asBase: string[] = [];
  for (const { name, skinnable, base, variant } of pieces()) {
    for (const skin of SKINS) {
      chooseSkin(skin.id);
      const own = variant(skin.id);
      // Crête's, with the motifs of the skin, or the skin's variant given Crête's.
      const expected = await inApp(own ?? base());
      const drawn = await inApp(skinnable());
      expect(drawn, `${name} in ${skin.id} at ${SKIN_DEPTH}`).toBe(expected);
      if (own === undefined) continue;
      replaced.push(`${skin.id}: ${name}`);
      // A variant draws something of its own, around the base or instead of it.
      if (drawn === (await inApp(base()))) asBase.push(`${skin.id}: ${name}`);
    }
  }
  expect(asBase, "variants that draw the base as it is").toEqual([]);
  // A palette build replaces nothing; a mix or full build does (the example skin replaces the empty state and the card).
  expect(replaced.length > 0, `variants drawn at ${SKIN_DEPTH}`).toBe(SKIN_DEPTH !== "palette");
  expect(replaced.filter((line) => line.startsWith("_example:"))).toEqual(
    SKIN_DEPTH === "palette"
      ? []
      : ["_example: EmptyState", "_example: EventCard", "_example: EventHero"],
  );
});

test("skinnable — le haut d'une fiche, dans chaque skin, garde le titre que la page lui donne", async () => {
  // The page gives the focus to the title (`data-focus`, `tabIndex`, or the ref
  // of a runner's), and names it from its actions (`id`): a variant that drew
  // its own h1 without `heading` would leave the focus on the body.
  const checked: string[] = [];
  for (const skin of SKINS) {
    chooseSkin(skin.id);
    await inApp(
      <EventHero
        view={view()}
        heading={{ id: "hero-title", "data-focus": "title", tabIndex: -1 }}
      />,
      (drawn) => {
        const title = drawn.querySelector("h1");
        expect(title?.id, `the event's title in ${skin.id}`).toBe("hero-title");
        expect(title?.dataset.focus, `its focus mark in ${skin.id}`).toBe("title");
        expect(title?.tabIndex, `its tabIndex in ${skin.id}`).toBe(-1);
      },
    );
    const heading = createRef<HTMLHeadingElement>();
    await inApp(
      <RunnerHero runner={aliceRunner} heading={{ ref: heading, tabIndex: -1 }} />,
      () => {
        expect(heading.current?.tagName, `the runner's title in ${skin.id}`).toBe("H1");
        expect(heading.current?.tabIndex, `its tabIndex in ${skin.id}`).toBe(-1);
      },
    );
    checked.push(skin.id);
  }
  expect(checked).toEqual(SKINS.map(({ id }) => id));
});

test("skinnable — la carte d'« Exemple » encadre la base qu'elle reçoit, avec les props de la carte", async () => {
  // Its module, whatever the depth of the run (a skin of development is in the tests).
  const ExampleCard = example.EventCard;
  expect(ExampleCard, "the example skin's event card").toBeDefined();
  if (ExampleCard === undefined) return;
  const shown = view();
  const given: EventCardProps[] = [];
  function Base(props: EventCardProps) {
    given.push(props);
    return <p data-base="">{props.view.event.name}</p>;
  }
  const screen = await render(<ExampleCard view={shown} list="past" Base={Base} />);
  // The base has the props of the card, and nothing else.
  expect(given).toStrictEqual([{ view: shown, list: "past" }]);
  const frame = screen.container.querySelector<HTMLElement>('[data-variant="example"]');
  expect(frame?.dataset.list).toBe("past");
  expect(frame?.querySelector("[data-base]")?.textContent).toBe("Trail des Crêtes");
});

test("skinnable — sous « Exemple », une carte est la base de Crête dans le cadre de la variante à mix et full, la base seule à palette", async () => {
  chooseSkin("_example");
  const box = document.createElement("div");
  box.innerHTML = await inApp(<EventCard view={view()} list="agenda" />);
  const frame = box.querySelector<HTMLElement>('[data-variant="example"]');
  // Crête's card, its link to the page of the event and its day: in the frame or alone.
  const card = box.querySelector(".event-card");
  expect(card?.querySelector('a[href="/evenements/event"]')?.textContent).toBe("Trail des Crêtes");
  expect(card?.querySelector(".date-chip")).not.toBeNull();
  const framed = SKIN_DEPTH !== "palette";
  expect(frame !== null, `a frame at ${SKIN_DEPTH}`).toBe(framed);
  expect(frame?.dataset.list).toBe(framed ? "agenda" : undefined);
  expect(frame?.contains(card) ?? false, "Crête's card in the frame").toBe(framed);
});
