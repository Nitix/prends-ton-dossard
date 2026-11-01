import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { ToastProvider } from "../../components/Toast";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import type { ParticipationRecord, RunnerRecord } from "../../lib/types";
import { toEventView, type EventView } from "../events/api";
import {
  aliceRunner,
  bobRunner,
  eventRecord,
  ninaRunner,
  p1,
  p2,
  pNinaUndecided,
  withParticipations,
} from "../events/testFixture";
import { ParticipationMenu } from "./ParticipationMenu";

// The tap targets and the place of the menu are a matter of the styles, which
// are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  update: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
  remove: vi.fn<(id: string) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    collection: (name: string) =>
      ({ participations: { update: mocks.update, delete: mocks.remove } })[name],
  },
}));

// Bob's, added by Alice and not confirmed; Alice's own, confirmed.
const bobParticipation: ParticipationRecord = { ...p2, status: "interested" };
const aliceParticipation: ParticipationRecord = { ...p1, status: "registered" };

// Nina is interested in the event, with no format yet.
const ninaParticipation: ParticipationRecord = {
  ...pNinaUndecided,
  status: "interested",
  confirmed: false,
};
// The same, confirmed: it is her own.
const ninaConfirmed: ParticipationRecord = { ...pNinaUndecided, status: "interested" };

let trail: EventView;

beforeAll(async () => {
  await ensureTemporal();
  trail = toEventView(withParticipations(eventRecord, [pNinaUndecided]));
});

beforeEach(() => {
  mocks.update.mockReset().mockResolvedValue({});
  mocks.remove.mockReset().mockResolvedValue(true);
});

async function renderMenu(
  options: {
    participation?: ParticipationRecord;
    runner?: RunnerRecord;
    canConfirm?: boolean;
    /** Given for a participation on the event alone: the formats to choose from. */
    formatsOf?: EventView;
    /** What the participation is on: its format, or the event when it has none. */
    label?: string;
  } = {},
) {
  const {
    participation = bobParticipation,
    runner = bobRunner,
    canConfirm = false,
    formatsOf,
    label = "Trail 42 km",
  } = options;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onRemoved = vi.fn<() => void>();
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={["fr"]}>
        <ToastProvider>
          {/* On the right, where the menu of a row is. */}
          <div className="flex justify-end p-4">
            <ParticipationMenu
              eventId="event"
              participation={participation}
              runner={runner}
              label={label}
              formatsOf={formatsOf}
              canConfirm={canConfirm}
              onRemoved={onRemoved}
            />
          </div>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { screen, invalidate, onRemoved };
}

type Screen = Awaited<ReturnType<typeof renderMenu>>["screen"];

const trigger = (screen: Screen, name = "Bob") =>
  screen.getByRole("button", { name: fr.participation.actionsFor(name) });

/** The element a button opens, by its `popovertarget`. */
function popoverOf(button: Element): HTMLElement {
  const id = button.getAttribute("popovertarget");
  const target = id === null ? null : document.getElementById(id);
  if (!target) throw new Error("the button does not point to an element");
  return target;
}

async function open(screen: Screen) {
  await trigger(screen).click();
  await expect.element(screen.getByRole("button", { name: fr.status.finished })).toBeVisible();
}

test("ParticipationMenu — le bouton ouvre un menu natif (popover) et le referme", async () => {
  const { screen } = await renderMenu();
  const button = trigger(screen).element();
  const popover = popoverOf(button);

  expect(popover.hasAttribute("popover")).toBe(true);
  expect(popover.matches(":popover-open")).toBe(false);
  // Closed, its actions are not on the page.
  await expect
    .element(screen.getByRole("button", { name: fr.status.finished }))
    .not.toBeInTheDocument();

  await trigger(screen).click();
  expect(popover.matches(":popover-open")).toBe(true);
  await expect.element(screen.getByRole("button", { name: fr.status.finished })).toBeVisible();

  await trigger(screen).click();
  expect(popover.matches(":popover-open")).toBe(false);
});

