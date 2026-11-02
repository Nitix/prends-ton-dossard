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
import { colourOf } from "../../test/computed";
import { withoutIds } from "../../test/ids";

import "../../styles.css";
import "../../skins/styles";

// « Carnet » at depth mix: the card and the top of the page of an event keep
// what Crête's show (every text, every link, every list with its name), and draw
// the markup of a sheet of the logbook; the card that offers a key to sign in is
// the navy card of the variant, and what is under the pointer takes a visible
// tint of coral. In a build at palette it redraws nothing: the checks then say
// the piece is Crête's own.

const ID = "carnet";

/** The source of the card that offers a key to sign in. */
const banner = Object.values(
  import.meta.glob<string>("../../features/home/PasskeyBanner.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
).join("");

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

test("carnet — la carte et le haut de la page viennent de mix.tsx : à mix la variante, à palette rien ; le jour est la puce de Crête", () => {
  for (const name of ["EventCard", "EventHero"] as const) {
    expect(variantOf(ID, name) !== undefined).toBe(SKIN_DEPTH !== "palette");
  }
  for (const name of ["DateChip", "RunnerHero"] as const) {
    expect(variantOf(ID, name)).toBeUndefined();
  }
});

test("carnet — la carte d'un événement garde tout ce que celle de Crête dit, avec son nom en deux voix et le carré de chaque épreuve", async () => {
  chooseSkin(ID);
  const [own, crete] = await keepsEverything(
    <EventCard view={view()} list="upcoming" />,
    <EventCardBase view={view()} list="upcoming" />,
  );
  const card = document.createElement("div");
  card.innerHTML = own ?? "";
  expect(card.querySelector("article.event-card")).not.toBeNull();
  expect(card.querySelector(".date-chip"), "the day").not.toBeNull();
  // The title is the same text in two faces: its last word in the serif.
  const link = card.querySelector("h3 a");
  expect(link?.textContent).toBe("Trail des Crêtes");
  expect(link?.querySelector(".font-serif")?.textContent ?? "Crêtes").toBe("Crêtes");
  // The squares are pictures, hidden, and the name of each kind is written beside them.
  for (const mark of card.querySelectorAll("li p > span[style]")) {
    expect(mark.getAttribute("aria-hidden")).toBe("true");
  }
  expect(own !== crete, "drawn by the skin").toBe(SKIN_DEPTH !== "palette");
  expect(card.textContent?.includes("dans 12 jours")).toBe(SKIN_DEPTH !== "palette");
});

test("carnet — le haut de la page d'un événement garde tout ce que celui de Crête dit : le titre de la page en deux voix, les jours, la date limite, les notes, le lien", async () => {
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
});

/** The classes of the card that offers a key to sign in, as the component writes them. */
const PASSKEY_SECTION = /<section[^>]*className="[^"]*\bbg-iris-50\b[^"]*\bring-iris-100\b/;

test("carnet — la carte de la clé d'accès a une classe que la feuille de mix lit : si le composant la change, ce test le dit", () => {
  // mix.css has no class of the component to hold on to (it has none): it reads
  // its utility classes. Change them, and the navy card is lost without a word.
  expect(banner).toMatch(PASSKEY_SECTION);
});

test("carnet — la carte de la clé d'accès est la carte marine de la variante à mix, ses mots lisibles ; à palette, le papier", async () => {
  chooseSkin(ID);
  const screen = await render(
    <section className="relative flex flex-col gap-2 overflow-hidden rounded-[1.25rem] bg-iris-50 p-4 ring-1 ring-iris-100">
      <span aria-hidden="true" className="absolute -top-12 -right-10 size-36 rounded-full" />
      <h2 className="card-title relative">Ajoute une clé d'accès</h2>
      <p className="relative text-sm text-neutral-700">Une clé d'accès te connecte.</p>
      <button type="button" className="btn-secondary">
        Masquer
      </button>
    </section>,
  );
  const card = screen.container.querySelector("section");
  const glow = card?.querySelector("span");
  const hide = card?.querySelector("button");
  if (!card || !glow || !hide) throw new Error("the card was not drawn");
  const deep = SKIN_DEPTH !== "palette";
  expect(getComputedStyle(card).backgroundColor).toBe(
    colourOf(deep ? "--dawn-sky-color" : "--color-iris-50"),
  );
  expect(getComputedStyle(glow).display !== "none", "the glow").toBe(!deep);
  // Its words: white on the navy, and the button (white too) keeps its ink.
  expect(getComputedStyle(card.querySelector("h2") ?? card).color).toBe(
    deep ? colourOf("--color-card") : colourOf("--color-ink"),
  );
  expect(getComputedStyle(hide).color).toBe(colourOf("--color-ink"));
  await screen.unmount();
});

test("carnet — ce qui est sous le pointeur prend une teinte de corail visible : plus le papier d'iris-50, presque le blanc d'une feuille", async () => {
  chooseSkin(ID);
  const screen = await render(
    <button type="button" className="bg-card hover:bg-iris-50">
      Retirer
    </button>,
  );
  const button = screen.getByRole("button", { name: "Retirer" });
  const rest = getComputedStyle(button.element()).backgroundColor;
  expect(rest).toBe(colourOf("--color-card"));
  await button.hover();
  const hovered = getComputedStyle(button.element()).backgroundColor;
  expect(hovered).toBe(colourOf(SKIN_DEPTH === "palette" ? "--color-iris-50" : "--color-iris-100"));
  await screen.unmount();
});
