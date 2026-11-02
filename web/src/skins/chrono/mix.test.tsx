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
import { HeaderArt } from "./motifs";

import "../../styles.css";
import "../../skins/styles";

// « Chrono » at depth mix: the card and the top of the page of an event keep
// what Crête's show (every text, every link, every list with its name), and draw
// the markup of a watch. In a build at palette it redraws nothing: the checks
// then say the piece is Crête's own.

const ID = "chrono";

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

test("chrono — la carte et le haut de la page viennent de mix.tsx : à mix la variante, à palette rien ; le jour est la puce de Crête", () => {
  for (const name of ["EventCard", "EventHero"] as const) {
    expect(variantOf(ID, name) !== undefined).toBe(SKIN_DEPTH !== "palette");
  }
  for (const name of ["DateChip", "RunnerHero"] as const) {
    expect(variantOf(ID, name)).toBeUndefined();
  }
});

test("chrono — la carte d'un événement garde tout ce que celle de Crête dit, avec l'anneau des jours et la barre de zone de chaque épreuve", async () => {
  chooseSkin(ID);
  const [own, crete] = await keepsEverything(
    <EventCard view={view()} list="upcoming" />,
    <EventCardBase view={view()} list="upcoming" />,
  );
  const card = document.createElement("div");
  card.innerHTML = own ?? "";
  expect(card.querySelector("article.event-card")).not.toBeNull();
  expect(card.querySelector(".date-chip"), "the day").not.toBeNull();
  // The marks are pictures: each is hidden, and what it means is written beside it.
  for (const mark of card.querySelectorAll("li > p > span[style]")) {
    expect(mark.getAttribute("aria-hidden")).toBe("true");
  }
  expect(own !== crete, "drawn by the skin").toBe(SKIN_DEPTH !== "palette");
  expect(card.querySelectorAll("[aria-hidden=true][style*=slope]").length > 0).toBe(
    SKIN_DEPTH !== "palette",
  );
  // The ring says the days left in words, for a screen reader (the event is in 12 days).
  expect(card.textContent?.includes("dans 12 jours")).toBe(SKIN_DEPTH !== "palette");
});

test("chrono — le haut de la page d'un événement garde tout ce que celui de Crête dit, et montre les chiffres de ses épreuves", async () => {
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
  const register = hero.querySelector("a[href='https://example.org/inscription']");
  expect(register?.getAttribute("rel")).toBe("noopener noreferrer");
  expect(own !== crete, "drawn by the skin").toBe(SKIN_DEPTH !== "palette");
  // The screen of figures: the formats are 15 and 42 km, 700 and 2 400 m, a limit of 10 h.
  const figures = [...hero.querySelectorAll("dl > div")]
    .map((one) => plain(one.textContent))
    .join("|");
  const shown = [/distance.*15.*42.*km/, /D[+].*700.*2.*400.*m/, /temps max.*10h/].map((figure) =>
    figure.test(figures),
  );
  expect(shown).toEqual(SKIN_DEPTH === "palette" ? [false, false, false] : [true, true, true]);
});

test("chrono — le cadran de la page de connexion tient sous la carte : pas plus de 13 rem, entier", async () => {
  chooseSkin(ID);
  const screen = await render(
    <div style={{ position: "relative", width: 375, height: 812 }}>
      <HeaderArt place="welcome" />
    </div>,
  );
  const dial = screen.container.querySelector("svg[viewBox='0 0 200 200']");
  expect(dial).not.toBeNull();
  const box = dial?.getBoundingClientRect();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.width ?? 999).toBeLessThanOrEqual(13 * 16 + 1);
  await screen.unmount();
});
