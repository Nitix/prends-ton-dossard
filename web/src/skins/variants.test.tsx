import {
  createElement,
  createRef,
  type Attributes,
  type ComponentType,
  type ReactNode,
} from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

import { SKIN_DEPTH, SKINS, chooseSkin, variantOf } from ".";
import { CountdownRingBase, DateChipBase } from "../components/Dawn";
import { EmptyStateBase } from "../components/EmptyState";
import { EventCardBase } from "../features/events/EventCard";
import { EventHeroBase } from "../features/events/EventHero";
import { formatMeasures } from "../features/events/formatName";
import { FormatTitleBase } from "../features/events/FormatTitle";
import { aliceRunner } from "../features/events/testFixture";
import { TrackFiguresBase } from "../features/route/TrackFigures";
import { RunnerHeroBase } from "../features/runners/RunnerHero";
import { fr } from "../i18n/fr";
import { createFormatters } from "../lib/format";
import { ensureTemporal } from "../lib/temporal";
import {
  EVENT_SHAPES,
  inApp,
  keepsEverything,
  said,
  type DrawOptions,
  type EventShape,
} from "../test/variant";
import type { EventCardList, VariantName, VariantProps, VariantPropsOf } from "./types";

import "../styles.css";
import "../skins/styles";

// The feature test every variant gets, whoever writes it: in each skin, each
// piece it replaces at the depth of the run says everything its base says
// (every text a screen reader has, every link, every named list, every
// button), over the shapes an event can take (`EVENT_SHAPES` of
// ../test/variant.tsx: rich, registrations closed, no format, a single day,
// under way, a one-word name, next year). A picture (the ring of the days left)
// says nothing, as its base. The variants are reached through the registry
// (`variantOf`), never by importing a `mix.tsx` or `full.tsx`.

vi.mock("../lib/pb", async () => (await import("../test/pbMock")).pbModule);

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(() => {
  chooseSkin("crete");
});

/** One case of a piece: what it is, its props, and the day it is seen on (1 June 2026 by default). */
type Case<N extends VariantName> = { what: string; props: VariantProps[N]; today?: string };

/** How a variant is held to its base: it says all the base says (or, for a picture, nothing). */
type Holds = (
  own: ReactNode,
  base: ReactNode,
  options: DrawOptions & { what: string },
) => Promise<unknown>;

/** A picture says nothing to a screen reader, as its base: the words beside it say what it shows. */
const saysNothing: Holds = async (own, _base, { what, ...options }) => {
  const spoken = await inApp(own, (drawn) => said(drawn).texts, options);
  expect(spoken, `${what} says nothing to a screen reader`).toEqual([]);
};

/** A piece of `VariantProps`, its base and its cases, and how its variant is held to the base. */
function piece<N extends VariantName>(
  name: N,
  Base: ComponentType<VariantProps[N]>,
  cases: () => Case<N>[],
  holds: Holds = keepsEverything,
) {
  return {
    name,
    /** Checks the variant of `skin` against its base, in each case; false when the skin has none. */
    check: async (skin: string): Promise<boolean> => {
      const Variant = variantOf(skin, name);
      if (Variant === undefined) return false;
      for (const { what, props, today } of cases()) {
        // As `skinnable` gives it (see components.tsx).
        const given: Attributes & VariantPropsOf<N> = { key: undefined, ...props, Base };
        await holds(createElement(Variant, given), createElement(Base, props), {
          today,
          what: `${skin}: ${name}, ${what}`,
        });
      }
      return true;
    },
  };
}

const LISTS: EventCardList[] = ["home", "upcoming", "past", "agenda"];

const heading = () => ({ id: "hero-title", "data-focus": "title", tabIndex: -1 }) as const;

const f = createFormatters("fr-FR");

/** The rich event in every list, the other shapes in the list of what is to come. */
function cardCases(): Case<"EventCard">[] {
  const [rich, ...others] = EVENT_SHAPES();
  const inLists = rich
    ? LISTS.map((list) => ({ what: `${rich.what}, ${list}`, props: { view: rich.view, list } }))
    : [];
  return [
    ...inLists,
    ...others.map(({ what, view, today }) => ({
      what,
      props: { view, list: "upcoming" as const },
      today,
    })),
  ];
}