test("ParticipationMenu — Échap referme le menu", async () => {
  const { screen } = await renderMenu();
  await open(screen);
  const popover = popoverOf(trigger(screen).element());

  expect(popover.matches(":popover-open")).toBe(true);

  await userEvent.keyboard("{Escape}");

  await vi.waitFor(() => {
    expect(popover.matches(":popover-open")).toBe(false);
  });
});

test("ParticipationMenu — le bouton fait au moins 44 px, et son nom dit pour qui il est", async () => {
  const { screen } = await renderMenu();

  const rect = trigger(screen).element().getBoundingClientRect();
  expect(rect.width).toBeGreaterThanOrEqual(44);
  expect(rect.height).toBeGreaterThanOrEqual(44);
});

test("ParticipationMenu — le menu s'ouvre à côté de son bouton, dans l'écran", async () => {
  const { screen } = await renderMenu();
  await open(screen);

  const button = trigger(screen).element().getBoundingClientRect();
  const menu = popoverOf(trigger(screen).element()).getBoundingClientRect();
  const below = Math.abs(menu.top - button.bottom) < 8;
  const above = Math.abs(menu.bottom - button.top) < 8;
  expect(below || above).toBe(true);
  expect(menu.left).toBeGreaterThanOrEqual(0);
  expect(menu.right).toBeLessThanOrEqual(window.innerWidth);
});

test("ParticipationMenu — propose les cinq statuts, marque celui d'aujourd'hui, et des boutons de 44 px", async () => {
  const { screen } = await renderMenu();
  await open(screen);

  for (const status of ["interested", "registered", "finished", "dnf", "dns"] as const) {
    const item = screen.getByRole("button", { name: fr.status[status] });
    await expect.element(item).toBeVisible();
    expect(item.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
  // Bob is "interested".
  await expect
    .element(screen.getByRole("button", { name: fr.status.interested }))
    .toHaveAttribute("aria-current", "true");
  await expect
    .element(screen.getByRole("button", { name: fr.status.finished }))
    .not.toHaveAttribute("aria-current", "true");
});

test("ParticipationMenu — changer le statut met la participation à jour, ferme le menu et invalide les listes", async () => {
  const { screen, invalidate } = await renderMenu();
  await open(screen);
  const popover = popoverOf(trigger(screen).element());

  await screen.getByRole("button", { name: fr.status.finished }).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p2", { status: "finished" });
  });
  expect(popover.matches(":popover-open")).toBe(false);
  await vi.waitFor(() => {
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(["events"]);
    expect(keys).toContainEqual(["event", "event"]);
    expect(keys).toContainEqual(["pending"]);
  });
});

test("ParticipationMenu — Confirmer n'est proposé qu'au coureur concerné, pour une participation non confirmée", async () => {
  // Bob's unconfirmed participation, by Bob.
  const { screen } = await renderMenu({ canConfirm: true });
  await open(screen);

  await screen.getByRole("button", { name: fr.common.confirm }).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p2", { confirmed: true });
  });
});

test("ParticipationMenu — pas de Confirmer pour quelqu'un d'autre, ni pour une participation déjà confirmée", async () => {
  const other = await renderMenu({ canConfirm: false });
  await open(other.screen);
  await expect
    .element(other.screen.getByRole("button", { name: fr.common.confirm }))
    .not.toBeInTheDocument();
  await other.screen.unmount();

  // Alice's own participation is confirmed already.
  const confirmed = await renderMenu({
    participation: aliceParticipation,
    runner: aliceRunner,
    canConfirm: true,
  });
  await confirmed.screen
    .getByRole("button", { name: fr.participation.actionsFor("Alice") })
    .click();
  await expect
    .element(confirmed.screen.getByRole("button", { name: fr.status.finished }))
    .toBeVisible();
  await expect
    .element(confirmed.screen.getByRole("button", { name: fr.common.confirm }))
    .not.toBeInTheDocument();
});

// --- A participation on the event alone ---

const ninaMenu = (screen: Screen) => trigger(screen, "Nina");
const chooseFormat = (screen: Screen) =>
  screen.getByRole("button", { name: fr.participation.chooseFormat });

