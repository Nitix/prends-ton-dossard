import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { SKIN_KEY, SKINS, chooseSkin, showKeptSkin } from ".";
import { ToastProvider } from "../components/Toast";
import { connectSession, logout } from "../features/auth/session";
import { aliceRunner } from "../features/events/testFixture";
import { fr } from "../i18n/fr";
import { I18nProvider } from "../i18n/I18nProvider";
import { ensureTemporal } from "../lib/temporal";
import { TodayProvider } from "../lib/useToday";
import { routeTree } from "../routeTree.gen";
import { ownDeclaration } from "../test/computed";

import "../styles.css";

// Each skin but Crête is loaded when it is chosen: its look brings its
// stylesheets into the page (in the dev server of the tests, a <style> for
// each; in a build, a <link>, which index.html writes for the skin kept on the
// device: noFlash.test.ts). The page of a person who stays on Crête has none of
// them. The tests of this file share one page, in any order: the page as the
// file found it is kept before any of them runs (`AT_START`), and the test of
// a slow look draws the picker with a registry of its own, where no look is
// loaded yet (`freshPage`).

/** The session of the tests: signed in until `logout`, which tells whoever listens. */
const session = vi.hoisted(() => ({
  valid: true,
  listeners: new Set<(token: string) => void>(),
}));

vi.mock("../lib/pb", () => ({
  pb: {
    authStore: {
      get isValid() {
        return session.valid;
      },
      get token() {
        return session.valid ? "token" : "";
      },
      get record() {
        return session.valid
          ? { id: "u-alice", collectionName: "users", role: "member", email: "a@example.test" }
          : null;
      },
      onChange: (listener: (token: string) => void) => {
        session.listeners.add(listener);
        return () => session.listeners.delete(listener);
      },
      clear: () => {
        session.valid = false;
        for (const listener of session.listeners) listener("");
      },
    },
    filter: (raw: string) => raw,
    send: () => Promise.resolve({}),
    collection: () => ({
      getFullList: () => Promise.resolve([]),
      getList: () => Promise.resolve({ items: [], page: 1, perPage: 1, totalItems: 0 }),
      getFirstListItem: () => Promise.resolve(aliceRunner),
      authRefresh: () => Promise.resolve({}),
      update: () => Promise.resolve({}),
    }),
  },
}));

/** The looks that a test holds back, by the id of their skin, until it opens them (a slow network). */
const gates = vi.hoisted(() => new Map<string, Promise<void>>());

vi.mock("./looks", async (importOriginal) => {
  const { LOOKS: real } = await importOriginal<typeof import("./looks")>();
  return {
    LOOKS: Object.fromEntries(
      Object.entries(real).map(([path, load]) => [
        path,
        async () => {
          await gates.get(/^\.\/([^/]+)\/look\.ts$/.exec(path)?.[1] ?? path);
          return load();
        },
      ]),
    ),
  };
});

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(async () => {
  session.valid = true;
  localStorage.removeItem(SKIN_KEY);
  await chooseSkin("crete");
});

/** The skins but Crête. */
const OTHERS = SKINS.filter((skin) => skin.id !== "crete");

/** A rule of a sheet of the page and those in its `@media`, as `[selector, rule]`. */
function rulesOf(sheet: CSSStyleSheet): CSSStyleRule[] {
  const of = (rules: CSSRuleList): CSSStyleRule[] =>
    [...rules].flatMap((rule) => [
      ...(rule instanceof CSSStyleRule ? [rule] : []),
      ...(rule instanceof CSSGroupingRule ? of(rule.cssRules) : []),
    ]);
  return of(sheet.cssRules);
}

/**
 * The sheets of the page that paint a skin: those with a rule on its page
 * (`:root[data-skin="<id>"]`) that sets a colour or a paint of the dawn, which
 * its palette.css does (its fonts.css sets only its `--font-*`).
 */
function palettesOf(id: string): CSSStyleSheet[] {
  return [...document.styleSheets].filter((sheet) =>
    rulesOf(sheet).some(
      (rule) =>
        rule.selectorText === `:root[data-skin="${id}"]` &&
        [...rule.style].some((property) => /^--(color|dawn)-/.test(property)),
    ),
  );
}

/** A colour as the browser paints it (`rgb(…)`). */
function painted(colour: string): string {
  const probe = document.createElement("span");
  probe.style.backgroundColor = colour;
  document.body.append(probe);
  const computed = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return computed;
}

/** The families that the faces of the page declare. */
const families = () => new Set([...document.fonts].map((face) => face.family.replaceAll('"', "")));

/** The page as this file found it, before any of its tests: what a person who stays on Crête has. */
const AT_START = {
  selectors: [...document.styleSheets].flatMap((sheet) =>
    rulesOf(sheet).map((rule) => rule.selectorText),
  ),
  families: [...families()],
};

/**
 * The registry of the skins, the picker and the context of the language as a
 * page has them when it opens: no look loaded yet, whatever the tests before.
 */
async function freshPage() {
  vi.resetModules();
  const registry = await import(".");
  const { AppearanceSection } = await import("../features/profile/AppearanceSection");
  const { I18nProvider: FreshI18n } = await import("../i18n/I18nProvider");
  // The messages are those of this registry's page too: its own context.
  const { ToastProvider: FreshToast } = await import("../components/Toast");
  const { slots: crete } = await import("./crete");
  return { registry, AppearanceSection, I18nProvider: FreshI18n, ToastProvider: FreshToast, crete };
}

