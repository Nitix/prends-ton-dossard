import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement } from "react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { SKIN_DEPTH, SKINS, chooseSkin, slotOf } from ".";
import { ToastProvider } from "../components/Toast";
import {
  aliceRunner,
  bobRunner,
  eventRecord,
  roadType,
  samRunner,
  trailType,
} from "../features/events/testFixture";
import { fr } from "../i18n/fr";
import { I18nProvider } from "../i18n/I18nProvider";
import { ensureTemporal } from "../lib/temporal";
import { chooseTheme } from "../lib/theme";
import { TodayProvider } from "../lib/useToday";
import { routeTree } from "../routeTree.gen";
import { fontsReady } from "../test/fontsReady";
import { withoutIds } from "../test/ids";
import { emulateMedia, resetMedia } from "../test/media";
import type { Mode, Skin } from "./types";

import "../styles.css";
import "../skins/styles";

// The main pages of the app, drawn in each skin and in each of its modes, on
// the narrowest phone (320 px): the home page, the page of an event with the
// map and the profile of its track and a dialog, the form of a new event, the
// settings, and forced colours. A skin only dresses the app: every page is
// there, with what it shows, nothing goes past the width of the screen, every
// target keeps its 44 px, the motifs of the skin are in their places (Crête's
// where it draws none), and the utilities of the dawn take its paints. Nothing
// here names a skin: a new one is tested as it is added.

/** An event of the fixture whose 42 km has a track. */
const event = {
  ...eventRecord,
  expand: {
    ...eventRecord.expand,
    formats_via_event: eventRecord.expand.formats_via_event.map((format) =>
      format.id === "f42" ? { ...format, gpx: "trace_ab12cd.gpx" } : format,
    ),
  },
};

/** 2.2 km, 200 m up then 50 m down. */
const CLIMB = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
  <trkpt lat="45.00" lon="6"><ele>450</ele></trkpt>
  <trkpt lat="45.01" lon="6"><ele>650</ele></trkpt>
  <trkpt lat="45.02" lon="6"><ele>600</ele></trkpt>
