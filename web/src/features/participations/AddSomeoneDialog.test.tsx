import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ToastProvider } from "../../components/Toast";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { toEventView, type EventView } from "../events/api";
import { SUPPORT, UNDECIDED } from "../events/participants";
import {
  aliceRunner,
  bobRunner,
  eventRecord,
  ninaRunner,
  p1,
  p2,
  pNinaSupporter,
  samRunner,
  withParticipations,
} from "../events/testFixture";
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

// Alice and Bob are on F42, Sam is on F15, Nina is on none.
let view: EventView;
// Alice is on F42 and F15 both.
let aliceEverywhere: EventView;
// Alice and Bob are on both formats.
let everyoneEverywhere: EventView;

beforeAll(async () => {
  await ensureTemporal();
  view = toEventView(eventRecord);
  const aliceOnF15 = { ...p1, id: "p1b", format: "f15", expand: p1.expand };
  const bobOnF15 = { ...p2, id: "p2b", format: "f15", expand: p2.expand };
  aliceEverywhere = toEventView(withParticipations(eventRecord, [aliceOnF15]));
  everyoneEverywhere = toEventView(withParticipations(eventRecord, [aliceOnF15, bobOnF15]));
});

beforeEach(() => {
  // On purpose in the order of neither the names nor the formats they are on.
  mocks.runners.mockReset().mockResolvedValue([samRunner, ninaRunner, bobRunner, aliceRunner]);
  mocks.create.mockReset().mockResolvedValue({ id: "new" });
});

async function renderDialog(eventView: EventView = view) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onClose = vi.fn<() => void>();
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={["fr"]}>
        <ToastProvider>
          <AddSomeoneDialog open onClose={onClose} view={eventView} />
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
const submit = (screen: Screen) => screen.getByRole("button", { name: fr.participation.addSubmit });

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

// --- The runner first ---

test("AddSomeoneDialog — le coureur se choisit d'abord ; Sam (sur F15) n'a que F42, sans « Pas encore décidé »", async () => {
  const { screen } = await renderDialog();
  await loaded(screen);
  // No format to choose before a runner is.
  await expect.element(formatSelect(screen)).not.toBeInTheDocument();

  await runnerSelect(screen).selectOptions(samRunner.id);

  expect(optionsOf(formatSelect(screen).element()).map((option) => option.value)).toEqual(["f42"]);
  await expect.element(formatSelect(screen)).toHaveValue("f42");
  expect(screen.container.textContent).not.toContain(fr.participation.undecided);
});

test("AddSomeoneDialog — les coureurs proposés sont ceux qui ont encore quelque chose à choisir, par nom", async () => {
  const { screen } = await renderDialog();
  await loaded(screen);

  // Alice and Bob are on F42 and can still take F15; Nina and Sam too.
  expect(offered(screen)).toEqual(["Alice", "Bob", "Nina", "Sam"]);
});

test("AddSomeoneDialog — un coureur sur aucune épreuve a toutes les épreuves, « Pas encore décidé » et « Vient encourager »", async () => {
  const { screen } = await renderDialog();
  await loaded(screen);

  await runnerSelect(screen).selectOptions(ninaRunner.id);

  const options = optionsOf(formatSelect(screen).element());
  expect(options.map((option) => option.value)).toEqual(["f15", "f42", UNDECIDED, SUPPORT]);
  expect(options.map((option) => option.textContent).slice(-2)).toEqual([
    fr.participation.undecided,
    fr.participation.supportOther,
  ]);
  await expect.element(formatSelect(screen)).toHaveValue("f15");
});

test("AddSomeoneDialog — un coureur déjà sur toutes les épreuves n'est pas proposé", async () => {
  const { screen } = await renderDialog(aliceEverywhere);
  await loaded(screen);

  expect(offered(screen)).toEqual(["Bob", "Nina", "Sam"]);
});

test("AddSomeoneDialog — les épreuves se reconnaissent à leur type, leur mesure et leur jour", async () => {
  const { screen } = await renderDialog();
  await loaded(screen);

  await runnerSelect(screen).selectOptions(ninaRunner.id);

  const labels = optionsOf(formatSelect(screen).element()).map((option) =>
    (option.textContent ?? "").replace(/\p{Zs}/gu, " "),
  );
  expect(labels).toEqual([
    "Trail 15 km · sam. 13 juin",
    "Trail 42 km · dim. 14 juin",
    fr.participation.undecided,
    fr.participation.supportOther,
  ]);
});

test("AddSomeoneDialog — changer de coureur repart de sa première épreuve proposée", async () => {
  const { screen } = await renderDialog();
  await loaded(screen);
  await runnerSelect(screen).selectOptions(ninaRunner.id);
  await formatSelect(screen).selectOptions("f42");
  await expect.element(formatSelect(screen)).toHaveValue("f42");

  // Sam only has F42 left: it is his first.
  await runnerSelect(screen).selectOptions(samRunner.id);
  await expect.element(formatSelect(screen)).toHaveValue("f42");

  // Alice only has F15 left.
  await runnerSelect(screen).selectOptions(aliceRunner.id);
  await expect.element(formatSelect(screen)).toHaveValue("f15");

  // Back to Nina, whose choice of F42 is forgotten.
  await runnerSelect(screen).selectOptions(ninaRunner.id);
  await expect.element(formatSelect(screen)).toHaveValue("f15");
});

// --- What it creates ---

