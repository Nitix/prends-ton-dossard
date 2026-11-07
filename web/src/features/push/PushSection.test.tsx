import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { useRef } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { KEY_A, fakeSubscription, installFakes, restoreFakes, type Fakes } from "./fakeBrowser";
import { PushSection } from "./PushSection";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

type Device = { id: string; label: string; created: string; lastSuccessAt: string };

const mocks = vi.hoisted(() => ({
  store: { record: null as Rec | null },
  send: vi.fn<(path: string, options: { method?: string; body?: unknown }) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: {
      get record() {
        return mocks.store.record && { ...mocks.store.record };
      },
      onChange: () => () => undefined,
    },
    send: mocks.send,
  },
}));

const THIS = "https://push.example.test/this-device";

/** What the server answers, and what it was asked. */
const server = {
  available: true,
  devices: [] as Device[],
  reminders: ["day"] as string[],
  test: (): Promise<unknown> => Promise.resolve({ sent: 2, failed: 0 }),
};

function device(id: string, label: string, lastSuccessAt = ""): Device {
  return { id, label, created: "2026-11-07 08:00:00.000Z", lastSuccessAt };
}

function serve() {
  mocks.send.mockImplementation((path, request) => {
    const method = request.method ?? "GET";
    if (path === "/api/app/me/reminders") return Promise.resolve({ reminders: server.reminders });
    if (path === "/api/app/push" && method === "GET") {
      return Promise.resolve(
        server.available
          ? { available: true, publicKey: KEY_A, devices: server.devices }
          : { available: false, devices: [] },
      );
    }
    if (path === "/api/app/push/subscriptions" && method === "POST") {
      server.devices = [device("dev-new", "Firefox sur Windows"), ...server.devices];
      return Promise.resolve({ id: "dev-new" });
    }
    if (path === "/api/app/push/subscriptions" && method === "DELETE") {
      server.devices = server.devices.filter((one) => one.id !== "dev-this");
      return Promise.resolve(undefined);
    }
    if (path.startsWith("/api/app/push/subscriptions/") && method === "DELETE") {
      const id = decodeURIComponent(path.split("/").pop() ?? "");
      server.devices = server.devices.filter((one) => one.id !== id);
      return Promise.resolve(undefined);
    }
    if (path === "/api/app/push/test") return server.test();
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
}

let fakes: Fakes;

beforeEach(() => {
  // The service worker is registered in a production build only.
  vi.stubEnv("PROD", true);
  mocks.send.mockReset();
  mocks.store.record = { id: "u1", collectionName: "users", role: "member" };
  server.available = true;
  server.devices = [];
  server.reminders = ["day"];
  server.test = () => Promise.resolve({ sent: 2, failed: 0 });
  localStorage.clear();
  fakes = installFakes();
  serve();
});

afterEach(() => {
  restoreFakes();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, "userAgent");
  Reflect.deleteProperty(navigator, "standalone");
});

function Host() {
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <section>
      <h2 ref={heading} tabIndex={-1}>
        Rappels
      </h2>
      <PushSection headingRef={heading} />
    </section>
  );
}

