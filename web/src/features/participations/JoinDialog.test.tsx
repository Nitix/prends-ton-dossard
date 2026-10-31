import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ToastProvider } from "../../components/Toast";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { toEventView, type EventView } from "../events/api";
import { aliceRunner, bobRunner, eventRecord, f15, f42, p1, p3 } from "../events/testFixture";
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

const alice: Me = { userId: "u-alice", runnerId: aliceRunner.id, isAdmin: false };
const bob: Me = { userId: "u-bob", runnerId: bobRunner.id, isAdmin: false };
// A member of the group who is not on the event yet.
const newcomer: Me = { userId: "u-new", runnerId: "newRunner00000", isAdmin: false };

let view: EventView;

beforeAll(async () => {
  await ensureTemporal();
  view = toEventView(eventRecord);
});

beforeEach(() => {
  mocks.create.mockReset().mockResolvedValue({ id: "new" });
  mocks.update.mockReset().mockResolvedValue({ id: "p1" });
});

async function renderDialog(me: Me, eventView: EventView = view) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onClose = vi.fn<() => void>();
  const ui = (open: boolean) => (
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={["fr"]}>
        <ToastProvider>
          <JoinDialog open={open} onClose={onClose} view={eventView} me={me} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
  const screen = await render(ui(true));
  await expect
    .element(screen.getByRole("dialog", { name: fr.participation.joinTitle }))
    .toBeVisible();
  return { screen, onClose, invalidate, setOpen: (open: boolean) => screen.rerender(ui(open)) };
}

type Screen = Awaited<ReturnType<typeof renderDialog>>["screen"];

const formatSelect = (screen: Screen) => screen.getByLabelText(fr.participation.format);
const statusSelect = (screen: Screen) => screen.getByLabelText(fr.participation.status);
const save = (screen: Screen) => screen.getByRole("button", { name: fr.common.save });

function optionValues(select: Element): string[] {
  if (!(select instanceof HTMLSelectElement)) throw new Error("not a select");
  return Array.from(select.options).map((option) => option.value);
}

// --- I am not on the event: the dialog creates a participation ---

test("JoinDialog — sans participation, elle en crée une : mon coureur, l'épreuve et le statut choisis", async () => {
  const { screen, onClose } = await renderDialog(newcomer);
  await formatSelect(screen).selectOptions("f42");
  await statusSelect(screen).selectOptions("registered");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    runner: newcomer.runnerId,
    format: "f42",
    status: "registered",
  });
  expect(mocks.update).not.toHaveBeenCalled();
});

test("JoinDialog — sans participation : toutes les épreuves sont proposées, la première est choisie, le statut est « Intéressé »", async () => {
  const { screen } = await renderDialog(newcomer);

  expect(optionValues(formatSelect(screen).element())).toEqual(["f15", "f42"]);
  await expect.element(formatSelect(screen)).toHaveValue("f15");
  await expect.element(statusSelect(screen)).toHaveValue("interested");
  // Nothing to say about an existing participation.
  expect(screen.container.textContent).not.toContain(fr.participation.alreadyIn);
});

test("JoinDialog — rouverte, elle repart des valeurs de départ", async () => {
  const { screen, setOpen } = await renderDialog(newcomer);
  await statusSelect(screen).selectOptions("dns");
  await setOpen(false);
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();

  await setOpen(true);

  await expect.element(statusSelect(screen)).toHaveValue("interested");
});

// --- I am on the event: the dialog changes my participation ---

test("JoinDialog — avec une participation dans l'événement, elle la modifie : épreuve et statut de départ, et un mot pour le dire", async () => {
  const { screen } = await renderDialog(alice);

  // Alice is on F42, as "registered".
  await expect.element(formatSelect(screen)).toHaveValue("f42");
  await expect.element(statusSelect(screen)).toHaveValue("registered");
  await expect.element(screen.getByText(fr.participation.alreadyIn)).toBeVisible();
});

test("JoinDialog — avec une participation, elle met à jour la sienne (épreuve, statut) sans en créer une autre", async () => {
  const { screen, onClose, invalidate } = await renderDialog(alice);
  await formatSelect(screen).selectOptions("f15");
  await statusSelect(screen).selectOptions("finished");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p1", { status: "finished", format: "f15" });
  expect(mocks.create).not.toHaveBeenCalled();
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(keys).toContainEqual(["events"]);
  expect(keys).toContainEqual(["event", "event"]);
  expect(keys).toContainEqual(["pending"]);
});

test("JoinDialog — la participation de Bob, ajoutée par Alice et non confirmée, est confirmée par sa modification", async () => {
  const { screen, onClose } = await renderDialog(bob);
  // Bob is on F42, "interested", added by Alice.
  await expect.element(statusSelect(screen)).toHaveValue("interested");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p2", {
    status: "interested",
    format: "f42",
    confirmed: true,
  });
});

test("JoinDialog — une épreuve où j'ai déjà une autre participation n'est pas proposée", async () => {
  // Alice is on both F15 and F42: moving her F42 participation to F15 would be refused.
  const twice = toEventView({
    ...eventRecord,
    expand: {
      formats_via_event: [
        f42,
        {
          ...f15,
          expand: {
            ...f15.expand,
            participations_via_format: [p3, { ...p1, id: "p1b", format: "f15", expand: p1.expand }],
          },
        },
      ],
    },
  });

  const { screen } = await renderDialog(alice, twice);

  // The first participation found is the one that is edited: Alice's on F15
  // (the formats are in the order of their days).
  expect(optionValues(formatSelect(screen).element())).toEqual(["f15"]);
});

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
  const { screen, onClose } = await renderDialog(newcomer);

  await save(screen).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.participation.alreadyThere);
  expect(onClose).not.toHaveBeenCalled();
  await expect.element(save(screen)).toBeEnabled();
});

test("JoinDialog — l'échec d'une modification est traduit d'après son code", async () => {
  mocks.update.mockRejectedValue(
    new ClientResponseError({
      status: 400,
      response: { status: 400, message: "…", data: { code: "format_other_event" } },
    }),
  );
  const { screen, onClose } = await renderDialog(alice);

  await save(screen).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.format_other_event);
  expect(onClose).not.toHaveBeenCalled();
});

test("JoinDialog — une erreur réseau donne le message générique", async () => {
  mocks.create.mockRejectedValue(new TypeError("Failed to fetch"));
  const { screen } = await renderDialog(newcomer);

  await save(screen).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
});

test("JoinDialog — Annuler ferme sans rien envoyer", async () => {
  const { screen, onClose } = await renderDialog(newcomer);

  await screen.getByRole("button", { name: fr.common.cancel }).click();

  expect(onClose).toHaveBeenCalledOnce();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});