</trkseg></trk></gpx>`;

const lists: Record<string, unknown[]> = {
  events: [event],
  runners: [aliceRunner, bobRunner, samRunner],
  race_types: [trailType, roadType],
};

// The real tree of routes, as in routes/root.test.tsx: the pages ask for their
// data, and get the event of the fixture, its runners and the race types.
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
    send: () => Promise.resolve({}),
    collection: (name: string) => ({
      getFullList: () => Promise.resolve(lists[name] ?? []),
      getList: () => Promise.resolve({ items: [], page: 1, perPage: 1, totalItems: 0 }),
      getFirstListItem: () => Promise.resolve(aliceRunner),
      getOne: () => Promise.resolve(event),
    }),
    files: {
      getURL: (_record: unknown, filename: string) =>
        filename.endsWith(".gpx") ? "https://pb.example.test/trace_ab12cd.gpx" : "",
    },
  },
}));

// The map of a track is the real one, with blank tiles: no test asks a tile server for a tile.
vi.mock("../features/route/TrackMap", async (importOriginal) => {
  const { blankTileModule } = await import("../test/tiles");
  return blankTileModule(importOriginal);
});

/** The narrowest phone the app is made for. */
const WIDTH = 320;

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(CLIMB)));
  await page.viewport(WIDTH, 700);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await resetMedia();
  chooseSkin("crete");
  chooseTheme("auto");
  window.scrollTo(0, 0);
  await page.viewport(414, 896);
});

/** Puts a skin, in one of its modes, on the page. */
function dress(skin: Skin, mode: Mode) {
  chooseSkin(skin.id);
  chooseTheme(mode);
}

async function openApp(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const screen = await render(
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
  return screen;
}

type Screen = Awaited<ReturnType<typeof openApp>>;

/** What the user can tap, in the page and its tabs, or in an open dialog. */
function targets(scope: ParentNode = document): HTMLElement[] {
  const found = scope.querySelectorAll<HTMLElement>(
    "main button, main select, main summary, main input, nav a, a.fab, dialog[open] button, dialog[open] input, dialog[open] select",
  );
  return [...found]
    .filter((element) => !(element instanceof HTMLInputElement && element.type === "hidden"))
    .filter((element) => element.checkVisibility() && element.getBoundingClientRect().width > 1)
    .map((element) =>
      // A box or a dot is tapped by its label: the label is the target.
      element instanceof HTMLInputElement && ["checkbox", "radio", "file"].includes(element.type)
        ? (element.closest("label") ?? element)
        : element,
    );
}

/**
 * What every page has, in every skin: the tabs, the button to create, nothing
 * wider than the phone, and targets of 44 px at least.
 */
async function framed(screen: Screen) {
  await expect.element(screen.getByRole("navigation", { name: fr.nav.main })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: fr.nav.createEvent })).toBeVisible();
  await fontsReady();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(WIDTH);
  // Not an empty search: the tabs, the « + », and what the page has.
  expect(targets().length).toBeGreaterThan(5);
  const small = targets()
    .filter((element) => element.getBoundingClientRect().height < 44)
    .map(
      (element) =>
        `${element.getBoundingClientRect().height}px: ${element.outerHTML.slice(0, 120)}`,
    );
  expect(small).toEqual([]);
}

/** The mark of a skin before a block's title, drawn on its own: what each title must start with. */
async function markerHtml(skin: Skin): Promise<string> {
  const alone = await render(createElement(slotOf(skin, "SectionMarker")));
  const html = withoutIds(alone.container.innerHTML);
  await alone.unmount();
  return html;
}

/** How a paint of the skin (`--dawn-deep`…) is drawn as a background, here and now. */
function painted(property: string): string {
  const probe = document.createElement("span");
  probe.style.backgroundImage = `var(${property})`;
  document.body.append(probe);
  const image = getComputedStyle(probe).backgroundImage;
  probe.remove();
  return image;
}

/** A colour of the skin (`--shade-welcome`…) as the browser computes it, here and now. */
function colourOf(property: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${property}, transparent)`;
  document.body.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}

/**
 * The two colours of the halo of the dawn (`shadow-glow`: the main buttons, the
 * current tab, the «+»). A skin without a halo sets both to `transparent`.
 */
const GLOWS = ["--dawn-glow-warm", "--dawn-glow-cool"];

/** The empty layer that Tailwind puts in a `box-shadow` for a ring or an inset shadow it does not draw. */
const EMPTY_LAYER = "rgba(0, 0, 0, 0) 0px 0px 0px 0px";

/** The layers of a computed `box-shadow`, without Tailwind's empty ones. */
function shadowLayers(shadow: string): string[] {
  if (shadow === "none") return [];
  return shadow
    .split(/,(?![^(]*\))/)
    .map((layer) => layer.trim())
    .filter((layer) => layer !== EMPTY_LAYER);
}

/** The halo that `shadow-glow` draws in the skin of the page, here and now. */
function glowOfSkin(): string[] {
  const probe = document.createElement("span");
  probe.className = "shadow-glow";
  document.body.append(probe);
  const layers = shadowLayers(getComputedStyle(probe).boxShadow);
  probe.remove();
  return layers;
}

/**
 * The halo of a piece of the dawn is the skin's: the one `shadow-glow` draws from
 * the skin's `--dawn-glow-*`, coloured or transparent (a skin without a halo),
 * never Crête's left behind. At mix and full a skin may restyle the piece itself
 * (`box-shadow: none` on the current tab, README.md): there, only the properties
 * are checked.
 */
function expectGlowOfSkin(element: Element, what: string) {
  const root = getComputedStyle(document.documentElement);
  for (const glow of GLOWS) {
    expect(root.getPropertyValue(glow).trim(), `${glow} is defined`).not.toBe("");
  }
  if (SKIN_DEPTH !== "palette") return;
  const halo = glowOfSkin();
  expect(halo, "the two layers of shadow-glow").toHaveLength(2);
  const layers = shadowLayers(getComputedStyle(element).boxShadow);
  expect(layers.slice(-halo.length), `the halo of ${what}`).toEqual(halo);
}

