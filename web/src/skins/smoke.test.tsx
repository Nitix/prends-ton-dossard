import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement } from "react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { SKINS, chooseSkin, slotOf } from ".";
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
import { initials } from "../lib/initials";
import { ensureTemporal } from "../lib/temporal";
import { chooseTheme } from "../lib/theme";
import { TodayProvider } from "../lib/useToday";
import { routeTree } from "../routeTree.gen";
import { colourOf, ownDeclaration, shadowLayers, textContrast, toldApart } from "../test/computed";
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

/**
 * An event of the fixture whose 42 km has a track, with what its hero shows on
 * the sky: the end of the registrations (on a veil), the notes (a frosted card)
 * and the link to register (a white pill).
 */
const event = {
  ...eventRecord,
  registration_deadline: "2026-06-08",
  registration_url: "https://inscriptions.example.test/trail",
  notes: "Navette depuis la gare à 6 h 30.",
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
async function framed(screen: Screen, { least = 6 } = {}) {
  await expect.element(screen.getByRole("navigation", { name: fr.nav.main })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: fr.nav.createEvent })).toBeVisible();
  await fontsReady();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(WIDTH);
  // Not an empty search: the tabs, the « + », and what the page has (`least` in all).
  expect(targets().length).toBeGreaterThanOrEqual(least);
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

/**
 * How a paint of the skin (`--dawn-deep`…) is drawn as a background, here and
 * now; a colour (`--welcome-card`) in the image that `imageOf` makes of it.
 */
function painted(property: string, imageOf = (value: string) => value): string {
  const probe = document.createElement("span");
  probe.style.backgroundImage = imageOf(`var(${property})`);
  document.body.append(probe);
  const image = getComputedStyle(probe).backgroundImage;
  probe.remove();
  return image;
}

/**
 * The two colours of the halo of the dawn (`shadow-glow`: the main buttons, the
 * current tab, the «+»). A skin without a halo sets both to `transparent`.
 */
const GLOWS = ["--dawn-glow-warm", "--dawn-glow-cool"];

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
 * never Crête's left behind: the skin's own sheet sets both (Crête declares
 * them, so the page alone would not say it).
 */
function expectGlowOfSkin(skin: Skin, element: Element, what: string) {
  for (const glow of GLOWS) {
    expect(ownDeclaration(skin.id, glow), `${skin.id} sets ${glow}`).not.toBe("");
  }
  const halo = glowOfSkin();
  expect(halo, "the two layers of shadow-glow").toHaveLength(2);
  const layers = shadowLayers(getComputedStyle(element).boxShadow);
  expect(layers.slice(-halo.length), `the halo of ${what}`).toEqual(halo);
}

/**
 * A piece is shaded in a colour of the theme (`--shade-notes`…), one of
 * Crête's (a name the test had wrong would read as `transparent`).
 */
function expectShadeOfSkin(element: Element, property: string, what: string) {
  expect(ownDeclaration("crete", property), `${property} is one of Crête's`).not.toBe("");
  const layers = shadowLayers(getComputedStyle(element).boxShadow).join(", ");
  expect(layers, `the shade of ${what}`).toContain(colourOf(property));
}

/** A piece is drawn in a value of the skin (computed as `expected`). */
function expectOfSkin(actual: string, expected: string, what: string) {
  expect(actual, `${what}, in the skin`).toBe(expected);
}

/**
 * A piece is painted with the deep dawn of the skin (`--dawn-deep`, a
 * gradient): the current tab.
 */
function expectPaintOfSkin(element: Element, what: string) {
  const own = painted("--dawn-deep");
  expect(own, "the deep dawn of the skin").toMatch(/gradient/);
  expect(getComputedStyle(element).backgroundImage, `the paint of ${what}`).toBe(own);
}

/**
 * A title is drawn in the style of the display face that the skin gives
 * (`--display-*`: italic, capitals, a width, a spacing), as `page-title` is
 * (tokens.test.tsx).
 */