test("lazy — avant tout choix, la page n'a rien d'un autre skin que Crête : ni sa palette, ni ses polices", () => {
  expect(OTHERS.length).toBeGreaterThan(1);
  // Not an empty search: Crête's own rules are there.
  expect(AT_START.selectors.length).toBeGreaterThan(100);
  expect(AT_START.selectors.filter((selector) => /\[data-skin="[^"]+"\]/.test(selector))).toEqual(
    [],
  );
  // Crête's faces only: Inter and Plus Jakarta Sans.
  expect(AT_START.families.toSorted((a, b) => a.localeCompare(b))).toEqual([
    "Inter Variable",
    "Plus Jakarta Sans Variable",
  ]);
});

test("lazy — dans le sélecteur, le thème choisi est coché dès le clic, et la page le prend quand son look est chargé", async () => {
  const skin = OTHERS.findLast((one) => !one.id.startsWith("_"));
  if (skin === undefined) throw new Error("a skin besides Crête");
  const { promise, resolve } = Promise.withResolvers<void>();
  gates.set(skin.id, promise);
  const fresh = await freshPage();
  // No look is loaded in this registry: Crête's motifs stand in for the skin's.
  expect(fresh.registry.slotOf(skin, "HeaderArt"), "the look of the skin, not loaded").toBe(
    fresh.crete.HeaderArt,
  );
  const screen = await render(
    <fresh.I18nProvider languages={["fr"]}>
      <fresh.ToastProvider>
        <fresh.AppearanceSection />
      </fresh.ToastProvider>
    </fresh.I18nProvider>,
  );
  try {
    const radio = screen.getByRole("radio", { name: skin.label.fr, exact: true });
    await radio.click();
    // The card says the choice at once, while the look of the skin loads (a slow network)…
    await expect.element(radio).toBeChecked();
    expect(document.documentElement.dataset.skin).toBeUndefined();
    // … and the page is in the skin once it is there.
    resolve();
    await expect.poll(() => document.documentElement.dataset.skin).toBe(skin.id);
    await expect.element(radio).toBeChecked();
  } finally {
    gates.delete(skin.id);
    resolve();
    await screen.unmount();
  }
});

test("lazy — un skin choisi a sa palette dans la page, une fois, même choisi deux fois", async () => {
  for (const skin of OTHERS) {
    await chooseSkin(skin.id);
    expect(palettesOf(skin.id), `the palette of ${skin.id}, chosen`).toHaveLength(1);
    await chooseSkin("crete");
    await chooseSkin(skin.id);
    expect(palettesOf(skin.id), `the palette of ${skin.id}, chosen again`).toHaveLength(1);
    expect(document.documentElement.dataset.skin).toBe(skin.id);
  }
});

/** The app, on a page, with the session of the tests tied to it as main.tsx ties it. */
async function openApp(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const disconnect = connectSession(router, queryClient);
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={["fr"]}>
        <TodayProvider value={Temporal.PlainDate.from("2026-06-01")}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </TodayProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { screen, router, disconnect };
}

test("lazy — se déconnecter garde le skin : sur l'appareil, sur la page, et la page de connexion est dessinée dedans", async () => {
  const [skin] = OTHERS.filter((one) => !one.id.startsWith("_"));
  if (skin === undefined) throw new Error("a skin besides Crête");
  await chooseSkin(skin.id);
  const { screen, router, disconnect } = await openApp("/");
  try {
    await expect
      .element(screen.getByRole("heading", { level: 1, name: fr.nav.home }))
      .toBeVisible();
    logout();
    // The session is gone, and the router has sent the page to sign in.
    await expect.poll(() => router.state.location.pathname).toBe("/connexion");
    await expect.element(screen.getByRole("heading", { level: 1 })).toBeVisible();
    // The skin is the device's, not the session's.
    expect(localStorage.getItem(SKIN_KEY)).toBe(skin.id);
    expect(document.documentElement.dataset.skin).toBe(skin.id);
    expect(palettesOf(skin.id)).toHaveLength(1);
  } finally {
    disconnect();
    await screen.unmount();
  }
});

test("lazy — une page sans session, ouverte avec un skin gardé : le skin et sa palette, comme au démarrage de l'appli", async () => {
  const [skin] = OTHERS.filter((one) => !one.id.startsWith("_")).toReversed();
  if (skin === undefined) throw new Error("a skin besides Crête");
  session.valid = false;
  localStorage.setItem(SKIN_KEY, skin.id);
  // What main.tsx does at start, before the first render.
  await showKeptSkin();
  for (const path of ["/connexion", "/invitation"]) {
    const { screen, disconnect } = await openApp(path);
    try {
      await expect.element(screen.getByText(fr.common.appName).first()).toBeVisible();
      expect(document.documentElement.dataset.skin, `at ${path}`).toBe(skin.id);
      expect(palettesOf(skin.id), `at ${path}`).toHaveLength(1);
      // The page is painted in the skin: the ground of the page, as its palette gives it.
      const ground = getComputedStyle(document.body).backgroundColor;
      expect(ground, `at ${path}`).toBe(painted(ownDeclaration(skin.id, "--color-neutral-50")));
    } finally {
      disconnect();
      await screen.unmount();
    }
  }
});
