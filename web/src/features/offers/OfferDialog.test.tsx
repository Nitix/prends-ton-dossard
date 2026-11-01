import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { useState } from "react";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import type { OfferKind } from "../../lib/types";
import { animationsDone } from "../../test/animations";
import { buttonOf, clickTwice, expectAvailable, expectBusy } from "../../test/busyButton";
import { toEventView, type EventView } from "../events/api";
import { eventRecord } from "../events/testFixture";
import { offersKey, toOfferView, type OfferView } from "./api";
import { OfferDialog } from "./OfferDialog";

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
      ({ offers: { create: mocks.create, update: mocks.update } })[name],
  },
}));

let view: EventView;

beforeAll(async () => {
  await ensureTemporal();
  view = toEventView(eventRecord);
});

beforeEach(() => {
  mocks.create.mockReset().mockResolvedValue({ id: "new" });
  mocks.update.mockReset().mockResolvedValue({ id: "ride1" });
});

const base = { created: "", updated: "", collectionId: "", collectionName: "" };
const alice = { ...base, id: "aliceRunner0000", name: "Alice", user: "u-alice" };

/** An offer of Alice as the list gives it: with her expanded as its owner, and nobody in it. */
function offerView(kind: OfferKind, fields: Rec): OfferView {
  return toOfferView({
    ...base,
    collectionName: "offers",
    id: kind === "ride" ? "ride1" : "lodging1",
    event: "event",
    kind,
    owner: alice.id,
    place: "",
    seats: 0,
    date: "",
    time: "",
    end_date: "",
    url: "",
    notes: "",
    ...fields,
    expand: { owner: alice },
  });
}

const ride = () =>
  offerView("ride", {
    place: "Lyon, Part-Dieu",
    seats: 4,
    date: "2026-06-13",
    time: "06:30",
    notes: "Rendez-vous devant la gare.",
  });

const lodging = () =>
  offerView("lodging", {
    place: "Gîte des Crêtes, Valloire",
    seats: 5,
    date: "2026-06-13",
    end_date: "2026-06-14",
    url: "https://gite.example.test/annonce",
    notes: "Draps fournis.",
  });

/** The opener, and the dialog it opens: closing the dialog (its own or the form's) closes it. */
function Harness({
  kind,
  offer,
  onClose,
}: {
  kind: OfferKind;
  offer?: OfferView | undefined;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Ouvrir
      </button>
      <OfferDialog
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        view={view}
        kind={kind}
        offer={offer}
      />
    </>
  );
}

async function openDialog(
  options: { kind?: OfferKind; offer?: OfferView; languages?: string[] } = {},
) {
  const { kind = "ride", offer, languages = ["fr"] } = options;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onClose = vi.fn<() => void>();
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        <Harness kind={kind} offer={offer} onClose={onClose} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  const opener = screen.getByRole("button", { name: "Ouvrir", exact: true });
  await opener.click();
  return { screen, onClose, invalidate, opener };
}

type Screen = Awaited<ReturnType<typeof openDialog>>["screen"];

const field = (screen: Screen, label: string) => screen.getByLabelText(label, { exact: true });
const save = (screen: Screen) =>
  screen.getByRole("button", { name: fr.offers.form.save, exact: true });
const dialogOf = (screen: Screen, name: string) => screen.getByRole("dialog", { name });

/** What the SDK throws for the 400 of a record that the server refuses. */
function refusal(name: string, code: string): ClientResponseError {
  return new ClientResponseError({
    status: 400,
    response: {
      status: 400,
      message: "Failed to create record.",
      data: { [name]: { code, message: "…" } },
    },
  });
}

// --- Offering ---

