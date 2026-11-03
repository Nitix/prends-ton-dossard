import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { SKINS, chooseSkin } from ".";
import { ToastProvider } from "../components/Toast";
import {
  aliceRunner,
  bobRunner,
  event2Record,
  eventRecord,
  ninaRunner,
  pNinaSupporter,
  pNinaUndecided,
  roadType,
  samRunner,
  trailType,
  withParticipations,
} from "../features/events/testFixture";
import { I18nProvider } from "../i18n/I18nProvider";
import { ensureTemporal } from "../lib/temporal";
import { chooseTheme } from "../lib/theme";
import { TodayProvider } from "../lib/useToday";
import { routeTree } from "../routeTree.gen";
import { contrast } from "../test/colour";
import { colourOf, rgbaOf } from "../test/computed";
import { fontsReady } from "../test/fontsReady";

import "../styles.css";

// What a skin draws behind the content of the page, on its sheet (`PageArt`,
// src/skins/README.md): Crête, and every skin that does not draw one, nothing,
// so that their page is what it was; « Carnet », the sheet of dots of the
// v4's background, which the text over it must stay legible on (4.5:1).

const events = [
  withParticipations(eventRecord, [pNinaUndecided, pNinaSupporter]),
  event2Record,
  { ...event2Record, id: "event5", name: "Cross du Salève", start_date: "2026-06-27" },
];

const lists: Record<string, unknown[]> = {
  events,
  runners: [aliceRunner, bobRunner, samRunner, ninaRunner],
  race_types: [trailType, roadType],
};

vi.mock("../lib/pb", () => ({
  pb: {
    authStore: {
      isValid: true,
      token: "token",
      get record() {
        return { id: "u-alice", collectionName: "users", role: "member", email: "a@example.test" };
      },
      onChange: () => () => {},
    },
    filter: (raw: string) => raw,
    // The settings page asks for the tokens of the assistants, which are a list; the other pages have no use for the answer.
    send: (path: string) =>
      Promise.resolve(
        path === "/api/app/mcp-tokens"
          ? { url: "http://localhost:5173/mcp", max: 5, tokens: [] }
          : {},
      ),
    collection: (name: string) => ({
      getFullList: () => Promise.resolve(lists[name] ?? []),
      getList: () => Promise.resolve({ items: [], page: 1, perPage: 1, totalItems: 0 }),
      getFirstListItem: () => Promise.resolve(aliceRunner),
      getOne: () => Promise.resolve(eventRecord),
    }),
    files: { getURL: () => "" },
  },
}));

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(async () => {
  await page.viewport(1280, 900);
});

afterEach(async () => {
  lists.events = events;
  await chooseSkin("crete");
  chooseTheme("auto");
  window.scrollTo(0, 0);
  await page.viewport(414, 896);
});

