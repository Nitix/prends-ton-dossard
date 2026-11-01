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
  event2Record,
  eventRecord,
  ninaRunner,
  pNinaSupporter,
  withParticipations,
} from "../events/testFixture";
import { JoinDialog } from "./JoinDialog";
import type { Me } from "./permissions";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  create: vi.fn<(body: Rec) => Promise<unknown>>(),
  update: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    collection: (name: string) =>
      ({ participations: { create: mocks.create, update: mocks.update } })[name],
  },
}));

// Alice is on F42 (and Bob too, Sam is on F15); Nina is on none of the formats.
const alice: Me = { userId: "u-alice", runnerId: aliceRunner.id, isAdmin: false };
const nina: Me = { userId: "u-nina", runnerId: ninaRunner.id, isAdmin: false };

let view: EventView;
let lyon: EventView;

beforeAll(async () => {
  await ensureTemporal();
  view = toEventView(eventRecord);
  // A single format: nothing to decide.
  lyon = toEventView(event2Record);
});

beforeEach(() => {
  mocks.create.mockReset().mockResolvedValue({ id: "new" });
  mocks.update.mockReset().mockResolvedValue({ id: "p1" });
});

async function renderDialog(me: Me, eventView: EventView = view) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onClose = vi.fn<() => void>();
  const onJoined = vi.fn<(created: unknown) => void>();
  const ui = (open: boolean) => (
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={["fr"]}>
        <ToastProvider>
          <JoinDialog open={open} onClose={onClose} onJoined={onJoined} view={eventView} me={me} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
  const screen = await render(ui(true));
  await expect
    .element(screen.getByRole("dialog", { name: fr.participation.joinTitle }))
    .toBeVisible();
  return {
    screen,
    onClose,
    onJoined,
    invalidate,
    setOpen: (open: boolean) => screen.rerender(ui(open)),
  };
}

type Screen = Awaited<ReturnType<typeof renderDialog>>["screen"];

const formatSelect = (screen: Screen) => screen.getByLabelText(fr.participation.format);
const statusSelect = (screen: Screen) => screen.getByLabelText(fr.participation.status);
const save = (screen: Screen) => screen.getByRole("button", { name: fr.common.save });

function optionsOf(select: Element): HTMLOptionElement[] {
  if (!(select instanceof HTMLSelectElement)) throw new Error("not a select");
  return Array.from(select.options);
}

function optionValues(select: Element): string[] {
  return optionsOf(select).map((option) => option.value);
}

// --- What the dialog offers ---

test("JoinDialog — Alice (sur F42) : seule F15 est proposée, sans « Pas encore décidé »", async () => {
  const { screen } = await renderDialog(alice);

  expect(optionValues(formatSelect(screen).element())).toEqual(["f15"]);
  await expect.element(formatSelect(screen)).toHaveValue("f15");
  expect(screen.container.textContent).not.toContain(fr.participation.undecided);
  expect(screen.container.textContent).not.toContain(fr.participation.support);
});

test("JoinDialog — Nina (sur aucune épreuve) : F15, F42 et « Pas encore décidé », la première épreuve est choisie, le statut est « Intéressé »", async () => {
  const { screen } = await renderDialog(nina);

  const select = formatSelect(screen).element();
  expect(optionValues(select)).toEqual(["f15", "f42", UNDECIDED, SUPPORT]);
  // « Pas encore décidé » and « Je viens encourager » come last, and are said in words.
  expect(
    optionsOf(select)
      .map((option) => option.textContent)
      .slice(-2),
  ).toEqual([fr.participation.undecided, fr.participation.support]);
  await expect.element(formatSelect(screen)).toHaveValue("f15");
  await expect.element(statusSelect(screen)).toHaveValue("interested");
  await expect.element(statusSelect(screen)).toBeEnabled();
  expect(screen.container.textContent).not.toContain(fr.participation.undecidedHint);
});

test("JoinDialog — sur un événement à une seule épreuve, pas de « Pas encore décidé » mais « Je viens encourager »", async () => {
  const { screen } = await renderDialog(nina, lyon);

  expect(optionValues(formatSelect(screen).element())).toEqual(["fLyon", SUPPORT]);
  expect(screen.container.textContent).not.toContain(fr.participation.undecided);
});

// --- It creates, it never changes ---