function mount(languages: string[] = ["fr"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider languages={languages}>
        <Host />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

type Screen = Awaited<ReturnType<typeof mount>>;

const button = (screen: Screen, name: string) => screen.getByRole("button", { name, exact: true });

/** The server and the browser already have this device. */
function alreadyOn() {
  restoreFakes();
  fakes = installFakes({ permission: "granted", current: fakeSubscription(THIS, KEY_A) });
  localStorage.setItem("ptd-push-device", "dev-this");
  server.devices = [device("dev-this", "Firefox sur Windows"), device("dev-other", "iPhone")];
}

test("PushSection — la permission est demandée avant tout await", async () => {
  restoreFakes();
  fakes = installFakes({ holdReady: true });
  const screen = await mount();
  await expect.element(button(screen, fr.push.enable)).toBeVisible();
  expect(fakes.requestPermission).not.toHaveBeenCalled();

  await button(screen, fr.push.enable).click();

  // The browser's worker is not ready yet, and the permission was asked already:
  // nothing was awaited between the tap and the request.
  expect(fakes.requestPermission).toHaveBeenCalledTimes(1);
  expect(fakes.subscribe).not.toHaveBeenCalled();
  fakes.releaseReady();
  await expect.element(screen.getByRole("status")).toHaveTextContent(fr.push.enabled);
});

test("PushSection — activer", async () => {
  const screen = await mount();

  await expect.element(screen.getByRole("heading", { name: fr.push.title })).toBeVisible();
  await expect.element(screen.getByText(fr.push.noDevices)).toBeVisible();
  await button(screen, fr.push.enable).click();

  await expect.element(screen.getByRole("status")).toHaveTextContent(fr.push.enabled);
  await expect.element(button(screen, fr.push.disable)).toBeVisible();
  await expect.element(button(screen, fr.push.test)).toBeVisible();
  expect(fakes.subscribe).toHaveBeenCalledTimes(1);
  // The list shows the device the server now has, marked as this one.
  await expect.element(button(screen, fr.push.removeLabel("Firefox sur Windows"))).toBeVisible();
  await expect.element(screen.getByText(`(${fr.push.thisDevice})`)).toBeVisible();
  // The title has the focus: the button that was tapped went.
  await expect.element(screen.getByRole("heading", { name: "Rappels", level: 2 })).toHaveFocus();
});

test("PushSection — l'anglais", async () => {
  const screen = await mount(["en"]);
  await expect.element(button(screen, en.push.enable)).toBeVisible();
});

test("PushSection — permission refusée : le texte qui le dit", async () => {
  restoreFakes();
  fakes = installFakes({ permission: "denied" });
  const screen = await mount();

  await expect.element(screen.getByText(fr.push.denied)).toBeVisible();
  await expect.element(button(screen, fr.push.enable)).not.toBeInTheDocument();
});

test("PushSection — le navigateur refuse la demande : le texte qui le dit", async () => {
  restoreFakes();
  fakes = installFakes({ answer: "denied" });
  const screen = await mount();

  await button(screen, fr.push.enable).click();

  await expect.element(screen.getByText(fr.push.denied)).toBeVisible();
  expect(fakes.subscribe).not.toHaveBeenCalled();
});

test("PushSection — iPhone dans Safari : comment installer", async () => {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  });
  const screen = await mount();

  await expect.element(screen.getByText(fr.push.needsInstall)).toBeVisible();
  await expect.element(button(screen, fr.push.enable)).not.toBeInTheDocument();
});

test("PushSection — iPhone dans l'appli installée : le bouton", async () => {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  });
  Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
  const screen = await mount();

  await expect.element(button(screen, fr.push.enable)).toBeVisible();
});

test("PushSection — navigateur sans Push API", async () => {
  // As with the server of Vite: the service worker is not registered.
  vi.stubEnv("PROD", false);
  const screen = await mount();

  await expect.element(screen.getByText(fr.push.unsupported)).toBeVisible();
  await expect.element(button(screen, fr.push.enable)).not.toBeInTheDocument();
});

test("PushSection — clés indisponibles", async () => {
  server.available = false;
  const screen = await mount();

  await expect.element(screen.getByText(fr.push.unavailable)).toBeVisible();
  await expect.element(button(screen, fr.push.enable)).not.toBeInTheDocument();
});

test("PushSection — absente quand le serveur n'a pas de notifications", async () => {
  mocks.send.mockImplementation((path) =>
    path === "/api/app/push"
      ? Promise.reject(new ClientResponseError({ status: 404, response: { status: 404 } }))
      : Promise.resolve({ reminders: [] }),
  );
  const screen = await mount();

  await expect.element(screen.getByRole("heading", { name: "Rappels", level: 2 })).toBeVisible();
  await expect
    .element(screen.getByRole("heading", { name: fr.push.title }))
    .not.toBeInTheDocument();
});

