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

// « Rétro » at depth mix: its ticket keeps what Crête's card shows (every
// text, every link, every list with its name), and draws the markup of a ticket. In a build at palette it
// redraws nothing: the checks then say the card is Crête's own.

const ID = "retro";

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

test("retro — la carte vient de mix.tsx : à mix la variante, à palette rien ; le reste est à la feuille", () => {
  expect(variantOf(ID, "EventCard") !== undefined).toBe(SKIN_DEPTH !== "palette");
  // The stamp of the day is Crête's chip, dressed by mix.css, and so are the tops of the pages.
  for (const name of ["DateChip", "EventHero", "RunnerHero"] as const) {
    expect(variantOf(ID, name)).toBeUndefined();
  }
});

test("retro — la carte d'un événement garde tout ce que celle de Crête dit, sous la forme d'un billet", async () => {
  chooseSkin(ID);
  const [own, crete] = await keepsEverything(
    <EventCard view={view()} list="upcoming" />,
    <EventCardBase view={view()} list="upcoming" />,
  );
  const card = document.createElement("div");
  card.innerHTML = own ?? "";
  expect(card.querySelector("article.event-card")).not.toBeNull();
  expect(card.querySelector(".date-chip"), "the day").not.toBeNull();
  expect(card.querySelector(".date-chip")?.getAttribute("aria-hidden")).toBe("true");
  // The measures of a format are tags: the words are the same, and the separators stay in the text.
  expect(card.querySelectorAll("li .sr-only").length).toBeGreaterThan(0);
  // The perforation is a picture, with nothing to read.
  const perforation = card.querySelector(".perforation");
  expect(perforation?.getAttribute("aria-hidden") === "true" || perforation === null).toBe(true);
  expect(own !== crete, "drawn by the skin").toBe(SKIN_DEPTH !== "palette");
  expect(perforation !== null, "a ticket has its perforation").toBe(SKIN_DEPTH !== "palette");
});

test("retro — un événement sans coureur ni épreuve est un billet sans talon : ni perforation, ni liste", async () => {
  chooseSkin(ID);
  const bare = toEventView({ ...eventRecord, expand: {} });
  const own = await drawn(<EventCard view={bare} list="past" />);
  expect(own.box.querySelector(".perforation")).toBeNull();
  expect(own.box.querySelector("ul")).toBeNull();
  expect(own.box.querySelector("a[href='/evenements/event']")?.textContent).toBe(
    "Trail des Crêtes",
  );
  await own.unmount();
});
