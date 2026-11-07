import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { ClientResponseError } from "pocketbase";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ToastProvider } from "../components/Toast";
import { I18nProvider } from "../i18n/I18nProvider";
import { ensureTemporal } from "../lib/temporal";
import { TodayProvider } from "../lib/useToday";
import { routeTree } from "../routeTree.gen";

import "../styles.css";

const world = vi.hoisted(() => ({
  record: null as { id: string; collectionName: string; role: string; email: string } | null,
  /** What the request for the event `getOne` waits for, then gives (or refuses with). */
  event: null as Promise<unknown> | null,
}));

// The real tree of routes runs here: every list is empty, except the runners
// (one, Alice) and the one event, which a test holds back or refuses.
vi.mock("../lib/pb", () => ({
  pb: {
    authStore: {
      isValid: true,
      get record() {
        return world.record && { ...world.record };
      },
      onChange: () => () => {},
    },
    filter: (raw: string) => raw,
    // The settings page asks for the calendar link, the tokens of the assistants and the push devices, by path.
    send: (path: string) =>
      Promise.resolve(
        path === "/api/app/mcp-tokens"
          ? { url: "http://localhost:5173/mcp", max: 5, tokens: [] }
          : path === "/api/app/push"
            ? { available: true, publicKey: "key", devices: [] }
            : { exists: false },
      ),
    files: { getURL: () => "" },
    collection: (name: string) => ({
      getFullList: () =>
        Promise.resolve(name === "runners" ? [{ id: "r1", name: "Alice", user: "u1" }] : []),
      getList: () => Promise.resolve({ items: [] }),
      getFirstListItem: () => Promise.resolve({ id: "r1", name: "Alice", user: "u1" }),
      getOne: () => world.event ?? Promise.reject(new Error("no event")),
    }),
  },
}));

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(() => {
  world.record = { id: "u1", collectionName: "users", role: "admin", email: "alice@example.test" };
  world.event = null;
  document.title = "";
});

const eventRecord = (name: string) => ({
  id: "e1",
  name,
  location: "Chamonix",
  start_date: "2027-06-13",
  created_by: "r1",
  expand: {},
});

async function openApp(path: string, language: "fr" | "en") {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider languages={[language]}>
        <TodayProvider value={Temporal.PlainDate.from("2026-10-31")}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </TodayProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return router;
}

// Each row of the table of the spec (§ 6), in both languages.
const ROWS: [path: string, fr: string, en: string][] = [
  ["/", "Accueil", "Home"],
  ["/liste", "Courses à venir", "Upcoming races"],
  ["/liste?periode=passees", "Courses passées", "Past races"],
  ["/agenda?mois=2027-06", "Agenda · juin 2027", "Calendar · June 2027"],
  ["/agenda", "Agenda · octobre 2026", "Calendar · October 2026"],
  ["/stats?annee=2026", "Statistiques 2026", "Statistics 2026"],
  ["/stats", "Statistiques 2026", "Statistics 2026"],
  ["/evenements/nouveau", "Nouvelle course", "New race"],
  ["/profil", "Profil", "Profile"],
  ["/profil/reglages", "Réglages", "Settings"],
  ["/admin/membres", "Membres · Admin", "Members · Admin"],
  ["/admin/types", "Types de course · Admin", "Race types · Admin"],
  ["/admin/doublons", "Doublons · Admin", "Duplicates · Admin"],
  ["/connexion", "Connexion", "Sign in"],
  ["/invitation", "Invitation", "Invitation"],
  ["/une/adresse/inconnue", "Page introuvable", "Page not found"],
];

for (const [path, fr, en] of ROWS) {
  test(`titres — ${path} s'appelle « ${fr} » en français`, async () => {
    await openApp(path, "fr");
    await expect.poll(() => document.title).toBe(`${fr} · Prends ton dossard`);
  });

  test(`titres — ${path} s'appelle « ${en} » en anglais`, async () => {
    await openApp(path, "en");
    await expect.poll(() => document.title).toBe(`${en} · Prends ton dossard`);
  });
}