async function openApp(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider languages={["fr"]}>
        <TodayProvider value={Temporal.PlainDate.from("2026-06-01")}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </TodayProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

/** The sheet of the page, which the content stands on. */
function sheet(): HTMLElement {
  const found = document.querySelector<HTMLElement>(".sheet");
  if (!found) throw new Error("no sheet");
  return found;
}

for (const skin of SKINS.filter((one) => one.id !== "carnet")) {
  test(`PageArt — ${skin.id} ne dessine rien derrière la page : la feuille n'a que son contenu`, async () => {
    await chooseSkin(skin.id);
    chooseTheme("light");
    for (const width of [375, 1280]) {
      await page.viewport(width, 900);
      const screen = await openApp("/liste");
      await expect.element(screen.getByRole("heading", { level: 1 })).toBeVisible();
      // The sheet holds the page's `main` and nothing else: no art, no extra box.
      expect(
        [...sheet().children].map((child) => child.tagName.toLowerCase()),
        `${width} px`,
      ).toEqual(["main"]);
      for (const which of ["::before", "::after"] as const) {
        expect(getComputedStyle(sheet(), which).content, `${width} px ${which}`).toBe("none");
      }
      await screen.unmount();
    }
  });
}

test("PageArt — Crête : la feuille est ce qu'elle était, aucun point derrière la page", async () => {
  const screen = await openApp("/liste");
  await expect.element(screen.getByRole("heading", { level: 1 })).toBeVisible();
  const style = getComputedStyle(sheet());
  expect(style.position).toBe("relative");
  expect(style.zIndex).toBe("10");
  expect(style.backgroundImage).toBe("none");
  expect(style.overflow).toBe("visible");
  // The ground of the sheet is the paper of the page, and nothing is drawn over it.
  expect(rgbaOf(style.backgroundColor)).toEqual(
    rgbaOf(getComputedStyle(document.body).backgroundColor),
  );
});

test("PageArt — Carnet : la feuille de points est dans la feuille, derrière le contenu, hors de portée du doigt", async () => {
  await chooseSkin("carnet");
  const screen = await openApp("/liste");
  await expect.element(screen.getByRole("heading", { level: 1 })).toBeVisible();
  await fontsReady();

  const art = sheet().firstElementChild;
  if (!(art instanceof HTMLElement)) throw new Error("no art");
  // Before the content, silent, and over the whole sheet.
  expect(art.getAttribute("aria-hidden")).toBe("true");
  expect(art.nextElementSibling?.tagName.toLowerCase()).toBe("main");
  const [artBox, sheetBox] = [art.getBoundingClientRect(), sheet().getBoundingClientRect()];
  expect(artBox.top).toBeCloseTo(sheetBox.top, 0);
  expect(artBox.height).toBeCloseTo(sheetBox.height, 0);
  expect(artBox.width).toBeCloseTo(sheetBox.width, 0);
  // Under the content, and never in the way of a tap.
  const style = getComputedStyle(art);
  expect(style.position).toBe("absolute");
  expect(style.zIndex).toBe("-1");
  expect(style.pointerEvents).toBe("none");
  // The title of the page is what is at its place, not the art.
  const title = screen.getByRole("heading", { level: 1 }).element().getBoundingClientRect();
  const at = document.elementFromPoint(title.left + 4, title.top + title.height / 2);
  expect(at?.closest(".carnet-page"), "the element at the title").toBeNull();
  // The dots are drawn, in the sheet's own paper: nothing else of the page is behind them.
  const dots = art.querySelector(".carnet-page-dots");
  if (!dots) throw new Error("no dots");
  expect(getComputedStyle(dots).maskImage).not.toBe("none");
  expect(rgbaOf(getComputedStyle(dots).backgroundColor)[3]).toBeGreaterThan(0);
});

/** A computed colour as `#rrggbb` (its alpha set aside). */
const hexOf = (colour: string) =>
  `#${rgbaOf(colour)
    .slice(0, 3)
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;

/** The colour of the dots of Carnet's sheet, laid over the paper it is drawn on: `#rrggbb`. */
function dotsOverPaper(art: Element): string {
  const probe = document.createElement("span");
  probe.style.color = "var(--carnet-dot)";
  art.append(probe);
  const dot = rgbaOf(getComputedStyle(probe).color);
  probe.remove();
  const paper = rgbaOf(getComputedStyle(sheet()).backgroundColor);
  const blend = [0, 1, 2].map((at) =>
    Math.round((dot[at] ?? 0) * dot[3] + (paper[at] ?? 0) * (1 - dot[3])),
  );
  return `#${blend.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** The elements of the page that have words of their own and stand on the paper (no card behind them). */
function textOnPaper(): HTMLElement[] {
  const main = sheet().querySelector("main");
  if (!main) throw new Error("no main");
  return [...main.querySelectorAll<HTMLElement>("*")].filter((element) => {
    const words = [...element.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
    );
    if (!words || !element.checkVisibility()) return false;
    for (let at: Element | null = element; at !== null && at !== sheet(); at = at.parentElement) {
      const style = getComputedStyle(at);
      if (rgbaOf(style.backgroundColor)[3] > 0 || style.backgroundImage !== "none") return false;
    }
    return true;
  });
}

// The pages with words straight on the paper, and how many at least (a page whose
// words are all in cards or on its hero has none: the event page).
for (const [path, width, empty, least] of [
  ["/", 375, false, 3],
  ["/", 1280, false, 3],
  ["/", 375, true, 2],
  ["/liste", 375, false, 2],
  ["/liste", 1280, false, 2],
  ["/agenda", 1280, false, 2],
  ["/agenda", 375, false, 2],
  ["/evenements/event", 375, false, 0],
  ["/evenements/event", 1280, false, 0],
  ["/coureurs/aliceRunner0000", 375, false, 3],
  ["/coureurs/aliceRunner0000", 1280, false, 3],
  ["/stats", 1280, false, 2],
  ["/profil", 375, false, 3],
  ["/profil/reglages", 1280, false, 1],
] as const) {
  test(`PageArt — Carnet, ${path} à ${width} px${empty ? ", sans événement" : ""} : les mots sur le papier gardent 4,5:1 sur les points`, async () => {
    lists.events = empty ? [] : events;
    await chooseSkin("carnet");
    await page.viewport(width, 900);
    const screen = await openApp(path);
    await expect.element(screen.getByRole("heading", { level: 1 })).toBeVisible();
    await fontsReady();
    const art = sheet().firstElementChild;
    if (!art) throw new Error("no art");
    const paper = hexOf(getComputedStyle(sheet()).backgroundColor);
    const dots = dotsOverPaper(art);
    // The dots are there to be seen: not the colour of the paper.
    expect(contrast(dots, paper), "the dots against the paper").toBeGreaterThan(1.1);

    const words = textOnPaper();
    // Not an empty search: the title, and what is under it.
    expect(words.length, "the words on the paper").toBeGreaterThanOrEqual(least);
    const weak = words.flatMap((element) => {
      const hex = hexOf(getComputedStyle(element).color);
      // On the paper, and on a dot of the sheet (the darker of the two grounds).
      const ratio = Math.min(contrast(hex, paper), contrast(hex, dots));
      return ratio < 4.5
        ? [`${(element.textContent ?? "").trim().slice(0, 30)}: ${ratio.toFixed(2)}`]
        : [];
    });
    expect(weak).toEqual([]);
  });
}

test("PageArt — Carnet : les mots les plus pâles de l'appli (neutral-600, le texte second) gardent 4,5:1 sur le papier et sur un point", async () => {
  await chooseSkin("carnet");
  const screen = await openApp("/");
  await expect.element(screen.getByRole("heading", { level: 1 })).toBeVisible();
  const art = sheet().firstElementChild;
  if (!art) throw new Error("no art");
  const palest = hexOf(colourOf("--color-neutral-600"));
  const paper = hexOf(getComputedStyle(sheet()).backgroundColor);
  expect(contrast(palest, paper), "on the paper").toBeGreaterThanOrEqual(4.5);
  expect(contrast(palest, dotsOverPaper(art)), "on a dot").toBeGreaterThanOrEqual(4.5);
});

// --- The orbit in the header of a page without a hero ---

/** What of the screen an element can be seen in: the boxes that clip it (`overflow`), up to the page. */
function clipOf(element: Element) {
  const clip = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(at);
    if (overflowX === "visible" && overflowY === "visible") continue;
    const box = at.getBoundingClientRect();
    clip.left = Math.max(clip.left, box.left);
    clip.top = Math.max(clip.top, box.top);
    clip.right = Math.min(clip.right, box.right);
    clip.bottom = Math.min(clip.bottom, box.bottom);
  }
  return clip;
}

for (const width of [768, 1024, 1280, 1440]) {
  test(`Carnet — à ${width} px, l'orbite de l'entête ne passe jamais à côté d'un onglet : ses points ne se voient que sous la capsule des onglets`, async () => {
    await chooseSkin("carnet");
    await page.viewport(width, 900);
    const screen = await openApp("/");
    await expect.element(screen.getByRole("heading", { level: 1 })).toBeVisible();
    await fontsReady();
    const orbit = document.querySelector(".carnet-header-orbit");
    const tabs = document.querySelector(".tabbar-list");
    if (!orbit || !tabs) throw new Error("no orbit or tabs");
    const capsule = tabs.getBoundingClientRect();
    const sheetTop = sheet().getBoundingClientRect().top;
    const turning = orbit
      .getAnimations({ subtree: true })
      .filter(
        (animation): animation is CSSAnimation =>
          animation instanceof CSSAnimation && animation.animationName === "carnet-orbit",
      );
    expect(turning).toHaveLength(2);
    const dots = [...orbit.querySelectorAll("circle[r='4']")];
    expect(dots).toHaveLength(3);

    // All the way round, a turn at a time: where is each dot, and can it be seen there?
    let seen = 0;
    const beside: string[] = [];
    for (let at = 0; at < 160_000; at += 8_000) {
      for (const animation of turning) {
        animation.pause();
        animation.currentTime = at;
      }
      for (const dot of dots) {
        const box = dot.getBoundingClientRect();
        const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
        const clip = clipOf(dot);
        const visible =
          x > clip.left && x < clip.right && y > clip.top && y < clip.bottom && y < sheetTop;
        if (!visible) continue;
        seen++;
        // 12 px: the dot, and the pulse that swells round the teal one.
        if (y - 12 < capsule.bottom) {
          beside.push(
            `${at / 1000} s: a dot at ${Math.round(x)},${Math.round(y)}, tabs down to ${Math.round(capsule.bottom)}`,
          );
        }
      }
    }
    expect(beside).toEqual([]);
    // Not by hiding the orbit altogether: its dots still pass under the tabs.
    expect(seen, "the dots that can be seen").toBeGreaterThan(0);
    for (const animation of turning) animation.play();
  });
}
