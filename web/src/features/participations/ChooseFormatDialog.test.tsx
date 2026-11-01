import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ToastProvider } from "../../components/Toast";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { toEventView, type EventView } from "../events/api";
import { eventRecord, f15, pNinaUndecided, withParticipations } from "../events/testFixture";
import { ChooseFormatDialog } from "./ChooseFormatDialog";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  update: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: { collection: (name: string) => ({ participations: { update: mocks.update } })[name] },
}));

// Nina is interested in the event, with no format yet; Alice and Bob are on F42, Sam on F15.
let view: EventView;

beforeAll(async () => {
  await ensureTemporal();
  view = toEventView(withParticipations(eventRecord, [pNinaUndecided]));
});

beforeEach(() => {
  mocks.update.mockReset().mockResolvedValue({ id: "pNinaUndecided" });
});

async function renderDialog(options: { withOnChosen?: boolean } = {}) {
  const { withOnChosen = false } = options;
  const participationView = view.interested[0];
  if (!participationView) throw new Error("the fixture has no participation on the event alone");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onClose = vi.fn<() => void>();
  const onChosen = vi.fn<() => void>();
  const ui = (eventView: EventView) => (
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={["fr"]}>
        <ToastProvider>
          <ChooseFormatDialog
            open
            onClose={onClose}
            onChosen={withOnChosen ? onChosen : undefined}
            view={eventView}
            participationView={participationView}
          />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
  const screen = await render(ui(view));
  await expect
    .element(screen.getByRole("dialog", { name: fr.participation.chooseFormatTitle }))
    .toBeVisible();
  return {
    screen,
    onClose,
    onChosen,
    invalidate,
    // The page loads a change while the dialog is open.
    showView: (eventView: EventView) => screen.rerender(ui(eventView)),
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

test('ChooseFormatDialog — propose F15 et F42 ; Enregistrer envoie updateParticipation(id, {format: "f42", status: "registered"}), ferme et invalide les listes', async () => {
  const { screen, onClose, invalidate } = await renderDialog();

  // The formats of the event, in the order of their days, and no « Pas encore décidé »:
  // the participation is on the event alone already.
  expect(optionsOf(formatSelect(screen).element()).map((option) => option.value)).toEqual([
    "f15",
    "f42",
  ]);
  await expect.element(formatSelect(screen)).toHaveValue("f15");
  await expect.element(statusSelect(screen)).toHaveValue("interested");

  await formatSelect(screen).selectOptions("f42");
  await statusSelect(screen).selectOptions("registered");
  await save(screen).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith("pNinaUndecided", {
    format: "f42",
    status: "registered",
  });
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(keys).toContainEqual(["events"]);
  expect(keys).toContainEqual(["event", "event"]);
  expect(keys).toContainEqual(["pending"]);
});

test("ChooseFormatDialog — si la page recharge l'événement et que l'épreuve choisie n'y est plus, la première est proposée", async () => {
  const { screen, showView } = await renderDialog();
  await formatSelect(screen).selectOptions("f42");
  await expect.element(formatSelect(screen)).toHaveValue("f42");

  // F42 has been deleted meanwhile: only F15 is left on the event.
  await showView(
    toEventView({
      ...eventRecord,
      expand: { formats_via_event: [f15], participations_via_event: [pNinaUndecided] },
    }),
  );

  expect(optionsOf(formatSelect(screen).element()).map((option) => option.value)).toEqual(["f15"]);
  await expect.element(formatSelect(screen)).toHaveValue("f15");
  // What is sent is what the select shows (a select shows its first option when its
  // value has no option: the state itself has to follow).
  await save(screen).click();
  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("pNinaUndecided", {
      format: "f15",
      status: "interested",
    });
  });
});

test("ChooseFormatDialog — avec onChosen, un enregistrement réussi le dit à sa place : onClose n'est pas appelé", async () => {
  const { screen, onClose, onChosen } = await renderDialog({ withOnChosen: true });
  await formatSelect(screen).selectOptions("f42");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(onChosen).toHaveBeenCalledOnce();
  });
  expect(onClose).not.toHaveBeenCalled();
});

test("ChooseFormatDialog — avec onChosen, Annuler appelle encore onClose", async () => {
  const { screen, onClose, onChosen } = await renderDialog({ withOnChosen: true });

  await screen.getByRole("button", { name: fr.common.cancel }).click();

  expect(onClose).toHaveBeenCalledOnce();
  expect(onChosen).not.toHaveBeenCalled();
});

test("ChooseFormatDialog — dit pour qui l'épreuve se choisit, et ne propose pas « Pas encore décidé »", async () => {
  const { screen } = await renderDialog();

  await expect.element(screen.getByText("Nina", { exact: true })).toBeVisible();
  expect(screen.container.textContent).not.toContain(fr.participation.undecided);
});

test("ChooseFormatDialog — un doublon refusé (validation_not_unique) le dit en clair, la fenêtre reste ouverte", async () => {
  mocks.update.mockRejectedValue(
    new ClientResponseError({
      status: 400,
      response: {
        status: 400,
        message: "…",
        data: { format: { code: "validation_not_unique", message: "Value must be unique." } },
      },
    }),
  );
  const { screen, onClose } = await renderDialog();

  await save(screen).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.participation.alreadyThere);
  expect(onClose).not.toHaveBeenCalled();
  await expect.element(save(screen)).toBeEnabled();
});

test("ChooseFormatDialog — un autre refus est traduit d'après son code", async () => {
  mocks.update.mockRejectedValue(
    new ClientResponseError({
      status: 400,
      response: { status: 400, message: "…", data: { code: "format_other_event" } },
    }),
  );
  const { screen, onClose } = await renderDialog();

  await save(screen).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.format_other_event);
  expect(onClose).not.toHaveBeenCalled();
});

test("ChooseFormatDialog — Annuler ferme sans rien envoyer", async () => {
  const { screen, onClose } = await renderDialog();

  await screen.getByRole("button", { name: fr.common.cancel }).click();

  expect(onClose).toHaveBeenCalledOnce();
  expect(mocks.update).not.toHaveBeenCalled();
});

test("ChooseFormatDialog — champs et boutons d'au moins 44 px", async () => {
  const { screen } = await renderDialog();

  for (const element of [
    formatSelect(screen),
    statusSelect(screen),
    save(screen),
    screen.getByRole("button", { name: fr.common.cancel }),
  ]) {
    expect(element.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
});
