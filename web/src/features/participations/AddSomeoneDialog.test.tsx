import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ToastProvider } from "../../components/Toast";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { toEventView, type EventView } from "../events/api";
import { aliceRunner, bobRunner, eventRecord, samRunner } from "../events/testFixture";
import { AddSomeoneDialog } from "./AddSomeoneDialog";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  runners: vi.fn<(options?: Rec) => Promise<unknown>>(),
  create: vi.fn<(body: Rec) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    collection: (name: string) =>
      ({
        runners: { getFullList: mocks.runners },
        participations: { create: mocks.create },
      })[name],
  },
}));

let view: EventView;

beforeAll(async () => {
  await ensureTemporal();
  view = toEventView(eventRecord);
});

beforeEach(() => {
  mocks.runners.mockReset().mockResolvedValue([aliceRunner, bobRunner, samRunner]);
  mocks.create.mockReset().mockResolvedValue({ id: "new" });
});

async function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onClose = vi.fn<() => void>();
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={["fr"]}>
        <ToastProvider>
          <AddSomeoneDialog open onClose={onClose} view={view} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { screen, onClose, invalidate };
}

type Screen = Awaited<ReturnType<typeof renderDialog>>["screen"];

const runnerSelect = (screen: Screen) => screen.getByLabelText(fr.participation.runner);
const formatSelect = (screen: Screen) => screen.getByLabelText(fr.participation.format);
const statusSelect = (screen: Screen) => screen.getByLabelText(fr.participation.status);

function optionsOf(select: Element): HTMLOptionElement[] {
  if (!(select instanceof HTMLSelectElement)) throw new Error("not a select");
  return Array.from(select.options);
}

/** The names of the runners the dialog offers, without the "choose" placeholder. */
function offered(screen: Screen): (string | null)[] {
  return optionsOf(runnerSelect(screen).element())
    .filter((option) => option.value !== "")
    .map((option) => option.textContent);
}

/** Waits for the runners to be loaded. */
async function loaded(screen: Screen) {
  await expect
    .element(screen.getByRole("dialog", { name: fr.participation.addSomeoneTitle }))
    .toBeVisible();
  await vi.waitFor(() => {
    expect(offered(screen).length).toBeGreaterThan(0);
  });
}

test("AddSomeoneDialog — pour F42, Alice et Bob ne sont pas proposés, Sam l'est", async () => {
  const { screen } = await renderDialog();
  await loaded(screen);

  await formatSelect(screen).selectOptions("f42");

  expect(offered(screen)).toEqual(["Sam"]);
});

test("AddSomeoneDialog — par défaut, la première épreuve (F15, le 13 juin) : Sam y est, Alice et Bob sont proposés", async () => {
  const { screen } = await renderDialog();
  await loaded(screen);

  await expect.element(formatSelect(screen)).toHaveValue("f15");
  expect(offered(screen)).toEqual(["Alice", "Bob"]);
});

test("AddSomeoneDialog — les épreuves se reconnaissent à leur type, leur mesure et leur jour", async () => {
  const { screen } = await renderDialog();
  await loaded(screen);

  const labels = optionsOf(formatSelect(screen).element()).map((option) =>
    (option.textContent ?? "").replace(/\p{Zs}/gu, " "),
  );
  expect(labels).toEqual(["Trail 15 km · sam. 13 juin", "Trail 42 km · dim. 14 juin"]);
});

test("AddSomeoneDialog — changer d'épreuve oublie le coureur choisi s'il n'y est plus proposé", async () => {
  const { screen } = await renderDialog();
  await loaded(screen);
  await runnerSelect(screen).selectOptions(bobRunner.id);
  await expect.element(runnerSelect(screen)).toHaveValue(bobRunner.id);

  // Bob is on F42.
  await formatSelect(screen).selectOptions("f42");

  await expect.element(runnerSelect(screen)).toHaveValue("");
});

