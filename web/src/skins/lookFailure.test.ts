import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";

import { SKINS } from ".";
import { fr } from "../i18n/fr";
import { builtApp, textOfBuilt } from "../test/builtApp";

// A look that cannot be loaded, through the real path: the real app, built as
// `pnpm build` builds it (once for the run: test/builtApp.setup.ts), in a real
// Chromium, served from memory under a fake host (every other host is
// refused). Vite's own preload helper loads the looks and the routes there,
// and fires `vite:preloadError` when one fails, as it does for a person on a
// phone: a stub of the loader (index.test.ts) cannot show what
// `reloadOnStaleChunks` (lib/staleChunks.ts) does with that event, nor what
// happens to the skin of a page that was opened before a deploy.
//
// - A look that fails (offline, or a 404 after a deploy) leaves the page as it
//   was: no reload. A later choice of the same skin loads its stylesheets,
//   which the helper does not ask for again after a failure.
// - A route chunk that is gone, online, still reloads the page (a deploy); offline it does not.
// - A skin kept on the device whose stylesheet fails while its code loads is
//   Crête, not Crête's colours under the skin's motifs; a stylesheet that
//   fails once is asked for again, a shared one (its faces, its trail) too.
//   Signed in, with the account's skin the device's, it is the same.
// - Choosing in the settings a skin whose look has gone after a deploy keeps
//   the choice and reloads the page once, which then wears it; offline, a
//   message and no reload.
//
// The negative claims (no reload) are not waits: each is read after a positive
// signal that the failure was handled (the event that Vite fires, the error
// that the router shows, the message of the picker).

const ORIGIN = "https://app.test";

/** A test opens pages in a real browser, one of them without a network: it has time. */
const TEST = { timeout: 30_000 };

const files = builtApp();

let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser.close();
});

/** What the fake server does with a request, by the test: it serves, or fails it. */
type Verdict = "serve" | "404" | "abort";
let verdict: (path: string) => Verdict = () => "serve";
/** The paths served so far: what a page that opens later already has. */
const served = new Set<string>();
/** The paths that were asked for and failed. */
let failed: string[] = [];
/**
 * The paths whose second request, and the ones after, wait for `until` before
 * they are answered: a network that is slow to give up. The first request is
 * the one that index.html's own link makes, which the parser waits for.
 */
let late:
  | { paths: ReadonlySet<string>; until: Promise<void>; counts: Map<string, number> }
  | undefined;

// The account of the person who is signed in, as the server has it, and what it was asked.
const ACCOUNT = "u1";
let accountSkin = "";
let saved: string[] = [];
let refreshes = 0;

const TYPES: Record<string, string> = {
  js: "text/javascript",
  css: "text/css",
  html: "text/html",
  woff2: "font/woff2",
  json: "application/json",
  svg: "image/svg+xml",
};

function record() {
  return {
    id: ACCOUNT,
    collectionId: "users",
    collectionName: "users",
    created: "",
    updated: "",
    email: "alice@example.test",
    role: "member",
    disabled: false,
    skin: accountSkin,
  };
}

