import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { RemindersSection } from "./RemindersSection";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  store: { record: null as Rec | null, listeners: new Set<() => void>() },
  send: vi.fn<(path: string, options: Rec) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: {
      // A new object on every read, like the SDK's LocalAuthStore.
      get record() {
        return mocks.store.record && { ...mocks.store.record };
      },
      onChange(listener: () => void) {
        mocks.store.listeners.add(listener);
        return () => mocks.store.listeners.delete(listener);
      },
    },
    send: mocks.send,
  },
}));

const PATH = "/api/app/me/reminders";

beforeEach(() => {
  mocks.send.mockReset();
  mocks.store.listeners.clear();
  mocks.store.record = { id: "u1", collectionName: "users", role: "member" };
});

function failure(status: number, code?: string) {
  return new ClientResponseError({
    status,
    response: { status, message: "…", data: code === undefined ? {} : { code } },
  });
}

/** The reminders of the body of a save. */
function remindersOf(body: unknown): string[] {
  if (typeof body === "object" && body !== null && "reminders" in body) {
    const { reminders } = body;
    if (Array.isArray(reminders)) return reminders.filter((one) => typeof one === "string");
  }
  throw new Error("a save without reminders");
}

/** The server of the reminders of the account: what is chosen, and what a save answers (as the server keeps it, day before hour). */
function serve(chosen: string[], save?: (body: unknown) => Promise<unknown>) {
  let stored = chosen;
  mocks.send.mockImplementation(async (path, request) => {
    if (path !== PATH) throw new Error(`unexpected request to ${path}`);
    if (request.method === "GET") return { reminders: stored };
    const reminders = remindersOf(request.body);
    if (save !== undefined) await save(request.body);
    stored = ["day", "hour"].filter((kind) => reminders.includes(kind));
    return { reminders: stored };
  });
}

function puts(): unknown[] {
  return mocks.send.mock.calls
    .filter(([, request]) => request.method === "PUT")
    .map(([, request]) => request.body);
}

function mount(languages: string[] = ["fr"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider languages={languages}>
        <RemindersSection />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

type Screen = Awaited<ReturnType<typeof mount>>;

const radio = (screen: Screen, name: string) => screen.getByRole("radio", { name, exact: true });

test("RemindersSection — le choix s'enregistre", async () => {
  serve([]);
  const screen = await mount();

  await expect.element(screen.getByRole("region")).toHaveAccessibleName(fr.reminders.title);
  await expect.element(screen.getByText(fr.reminders.intro)).toBeVisible();
  await expect.element(screen.getByRole("group", { name: fr.reminders.legend })).toBeVisible();
  // Nothing is chosen until the person chooses: « Jamais ».
  await expect.element(radio(screen, fr.reminders.none)).toBeChecked();
  for (const label of [fr.reminders.day, fr.reminders.hour, fr.reminders.both]) {
    await expect.element(radio(screen, label)).not.toBeChecked();
  }
  // Nothing is said to be saved before anything is.
  await expect.element(screen.getByRole("status")).toHaveTextContent("");

  await radio(screen, fr.reminders.both).click();

  await expect.element(screen.getByRole("status")).toHaveTextContent(fr.reminders.saved);
  await expect.element(radio(screen, fr.reminders.both)).toBeChecked();
  expect(puts()).toEqual([{ reminders: ["day", "hour"] }]);

  await radio(screen, fr.reminders.hour).click();
  await expect.element(radio(screen, fr.reminders.hour)).toBeChecked();
  expect(puts()).toEqual([{ reminders: ["day", "hour"] }, { reminders: ["hour"] }]);

  await radio(screen, fr.reminders.none).click();
  await expect.element(radio(screen, fr.reminders.none)).toBeChecked();
  expect(puts().at(-1)).toEqual({ reminders: [] });
  // The line that says it, and the others the page owes: the time that is
  // counted without an opening time, and where the reminders arrive.
  await expect.element(screen.getByText(fr.reminders.noTime)).toBeVisible();
  await expect.element(screen.getByText(fr.reminders.where)).toBeVisible();
  // No alert on the way.
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});

test("RemindersSection — le choix est celui du serveur, et les cibles font 44 px", async () => {
  serve(["hour"]);
  const screen = await mount();

  await expect.element(radio(screen, fr.reminders.hour)).toBeChecked();
  for (const label of [fr.reminders.day, fr.reminders.hour, fr.reminders.both, fr.reminders.none]) {
    const box = radio(screen, label).element().getBoundingClientRect();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

test("RemindersSection — un refus rend l'ancien choix", async () => {
  serve(["day"]);
  const screen = await mount();
  await expect.element(radio(screen, fr.reminders.day)).toBeChecked();

  // The server refuses: the choice that was made shows while it thinks, then the old one is back.
  const answer = Promise.withResolvers<never>();
  mocks.send.mockImplementation((_path, request) =>
    request.method === "GET" ? Promise.resolve({ reminders: ["day"] }) : answer.promise,
  );
  await radio(screen, fr.reminders.hour).click();
  await expect.element(radio(screen, fr.reminders.hour)).toBeChecked();
  answer.reject(failure(403, "forbidden"));

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.forbidden);
  await expect.element(radio(screen, fr.reminders.day)).toBeChecked();
  await expect.element(radio(screen, fr.reminders.hour)).not.toBeChecked();
  await expect.element(screen.getByRole("status")).toHaveTextContent("");

  // The next change goes through, and the alert goes.
  serve(["day"]);
  await radio(screen, fr.reminders.both).click();
  await expect.element(screen.getByRole("status")).toHaveTextContent(fr.reminders.saved);
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});

test("RemindersSection — absente sur la démo", async () => {
  mocks.send.mockRejectedValue(failure(404));
  const screen = await mount();

  await vi.waitFor(() => {
    expect(mocks.send).toHaveBeenCalledWith(PATH, expect.objectContaining({ method: "GET" }));
  });
  await expect.element(screen.getByRole("region")).not.toBeInTheDocument();
  await expect.element(screen.getByText(fr.reminders.title)).not.toBeInTheDocument();
});

test("RemindersSection — en anglais", async () => {
  serve([]);
  const screen = await mount(["en"]);

  await expect.element(screen.getByRole("region")).toHaveAccessibleName(en.reminders.title);
  await expect.element(radio(screen, en.reminders.both)).toBeVisible();
  await radio(screen, en.reminders.day).click();
  await expect.element(screen.getByRole("status")).toHaveTextContent(en.reminders.saved);
});
