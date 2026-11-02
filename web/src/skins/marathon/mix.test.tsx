import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { afterEach, beforeAll, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { SKIN_DEPTH, chooseSkin, variantOf } from "..";
import { DateChip, DateChipBase } from "../../components/Dawn";
import { toEventView } from "../../features/events/api";
import { EventCard, EventCardBase } from "../../features/events/EventCard";
import { EventHero, EventHeroBase } from "../../features/events/EventHero";
import {
  eventRecord,
  pNinaSupporter,
  pNinaUndecided,
  withParticipations,
} from "../../features/events/testFixture";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";
import { withoutIds } from "../../test/ids";

import "../../styles.css";
import "../../skins/styles";

// « Marathon » at depth mix: each piece it redraws keeps what Crête's shows
// (every text, every link, every list with its name), and draws the markup of
// the poster. In a build at palette it redraws nothing: the checks then say the
// piece is Crête's own.

const ID = "marathon";

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(() => {
  chooseSkin("crete");
});

/** The event of the fixture with all that its pieces can show: a deadline in 4 days, notes, a link to register, someone interested and a supporter. */
const view = () =>
  toEventView(
    withParticipations(
      {
        ...eventRecord,
        notes: "Départ à 7 h.",
        registration_url: "https://example.org/inscription",
        registration_deadline: "2026-06-05",
      },
      [pNinaUndecided, pNinaSupporter],
    ),
  );

/** What a piece draws in the app (its language, its day, a router for its links). */
async function drawn(element: ReactNode) {
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
  if (box === null) throw new Error("the piece was not drawn");
  return { box, unmount: () => screen.unmount() };
}

const plain = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();

/** What a piece says: each of its texts, its links (words and address), the names of its lists. */
function said(box: Element) {
  const texts: string[] = [];
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = plain(node.textContent);
    if (text !== "") texts.push(text);
  }
  return {
    texts,
    flat: plain(box.textContent),
    links: [...box.querySelectorAll("a[href]")].map(
      (link) => `${plain(link.textContent)} → ${link.getAttribute("href")}`,
    ),
    names: [...box.querySelectorAll("[aria-label]")].map((one) => one.getAttribute("aria-label")),
    buttons: [...box.querySelectorAll("button")].map((one) => plain(one.textContent)),
  };
}

/** The skin's piece says everything that Crête's says. */
async function keepsEverything(skinned: ReactNode, base: ReactNode) {
  const [own, crete] = [await drawn(skinned), await drawn(base)];
  const [ours, theirs] = [said(own.box), said(crete.box)];
  for (const text of theirs.texts) expect(ours.flat, `the text « ${text} »`).toContain(text);
  expect(ours.links, "its links").toEqual(expect.arrayContaining(theirs.links));
  expect(ours.names, "its lists").toEqual(expect.arrayContaining(theirs.names));
  expect(ours.buttons, "its buttons").toEqual(expect.arrayContaining(theirs.buttons));
  const html = [withoutIds(own.box.innerHTML), withoutIds(crete.box.innerHTML)];
  await own.unmount();
  await crete.unmount();
  return html;
}

test("marathon — chaque pièce redessinée vient de mix.tsx : à mix la variante, à palette rien", () => {
  for (const name of ["DateChip", "EventCard", "EventHero"] as const) {
    expect(variantOf(ID, name) !== undefined).toBe(SKIN_DEPTH !== "palette");
  }
  // Left to its CSS: the top of the page of a runner.
  expect(variantOf(ID, "RunnerHero")).toBeUndefined();
});

test("marathon — la carte d'un événement garde tout ce que celle de Crête dit, sur un programme à filets", async () => {
  chooseSkin(ID);
  const [own, crete] = await keepsEverything(
    <EventCard view={view()} list="upcoming" />,
    <EventCardBase view={view()} list="upcoming" />,
  );
  const card = document.createElement("div");
  card.innerHTML = own ?? "";
  expect(card.querySelector("article.event-card")).not.toBeNull();
  expect(card.querySelector(".date-chip"), "the day").not.toBeNull();
  // The measures of a format are tags: the words are the same, and the separators stay in the text.
  expect(card.querySelectorAll("li .sr-only").length).toBeGreaterThan(0);
  expect(own !== crete, "drawn by the skin").toBe(SKIN_DEPTH !== "palette");
});

test("marathon — le jour d'un événement est un numéro de dossard, dit en toutes lettres à un lecteur d'écran", async () => {
  chooseSkin(ID);
  const { start, end } = view();
  const props = { start, end, label: "du 13 au 14 juin" };
  const [own, crete] = await keepsEverything(<DateChip {...props} />, <DateChipBase {...props} />);
  const day = document.createElement("div");
  day.innerHTML = own ?? "";
  // The picture is hidden, the words are for the screen readers, and it does not shrink in a row.
  const picture = day.querySelector(".date-chip");
  expect(picture?.getAttribute("aria-hidden")).toBe("true");
  expect(picture?.className).toContain("shrink-0");
  expect(picture?.className).toContain("self-start");
  expect(day.querySelector(".sr-only")?.textContent).toBe("du 13 au 14 juin");
  expect(own !== crete, "drawn by the skin").toBe(SKIN_DEPTH !== "palette");
});

test("marathon — le haut de la page d'un événement garde tout ce que celui de Crête dit : le titre de la page, les jours, la date limite, les notes, le lien", async () => {
  chooseSkin(ID);
  const heading = { id: "title", "data-focus": "page-title", tabIndex: -1 } as const;
  const [own, crete] = await keepsEverything(
    <EventHero view={view()} heading={heading} />,
    <EventHeroBase view={view()} heading={heading} />,
  );
  const hero = document.createElement("div");
  hero.innerHTML = own ?? "";
  expect(hero.querySelector("header.event-hero")).not.toBeNull();
  const title = hero.querySelector("h1");
  expect(title?.id).toBe("title");
  expect(title?.getAttribute("data-focus")).toBe("page-title");
  expect(title?.textContent).toBe("Trail des Crêtes");
  // The link to register opens another tab, as Crête's does.
  const register = hero.querySelector("a[href='https://example.org/inscription']");
  expect(register?.getAttribute("rel")).toBe("noopener noreferrer");
  expect(own !== crete, "drawn by the skin").toBe(SKIN_DEPTH !== "palette");
});