test("PushSection — désactiver, puis le focus sur le titre", async () => {
  alreadyOn();
  const screen = await mount();
  await expect.element(button(screen, fr.push.disable)).toBeVisible();

  await button(screen, fr.push.disable).click();

  await expect.element(screen.getByRole("status")).toHaveTextContent(fr.push.disabled);
  await expect.element(button(screen, fr.push.enable)).toBeVisible();
  expect(fakes.current).toBeNull();
  expect(mocks.send).toHaveBeenCalledWith("/api/app/push/subscriptions", {
    method: "DELETE",
    body: { endpoint: THIS },
  });
  await expect.element(screen.getByRole("heading", { name: "Rappels", level: 2 })).toHaveFocus();
});

test("PushSection — retirer un autre appareil, puis le focus", async () => {
  alreadyOn();
  const screen = await mount();
  await expect.element(screen.getByText("iPhone", { exact: true })).toBeVisible();

  await button(screen, fr.push.removeLabel("iPhone")).click();

  await expect.element(screen.getByText("iPhone", { exact: true })).not.toBeInTheDocument();
  expect(mocks.send).toHaveBeenCalledWith("/api/app/push/subscriptions/dev-other", {
    method: "DELETE",
  });
  // This device is untouched.
  expect(fakes.current).not.toBeNull();
  await expect.element(screen.getByRole("heading", { name: "Rappels", level: 2 })).toHaveFocus();
});

test("PushSection — retirer cet appareil le désabonne aussi", async () => {
  alreadyOn();
  const screen = await mount();

  await button(screen, fr.push.removeLabel("Firefox sur Windows")).click();

  await expect.element(button(screen, fr.push.enable)).toBeVisible();
  expect(fakes.current).toBeNull();
});

test("PushSection — « cet appareil » est marqué", async () => {
  alreadyOn();
  const screen = await mount();

  await expect.element(screen.getByText(`(${fr.push.thisDevice})`)).toBeVisible();
  // Once, on the row of this device only.
  await expect.element(screen.getByText("iPhone", { exact: true })).toBeVisible();
  expect(document.body.textContent?.split(`(${fr.push.thisDevice})`)).toHaveLength(2);
  expect(document.body.textContent).toMatch(/depuis le 7 nov\.\s2026/);
});

test("PushSection — essai : « Essai envoyé à 2 appareils. »", async () => {
  alreadyOn();
  const screen = await mount();

  await button(screen, fr.push.test).click();

  await expect.element(screen.getByRole("status")).toHaveTextContent("Essai envoyé à 2 appareils.");
});

test("PushSection — essai : un appareil n'a pas répondu", async () => {
  alreadyOn();
  server.test = () => Promise.resolve({ sent: 1, failed: 1 });
  const screen = await mount();

  await button(screen, fr.push.test).click();

  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Essai envoyé à 1 appareil. 1 appareil n'a pas répondu.");
});

test("PushSection — essai trop vite : le 429 sans code", async () => {
  alreadyOn();
  server.test = () =>
    Promise.reject(
      new ClientResponseError({ status: 429, response: { status: 429, message: "Too many" } }),
    );
  const screen = await mount();

  await button(screen, fr.push.test).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.push.tooManyTests);
});

test("PushSection — notifications non disponibles : l'erreur du serveur est dite", async () => {
  alreadyOn();
  server.test = () =>
    Promise.reject(
      new ClientResponseError({
        status: 503,
        response: { status: 503, data: { code: "push_unavailable" } },
      }),
    );
  const screen = await mount();

  await button(screen, fr.push.test).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.push_unavailable);
});

test("PushSection — choix « Jamais » : « Choisis d'abord quand être prévenu. »", async () => {
  server.reminders = [];
  const screen = await mount();

  await expect.element(screen.getByText("Choisis d'abord quand être prévenu.")).toBeVisible();
  // The button stays usable.
  await expect.element(button(screen, fr.push.enable)).toHaveAttribute("aria-disabled", "false");
  await button(screen, fr.push.enable).click();
  await expect.element(button(screen, fr.push.disable)).toBeVisible();
});

test("PushSection — un choix fait : pas de « Choisis d'abord »", async () => {
  const screen = await mount();

  await expect.element(button(screen, fr.push.enable)).toBeVisible();
  await expect.element(screen.getByText(fr.push.chooseFirst)).not.toBeInTheDocument();
});