async function renderOnEventAlone(options: { canConfirm?: boolean; confirmed?: boolean } = {}) {
  const { canConfirm = true, confirmed = false } = options;
  return renderMenu({
    participation: confirmed ? ninaConfirmed : ninaParticipation,
    runner: ninaRunner,
    formatsOf: trail,
    // No format: the participation is on the event.
    label: "Trail des Crêtes",
    canConfirm,
  });
}

test("ParticipationMenu — sans épreuve : pas de statuts, mais « Choisir l'épreuve », Confirmer s'il y a lieu, et Retirer", async () => {
  const { screen } = await renderOnEventAlone();
  await ninaMenu(screen).click();
  await expect.element(chooseFormat(screen)).toBeVisible();

  // Only « Intéressé » is possible with no format: no status to choose from.
  for (const status of ["interested", "registered", "finished", "dnf", "dns"] as const) {
    await expect
      .element(screen.getByRole("button", { name: fr.status[status] }))
      .not.toBeInTheDocument();
  }
  await expect
    .element(screen.getByRole("list", { name: fr.participation.status }))
    .not.toBeInTheDocument();
  // Nina's own participation is not confirmed yet, and she may confirm it.
  const confirm = screen.getByRole("button", { name: fr.common.confirm });
  await expect.element(confirm).toBeVisible();
  const remove = screen.getByRole("button", { name: fr.common.remove });
  await expect.element(remove).toBeVisible();
  for (const item of [chooseFormat(screen), confirm, remove]) {
    expect(item.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
});

test("ParticipationMenu — sans épreuve, pas de Confirmer pour quelqu'un d'autre, ni pour une participation déjà confirmée", async () => {
  const other = await renderOnEventAlone({ canConfirm: false });
  await ninaMenu(other.screen).click();
  await expect.element(chooseFormat(other.screen)).toBeVisible();
  await expect
    .element(other.screen.getByRole("button", { name: fr.common.confirm }))
    .not.toBeInTheDocument();
  await other.screen.unmount();

  const confirmed = await renderOnEventAlone({ confirmed: true });
  await ninaMenu(confirmed.screen).click();
  await expect.element(chooseFormat(confirmed.screen)).toBeVisible();
  await expect
    .element(confirmed.screen.getByRole("button", { name: fr.common.confirm }))
    .not.toBeInTheDocument();
});

test("ParticipationMenu — sans épreuve, Retirer demande confirmation avec le nom de l'événement", async () => {
  const { screen } = await renderOnEventAlone();
  await ninaMenu(screen).click();

  await screen.getByRole("button", { name: fr.common.remove }).click();

  await expect
    .element(screen.getByRole("dialog", { name: fr.participation.removeTitle }))
    .toBeVisible();
  await expect
    .element(screen.getByText(fr.participation.removeWarning("Nina", "Trail des Crêtes")))
    .toBeVisible();
});

test("ParticipationMenu — « Choisir l'épreuve » ouvre le dialogue des épreuves de l'événement", async () => {
  const { screen } = await renderOnEventAlone();
  await ninaMenu(screen).click();

  await chooseFormat(screen).click();

  const dialog = screen.getByRole("dialog", { name: fr.participation.chooseFormatTitle });
  await expect.element(dialog).toBeVisible();
  const select = dialog.getByLabelText(fr.participation.format).element();
  if (!(select instanceof HTMLSelectElement)) throw new Error("not a select");
  expect(Array.from(select.options).map((option) => option.value)).toEqual(["f15", "f42"]);
  // The menu is closed: the dialog does not leave it open behind.
  expect(popoverOf(ninaMenu(screen).element()).matches(":popover-open")).toBe(false);
});

test("ParticipationMenu — choisir l'épreuve met la participation à jour, et le dit à la page (la ligne change de section)", async () => {
  const { screen, onRemoved } = await renderOnEventAlone();
  await ninaMenu(screen).click();
  await chooseFormat(screen).click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.chooseFormatTitle });
  await dialog.getByLabelText(fr.participation.format).selectOptions("f42");
  expect(onRemoved).not.toHaveBeenCalled();

  await dialog.getByRole("button", { name: fr.common.save }).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("pNinaUndecided", {
      format: "f42",
      status: "interested",
    });
  });
  await vi.waitFor(() => {
    expect(onRemoved).toHaveBeenCalledOnce();
  });
  await expect.element(dialog).not.toBeInTheDocument();
  // The row is about to move: the focus is the page's to place, the menu does not take it.
  expect(document.activeElement).not.toBe(ninaMenu(screen).element());
});