test("AddSomeoneDialog — ajoute Sam sur F42 avec le statut choisi, puis se ferme et invalide les listes", async () => {
  const { screen, onClose, invalidate } = await renderDialog();
  await loaded(screen);
  await formatSelect(screen).selectOptions("f42");
  await runnerSelect(screen).selectOptions(samRunner.id);
  await statusSelect(screen).selectOptions("registered");

  await screen.getByRole("button", { name: fr.participation.addSubmit }).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.create).toHaveBeenCalledWith({
    runner: samRunner.id,
    format: "f42",
    status: "registered",
  });
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(keys).toContainEqual(["events"]);
  expect(keys).toContainEqual(["event", "event"]);
  expect(keys).toContainEqual(["pending"]);
});

test("AddSomeoneDialog — le statut de départ est « Intéressé », et les cinq statuts sont proposés", async () => {
  const { screen } = await renderDialog();
  await loaded(screen);

  await expect.element(statusSelect(screen)).toHaveValue("interested");
  expect(optionsOf(statusSelect(screen).element()).map((option) => option.textContent)).toEqual([
    fr.status.interested,
    fr.status.registered,
    fr.status.finished,
    fr.status.dnf,
    fr.status.dns,
  ]);
});

test("AddSomeoneDialog — on ne peut pas valider sans avoir choisi un coureur", async () => {
  const { screen, onClose } = await renderDialog();
  await loaded(screen);

  await screen.getByRole("button", { name: fr.participation.addSubmit }).click();

  expect(mocks.create).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  const select = runnerSelect(screen).element();
  if (!(select instanceof HTMLSelectElement)) throw new Error("not a select");
  expect(select.validity.valueMissing).toBe(true);
});

test("AddSomeoneDialog — un coureur déjà sur l'épreuve (le serveur le dit) : message clair, la fenêtre reste ouverte", async () => {
  mocks.create.mockRejectedValue(
    new ClientResponseError({
      status: 400,
      response: {
        status: 400,
        message: "…",
        data: { runner: { code: "validation_not_unique", message: "Value must be unique." } },
      },
    }),
  );
  const { screen, onClose } = await renderDialog();
  await loaded(screen);
  await runnerSelect(screen).selectOptions(aliceRunner.id);

  await screen.getByRole("button", { name: fr.participation.addSubmit }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.participation.alreadyThere);
  expect(onClose).not.toHaveBeenCalled();
  // The user can try again with somebody else.
  await expect
    .element(screen.getByRole("button", { name: fr.participation.addSubmit }))
    .toBeEnabled();
});

test("AddSomeoneDialog — toute autre erreur est traduite d'après son code", async () => {
  mocks.create.mockRejectedValue(
    new ClientResponseError({
      status: 403,
      response: { status: 403, message: "…", data: { code: "forbidden" } },
    }),
  );
  const { screen } = await renderDialog();
  await loaded(screen);
  await runnerSelect(screen).selectOptions(aliceRunner.id);

  await screen.getByRole("button", { name: fr.participation.addSubmit }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.forbidden);
});

test("AddSomeoneDialog — si tout le monde est déjà sur l'épreuve, il n'y a personne à ajouter", async () => {
  mocks.runners.mockResolvedValue([aliceRunner, bobRunner]);
  const { screen } = await renderDialog();
  await expect
    .element(screen.getByRole("dialog", { name: fr.participation.addSomeoneTitle }))
    .toBeVisible();

  await formatSelect(screen).selectOptions("f42");

  await expect.element(screen.getByText(fr.participation.everyoneThere)).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: fr.participation.addSubmit }))
    .toBeDisabled();
});

test("AddSomeoneDialog — Annuler ferme sans rien créer", async () => {
  const { screen, onClose } = await renderDialog();
  await loaded(screen);

  await screen.getByRole("button", { name: fr.common.cancel }).click();

  expect(onClose).toHaveBeenCalledOnce();
  expect(mocks.create).not.toHaveBeenCalled();
});

test("AddSomeoneDialog — les champs et les boutons font au moins 44 px", async () => {
  const { screen } = await renderDialog();
  await loaded(screen);

  for (const element of [
    runnerSelect(screen),
    formatSelect(screen),
    statusSelect(screen),
    screen.getByRole("button", { name: fr.participation.addSubmit }),
    screen.getByRole("button", { name: fr.common.cancel }),
  ]) {
    expect(element.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
});