describe("offering", () => {
  test("OfferDialog — proposer une voiture envoie event, kind, lieu, places, date, heure et notes", async () => {
    const { screen, onClose } = await openDialog({ kind: "ride" });
    const dialog = dialogOf(screen, fr.offers.form.titleNew.ride);
    await expect.element(dialog).toBeVisible();

    // The day starts as the first day of the event.
    await expect.element(field(screen, fr.offers.form.date.ride)).toHaveValue("2026-06-13");
    // A car takes 1 to 8 passengers, and says how many.
    const seats = field(screen, fr.offers.form.seats.ride);
    await expect.element(seats).toHaveAttribute("type", "number");
    await expect.element(seats).toHaveAttribute("min", "1");
    await expect.element(seats).toHaveAttribute("max", "8");
    await expect.element(seats).toBeRequired();
    await expect.element(field(screen, fr.offers.form.place.ride)).toBeRequired();
    await expect.element(field(screen, fr.offers.form.time)).toHaveAttribute("type", "time");
    // What a lodging has, a car has not.
    await expect.element(field(screen, fr.offers.form.endDate)).not.toBeInTheDocument();
    await expect.element(field(screen, fr.offers.form.url)).not.toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();

    await field(screen, fr.offers.form.place.ride).fill("Lyon, Part-Dieu");
    await seats.fill("3");
    await field(screen, fr.offers.form.time).fill("06:30");
    await field(screen, fr.offers.form.notes).fill("Devant la gare.\nPas de chien.");
    await save(screen).click();

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    // The owner is the server's to set, and so is nothing else the form does not have.
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith({
      event: "event",
      kind: "ride",
      place: "Lyon, Part-Dieu",
      seats: 3,
      date: "2026-06-13",
      time: "06:30",
      notes: "Devant la gare.\nPas de chien.",
    });
    expect(mocks.update).not.toHaveBeenCalled();
    await expect.element(dialog).not.toBeInTheDocument();
  });

  test("OfferDialog — un logement n'a pas d'heure ; ses places sont facultatives", async () => {
    const { screen, onClose } = await openDialog({ kind: "lodging" });
    const dialog = dialogOf(screen, fr.offers.form.titleNew.lodging);
    await expect.element(dialog).toBeVisible();

    await expect.element(field(screen, fr.offers.form.time)).not.toBeInTheDocument();
    // The arrival starts as the first day of the event; the departure is left to the member.
    await expect.element(field(screen, fr.offers.form.date.lodging)).toHaveValue("2026-06-13");
    await expect.element(field(screen, fr.offers.form.endDate)).toHaveValue("");
    // 1 to 30 places, or none: a lodging that does not say has no limit.
    const seats = field(screen, fr.offers.form.seats.lodging);
    await expect.element(seats).toHaveAttribute("min", "1");
    await expect.element(seats).toHaveAttribute("max", "30");
    await expect.element(seats).not.toBeRequired();
    // The address of the listing is a web address.
    await expect.element(field(screen, fr.offers.form.url)).toHaveAttribute("type", "url");

    await field(screen, fr.offers.form.place.lodging).fill("Gîte des Crêtes, Valloire");
    await save(screen).click();

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    // What is left empty is sent empty: no places is 0, which is no limit.
    expect(mocks.create).toHaveBeenCalledWith({
      event: "event",
      kind: "lodging",
      place: "Gîte des Crêtes, Valloire",
      seats: 0,
      date: "2026-06-13",
      end_date: "",
      url: "",
      notes: "",
    });
  });

  test("OfferDialog — un logement envoie ses places, sa date de départ et son lien", async () => {
    const { screen, onClose } = await openDialog({ kind: "lodging" });
    await expect.element(dialogOf(screen, fr.offers.form.titleNew.lodging)).toBeVisible();

    await field(screen, fr.offers.form.place.lodging).fill("Camping du Lac");
    await field(screen, fr.offers.form.seats.lodging).fill("6");
    await field(screen, fr.offers.form.date.lodging).fill("2026-06-12");
    await field(screen, fr.offers.form.endDate).fill("2026-06-14");
    await field(screen, fr.offers.form.url).fill("https://camping.example.test/lac");
    await field(screen, fr.offers.form.notes).fill("Emplacements ombragés.");
    await save(screen).click();

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(mocks.create).toHaveBeenCalledWith({
      event: "event",
      kind: "lodging",
      place: "Camping du Lac",
      seats: 6,
      date: "2026-06-12",
      end_date: "2026-06-14",
      url: "https://camping.example.test/lac",
      notes: "Emplacements ombragés.",
    });
  });

  test("OfferDialog — Annuler ne crée rien, et la fenêtre rouverte repart de zéro", async () => {
    const { screen, onClose, opener } = await openDialog({ kind: "ride" });
    await expect.element(dialogOf(screen, fr.offers.form.titleNew.ride)).toBeVisible();
    await field(screen, fr.offers.form.place.ride).fill("Grenoble");

    await screen.getByRole("button", { name: fr.common.cancel }).click();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
    await expect.element(opener).toHaveFocus();

    await opener.click();
    await expect.element(field(screen, fr.offers.form.place.ride)).toHaveValue("");
    await expect.element(field(screen, fr.offers.form.date.ride)).toHaveValue("2026-06-13");
  });

  test("OfferDialog — deux envois à la suite ne créent qu'une offre", async () => {
    const { screen, onClose } = await openDialog({ kind: "ride" });
    const dialog = dialogOf(screen, fr.offers.form.titleNew.ride);
    await expect.element(dialog).toBeVisible();
    await field(screen, fr.offers.form.place.ride).fill("Lyon");
    await field(screen, fr.offers.form.seats.ride).fill("2");

    // Two submissions in the same instant (two taps before the button says it is busy).
    const form = dialog.element().querySelector("form");
    if (!form) throw new Error("no form");
    form.requestSubmit();
    form.requestSubmit();

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  test("OfferDialog — l'enregistrement relit la liste des offres de l'événement", async () => {
    const { screen, onClose, invalidate } = await openDialog({ kind: "ride" });
    await expect.element(dialogOf(screen, fr.offers.form.titleNew.ride)).toBeVisible();
    await field(screen, fr.offers.form.place.ride).fill("Lyon");
    await field(screen, fr.offers.form.seats.ride).fill("2");

    await save(screen).click();

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: offersKey("event") });
  });
});