test("titres — la course : « Course », puis son nom quand il arrive", async () => {
  let arrive!: (record: unknown) => void;
  world.event = new Promise((resolve) => (arrive = resolve));
  await openApp("/evenements/e1", "fr");
  await expect.poll(() => document.title).toBe("Course · Prends ton dossard");

  arrive(eventRecord("Trail des Crêtes"));
  await expect.poll(() => document.title).toBe("Trail des Crêtes · Prends ton dossard");
});

test("titres — la course, en anglais : « Race », puis son nom", async () => {
  let arrive!: (record: unknown) => void;
  world.event = new Promise((resolve) => (arrive = resolve));
  await openApp("/evenements/e1", "en");
  await expect.poll(() => document.title).toBe("Race · Prends ton dossard");

  arrive(eventRecord("Trail des Crêtes"));
  await expect.poll(() => document.title).toBe("Trail des Crêtes · Prends ton dossard");
});

test("titres — un nom de course est du texte, rien n'y est interprété", async () => {
  world.event = Promise.resolve(eventRecord("<b>Trail</b> &amp; co"));
  await openApp("/evenements/e1", "fr");
  await expect.poll(() => document.title).toBe("<b>Trail</b> &amp; co · Prends ton dossard");
});

test("titres — une course qui n'existe pas (404) : « Course introuvable »", async () => {
  world.event = Promise.reject(new ClientResponseError({ status: 404, response: {} }));
  await openApp("/evenements/nope", "fr");
  await expect.poll(() => document.title).toBe("Course introuvable · Prends ton dossard");
});

test("titres — une course introuvable, en anglais", async () => {
  world.event = Promise.reject(new ClientResponseError({ status: 404, response: {} }));
  await openApp("/evenements/nope", "en");
  await expect.poll(() => document.title).toBe("Race not found · Prends ton dossard");
});

test("titres — modifier une course : « Modifier », puis « Modifier · <nom> »", async () => {
  let arrive!: (record: unknown) => void;
  world.event = new Promise((resolve) => (arrive = resolve));
  await openApp("/evenements/e1/modifier", "fr");
  await expect.poll(() => document.title).toBe("Modifier · Prends ton dossard");

  arrive(eventRecord("Trail des Crêtes"));
  await expect.poll(() => document.title).toBe("Modifier · Trail des Crêtes · Prends ton dossard");
});

test("titres — modifier une course, en anglais", async () => {
  world.event = Promise.resolve(eventRecord("Trail des Crêtes"));
  await openApp("/evenements/e1/modifier", "en");
  await expect.poll(() => document.title).toBe("Edit · Trail des Crêtes · Prends ton dossard");
});

test("titres — modifier une course qui n'existe pas : « Course introuvable »", async () => {
  world.event = Promise.reject(new ClientResponseError({ status: 404, response: {} }));
  await openApp("/evenements/nope/modifier", "fr");
  await expect.poll(() => document.title).toBe("Course introuvable · Prends ton dossard");
});

test("titres — un coureur : son nom", async () => {
  await openApp("/coureurs/r1", "fr");
  await expect.poll(() => document.title).toBe("Alice · Prends ton dossard");
});

test("titres — un coureur, en anglais : son nom aussi", async () => {
  await openApp("/coureurs/r1", "en");
  await expect.poll(() => document.title).toBe("Alice · Prends ton dossard");
});

test("titres — un coureur inconnu : « Coureur »", async () => {
  await openApp("/coureurs/inconnu", "fr");
  await expect.poll(() => document.title).toBe("Coureur · Prends ton dossard");
});

test("titres — un coureur inconnu, en anglais : « Runner »", async () => {
  await openApp("/coureurs/inconnu", "en");
  await expect.poll(() => document.title).toBe("Runner · Prends ton dossard");
});