/**
 * A piece is shaded in a colour of the skin (`--shade-welcome`…), which is
 * declared. At mix and full a skin may restyle the piece: there, only the
 * property is checked.
 */
function expectShadeOfSkin(element: Element, property: string, what: string) {
  const root = getComputedStyle(document.documentElement);
  expect(root.getPropertyValue(property).trim(), `${property} is declared`).not.toBe("");
  if (SKIN_DEPTH !== "palette") return;
  const layers = shadowLayers(getComputedStyle(element).boxShadow).join(", ");
  expect(layers, `the shade of ${what}`).toContain(colourOf(property));
}

const CASES = SKINS.flatMap((skin) => skin.modes.map((mode) => ({ skin, mode })));

/** The selectors of every rule in the stylesheets of the page, those inside `@media` and such too. */
function selectorsOfPage(): string[] {
  const of = (rules: CSSRuleList): string[] =>
    [...rules].flatMap((rule) => [
      ...(rule instanceof CSSStyleRule ? [rule.selectorText] : []),
      ...(rule instanceof CSSGroupingRule ? of(rule.cssRules) : []),
    ]);
  return [...document.styleSheets].flatMap((sheet) => of(sheet.cssRules));
}

test("smoke — les feuilles de chaque skin sont dans la page (skins/styles, comme main.tsx)", () => {
  // Without them, a skin would be drawn in Crête's colours and every test of
  // its paints would pass for nothing.
  const selectors = selectorsOfPage();
  for (const skin of SKINS.filter((one) => one.id !== "crete")) {
    expect(
      selectors.some((selector) => selector.startsWith(`:root[data-skin="${skin.id}"]`)),
      `the palette of ${skin.id}`,
    ).toBe(true);
  }
});