test('JoinDialog — choisir F42 crée {runner, event, format: "f42", status} et ne modifie rien', async () => {
  const { screen, onClose, invalidate } = await renderDialog(nina);
  await formatSelect(screen).selectOptions("f42");
  await statusSelect(screen).selectOptions("registered");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    runner: nina.runnerId,
    event: "event",
    format: "f42",
    status: "registered",
  });
  expect(mocks.update).not.toHaveBeenCalled();
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(keys).toContainEqual(["events"]);
  expect(keys).toContainEqual(["event", "event"]);
  expect(keys).toContainEqual(["pending"]);
});

test("JoinDialog — dit à la page la participation créée, avant de se fermer, pour qu'elle y place le focus", async () => {
  mocks.create.mockResolvedValue({ id: "pNew", format: "f42" });
  const { screen, onClose, onJoined } = await renderDialog(nina);
  await formatSelect(screen).selectOptions("f42");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(onJoined).toHaveBeenCalledExactlyOnceWith({ id: "pNew", format: "f42" });
  expect(onJoined.mock.invocationCallOrder[0]).toBeLessThan(
    onClose.mock.invocationCallOrder[0] ?? 0,
  );
});

test("JoinDialog — un refus ne dit rien à la page", async () => {
  mocks.create.mockRejectedValue(new TypeError("Failed to fetch"));
  const { screen, onJoined } = await renderDialog(nina);

  await save(screen).click();

  await expect.element(screen.getByRole("alert")).toBeVisible();
  expect(onJoined).not.toHaveBeenCalled();
});

test("JoinDialog — Alice crée sa participation à F15 : celle de F42 n'est pas touchée", async () => {
  const { screen, onClose } = await renderDialog(alice);
  await statusSelect(screen).selectOptions("finished");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    runner: alice.runnerId,
    event: "event",
    format: "f15",
    status: "finished",
  });
  expect(mocks.update).not.toHaveBeenCalled();
});

test('JoinDialog — « Pas encore décidé » verrouille le statut sur « Intéressé » et crée {runner, event, status: "interested"} sans format', async () => {
  const { screen, onClose } = await renderDialog(nina);
  // The status was chosen before: the lock puts it back to « Intéressé ».
  await statusSelect(screen).selectOptions("registered");

  await formatSelect(screen).selectOptions(UNDECIDED);

  await expect.element(statusSelect(screen)).toBeDisabled();
  await expect.element(statusSelect(screen)).toHaveValue("interested");
  await expect.element(screen.getByText(fr.participation.undecidedHint)).toBeVisible();

  await save(screen).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    runner: nina.runnerId,
    event: "event",
    status: "interested",
  });
  // The key is absent, not `undefined`.
  const [body] = mocks.create.mock.calls[0] ?? [];
  expect(body).toBeDefined();
  expect("format" in (body ?? {})).toBe(false);
  expect(mocks.update).not.toHaveBeenCalled();
});

test("JoinDialog — l'indication du statut verrouillé décrit le champ du statut", async () => {
  const { screen } = await renderDialog(nina);

  await formatSelect(screen).selectOptions(UNDECIDED);

  const hint = screen.getByText(fr.participation.undecidedHint).element();
  expect(statusSelect(screen).element().getAttribute("aria-describedby")).toBe(hint.id);
});

test("JoinDialog — reprendre une épreuve rend le choix du statut", async () => {
  const { screen } = await renderDialog(nina);
  await formatSelect(screen).selectOptions(UNDECIDED);
  await expect.element(statusSelect(screen)).toBeDisabled();

  await formatSelect(screen).selectOptions("f42");

  await expect.element(statusSelect(screen)).toBeEnabled();
  expect(screen.container.textContent).not.toContain(fr.participation.undecidedHint);
});

test("JoinDialog — rouverte, elle repart des valeurs de départ", async () => {
  const { screen, setOpen } = await renderDialog(nina);
  await statusSelect(screen).selectOptions("dns");
  await setOpen(false);
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();

  await setOpen(true);

  await expect.element(statusSelect(screen)).toHaveValue("interested");
  await expect.element(formatSelect(screen)).toHaveValue("f15");
});

// --- Supporter: « Je viens encourager » ---