function expectDisplayStyle(title: Element, what: string) {
  const probe = document.createElement("span");
  probe.style.cssText =
    "font-style: var(--display-style); text-transform: var(--display-transform); font-stretch: var(--display-stretch); letter-spacing: var(--display-tracking)";
  title.append(probe);
  const [own, expected] = [getComputedStyle(title), getComputedStyle(probe)];
  for (const property of ["fontStyle", "textTransform", "fontStretch", "letterSpacing"] as const) {
    expect(own[property], `${what}, its ${property}`).toBe(expected[property]);
  }
  probe.remove();
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
    // `aria-[current=page]:shadow-glow`), takes the paint and the halo of the skin;
    // it is told apart from the other tabs by more than the colour of its words,
    // and its words read on what is behind them (4.5:1).
    const tabs = screen.getByRole("navigation", { name: fr.nav.main });
    const current = tabs.getByRole("link", { name: fr.nav.home, exact: true }).element();
    const other = tabs.getByRole("link", { name: fr.nav.list, exact: true }).element();
    expect(toldApart(current, other), "what tells the current tab apart").not.toEqual([]);
    expect(textContrast(current), "the words of the current tab").toBeGreaterThanOrEqual(4.5);
    expectPaintOfSkin(current, "the current tab");
    const plus = screen.getByRole("link", { name: fr.nav.createEvent }).element();
    expectGlowOfSkin(skin, current, "the current tab");
    expectGlowOfSkin(skin, plus, "the «+»");
    // Their words and their icon in the ink of the deep dawn (`--dawn-deep-ink`).
    for (const [piece, what] of [
      [current, "the current tab"],
      [plus, "the «+»"],
    ] as const) {
      expectOfSkin(
        getComputedStyle(piece).color,
        colourOf("--dawn-deep-ink"),
        `the ink of ${what}`,
      );
    }
    // The title of the page in the style of the skin's titles.
    expectDisplayStyle(
      screen.getByRole("heading", { level: 1, name: fr.nav.home }).element(),
      "the title of the page",
    );
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
    const hero = document.querySelector(".event-hero");
    expect(hero).not.toBeNull();
    // What the hero says: the end of the registrations, the notes, the link to register.
    expect(hero?.textContent, "the end of the registrations").toContain(
      fr.event.registrationUntil(""),
    );
    expect(hero?.textContent, "the notes").toContain(event.notes);
    const register = [...(hero?.querySelectorAll("a") ?? [])].find((link) =>
      link.textContent?.includes(fr.event.register),
    );
    expect(register?.getAttribute("href"), "the link to register").toBe(event.registration_url);
    // On the sky of the hero: its title in the style of the skin's
    // titles, the end of the registrations on its veil, the notes and the white
    // pill to register in the shades of the skin.
    expectDisplayStyle(
      screen.getByRole("heading", { level: 1, name: "Trail des Crêtes" }).element(),
      "the title of the hero",
    );
    const notes = screen.getByText(event.notes).element();
    expectShadeOfSkin(notes, "--shade-notes", "the notes on the hero");
    expectShadeOfSkin(register ?? document.body, "--shade-on-dawn", "the white pill on the hero");
    const veil = [...(hero?.querySelectorAll("p") ?? [])].find((p) =>
      p.textContent?.includes(fr.event.registrationUntil("")),
    );
    expectOfSkin(
      getComputedStyle(veil ?? document.body).backgroundColor,
      colourOf("--hero-veil"),
      "the veil of the end of the registrations",
    );

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
    // Its title in the style of the skin's titles.
    expectDisplayStyle(
      dialog.getByRole("heading", { name: fr.participation.addSomeoneTitle }).element(),
      "the title of the dialog",
    );
  });

  test(`smoke — ${name} : la page d'un coureur, sa photo sur le ciel`, async () => {
    dress(skin, mode);
    const screen = await openApp(`/coureurs/${aliceRunner.id}`);
    const title = screen.getByRole("heading", { level: 1, name: aliceRunner.name });
    await expect.element(title).toBeVisible();
    // The tabs and the « + »: the page of a runner with no results has nothing else to tap.
    await framed(screen, { least: 5 });
    expectDisplayStyle(title.element(), "the title of the hero");
    // The photo of the runner in the hero, whoever draws it: here their initials.
    const hero = document.querySelector(".runner-hero");
    expect(hero?.contains(title.element()), "the title in the hero").toBe(true);
    expect(
      [...(hero?.querySelectorAll("span") ?? [])].some(
        (span) => span.textContent === initials(aliceRunner.name),
      ),
      "the photo of the runner",
    ).toBe(true);
    // In the hero: cut out of the sky by a ring, over its shade.
    const photo = hero?.querySelector(".avatar-soft");
    expectShadeOfSkin(photo ?? document.body, "--photo-ring", "the ring of the photo");
    expectShadeOfSkin(photo ?? document.body, "--shade-photo", "the shade of the photo");
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
    if (primary !== null) expectGlowOfSkin(skin, primary, "the main button");
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
    // The card of the page floats over the ridges, in the shade of the skin, on
    // the ground and in the rim that the skin gives it (Crête's: none over its
    // frosted glass, and the rim of a window).
    const card = screen.getByRole("main").element();
    expectShadeOfSkin(card, "--shade-welcome", "the card");
    // In the skin's own colours: Crête's violet halo would show under the card.
    expect(ownDeclaration(skin.id, "--shade-welcome"), `${skin.id} sets --shade-welcome`).not.toBe(
      "",
    );
    for (const property of ["--welcome-card", "--welcome-rim"]) {
      expect(ownDeclaration("crete", property), `${property} is one of Crête's`).not.toBe("");
    }
    expectOfSkin(
      getComputedStyle(card).backgroundImage,
      painted("--welcome-card", (colour) => `linear-gradient(${colour}, ${colour})`),
      "the ground of the card",
    );
    expectOfSkin(getComputedStyle(card).borderTopColor, colourOf("--welcome-rim"), "its rim");
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