// --- What the server refuses ---

describe("a refusal", () => {
  test("OfferDialog — offer_seats_required s'affiche sous les places, qui prennent le focus", async () => {
    mocks.create.mockRejectedValueOnce(refusal("seats", "offer_seats_required"));
    const { screen, onClose } = await openDialog({ kind: "ride" });
    const dialog = dialogOf(screen, fr.offers.form.titleNew.ride);
    await expect.element(dialog).toBeVisible();
    await field(screen, fr.offers.form.place.ride).fill("Lyon");
    const seats = field(screen, fr.offers.form.seats.ride);
    await seats.fill("2");

    await save(screen).click();

    // The message is under the field it is about, which has the focus.
    await expect.element(seats).toHaveAttribute("aria-invalid", "true");
    await expect.element(seats).toHaveAccessibleDescription(fr.errors.offer_seats_required);
    await expect.element(seats).toHaveFocus();
    await expect
      .element(field(screen, fr.offers.form.place.ride))
      .toHaveAttribute("aria-invalid", "false");
    // The window stays open, with what was typed.
    await expect.element(dialog).toBeVisible();
    await expect.element(field(screen, fr.offers.form.place.ride)).toHaveValue("Lyon");
    expect(onClose).not.toHaveBeenCalled();

    // Trying again with the server happy closes the window.
    await save(screen).click();
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  test("OfferDialog — le focus va sur le premier champ en erreur, dans l'ordre du formulaire", async () => {
    mocks.create.mockRejectedValueOnce(
      new ClientResponseError({
        status: 400,
        response: {
          status: 400,
          message: "Failed to create record.",
          data: {
            notes: { code: "validation_max_text_constraint", message: "…" },
            time: { code: "time_invalid", message: "…" },
          },
        },
      }),
    );
    const { screen } = await openDialog({ kind: "ride" });
    await expect.element(dialogOf(screen, fr.offers.form.titleNew.ride)).toBeVisible();
    await field(screen, fr.offers.form.place.ride).fill("Lyon");
    await field(screen, fr.offers.form.seats.ride).fill("2");

    await save(screen).click();

    // Both are shown, the time (which comes first) has the focus.
    const time = field(screen, fr.offers.form.time);
    await expect.element(time).toHaveAccessibleDescription(fr.errors.time_invalid);
    await expect
      .element(field(screen, fr.offers.form.notes))
      .toHaveAccessibleDescription(fr.errors.validation_max_text_constraint);
    await expect.element(time).toHaveFocus();
  });

  test("OfferDialog — une erreur qui n'est pas celle d'un champ va dans une alerte", async () => {
    mocks.create.mockRejectedValueOnce(refusal("kind", "offer_already_member"));
    const { screen, onClose } = await openDialog({ kind: "ride" });
    const dialog = dialogOf(screen, fr.offers.form.titleNew.ride);
    await expect.element(dialog).toBeVisible();
    await field(screen, fr.offers.form.place.ride).fill("Lyon");
    await field(screen, fr.offers.form.seats.ride).fill("2");

    await save(screen).click();

    await expect
      .element(dialog.getByRole("alert").getByText(fr.errors.offer_already_member))
      .toBeVisible();
    // No field is blamed for it.
    for (const label of [
      fr.offers.form.place.ride,
      fr.offers.form.seats.ride,
      fr.offers.form.date.ride,
      fr.offers.form.time,
      fr.offers.form.notes,
    ]) {
      await expect.element(field(screen, label)).toHaveAttribute("aria-invalid", "false");
    }
    await expect.element(dialog).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("OfferDialog — Enregistrer garde le focus pendant l'envoi et après un refus qui ne tient à aucun champ, et un double envoi ne crée qu'une offre", async () => {
    const pending = Promise.withResolvers<unknown>();
    mocks.create.mockReturnValueOnce(pending.promise);
    const { screen, onClose } = await openDialog({ kind: "ride" });
    const dialog = dialogOf(screen, fr.offers.form.titleNew.ride);
    await expect.element(dialog).toBeVisible();
    await field(screen, fr.offers.form.place.ride).fill("Lyon");
    await field(screen, fr.offers.form.seats.ride).fill("2");
    const button = buttonOf(save(screen));

    // Two clicks in the same tick, before the page has drawn the busy state.
    clickTwice(button);

    await expectBusy(button);
    expect(mocks.create).toHaveBeenCalledTimes(1);

    // The offer as a whole is refused: no field to give the focus to, so it stays on the button.
    pending.reject(refusal("kind", "offer_already_member"));
    await expect
      .element(dialog.getByRole("alert").getByText(fr.errors.offer_already_member))
      .toBeVisible();
    await expectAvailable(button);
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  test("OfferDialog — un refus sans code donne le message générique, et la fenêtre reste ouverte", async () => {
    mocks.create.mockRejectedValueOnce(new Error("offline"));
    const { screen, onClose } = await openDialog({ kind: "ride" });
    const dialog = dialogOf(screen, fr.offers.form.titleNew.ride);
    await expect.element(dialog).toBeVisible();
    await field(screen, fr.offers.form.place.ride).fill("Lyon");
    await field(screen, fr.offers.form.seats.ride).fill("2");

    await save(screen).click();

    await expect.element(dialog.getByRole("alert").getByText(fr.errors.generic)).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("OfferDialog — l'adresse du lien refusée (validation_invalid_url) s'affiche sous le lien", async () => {
    mocks.create.mockRejectedValueOnce(refusal("url", "validation_invalid_url"));
    const { screen } = await openDialog({ kind: "lodging" });
    await expect.element(dialogOf(screen, fr.offers.form.titleNew.lodging)).toBeVisible();
    await field(screen, fr.offers.form.place.lodging).fill("Gîte");
    await field(screen, fr.offers.form.url).fill("https://gite.example.test");

    await save(screen).click();

    const url = field(screen, fr.offers.form.url);
    await expect.element(url).toHaveAccessibleDescription(fr.errors.validation_invalid_url);
    await expect.element(url).toHaveFocus();
  });
});

// --- Editing ---

describe("editing", () => {
  test("OfferDialog — modifier préremplit et envoie un PATCH sans event, kind ni owner ; un champ vidé part vide", async () => {
    const { screen, onClose } = await openDialog({ kind: "ride", offer: ride() });
    const dialog = dialogOf(screen, fr.offers.form.titleEdit);
    await expect.element(dialog).toBeVisible();

    // The fields start as the offer is.
    await expect.element(field(screen, fr.offers.form.place.ride)).toHaveValue("Lyon, Part-Dieu");
    await expect.element(field(screen, fr.offers.form.seats.ride)).toHaveValue(4);
    await expect.element(field(screen, fr.offers.form.date.ride)).toHaveValue("2026-06-13");
    await expect.element(field(screen, fr.offers.form.time)).toHaveValue("06:30");
    await expect
      .element(field(screen, fr.offers.form.notes))
      .toHaveValue("Rendez-vous devant la gare.");

    await field(screen, fr.offers.form.place.ride).fill("Lyon, Perrache");
    await field(screen, fr.offers.form.time).fill("");
    await field(screen, fr.offers.form.notes).fill("");
    await save(screen).click();

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    // Emptied is sent as empty, so that the server clears it; the event, the kind and the owner never move.
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith("ride1", {
      place: "Lyon, Perrache",
      seats: 4,
      date: "2026-06-13",
      time: "",
      notes: "",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test("OfferDialog — un logement vidé de ses places, de son départ et de son lien les envoie à 0 et vides", async () => {
    const { screen, onClose } = await openDialog({ kind: "lodging", offer: lodging() });
    await expect.element(dialogOf(screen, fr.offers.form.titleEdit)).toBeVisible();

    await expect.element(field(screen, fr.offers.form.seats.lodging)).toHaveValue(5);
    await expect.element(field(screen, fr.offers.form.endDate)).toHaveValue("2026-06-14");
    await expect
      .element(field(screen, fr.offers.form.url))
      .toHaveValue("https://gite.example.test/annonce");

    await field(screen, fr.offers.form.seats.lodging).fill("");
    await field(screen, fr.offers.form.endDate).fill("");
    await field(screen, fr.offers.form.url).fill("");
    await save(screen).click();

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(mocks.update).toHaveBeenCalledWith("lodging1", {
      place: "Gîte des Crêtes, Valloire",
      seats: 0,
      date: "2026-06-13",
      end_date: "",
      url: "",
      notes: "Draps fournis.",
    });
  });

  test("OfferDialog — une offre sans date n'en reçoit pas à la modification", async () => {
    const offer = offerView("ride", { place: "Lyon", seats: 2 });
    const { screen, onClose } = await openDialog({ kind: "ride", offer });
    await expect.element(dialogOf(screen, fr.offers.form.titleEdit)).toBeVisible();

    // The first day of the event is for a new offer: this one has none, and the member may want it so.
    await expect.element(field(screen, fr.offers.form.date.ride)).toHaveValue("");
    await save(screen).click();

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(mocks.update).toHaveBeenCalledWith("ride1", {
      place: "Lyon",
      seats: 2,
      date: "",
      time: "",
      notes: "",
    });
  });

  test("OfferDialog — offer_seats_below_members s'affiche sous les places", async () => {
    mocks.update.mockRejectedValueOnce(refusal("seats", "offer_seats_below_members"));
    const { screen } = await openDialog({ kind: "ride", offer: ride() });
    await expect.element(dialogOf(screen, fr.offers.form.titleEdit)).toBeVisible();
    await field(screen, fr.offers.form.seats.ride).fill("1");

    await save(screen).click();

    const seats = field(screen, fr.offers.form.seats.ride);
    await expect.element(seats).toHaveAccessibleDescription(fr.errors.offer_seats_below_members);
    await expect.element(seats).toHaveFocus();
  });
});

// --- Focus, language, tap targets ---

describe("the dialog", () => {
  test("OfferDialog — après l'enregistrement, le focus revient au bouton d'ouverture", async () => {
    const { screen, onClose, opener } = await openDialog({ kind: "ride", offer: ride() });
    const dialog = dialogOf(screen, fr.offers.form.titleEdit);
    await expect.element(dialog).toBeVisible();
    // The focus is in the window while it is open.
    expect(dialog.element().contains(document.activeElement)).toBe(true);

    await save(screen).click();

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(opener).toHaveFocus();
  });

  test("OfferDialog — Échap ferme la fenêtre et rend le focus au bouton d'ouverture", async () => {
    const { screen, onClose, opener } = await openDialog({ kind: "lodging" });
    await expect.element(dialogOf(screen, fr.offers.form.titleNew.lodging)).toBeVisible();

    await userEvent.keyboard("{Escape}");

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    await expect.element(opener).toHaveFocus();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test("OfferDialog — en anglais, les textes suivent la langue", async () => {
    const { screen } = await openDialog({ kind: "lodging", languages: ["en"] });

    await expect
      .element(screen.getByRole("dialog", { name: en.offers.form.titleNew.lodging }))
      .toBeVisible();
    for (const label of [
      en.offers.form.place.lodging,
      en.offers.form.seats.lodging,
      en.offers.form.date.lodging,
      en.offers.form.endDate,
      en.offers.form.url,
      en.offers.form.notes,
    ]) {
      await expect.element(screen.getByLabelText(label, { exact: true })).toBeVisible();
    }
    await expect
      .element(screen.getByRole("button", { name: en.offers.form.save, exact: true }))
      .toBeVisible();
  });

  test("OfferDialog — zones tactiles d'au moins 44 px", async () => {
    await page.viewport(390, 844);
    const { screen } = await openDialog({ kind: "ride" });
    await expect.element(dialogOf(screen, fr.offers.form.titleNew.ride)).toBeVisible();
    await animationsDone();

    const heights = [
      screen.getByLabelText(fr.offers.form.place.ride, { exact: true }),
      screen.getByLabelText(fr.offers.form.seats.ride, { exact: true }),
      screen.getByLabelText(fr.offers.form.date.ride, { exact: true }),
      screen.getByLabelText(fr.offers.form.time, { exact: true }),
      save(screen),
      screen.getByRole("button", { name: fr.common.cancel }),
    ].map((target) => target.element().getBoundingClientRect().height);

    expect(heights).toHaveLength(6);
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
    await page.viewport(414, 896);
  });
});
