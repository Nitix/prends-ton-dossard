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
import { TodayProvider } from "../../lib/useToday";
import { buttonOf, clickTwice, expectAvailable, expectBusy } from "../../test/busyButton";
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

// The day of the 42 km (and the second day of the event): the dialog of the formats
// reads it, to know which of the races have started.
const RACE_DAY = "2026-06-14";

async function renderMenu(
  options: {
    participation?: ParticipationRecord;
    runner?: RunnerRecord;
    canConfirm?: boolean;
    /** Given for a participation on the event alone: the formats to choose from. */
    formatsOf?: EventView;
    /** What the participation is on: its format, or the event when it has none. */
    label?: string;
    /** The race has started, the day of the format being today or past: the case of most tests. */
    started?: boolean;
  } = {},
) {
  const {
    participation = bobParticipation,
    runner = bobRunner,
    canConfirm = false,
    formatsOf,
    label = "Trail 42 km",
    started = true,
  } = options;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onRemoved = vi.fn<() => void>();
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={["fr"]}>
        <TodayProvider value={Temporal.PlainDate.from(RACE_DAY)}>
          <ToastProvider>
            {/* On the right, where the menu of a row is. */}
            <div className="flex justify-end p-4">
              <ParticipationMenu
                eventId="event"
                participation={participation}
                runner={runner}
                label={label}
                formatsOf={formatsOf}
                started={started}
                canConfirm={canConfirm}
                onRemoved={onRemoved}
              />
            </div>
          </ToastProvider>
        </TodayProvider>
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

// --- Before the day of the race ---
//
// Nobody finishes a race, or gives up on it, before its day (the server refuses it
// too): the menu does not offer « Terminé », « Abandon » or the result until then.

test("ParticipationMenu — avant le jour de la course, ni Terminé, ni Abandon, ni Saisir le résultat", async () => {
  const { screen } = await renderMenu({ started: false });
  await trigger(screen).click();
  await expect.element(screen.getByRole("button", { name: fr.status.dns })).toBeVisible();

  expect(itemsOf(trigger(screen).element())).toEqual([
    fr.status.interested,
    fr.status.registered,
    fr.status.dns,
    fr.common.remove,
  ]);
});

test("ParticipationMenu — le jour de la course, les cinq statuts et le résultat sont là", async () => {
  const { screen } = await renderMenu({ started: true });
  await open(screen);

  expect(itemsOf(trigger(screen).element())).toEqual([
    fr.status.interested,
    fr.status.registered,
    fr.status.finished,
    fr.status.dnf,
    fr.status.dns,
    fr.results.enter,
    fr.common.remove,
  ]);
});

test("ParticipationMenu — le statut actuel reste dans la liste même s'il n'est plus proposé (course déplacée plus tard)", async () => {
  // Bob had finished, then the race was moved to a later day.
  const { screen } = await renderMenu({ participation: bobFinished, started: false });
  await trigger(screen).click();
  await expect.element(screen.getByRole("button", { name: fr.status.dns })).toBeVisible();

  // « Abandon » is not offered, « Terminé » is: it is what he is. And his result can still be changed.
  expect(itemsOf(trigger(screen).element())).toEqual([
    fr.status.interested,
    fr.status.registered,
    fr.status.finished,
    fr.status.dns,
    fr.results.edit,
    fr.common.remove,
  ]);
  await expect
    .element(screen.getByRole("button", { name: fr.status.finished }))
    .toHaveAttribute("aria-current", "true");
});

test("ParticipationMenu — avant le jour de la course, le dialogue du résultat d'un coureur qui a terminé ne propose que son statut", async () => {
  const { screen } = await renderMenu({ participation: bobFinished, started: false });
  await trigger(screen).click();
  await editResult(screen).click();

  const select = resultDialog(screen).getByLabelText(fr.participation.status).element();
  if (!(select instanceof HTMLSelectElement)) throw new Error("not a select");
  expect(Array.from(select.options).map((option) => option.value)).toEqual(["finished"]);
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

async function renderOnEventAlone(
  options: { canConfirm?: boolean; confirmed?: boolean; supporter?: boolean } = {},
) {
  const { canConfirm = true, confirmed = false, supporter = false } = options;
  const own = confirmed ? ninaConfirmed : ninaParticipation;
  return renderMenu({
    participation: supporter ? { ...own, status: "supporter" } : own,
    runner: ninaRunner,
    formatsOf: trail,
    // No format: the participation is on the event.
    label: "Trail des Crêtes",
    canConfirm,
  });
}

/** The labels of the buttons of a menu, in order, without the check mark of the current status. */
function itemsOf(button: Element): string[] {
  return Array.from(popoverOf(button).querySelectorAll("button")).map((item) =>
    (item.textContent ?? "").replace("✓", "").trim(),
  );
}

test("ParticipationMenu — à l'événement : Intéressé et Supporteur, puis Choisir l'épreuve", async () => {
  const { screen } = await renderOnEventAlone();
  await ninaMenu(screen).click();
  await expect.element(chooseFormat(screen)).toBeVisible();

  // The two statuses of a participation on the event, then what is left of the menu.
  expect(itemsOf(ninaMenu(screen).element())).toEqual([
    fr.status.interested,
    fr.status.supporter,
    fr.participation.chooseFormat,
    fr.common.confirm,
    fr.common.remove,
  ]);
  await expect.element(screen.getByRole("list", { name: fr.participation.status })).toBeVisible();
  // The current one is marked as it is among the formats, and not by the weight of the text alone.
  const interested = screen.getByRole("button", { name: fr.status.interested });
  const supporter = screen.getByRole("button", { name: fr.status.supporter });
  await expect.element(interested).toHaveAttribute("aria-current", "true");
  await expect.element(supporter).not.toHaveAttribute("aria-current", "true");
  expect(interested.element().textContent).toContain("✓");
  expect(supporter.element().textContent).not.toContain("✓");
  for (const item of [interested, supporter]) {
    expect(item.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
});

test("ParticipationMenu — à l'événement, un supporteur a Supporteur pour statut courant", async () => {
  const { screen } = await renderOnEventAlone({ supporter: true });
  await ninaMenu(screen).click();
  await expect.element(chooseFormat(screen)).toBeVisible();

  await expect
    .element(screen.getByRole("button", { name: fr.status.supporter }))
    .toHaveAttribute("aria-current", "true");
  await expect
    .element(screen.getByRole("button", { name: fr.status.interested }))
    .not.toHaveAttribute("aria-current", "true");
});

test('ParticipationMenu — passer d\'Intéressé à Supporteur envoie {status: "supporter"}', async () => {
  const { screen, invalidate } = await renderOnEventAlone();
  await ninaMenu(screen).click();
  const popover = popoverOf(ninaMenu(screen).element());

  await screen.getByRole("button", { name: fr.status.supporter }).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("pNinaUndecided", {
      status: "supporter",
    });
  });
  expect(popover.matches(":popover-open")).toBe(false);
  await vi.waitFor(() => {
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(["event", "event"]);
  });
});

test("ParticipationMenu — passer d'Intéressé à Supporteur, ou l'inverse, change la ligne de section : la page en est prévenue", async () => {
  const toSupporter = await renderOnEventAlone();
  await ninaMenu(toSupporter.screen).click();
  await toSupporter.screen.getByRole("button", { name: fr.status.supporter }).click();
  await vi.waitFor(() => {
    expect(toSupporter.onRemoved).toHaveBeenCalledOnce();
  });
  await toSupporter.screen.unmount();

  mocks.update.mockClear();
  const toInterested = await renderOnEventAlone({ supporter: true });
  await ninaMenu(toInterested.screen).click();
  await toInterested.screen.getByRole("button", { name: fr.status.interested }).click();
  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("pNinaUndecided", {
      status: "interested",
    });
  });
  await vi.waitFor(() => {
    expect(toInterested.onRemoved).toHaveBeenCalledOnce();
  });
});

test("ParticipationMenu — à l'événement, le statut courant ne renvoie rien et ne prévient pas la page", async () => {
  const { screen, onRemoved } = await renderOnEventAlone();
  await ninaMenu(screen).click();

  await screen.getByRole("button", { name: fr.status.interested }).click();

  expect(mocks.update).not.toHaveBeenCalled();
  expect(onRemoved).not.toHaveBeenCalled();
});

test("ParticipationMenu — à l'événement : ni Inscrit, ni Terminé, ni Abandon, ni Non partant, mais Confirmer s'il y a lieu et Retirer", async () => {
  const { screen } = await renderOnEventAlone();
  await ninaMenu(screen).click();
  await expect.element(chooseFormat(screen)).toBeVisible();

  // The statuses of a format are not possible with no format.
  for (const status of ["registered", "finished", "dnf", "dns"] as const) {
    await expect
      .element(screen.getByRole("button", { name: fr.status[status] }))
      .not.toBeInTheDocument();
  }
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

test("ParticipationMenu — Retirer, dans la fenêtre, garde le focus pendant l'envoi et après un refus, et un double envoi ne retire qu'une fois", async () => {
  const pending = Promise.withResolvers<unknown>();
  mocks.remove.mockReturnValueOnce(pending.promise);
  const { screen, onRemoved } = await renderMenu();
  await open(screen);
  await screen.getByRole("button", { name: fr.common.remove }).click();
  const dialog = screen.getByRole("dialog", { name: fr.participation.removeTitle });
  const confirm = buttonOf(dialog.getByRole("button", { name: fr.common.remove }));

  clickTwice(confirm);

  await expectBusy(confirm);
  expect(mocks.remove).toHaveBeenCalledTimes(1);

  pending.reject(
    new ClientResponseError({
      status: 403,
      response: { status: 403, message: "…", data: { code: "forbidden" } },
    }),
  );
  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.forbidden);
  await expectAvailable(confirm);
  expect(onRemoved).not.toHaveBeenCalled();
  expect(mocks.remove).toHaveBeenCalledTimes(1);
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

// --- The result ---
//
// On a format only: a participation on the event alone has not started anything.

const enterResult = (screen: Screen) =>
  screen.getByRole("button", { name: fr.results.enter, exact: true });
const editResult = (screen: Screen) =>
  screen.getByRole("button", { name: fr.results.edit, exact: true });
const resultDialog = (screen: Screen) => screen.getByRole("dialog", { name: fr.results.title });

// Bob has finished: his result is known.
const bobFinished: ParticipationRecord = {
  ...bobParticipation,
  status: "finished",
  finish_time_s: 15150,
  rank: 12,
  rank_of: 340,
  result_note: "3e V1H",
};

test("ParticipationMenu — « Saisir le résultat » pour qui peut modifier, « Modifier le résultat » s'il y en a un", async () => {
  const none = await renderMenu();
  await open(none.screen);
  await expect.element(enterResult(none.screen)).toBeVisible();
  await expect.element(editResult(none.screen)).not.toBeInTheDocument();
  expect(enterResult(none.screen).element().getBoundingClientRect().height).toBeGreaterThanOrEqual(
    44,
  );
  // After the statuses, with the other actions: it is not a status.
  expect(itemsOf(trigger(none.screen).element())).toEqual([
    fr.status.interested,
    fr.status.registered,
    fr.status.finished,
    fr.status.dnf,
    fr.status.dns,
    fr.results.enter,
    fr.common.remove,
  ]);
  await none.screen.unmount();

  const known = await renderMenu({ participation: bobFinished });
  await open(known.screen);
  await expect.element(editResult(known.screen)).toBeVisible();
  await expect.element(enterResult(known.screen)).not.toBeInTheDocument();
});

test("ParticipationMenu — « Modifier le résultat » aussi pour une simple note, ou un rang seul", async () => {
  for (const result of [{ result_note: "abandon au km 30" }, { rank: 3 }, { finish_time_s: 60 }]) {
    const { screen } = await renderMenu({ participation: { ...bobParticipation, ...result } });
    await open(screen);
    await expect.element(editResult(screen)).toBeVisible();
    await screen.unmount();
  }
  // A number of people ranked alone is no result.
  const { screen } = await renderMenu({ participation: { ...bobParticipation, rank_of: 340 } });
  await open(screen);
  await expect.element(enterResult(screen)).toBeVisible();
});

test("ParticipationMenu — rien pour une participation à l'événement", async () => {
  for (const supporter of [false, true]) {
    const { screen } = await renderOnEventAlone({ supporter });
    await ninaMenu(screen).click();
    await expect.element(chooseFormat(screen)).toBeVisible();

    await expect.element(enterResult(screen)).not.toBeInTheDocument();
    await expect.element(editResult(screen)).not.toBeInTheDocument();
    await screen.unmount();
  }
});

test("ParticipationMenu — « Saisir le résultat » ouvre le dialogue du résultat, menu refermé, avec le statut Terminé", async () => {
  const { screen } = await renderMenu();
  await open(screen);

  await enterResult(screen).click();

  await expect.element(resultDialog(screen)).toBeVisible();
  await expect
    .element(resultDialog(screen).getByLabelText(fr.participation.status))
    .toHaveValue("finished");
  expect(popoverOf(trigger(screen).element()).matches(":popover-open")).toBe(false);
});

test("ParticipationMenu — « Modifier le résultat » montre le résultat qu'il y a", async () => {
  const { screen } = await renderMenu({ participation: bobFinished });
  await open(screen);

  await editResult(screen).click();

  const dialog = resultDialog(screen);
  await expect
    .element(dialog.getByLabelText(fr.results.note, { exact: true }))
    .toHaveValue("3e V1H");
  await expect
    .element(dialog.getByLabelText(`${fr.results.time}, ${fr.results.hoursName}`))
    .toHaveValue(4);
});

test("ParticipationMenu — enregistrer un résultat envoie la modification de la participation, ferme le dialogue et rend le focus au bouton du menu", async () => {
  const { screen, invalidate, onRemoved } = await renderMenu();
  await open(screen);
  await enterResult(screen).click();
  const dialog = resultDialog(screen);
  await dialog.getByLabelText(`${fr.results.time}, ${fr.results.hoursName}`).fill("4");
  await dialog.getByLabelText(`${fr.results.time}, ${fr.results.minutesName}`).fill("12");
  await dialog.getByLabelText(fr.results.rank, { exact: true }).fill("12");

  await dialog.getByRole("button", { name: fr.results.save }).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p2", {
      status: "finished",
      finish_time_s: 15120,
      rank: 12,
      rank_of: 0,
      result_note: "",
    });
  });
  await expect.element(dialog).not.toBeInTheDocument();
  await vi.waitFor(() => {
    expect(focused()).toBe(trigger(screen).element());
  });
  // The row stays where it is: the page has nothing to place.
  expect(onRemoved).not.toHaveBeenCalled();
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(keys).toContainEqual(["event", "event"]);
});

