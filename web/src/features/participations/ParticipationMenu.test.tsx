import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { ToastProvider } from "../../components/Toast";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { ParticipationRecord, RunnerRecord } from "../../lib/types";
import { aliceRunner, bobRunner, p1, p2 } from "../events/testFixture";
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

beforeEach(() => {
  mocks.update.mockReset().mockResolvedValue({});
  mocks.remove.mockReset().mockResolvedValue(true);
});

async function renderMenu(
  options: {
    participation?: ParticipationRecord;
    runner?: RunnerRecord;
    canConfirm?: boolean;
  } = {},
) {
  const { participation = bobParticipation, runner = bobRunner, canConfirm = false } = options;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
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
              formatLabel="Trail 42 km"
              canConfirm={canConfirm}
            />
          </div>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { screen, invalidate };
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