/** The day of an event as a card gives it: its first and last days, and the date in words. */
function dayOf({ what, view, today }: EventShape): Case<"DateChip"> {
  const several = !view.start.equals(view.end);
  return {
    what,
    props: {
      start: view.start,
      end: view.end,
      label: several
        ? fr.event.dateRange(f.date(view.start), f.date(view.end))
        : f.date(view.start),
    },
    today,
  };
}

/** Every piece of `VariantProps`: the record says so, a new one fails to typecheck until it is here. */
const PIECES: { [N in VariantName]: ReturnType<typeof piece<N>> } = {
  EmptyState: piece("EmptyState", EmptyStateBase, () => [
    { what: "an empty list", props: { title: "Rien ici", hint: "Ajoute-en un." } },
  ]),
  EventCard: piece("EventCard", EventCardBase, cardCases),
  EventHero: piece("EventHero", EventHeroBase, () =>
    EVENT_SHAPES().map(({ what, view, today }) => ({
      what,
      props: { view, heading: heading() },
      today,
    })),
  ),
  DateChip: piece("DateChip", DateChipBase, () => EVENT_SHAPES().map(dayOf)),
  RunnerHero: piece("RunnerHero", RunnerHeroBase, () => [
    {
      what: "a runner",
      props: { runner: aliceRunner, heading: { ref: createRef(), tabIndex: -1 } },
    },
    {
      what: "a runner on the way",
      props: { runner: undefined, heading: { ref: createRef(), tabIndex: -1 } },
    },
  ]),
  FormatTitle: piece("FormatTitle", FormatTitleBase, () =>
    EVENT_SHAPES().flatMap(({ what, view }) =>
      view.formats.map((formatView) => ({
        what: `${what}, ${formatView.format.id}`,
        props: {
          formatView,
          parts: formatMeasures(formatView.format, formatView.raceType.label, f, fr),
        },
      })),
    ),
  ),
  TrackFigures: piece("TrackFigures", TrackFiguresBase, () => [
    {
      what: "a track with altitudes",
      props: {
        figures: ["12,6 km", "724 m D+", "728 m D−"],
        altitude: "altitude 450 m à 1 157 m",
        start: { lat: 45.9, lon: 6.13 },
      },
    },
    { what: "a track without altitudes", props: { figures: ["8,2 km"], altitude: null } },
  ]),
  CountdownRing: piece(
    "CountdownRing",
    CountdownRingBase,
    () => [
      { what: "on the day", props: { days: 0 } },
      { what: "in 9 days", props: { days: 9 } },
      { what: "far away", props: { days: 45 } },
      { what: "on the sky of a hero", props: { days: 9, tone: "light" } },
    ],
    saysNothing,
  ),
};

test("variantes — chaque pièce remplacée par un skin dit tout ce que dit sa base, dans chaque forme d'événement", async () => {
  const checked: string[] = [];
  for (const skin of SKINS) {
    chooseSkin(skin.id);
    for (const { name, check } of Object.values(PIECES)) {
      if (await check(skin.id)) checked.push(`${skin.id}: ${name}`);
    }
  }
  // At palette no skin replaces anything; at mix and full, the variants of the skins are here.
  expect(checked.length > 0, `variants checked at ${SKIN_DEPTH}`).toBe(SKIN_DEPTH !== "palette");
});

test("variantes — les formes d'événement couvrent ce qu'une carte peut dire", () => {
  const shapes = EVENT_SHAPES();
  expect(shapes.map(({ what }) => what)).toEqual([
    "rich",
    "registrations closed",
    "no format",
    "a single day, no deadline",
    "under way",
    "a one-word name",
    "next year",
  ]);
  const [rich] = shapes;
  // Not an empty fixture: two days, formats with their runners, interested and supporters, notes, a link, a deadline.
  expect(rich?.view.formats.length).toBeGreaterThan(1);
  expect(rich?.view.interested.length).toBeGreaterThan(0);
  expect(rich?.view.supporters.length).toBeGreaterThan(0);
  expect(rich?.view.event.notes).not.toBe("");
  expect(rich?.view.event.registration_url).not.toBe("");
  expect(shapes.find(({ what }) => what === "under way")?.today).toBe("2026-06-13");
});