test("ParticipationMenu — Annuler, Échap ou Fermer dans le dialogue du résultat rendent le focus au bouton du menu", async () => {
  const { screen, onRemoved } = await renderMenu();
  for (const close of [
    () => resultDialog(screen).getByRole("button", { name: fr.common.cancel }).click(),
    () => userEvent.keyboard("{Escape}"),
    () => resultDialog(screen).getByRole("button", { name: fr.common.close }).click(),
  ]) {
    await open(screen);
    await enterResult(screen).click();
    await expect.element(resultDialog(screen)).toBeVisible();

    await close();

    await expect.element(resultDialog(screen)).not.toBeInTheDocument();
    await vi.waitFor(() => {
      expect(focused()).toBe(trigger(screen).element());
    });
  }
  expect(mocks.update).not.toHaveBeenCalled();
  expect(onRemoved).not.toHaveBeenCalled();
});

test("ParticipationMenu — le résultat d'un non partant le sort de la liste des non partants : la page en est prévenue", async () => {
  const { screen, onRemoved } = await renderMenu({
    participation: { ...bobParticipation, status: "dns" },
  });
  await open(screen);
  await enterResult(screen).click();
  const dialog = resultDialog(screen);
  await dialog.getByLabelText(`${fr.results.time}, ${fr.results.minutesName}`).fill("42");
  expect(onRemoved).not.toHaveBeenCalled();

  await dialog.getByRole("button", { name: fr.results.save }).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p2", {
      status: "finished",
      finish_time_s: 2520,
      rank: 0,
      rank_of: 0,
      result_note: "",
    });
  });
  await vi.waitFor(() => {
    expect(onRemoved).toHaveBeenCalledOnce();
  });
  await expect.element(dialog).not.toBeInTheDocument();
  // The row is about to move: the focus is the page's to place, the menu does not take it.
  expect(focused()).not.toBe(trigger(screen).element());
});