test("JoinDialog — « Je viens encourager » crée une participation supporter sans format, statut verrouillé avec sa phrase", async () => {
  const { screen, onClose, onJoined } = await renderDialog(nina, lyon);
  // The status was chosen before: the lock puts it on « Supporteur ».
  await statusSelect(screen).selectOptions("registered");

  await formatSelect(screen).selectOptions(SUPPORT);

  await expect.element(statusSelect(screen)).toBeDisabled();
  await expect.element(statusSelect(screen)).toHaveValue("supporter");
  await expect.element(screen.getByText(fr.participation.supportHint)).toBeVisible();
  // It is not the sentence of « Pas encore décidé ».
  expect(screen.container.textContent).not.toContain(fr.participation.undecidedHint);
  const hint = screen.getByText(fr.participation.supportHint).element();
  expect(statusSelect(screen).element().getAttribute("aria-describedby")).toBe(hint.id);

  await save(screen).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    runner: nina.runnerId,
    event: "event2",
    status: "supporter",
  });
  // The key is absent, not `undefined`.
  const [body] = mocks.create.mock.calls[0] ?? [];
  expect("format" in (body ?? {})).toBe(false);
  expect(mocks.update).not.toHaveBeenCalled();
  expect(onJoined).toHaveBeenCalledOnce();
});

test("JoinDialog — passer de « Je viens encourager » à une épreuve rend le choix du statut", async () => {
  const { screen } = await renderDialog(nina, lyon);
  await formatSelect(screen).selectOptions(SUPPORT);
  await expect.element(statusSelect(screen)).toBeDisabled();

  await formatSelect(screen).selectOptions("fLyon");

  await expect.element(statusSelect(screen)).toBeEnabled();
  await expect.element(statusSelect(screen)).toHaveValue("interested");
  expect(screen.container.textContent).not.toContain(fr.participation.supportHint);
});

test("JoinDialog — de « Pas encore décidé » à « Je viens encourager », la phrase et le statut suivent", async () => {
  const { screen } = await renderDialog(nina);
  await formatSelect(screen).selectOptions(UNDECIDED);
  await expect.element(screen.getByText(fr.participation.undecidedHint)).toBeVisible();

  await formatSelect(screen).selectOptions(SUPPORT);

  await expect.element(statusSelect(screen)).toHaveValue("supporter");
  await expect.element(screen.getByText(fr.participation.supportHint)).toBeVisible();
  expect(screen.container.textContent).not.toContain(fr.participation.undecidedHint);
});

test("JoinDialog — un supporteur n'a plus « Je viens encourager » ni « Pas encore décidé », mais les épreuves", async () => {
  const supporter = toEventView(withParticipations(eventRecord, [pNinaSupporter]));
  const { screen } = await renderDialog(nina, supporter);

  expect(optionValues(formatSelect(screen).element())).toEqual(["f15", "f42"]);
});

// --- Failures ---

test("JoinDialog — le serveur refuse un doublon : message clair, la fenêtre reste ouverte", async () => {
  mocks.create.mockRejectedValue(
    new ClientResponseError({
      status: 400,
      response: {
        status: 400,
        message: "…",
        data: { format: { code: "validation_not_unique", message: "Value must be unique." } },
      },
    }),
  );
  const { screen, onClose } = await renderDialog(nina);

  await save(screen).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.participation.alreadyThere);
  expect(onClose).not.toHaveBeenCalled();
  await expect.element(save(screen)).toBeEnabled();
});

test("JoinDialog — un autre refus est traduit d'après son code", async () => {
  mocks.create.mockRejectedValue(
    new ClientResponseError({
      status: 400,
      response: { status: 400, message: "…", data: { code: "format_other_event" } },
    }),
  );
  const { screen, onClose } = await renderDialog(nina);

  await save(screen).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.format_other_event);
  expect(onClose).not.toHaveBeenCalled();
});

test("JoinDialog — une erreur réseau donne le message générique", async () => {
  mocks.create.mockRejectedValue(new TypeError("Failed to fetch"));
  const { screen } = await renderDialog(nina);

  await save(screen).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
});

test("JoinDialog — Annuler ferme sans rien envoyer", async () => {
  const { screen, onClose } = await renderDialog(nina);

  await screen.getByRole("button", { name: fr.common.cancel }).click();

  expect(onClose).toHaveBeenCalledOnce();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});

test("JoinDialog — les champs et les boutons font au moins 44 px", async () => {
  const { screen } = await renderDialog(nina);
  await formatSelect(screen).selectOptions(UNDECIDED);

  for (const element of [
    formatSelect(screen),
    statusSelect(screen),
    save(screen),
    screen.getByRole("button", { name: fr.common.cancel }),
  ]) {
    expect(element.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
});