for (const { skin, mode } of CASES) {
  const name = `${skin.id}, ${mode}`;

  test(`smoke — ${name} : l'accueil, la marque des titres de ses blocs, l'onglet courant aux couleurs du skin`, async () => {
    const marker = await markerHtml(skin);
    dress(skin, mode);
    const screen = await openApp("/");
    await expect
      .element(screen.getByRole("heading", { level: 1, name: fr.nav.home }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Trail des Crêtes" }).first())
      .toBeVisible();
    await framed(screen);
    expect(document.documentElement.dataset.skin).toBe(skin.id === "crete" ? undefined : skin.id);
    expect(document.documentElement.dataset.theme).toBe(mode);
    // Each title of a block starts with the mark of the skin.
    const titles = [...document.querySelectorAll("h2.section-title")];
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      expect(
        withoutIds(title.firstElementChild?.outerHTML ?? ""),
        `title ${title.textContent}`,
      ).toBe(marker);
    }
    // The current tab, variants of utilities (`aria-[current=page]:bg-dawn-deep`,
    // `aria-[current=page]:shadow-glow`), takes the paint and the halo of the skin.
    const current = screen
      .getByRole("navigation", { name: fr.nav.main })
      .getByRole("link", { name: fr.nav.home, exact: true })
      .element();
    const own = painted("--dawn-deep");
    expect(own).toMatch(/gradient/);
    expect(getComputedStyle(current).backgroundImage).toBe(own);
    expectGlowOfSkin(current, "the current tab");
    expectGlowOfSkin(screen.getByRole("link", { name: fr.nav.createEvent }).element(), "the «+»");
  });

  test(`smoke — ${name} : la page d'un événement, sa carte, le profil de sa trace et une fenêtre`, async () => {
    dress(skin, mode);
    const screen = await openApp(`/evenements/${event.id}`);
    await expect
      .element(screen.getByRole("heading", { level: 1, name: "Trail des Crêtes" }))
      .toBeVisible();
    const trail42 = screen.getByRole("region", { name: /^Trail 42/ });
    await expect.element(trail42.getByRole("region", { name: fr.route.map })).toBeVisible();
    await expect
      .element(trail42.getByRole("img", { name: new RegExp(`^${fr.route.profileLabel}`) }))
      .toBeVisible();
    await expect.element(trail42.getByText(/D\+/).first()).toBeVisible();
    await framed(screen);
    expect(document.querySelector(".event-hero")).not.toBeNull();

    // A dialog: within the phone, its actions 44 px tall.
    await screen
      .getByRole("button", { name: fr.participation.addSomeone, exact: true })
      .first()
      .click();
    const dialog = screen.getByRole("dialog", { name: fr.participation.addSomeoneTitle });
    await expect.element(dialog).toBeVisible();
    // Measured once it has risen and its fonts are in: not in the middle of its
    // entrance. Only an animation that ends is waited for (an endless one, a
    // spinner, never would), and one cancelled on the way is as good as done.
    await Promise.all(
      dialog
        .element()
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
    await fontsReady();
    const box = dialog.element().getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(WIDTH);
    const small = targets(dialog.element())
      .filter((element) => element.getBoundingClientRect().height < 44)
      .map(
        (element) =>
          `${element.getBoundingClientRect().height}px: ${element.outerHTML.slice(0, 120)}`,
      );
    expect(small).toEqual([]);
  });

  test(`smoke — ${name} : le formulaire d'un nouvel événement`, async () => {
    dress(skin, mode);
    const screen = await openApp("/evenements/nouveau");
    await expect.element(screen.getByRole("heading", { level: 1 })).toBeVisible();
    await expect
      .element(screen.getByRole("heading", { level: 2, name: fr.form.formatsTitle }))
      .toBeVisible();
    await expect.element(screen.getByRole("textbox").first()).toBeVisible();
    await framed(screen);
    // The main button of the form (`PRIMARY`): its halo is the skin's.
    const primary = document.querySelector("main .btn-primary");
    expect(primary, "the main button of the form").not.toBeNull();
    if (primary !== null) expectGlowOfSkin(primary, "the main button");
  });

  test(`smoke — ${name} : une page publique, sa carte sur le ciel`, async () => {
    dress(skin, mode);
    // An invitation without its token: the page says so, on the sky of the sign-in pages.
    const screen = await openApp("/invitation");
    await expect.element(screen.getByText(fr.errors.invitation_invalid)).toBeVisible();
    await expect.element(screen.getByText(fr.common.appName)).toBeVisible();
    // Within the phone (it has no tabs: `framed` is for the signed-in pages).
    await fontsReady();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(WIDTH);
    // The card of the page floats over the ridges, in the shade of the skin.
    expectShadeOfSkin(screen.getByRole("main").element(), "--shade-welcome", "the card");
  });

  test(`smoke — ${name} : les réglages, avec le choix du thème`, async () => {
    dress(skin, mode);
    const screen = await openApp("/profil/reglages");
    await expect
      .element(screen.getByRole("heading", { level: 1, name: fr.profile.settings }))
      .toBeVisible();
    const skins = screen.getByRole("radiogroup", { name: fr.settings.skin });
    await expect
      .element(skins.getByRole("radio", { name: skin.label.fr, exact: true }))
      .toBeChecked();
    await framed(screen);
  });

  test(`smoke — ${name} : en couleurs forcées, l'onglet courant et le bouton + gardent un bord`, async () => {
    dress(skin, mode);
    await emulateMedia({ forcedColors: "active" });
    const screen = await openApp("/");
    await expect
      .element(screen.getByRole("heading", { level: 1, name: fr.nav.home }))
      .toBeVisible();
    const current = screen
      .getByRole("navigation", { name: fr.nav.main })
      .getByRole("link", { name: fr.nav.home, exact: true })
      .element();
    expect(getComputedStyle(current).borderTopWidth).toBe("2px");
    const plus = screen.getByRole("link", { name: fr.nav.createEvent }).element();
    expect(getComputedStyle(plus).borderTopWidth).toBe("1px");
    await framed(screen);
  });
}