test("ParticipationMenu — un résultat sur une participation introuvable (404) le dit, et prévient la page", async () => {
  mocks.update.mockRejectedValue(
    new ClientResponseError({
      status: 404,
      response: { status: 404, message: "The requested resource wasn't found.", data: {} },
    }),
  );
  const { screen, onRemoved, invalidate } = await renderMenu();
  await open(screen);
  await enterResult(screen).click();
  const dialog = resultDialog(screen);
  await dialog.getByLabelText(`${fr.results.time}, ${fr.results.minutesName}`).fill("42");

  await dialog.getByRole("button", { name: fr.results.save }).click();

  await expect.element(screen.getByText(fr.errors.not_found)).toBeVisible();
  await vi.waitFor(() => {
    expect(onRemoved).toHaveBeenCalledOnce();
  });
  await expect.element(dialog).not.toBeInTheDocument();
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(keys).toContainEqual(["event", "event"]);
});

test("ParticipationMenu — dans Safari, un statut choisi rend le focus au bouton du menu, mais un clic ailleurs ne le prend pas", async () => {
  const { screen } = await renderMenu();
  // Safari does not focus a button that is clicked: Chromium does, unless the press is cancelled.
  const button = trigger(screen).element();
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  await open(screen);
  expect(focused()).not.toBe(button);
  await screen.getByRole("button", { name: fr.status.finished }).click();
  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledOnce();
  });
  await vi.waitFor(() => {
    expect(focused()).toBe(button);
  });

  // Light dismiss: the page keeps the focus where the person put it.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await open(screen);
  await userEvent.click(document.body, { position: { x: 1, y: 1 } });
  await vi.waitFor(() => {
    expect(document.querySelector(":popover-open")).toBeNull();
  });
  expect(focused()).not.toBe(button);
});