/** A token that expires in an hour: the SDK reads it, unsigned. */
function token(): string {
  const payload = Buffer.from(
    JSON.stringify({ id: ACCOUNT, exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

/** The answers of the API that the pages of the app ask for: the account, a runner, nothing else. */
function api(method: string, path: string, body: string | null): { status: number; body: unknown } {
  if (method === "POST" && path === "/api/collections/users/auth-refresh") {
    refreshes++;
    return { status: 200, body: { token: token(), record: record() } };
  }
  if (method === "PATCH" && path === `/api/collections/users/records/${ACCOUNT}`) {
    const sent: unknown = JSON.parse(body ?? "{}");
    if (
      typeof sent === "object" &&
      sent !== null &&
      "skin" in sent &&
      typeof sent.skin === "string"
    ) {
      accountSkin = sent.skin;
      saved.push(sent.skin);
    }
    return { status: 200, body: record() };
  }
  if (method === "GET" && path === "/api/collections/runners/records") {
    const runner = { id: "r1", name: "Alice", user: ACCOUNT, collectionName: "runners" };
    return { status: 200, body: { page: 1, perPage: 1, totalItems: 1, items: [runner] } };
  }
  if (method === "GET" && path.startsWith("/api/collections/") && path.endsWith("/records")) {
    return { status: 200, body: { page: 1, perPage: 30, totalItems: 0, items: [] } };
  }
  return { status: 404, body: { status: 404, message: "Not found.", data: {} } };
}

async function serve(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  if (url.origin !== ORIGIN) return route.abort();
  if (url.pathname.startsWith("/api/")) {
    const answer = api(route.request().method(), url.pathname, route.request().postData());
    return route.fulfill({
      status: answer.status,
      contentType: TYPES.json ?? "",
      body: JSON.stringify(answer.body),
    });
  }
  const name = url.pathname.slice(1);
  const answer = verdict(url.pathname);
  if (late?.paths.has(url.pathname) === true) {
    const count = (late.counts.get(url.pathname) ?? 0) + 1;
    late.counts.set(url.pathname, count);
    if (count > 1) await late.until;
  }
  if (answer === "abort") {
    failed.push(url.pathname);
    return route.abort("internetdisconnected");
  }
  if (answer === "404") {
    failed.push(url.pathname);
    return route.fulfill({ status: 404, body: "not found" });
  }
  const file = files.get(name);
  if (file === undefined) {
    // The pages of the app are index.html; anything with an extension is not there.
    if (/\.[a-z0-9]+$/.test(name)) return route.fulfill({ status: 404, body: "not found" });
    return route.fulfill({ contentType: TYPES.html ?? "", body: textOfBuilt("index.html") });
  }
  served.add(url.pathname);
  const extension = name.split(".").at(-1) ?? "";
  const body = file.type === "chunk" ? file.code : file.source;
  return route.fulfill({
    contentType: TYPES[extension] ?? "application/octet-stream",
    body: typeof body === "string" ? body : Buffer.from(body),
  });
}

// A context of its own for each test: what a page keeps (the skin, the reload that was done) is not another's.
beforeEach(async () => {
  accountSkin = "";
  saved = [];
  refreshes = 0;
  context = await browser.newContext({ serviceWorkers: "block", locale: "fr-FR" });
  // How many times Vite said that a chunk could not be loaded, counted once the
  // listeners of the app have had it (so its reload, if any, is already asked for).
  await context.addInitScript(() => {
    Object.assign(window, { preloadErrors: 0 });
    window.addEventListener("vite:preloadError", () => {
      setTimeout(() => {
        Object.assign(window, { preloadErrors: Number(Reflect.get(window, "preloadErrors")) + 1 });
      }, 0);
    });
  });
  await context.route("**/*", serve);
});

afterEach(async () => {
  verdict = () => "serve";
  failed = [];
  late = undefined;
  served.clear();
  await context.close();
});

/** The skins that are not Crête, and the sheets that the page names for each. */
const OTHERS = SKINS.filter((skin) => skin.id !== "crete" && !skin.id.startsWith("_"));
const SKIN = OTHERS[0]?.id ?? "";

function sheetsOf(id: string): string[] {
  const table: unknown = JSON.parse(
    /const skins = (\{.*?\});/.exec(textOfBuilt("index.html"))?.[1] ?? "{}",
  );
  const entry: unknown =
    typeof table === "object" && table !== null
      ? Object.entries(table).find(([key]) => key === id)?.[1]
      : undefined;
  const sheets: unknown =
    typeof entry === "object" && entry !== null && "sheets" in entry ? entry.sheets : [];
  return Array.isArray(sheets) ? sheets.map(String) : [];
}

/** The sheets of a skin that carry its palette, and those that do not (its faces, its utilities, its trail). */
function sheetsByKind(id: string): { palette: string[]; others: string[] } {
  const sheets = sheetsOf(id);
  const hasPalette = (sheet: string) =>
    textOfBuilt(sheet.slice(1)).includes(`data-skin=${id}`) ||
    textOfBuilt(sheet.slice(1)).includes(`data-skin="${id}"`);
  return {
    palette: sheets.filter(hasPalette),
    others: sheets.filter((sheet) => !hasPalette(sheet)),
  };
}

type Opening = {
  /** The skin that the device keeps. */
  kept?: string;
  /** Whether somebody is signed in (the account is `accountSkin`). */
  signedIn?: boolean;
  /** The page, and what shows that it is drawn. */
  path?: string;
};

/** Opens a page of the app, drawn once its title is there, and marks it so that a reload shows. */
async function openApp(page: Page, { kept, signedIn = false, path = "/connexion" }: Opening = {}) {
  if (kept !== undefined) {
    await page.addInitScript((id) => localStorage.setItem("ptd-skin", id), kept);
  }
  if (signedIn) {
    await page.addInitScript(
      ([auth, user]) =>
        localStorage.setItem("pocketbase_auth", JSON.stringify({ token: auth, record: user })),
      [token(), record()] as const,
    );
  }
  await page.goto(`${ORIGIN}${path}`);
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.evaluate(() => {
    Object.assign(window, { loadedOnce: true });
  });
}

/** Whether this is still the page that was marked, and no reload was asked for (the guard's key is set before it). */
const notReloaded = (page: Page) =>
  page.evaluate(
    () => "loadedOnce" in window && sessionStorage.getItem("courses:stale-chunk-reload") === null,
  );

/** Waits until Vite has said once, on this page, that a chunk could not be loaded, and the app has answered. */
async function preloadErrorHandled(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => Number(Reflect.get(window, "preloadErrors"))), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
}

const skinOf = (page: Page) =>
  page.evaluate(() => document.documentElement.dataset.skin ?? "crete");
const groundOf = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

/** Another page of the same site chooses a skin: the first page hears of it through the storage. */
async function chooseElsewhere(id: string | null): Promise<void> {
  const other = await context.newPage();
  await other.goto(`${ORIGIN}/connexion`);
  await other.evaluate((chosen) => {
    if (chosen === null) localStorage.removeItem("ptd-skin");
    else localStorage.setItem("ptd-skin", chosen);
  }, id);
  await other.close();
}

/** Everything that is not served yet is gone: a page that is open has what it needs, and no look. */
function lookOffline(answer: Verdict) {
  const have = new Set(served);
  verdict = (path) => (path.startsWith("/assets/") && !have.has(path) ? answer : "serve");
}

test(
  "un look qui ne se charge pas ne recharge pas la page : elle garde son thème, puis le choix, une fois le réseau revenu, charge aussi sa feuille",
  TEST,
  async () => {
    expect(SKIN, "a skin besides Crête").not.toBe("");
    const page = await context.newPage();
    await openApp(page);
    const crete = await groundOf(page);
    lookOffline("404");

    await chooseElsewhere(SKIN);

    await preloadErrorHandled(page);
    expect(await notReloaded(page), "the page was reloaded").toBe(true);
    expect(await skinOf(page)).toBe("crete");

    // The network is back, and the skin is chosen again.
    verdict = () => "serve";
    await chooseElsewhere(null);
    await chooseElsewhere(SKIN);

    await expect.poll(() => skinOf(page), { timeout: 10_000 }).toBe(SKIN);
    expect(await notReloaded(page), "the page was reloaded").toBe(true);
    // Dressed, not half: the skin's own colours are on the page.
    expect(await groundOf(page)).not.toBe(crete);
  },
);

test("sans réseau, un look jamais chargé ne recharge pas la page non plus", TEST, async () => {
  const page = await context.newPage();
  await openApp(page);
  const other = await context.newPage();
  await other.goto(`${ORIGIN}/connexion`);
  lookOffline("abort");
  await context.setOffline(true);

  await other.evaluate((id) => localStorage.setItem("ptd-skin", id), SKIN);

  await preloadErrorHandled(page);
  expect(await notReloaded(page), "the page was reloaded").toBe(true);
  expect(await skinOf(page)).toBe("crete");
});

/** The router goes to another page of the app, whose route is a chunk of its own. */
async function goTo(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

/** What the router shows when a route cannot be loaded and it does not reload: the end of the failure, on the page. */
const routerError = (page: Page) => page.getByText("Something went wrong!");

test(
  "un morceau de route qui n'existe plus (un déploiement), en ligne, recharge la page, puis s'arrête",
  TEST,
  async () => {
    const page = await context.newPage();
    await openApp(page);
    lookOffline("404");
    let loads = 0;
    page.on("load", () => {
      loads++;
    });

    await goTo(page, "/invitation");

    // The reloaded page fails on the same route (it stays gone here): the router
    // shows the error, which is the end of it: the guard did not let it loop.
    await routerError(page).waitFor({ timeout: 10_000 });
    expect(loads, "the page was reloaded").toBeGreaterThan(0);
    expect(loads, "the page went on reloading").toBeLessThanOrEqual(2);
    expect(
      await page.evaluate(() => sessionStorage.getItem("courses:stale-chunk-reload")),
    ).not.toBeNull();
  },
);

test(
  "hors ligne, un morceau de route qui ne vient pas ne recharge pas la page : ce n'est pas un déploiement",
  TEST,
  async () => {
    const page = await context.newPage();
    await openApp(page);
    lookOffline("abort");
    await context.setOffline(true);

    await goTo(page, "/invitation");

    // The router says so on the page, and the page is the one that was marked.
    await routerError(page).waitFor({ timeout: 10_000 });
    expect(await notReloaded(page), "the page was reloaded").toBe(true);
  },
);

test(
  "un thème gardé dont la feuille ne se charge pas, alors que son code se charge : Crête, pas ses motifs sur les couleurs de Crête",
  TEST,
  async () => {
    const sheets = sheetsOf(SKIN);
    expect(sheets.length, `the sheets of ${SKIN}`).toBeGreaterThan(0);
    const control = await context.newPage();
    await openApp(control);
    const crete = await groundOf(control);
    await control.close();
    verdict = (path) => (sheets.includes(path) ? "404" : "serve");

    const page = await context.newPage();
    await openApp(page, { kept: SKIN });

    expect(failed.length, "the sheets were asked for").toBeGreaterThan(0);
    // Crête, whole: no `data-skin`, and Crête's own colours.
    expect(await skinOf(page)).toBe("crete");
    expect(await groundOf(page)).toBe(crete);
    expect(await notReloaded(page), "the page was reloaded").toBe(true);
  },
);

/** The answers for a skin's sheets: those that `pick` names fail `times` times, then they come. */
function sheetsFailing(pick: readonly string[], times: number): (path: string) => Verdict {
  const asked = new Map<string, number>();
  return (path) => {
    if (!pick.includes(path)) return "serve";
    asked.set(path, (asked.get(path) ?? 0) + 1);
    return (asked.get(path) ?? 0) <= times ? "404" : "serve";
  };
}

test(
  "un thème gardé dont la feuille manque une fois : elle est redemandée, et le thème est en place",
  TEST,
  async () => {
    const sheets = sheetsOf(SKIN);
    const control = await context.newPage();
    await openApp(control, { kept: SKIN });
    const dressed = await groundOf(control);
    await control.close();
    verdict = sheetsFailing(sheets, 1);

    const page = await context.newPage();
    await openApp(page, { kept: SKIN });

    expect(failed.length, "a sheet failed once").toBeGreaterThan(0);
    expect(await skinOf(page)).toBe(SKIN);
    expect(await groundOf(page)).toBe(dressed);
  },
);

// The account's skin is the device's, which is the common case of a member:
// the sync asks for the same look again while the start waits for it, and
// shares its load. If that load fails after the account has answered, the page
// was left in the skin, with Crête's colours or motifs.
test(
  "connecté, le thème de l'appareil étant celui du compte : si son look échoue, c'est Crête, même quand la session répond avant l'échec",
  TEST,
  async () => {
    const sheets = sheetsOf(SKIN);
    const control = await context.newPage();
    await openApp(control);
    const crete = await groundOf(control);
    await control.close();
    accountSkin = SKIN;
    // The sheets of the look fail at once for the link that index.html writes, and
    // fail again, slowly, for the request that asks for them again: the account has
    // answered, and the sync has asked for the same look, by then.
    const { promise, resolve } = Promise.withResolvers<void>();
    late = { paths: new Set(sheets), until: promise, counts: new Map() };
    verdict = (path) => (sheets.includes(path) ? "404" : "serve");
    const open = (async () => {
      await expect.poll(() => refreshes, { timeout: 10_000 }).toBeGreaterThan(0);
      resolve();
    })();

    const page = await context.newPage();
    await openApp(page, { kept: SKIN, signedIn: true });
    await open;

    expect(failed.length, "the sheets were asked for").toBeGreaterThan(0);
    expect(await skinOf(page)).toBe("crete");
    expect(await groundOf(page)).toBe(crete);
    // The device keeps the choice: the next start tries again.
    expect(await page.evaluate(() => localStorage.getItem("ptd-skin"))).toBe(SKIN);
    expect(saved, "the account was left alone").toEqual([]);
  },
);

// A look has more sheets than its palette: its faces, its trail.
test(
  "un thème gardé dont une feuille qui n'est pas sa palette manque pour de bon : Crête, pas le thème sans ses polices",
  TEST,
  async () => {
    const { others, palette } = sheetsByKind(SKIN);
    expect(palette.length, `the palette of ${SKIN}`).toBeGreaterThan(0);
    expect(others.length, `the other sheets of ${SKIN}`).toBeGreaterThan(0);
    const control = await context.newPage();
    await openApp(control);
    const crete = await groundOf(control);
    await control.close();
    verdict = sheetsFailing(others.slice(0, 1), Infinity);

    const page = await context.newPage();
    await openApp(page, { kept: SKIN });

    expect(failed.length, "the sheet was asked for").toBeGreaterThan(0);
    expect(await skinOf(page)).toBe("crete");
    expect(await groundOf(page)).toBe(crete);
  },
);

test(
  "un thème gardé dont une feuille qui n'est pas sa palette manque une fois : elle est redemandée, et le thème est entier",
  TEST,
  async () => {
    const { others } = sheetsByKind(SKIN);
    const control = await context.newPage();
    await openApp(control, { kept: SKIN });
    const dressed = await groundOf(control);
    await control.close();
    verdict = sheetsFailing(others.slice(0, 1), 1);

    const page = await context.newPage();
    await openApp(page, { kept: SKIN });

    expect(failed.length, "the sheet failed once").toBeGreaterThan(0);
    expect(await skinOf(page)).toBe(SKIN);
    expect(await groundOf(page)).toBe(dressed);
    // Asked for again, and loaded: nothing of the skin's is missing from the page.
    expect(
      await page.evaluate(
        () =>
          [...document.querySelectorAll('link[rel="stylesheet"]')].filter(
            (link) =>
              link instanceof HTMLLinkElement &&
              (link.sheet === null || link.sheet.cssRules.length === 0),
          ).length,
      ),
    ).toBe(0);
  },
);

// The settings page, signed in: the picker is the real one, on the real build.
const SETTINGS = "/profil/reglages";
const label = (id: string) => SKINS.find((skin) => skin.id === id)?.label.fr ?? id;
const picker = (page: Page) => page.getByRole("radiogroup", { name: fr.settings.skin });
const cardOf = (page: Page, id: string) =>
  picker(page).getByRole("radio", { name: label(id), exact: true });

/** The settings page of somebody signed in, once the picker is there. */
async function openSettings(page: Page) {
  await openApp(page, { signedIn: true, path: SETTINGS });
  await picker(page).waitFor();
}

// After a deploy, a tab that was opened before it asks for a look that the
// server no longer has. Online, that is the likely reason a look fails: the
// choice is kept, and the page reloads once, into the build that has the look.
test(
  "en ligne, choisir dans les réglages un thème dont le look a disparu (un déploiement) : le choix est gardé, la page se recharge une fois, et le nouveau build le met",
  TEST,
  async () => {
    const page = await context.newPage();
    await openSettings(page);
    // The look is gone, until the page is asked for again: the new build is up.
    const have = new Set(served);
    let deployed = false;
    verdict = (path) => {
      if (path === SETTINGS && failed.length > 0) deployed = true;
      return path.startsWith("/assets/") && !have.has(path) && !deployed ? "404" : "serve";
    };
    let loads = 0;
    page.on("load", () => {
      loads++;
    });

    // A click, not check(): when the look fails, the page puts the choice back at once, and
    // check() then fails on its own « the state did not change » before the assertions below.
    await cardOf(page, SKIN).click();

    // The page reloads, and is in the skin: kept on the device, it is the new build that wears it.
    await expect.poll(() => loads, { timeout: 10_000 }).toBeGreaterThan(0);
    await picker(page).waitFor();
    await expect.poll(() => skinOf(page), { timeout: 10_000 }).toBe(SKIN);
    await expect.poll(() => cardOf(page, SKIN).isChecked()).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem("ptd-skin"))).toBe(SKIN);
    // The account was marked as not told, and the next start sent it.
    await expect.poll(() => saved, { timeout: 10_000 }).toEqual([SKIN]);
    expect(loads, "it reloaded once").toBe(1);
  },
);

test(
  "hors ligne, choisir dans les réglages un thème jamais chargé : le message de la connexion, et ni rechargement, ni choix gardé",
  TEST,
  async () => {
    const page = await context.newPage();
    await openSettings(page);
    lookOffline("abort");
    await context.setOffline(true);

    // A click, not check(): when the look fails, the page puts the choice back at once, and
    // check() then fails on its own « the state did not change » before the assertions below.
    await cardOf(page, SKIN).click();

    await page.getByText(fr.settings.skinLoadFailed).waitFor({ timeout: 10_000 });
    expect(await notReloaded(page), "the page was reloaded").toBe(true);
    expect(await skinOf(page)).toBe("crete");
    expect(await page.evaluate(() => localStorage.getItem("ptd-skin"))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem("ptd-skin-unsaved"))).toBeNull();
    await expect.poll(() => cardOf(page, "crete").isChecked()).toBe(true);
    expect(saved).toEqual([]);
  },
);

test(
  "en ligne, un look qui manque encore après le rechargement : pas de seconde boucle, et un message qui ne met pas la connexion en cause",
  TEST,
  async () => {
    const page = await context.newPage();
    await openSettings(page);
    // The look stays gone, whatever the page: it is not a deploy that brings it back.
    lookOffline("404");
    let loads = 0;
    page.on("load", () => {
      loads++;
    });

    // A click, not check(): when the look fails, the page puts the choice back at once, and
    // check() then fails on its own « the state did not change » before the assertions below.
    await cardOf(page, SKIN).click();
    await expect.poll(() => loads, { timeout: 10_000 }).toBe(1);
    await picker(page).waitFor();
    // The reloaded page wears Crête (the kept skin has no look), and the choice is on the device.
    expect(await skinOf(page)).toBe("crete");
    expect(await page.evaluate(() => localStorage.getItem("ptd-skin"))).toBe(SKIN);

    // Again: the guard knows the page was just reloaded, and says so.
    // A click, not check(): when the look fails, the page puts the choice back at once, and
    // check() then fails on its own « the state did not change » before the assertions below.
    await cardOf(page, SKIN).click();

    await page.getByText(fr.settings.skinLoadFailedOnline).waitFor({ timeout: 10_000 });
    expect(loads, "the page reloaded again").toBe(1);
  },
);
