import { fileURLToPath } from "node:url";

import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";

import { SKINS } from ".";

// A look that cannot be loaded, through the real path: the real app, built as
// `pnpm build` builds it, in a real Chromium, served from memory under a fake
// host (every other host is refused). Vite's own preload helper loads the
// looks and the routes there, and fires `vite:preloadError` when one fails, as
// it does for a person on a phone: a stub of the loader (index.test.ts) cannot
// show what `reloadOnStaleChunks` (lib/staleChunks.ts) does with that event.
//
// - A look that fails (offline, or a 404 after a deploy) leaves the page as it
//   was: no reload. A later choice of the same skin loads its stylesheets,
//   which the helper does not ask for again after a failure.
// - A route chunk that is gone, online, still reloads the page (a deploy); offline it does not.
// - A skin kept on the device whose stylesheet fails while its code loads is
//   Crête, not Crête's colours under the skin's motifs; a stylesheet that
//   fails once is asked for again.

const web = fileURLToPath(new URL("../../", import.meta.url));
const ORIGIN = "https://app.test";

/** A test opens pages in a real browser, one of them without a network: it has time. */
const TEST = { timeout: 30_000 };

type Output = { fileName: string; code?: string; source?: string | Uint8Array };

let files = new Map<string, Output>();
let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  const { build } = await import("vite");
  const output = await build({
    root: web,
    configFile: `${web}vite.config.ts`,
    logLevel: "silent",
    build: { write: false, emptyOutDir: false },
  });
  const outputs: readonly Output[] = (Array.isArray(output) ? output : [output]).flatMap((one) =>
    "output" in one ? one.output : [],
  );
  files = new Map(outputs.map((file) => [file.fileName, file]));
  browser = await chromium.launch();
}, 120_000);

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

const TYPES: Record<string, string> = {
  js: "text/javascript",
  css: "text/css",
  html: "text/html",
  woff2: "font/woff2",
  json: "application/json",
  svg: "image/svg+xml",
};

async function serve(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  if (url.origin !== ORIGIN) return route.abort();
  const name = url.pathname.slice(1);
  const answer = verdict(url.pathname);
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
    // The pages of the app are index.html; anything with an extension, or of the API, is not there.
    if (url.pathname.startsWith("/api/") || /\.[a-z0-9]+$/.test(name)) {
      return route.fulfill({ status: 404, body: "not found" });
    }
    return route.fulfill({ contentType: TYPES.html ?? "", body: textOf("index.html") });
  }
  served.add(url.pathname);
  const extension = name.split(".").at(-1) ?? "";
  const body = file.code ?? file.source;
  return route.fulfill({
    contentType: TYPES[extension] ?? "application/octet-stream",
    body: typeof body === "string" ? body : Buffer.from(body ?? ""),
  });
}

function textOf(fileName: string): string {
  const file = files.get(fileName);
  const body = file?.code ?? file?.source ?? "";
  return typeof body === "string" ? body : Buffer.from(body).toString("utf8");
}

// A context of its own for each test: what a page keeps (the skin, the reload that was done) is not another's.
beforeEach(async () => {
  context = await browser.newContext({ serviceWorkers: "block", locale: "fr-FR" });
  await context.route("**/*", serve);
});

afterEach(async () => {
  verdict = () => "serve";
  failed = [];
  served.clear();
  await context.close();
});

/** A skin that is not Crête, and the stylesheets that the page names for it. */
const SKIN = SKINS.find((skin) => skin.id !== "crete" && !skin.id.startsWith("_"))?.id ?? "";

function sheetsOf(id: string): string[] {
  const table: unknown = JSON.parse(
    /const skins = (\{.*?\});/.exec(textOf("index.html"))?.[1] ?? "{}",
  );
  const entry: unknown =
    typeof table === "object" && table !== null
      ? Object.entries(table).find(([key]) => key === id)?.[1]
      : undefined;
  const sheets: unknown =
    typeof entry === "object" && entry !== null && "sheets" in entry ? entry.sheets : [];
  return Array.isArray(sheets) ? sheets.map(String) : [];
}

/** Opens the sign-in page, drawn once its heading is there, and marks the page so that a reload shows. */
async function openApp(page: Page, kept?: string): Promise<void> {
  if (kept !== undefined) {
    await page.addInitScript((id) => localStorage.setItem("ptd-skin", id), kept);
  }
  await page.goto(`${ORIGIN}/connexion`);
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.evaluate(() => {
    Object.assign(window, { loadedOnce: true });
  });
}

/** Whether this is still the page that was marked (a reload would have lost the mark). */
const notReloaded = (page: Page) =>
  page.evaluate(
    () => "loadedOnce" in window && sessionStorage.getItem("courses:stale-chunk-reload") === null,
  );

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

    await expect.poll(() => failed.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(500);
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

  await expect.poll(() => failed.length, { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(500);
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

test(
  "un morceau de route qui n'existe plus (un déploiement), en ligne, recharge la page, une fois",
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

    await expect.poll(() => loads, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1000);
    const settled = loads;
    await page.waitForTimeout(1000);
    // It stops: the reloaded page fails on the same route (it stays gone here), and does not loop.
    expect(loads).toBe(settled);
    expect(loads).toBeLessThanOrEqual(2);
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

    await expect.poll(() => failed.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(500);
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
    await openApp(page, SKIN);

    expect(failed.length, "the sheets were asked for").toBeGreaterThan(0);
    // Crête, whole: no `data-skin`, and Crête's own colours.
    expect(await skinOf(page)).toBe("crete");
    expect(await groundOf(page)).toBe(crete);
    expect(await notReloaded(page), "the page was reloaded").toBe(true);
  },
);

test(
  "un thème gardé dont la feuille manque une fois : elle est redemandée, et le thème est en place",
  TEST,
  async () => {
    const sheets = sheetsOf(SKIN);
    const control = await context.newPage();
    await openApp(control, SKIN);
    const dressed = await groundOf(control);
    await control.close();
    const asked = new Map<string, number>();
    verdict = (path) => {
      if (!sheets.includes(path)) return "serve";
      asked.set(path, (asked.get(path) ?? 0) + 1);
      // The first time only.
      return asked.get(path) === 1 ? "404" : "serve";
    };

    const page = await context.newPage();
    await openApp(page, SKIN);

    expect(failed.length, "a sheet failed once").toBeGreaterThan(0);
    expect(await skinOf(page)).toBe(SKIN);
    expect(await groundOf(page)).toBe(dressed);
  },
);