test("AddSomeoneDialog — ajoute Sam sur F42 avec le statut choisi, puis se ferme et invalide les listes", async () => {
  const { screen, onClose, invalidate } = await renderDialog();
  await loaded(screen);
  await runnerSelect(screen).selectOptions(samRunner.id);
  await statusSelect(screen).selectOptions("registered");

  await submit(screen).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    runner: samRunner.id,
    event: "event",
    format: "f42",
    status: "registered",
  });
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(keys).toContainEqual(["events"]);
  expect(keys).toContainEqual(["event", "event"]);
  expect(keys).toContainEqual(["pending"]);
});

test('AddSomeoneDialog — « Pas encore décidé » crée {runner, event, status: "interested"} sans format', async () => {
  const { screen, onClose } = await renderDialog();
  await loaded(screen);
  await runnerSelect(screen).selectOptions(ninaRunner.id);
  await statusSelect(screen).selectOptions("registered");

  await formatSelect(screen).selectOptions(UNDECIDED);

  await expect.element(statusSelect(screen)).toBeDisabled();
  await expect.element(statusSelect(screen)).toHaveValue("interested");
  await expect.element(screen.getByText(fr.participation.undecidedHint)).toBeVisible();

  await submit(screen).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    runner: ninaRunner.id,
    event: "event",
    status: "interested",
  });
  const [body] = mocks.create.mock.calls[0] ?? [];
  expect("format" in (body ?? {})).toBe(false);
});

// --- Supporter: « Vient encourager » ---

test("AddSomeoneDialog — « Vient encourager » pour un autre coureur", async () => {
  const { screen, onClose, invalidate } = await renderDialog();
  await loaded(screen);
  await runnerSelect(screen).selectOptions(ninaRunner.id);
  // The status was chosen before: the lock puts it on « Supporteur ».
  await statusSelect(screen).selectOptions("registered");

  await formatSelect(screen).selectOptions(SUPPORT);

  // The choice is worded for somebody else.
  expect(screen.container.textContent).not.toContain(fr.participation.support);
  await expect.element(statusSelect(screen)).toBeDisabled();
  await expect.element(statusSelect(screen)).toHaveValue("supporter");
  await expect.element(screen.getByText(fr.participation.supportHint)).toBeVisible();
  expect(screen.container.textContent).not.toContain(fr.participation.undecidedHint);
  const hint = screen.getByText(fr.participation.supportHint).element();
  expect(statusSelect(screen).element().getAttribute("aria-describedby")).toBe(hint.id);

  await submit(screen).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    runner: ninaRunner.id,
    event: "event",
    status: "supporter",
  });
  const [body] = mocks.create.mock.calls[0] ?? [];
  expect("format" in (body ?? {})).toBe(false);
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(keys).toContainEqual(["event", "event"]);
});

test("AddSomeoneDialog — un coureur qui n'a plus que ce choix est proposé", async () => {
  // An event with no format: « Vient encourager » is all that is left to choose, for everybody.
  const noFormat = toEventView({
    ...eventRecord,
    expand: { formats_via_event: [], participations_via_event: [] },
  });
  const { screen, onClose } = await renderDialog(noFormat);
  await loaded(screen);

  expect(offered(screen)).toEqual(["Alice", "Bob", "Nina", "Sam"]);
  await runnerSelect(screen).selectOptions(samRunner.id);
  // It is the only choice, and it is the one that is chosen.
  expect(optionsOf(formatSelect(screen).element()).map((option) => option.value)).toEqual([
    SUPPORT,
  ]);
  await expect.element(formatSelect(screen)).toHaveValue(SUPPORT);
  await expect.element(statusSelect(screen)).toHaveValue("supporter");

  await submit(screen).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    runner: samRunner.id,
    event: "event",
    status: "supporter",
  });
});

test("AddSomeoneDialog — un supporteur n'a plus « Vient encourager » ni « Pas encore décidé », mais les épreuves", async () => {
  const supporter = toEventView(withParticipations(eventRecord, [pNinaSupporter]));
  const { screen } = await renderDialog(supporter);
  await loaded(screen);

  await runnerSelect(screen).selectOptions(ninaRunner.id);

  expect(optionsOf(formatSelect(screen).element()).map((option) => option.value)).toEqual([
    "f15",
    "f42",
  ]);
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

  await submit(screen).click();

  expect(mocks.create).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  const select = runnerSelect(screen).element();
  if (!(select instanceof HTMLSelectElement)) throw new Error("not a select");
  expect(select.validity.valueMissing).toBe(true);
});

// --- Failures ---

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

  await submit(screen).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.participation.alreadyThere);
  expect(onClose).not.toHaveBeenCalled();
  // The user can try again with somebody else.
  await expect.element(submit(screen)).toBeEnabled();
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

  await submit(screen).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.forbidden);
});

test("AddSomeoneDialog — si tout le monde est déjà sur toutes les épreuves, il n'y a personne à ajouter", async () => {
  mocks.runners.mockResolvedValue([aliceRunner, bobRunner]);
  const { screen } = await renderDialog(everyoneEverywhere);

  await expect.element(screen.getByText(fr.participation.everyoneThere)).toBeVisible();
  await expect.element(submit(screen)).toBeDisabled();
  await expect.element(runnerSelect(screen)).not.toBeInTheDocument();
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
  await runnerSelect(screen).selectOptions(ninaRunner.id);
  await formatSelect(screen).selectOptions(UNDECIDED);

  for (const element of [
    runnerSelect(screen),
    formatSelect(screen),
    statusSelect(screen),
    submit(screen),
    screen.getByRole("button", { name: fr.common.cancel }),
  ]) {
    expect(element.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
});