test("ParticipationMenu — Annuler dans le dialogue des épreuves rend le focus au bouton du menu", async () => {
  const { screen, onRemoved } = await renderOnEventAlone();
  await ninaMenu(screen).click();
  await chooseFormat(screen).click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.chooseFormatTitle });
  await expect.element(dialog).toBeVisible();

  await dialog.getByRole("button", { name: fr.common.cancel }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(ninaMenu(screen).element());
  });
  expect(mocks.update).not.toHaveBeenCalled();
  expect(onRemoved).not.toHaveBeenCalled();
});

// A "not starting" participation is not in the list of its format but in the one
// of those who do not start: a status change across that line moves its row.

test("ParticipationMenu — passer à « Non partant » ou en revenir déplace la ligne : la page en est prévenue", async () => {
  const toDns = await renderMenu();
  await open(toDns.screen);
  await toDns.screen.getByRole("button", { name: fr.status.dns }).click();
  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p2", { status: "dns" });
  });
  await vi.waitFor(() => {
    expect(toDns.onRemoved).toHaveBeenCalledOnce();
  });
  await toDns.screen.unmount();

  mocks.update.mockClear();
  const fromDns = await renderMenu({ participation: { ...bobParticipation, status: "dns" } });
  await open(fromDns.screen);
  await fromDns.screen.getByRole("button", { name: fr.status.registered }).click();
  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p2", { status: "registered" });
  });
  await vi.waitFor(() => {
    expect(fromDns.onRemoved).toHaveBeenCalledOnce();
  });
});

test("ParticipationMenu — un changement de statut qui laisse la ligne où elle est ne prévient pas la page", async () => {
  const { screen, onRemoved } = await renderMenu();
  await open(screen);

  await screen.getByRole("button", { name: fr.status.finished }).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledOnce();
  });
  expect(onRemoved).not.toHaveBeenCalled();
});

test("ParticipationMenu — Retirer demande confirmation, et Annuler ne retire rien", async () => {
  const { screen } = await renderMenu();
  await open(screen);

  await screen.getByRole("button", { name: fr.common.remove }).click();

  const dialog = screen.getByRole("dialog", { name: fr.participation.removeTitle });
  await expect.element(dialog).toBeVisible();
  await expect
    .element(dialog.getByText(fr.participation.removeWarning("Bob", "Trail 42 km")))
    .toBeVisible();
  expect(mocks.remove).not.toHaveBeenCalled();

  await dialog.getByRole("button", { name: fr.common.cancel }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  expect(mocks.remove).not.toHaveBeenCalled();
});

test("ParticipationMenu — confirmer le retrait supprime la participation et invalide les listes", async () => {
  const { screen, invalidate } = await renderMenu();
  await open(screen);
  await screen.getByRole("button", { name: fr.common.remove }).click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.removeTitle });

  await dialog.getByRole("button", { name: fr.common.remove }).click();

  await vi.waitFor(() => {
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("p2");
  });
  await expect.element(dialog).not.toBeInTheDocument();
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(keys).toContainEqual(["events"]);
  expect(keys).toContainEqual(["event", "event"]);
  expect(keys).toContainEqual(["pending"]);
});

test("ParticipationMenu — un retrait refusé le dit dans la fenêtre, qui reste ouverte", async () => {
  mocks.remove.mockRejectedValue(
    new ClientResponseError({
      status: 403,
      response: { status: 403, message: "…", data: { code: "forbidden" } },
    }),
  );
  const { screen } = await renderMenu();
  await open(screen);
  await screen.getByRole("button", { name: fr.common.remove }).click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.removeTitle });

  await dialog.getByRole("button", { name: fr.common.remove }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.forbidden);
  await expect.element(dialog).toBeVisible();
});

test("ParticipationMenu — un changement de statut refusé s'affiche en message", async () => {
  mocks.update.mockRejectedValue(
    new ClientResponseError({
      status: 403,
      response: { status: 403, message: "…", data: { code: "forbidden" } },
    }),
  );
  const { screen } = await renderMenu();
  await open(screen);

  await screen.getByRole("button", { name: fr.status.dnf }).click();

  await expect.element(screen.getByText(fr.errors.forbidden)).toBeVisible();
});

test("ParticipationMenu — un changement de statut sur une participation introuvable (404) le dit, rafraîchit les listes et prévient la page", async () => {
  mocks.update.mockRejectedValue(
    new ClientResponseError({
      status: 404,
      response: { status: 404, message: "The requested resource wasn't found.", data: {} },
    }),
  );
  const { screen, invalidate, onRemoved } = await renderMenu();
  await open(screen);

  await screen.getByRole("button", { name: fr.status.dnf }).click();

  await expect.element(screen.getByText(fr.errors.not_found)).toBeVisible();
  // The row is gone: what the page shows is asked for again, and the page places the focus.
  await vi.waitFor(() => {
    expect(onRemoved).toHaveBeenCalledOnce();
  });
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(keys).toContainEqual(["events"]);
  expect(keys).toContainEqual(["event", "event"]);
  expect(keys).toContainEqual(["pending"]);
});

// --- Where the focus goes ---
//
// The removal dialog is opened from an item of the popover, which closes at the
// same time: the dialog must not give the focus back to that hidden item.

const focused = () => document.activeElement;

async function openRemovalDialog(screen: Screen) {
  await open(screen);
  await screen.getByRole("button", { name: fr.common.remove }).click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.removeTitle });
  await expect.element(dialog).toBeVisible();
  return dialog;
}

test("ParticipationMenu — Annuler dans la fenêtre de retrait rend le focus au bouton du menu", async () => {
  const { screen } = await renderMenu();
  const dialog = await openRemovalDialog(screen);

  await dialog.getByRole("button", { name: fr.common.cancel }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  await vi.waitFor(() => {
    expect(focused()).toBe(trigger(screen).element());
  });
});

test("ParticipationMenu — Échap dans la fenêtre de retrait rend le focus au bouton du menu", async () => {
  const { screen } = await renderMenu();
  const dialog = await openRemovalDialog(screen);

  await userEvent.keyboard("{Escape}");

  await expect.element(dialog).not.toBeInTheDocument();
  await vi.waitFor(() => {
    expect(focused()).toBe(trigger(screen).element());
  });
});

test("ParticipationMenu — le bouton Fermer de la fenêtre de retrait rend aussi le focus au bouton du menu", async () => {
  const { screen } = await renderMenu();
  const dialog = await openRemovalDialog(screen);

  await dialog.getByRole("button", { name: fr.common.close }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  await vi.waitFor(() => {
    expect(focused()).toBe(trigger(screen).element());
  });
});

test("ParticipationMenu — un retrait réussi le dit à la page (qui a la charge du focus : la ligne va disparaître)", async () => {
  const { screen, onRemoved } = await renderMenu();
  const dialog = await openRemovalDialog(screen);
  expect(onRemoved).not.toHaveBeenCalled();

  await dialog.getByRole("button", { name: fr.common.remove }).click();

  await vi.waitFor(() => {
    expect(onRemoved).toHaveBeenCalledOnce();
  });
});

test("ParticipationMenu — après un changement de statut, le focus est sur le bouton du menu", async () => {
  const { screen } = await renderMenu();
  await open(screen);

  await screen.getByRole("button", { name: fr.status.finished }).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledOnce();
  });
  expect(focused()).toBe(trigger(screen).element());
});
