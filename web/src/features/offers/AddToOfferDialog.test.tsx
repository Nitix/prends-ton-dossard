import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { buttonOf, clickTwice, expectAvailable, expectBusy } from "../../test/busyButton";
import { AddToOfferDialog } from "./AddToOfferDialog";
import { offersKey, toOfferView, type OfferView } from "./api";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  runners: vi.fn<(options?: Rec) => Promise<unknown>>(),
  take: vi.fn<(body: Rec) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    collection: (name: string) =>
      ({
        runners: { getFullList: mocks.runners },
        offer_members: { create: mocks.take },
      })[name],
  },
}));

const base = { created: "", updated: "", collectionId: "", collectionName: "" };
const runner = (name: string, user = `u-${name.toLowerCase()}`) => ({
  ...base,
  id: `${name.toLowerCase()}Runner00`.slice(0, 15).padEnd(15, "0"),
  name,
  user,
});
const alice = runner("Alice");
const bob = runner("Bob");
const sam = runner("Sam", "");
const nina = runner("Nina");
const zoe = runner("Zoe");
const carl = runner("Carl");
const admin = runner("Admin");

type Runner = typeof alice;

function place(id: string, offerId: string, who: Runner) {
  return {
    ...base,
    collectionName: "offer_members",
    id,
    offer: offerId,
    runner: who.id,
    added_by: who.id,
    expand: { runner: who },
  };
}

/** An offer with its owner and the people in it, as the list gives it. */
function offerView(
  id: string,
  kind: "ride" | "lodging",
  owner: Runner,
  seats: number,
  members: Runner[] = [],
): OfferView {
  return toOfferView({
    ...base,
    collectionName: "offers",
    id,
    event: "event",
    kind,
    owner: owner.id,
    place: "Lyon",
    seats,
    date: "",
    time: "",
    end_date: "",
    url: "",
    notes: "",
    expand: {
      owner,
      ...(members.length > 0 && {
        offer_members_via_offer: members.map((who) => place(`m-${id}-${who.name}`, id, who)),
      }),
    },
  });
}

// Alice's car (4 seats) has Sam and Bob in it; Carl has a car of his own; Nina has a bed at Zoe's lodging.
const aliceCar = () => offerView("ride1", "ride", alice, 4, [sam, bob]);
const carlCar = () => offerView("ride2", "ride", carl, 3);
const zoeLodging = () => offerView("lodging1", "lodging", zoe, 0, [nina]);

beforeEach(() => {
  // On purpose in the order of no name.
  mocks.runners
    .mockReset()
    .mockResolvedValue([zoe, sam, nina, bob, alice, carl, admin].map((who) => ({ ...who })));
  mocks.take.mockReset().mockResolvedValue({ id: "new" });
});

/** The opener, and the dialog it opens: closing the dialog (its own or the form's) closes it. */
function Tree({
  offer,
  offers,
  onClose,
}: {
  offer: OfferView;
  offers: OfferView[];
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
      <AddToOfferDialog
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        eventId="event"
        offers={offers}
        offer={offer}
      />
    </>
  );
}

async function openDialog(
  options: { offer?: OfferView; offers?: OfferView[]; languages?: string[] } = {},
) {
  const { offer = aliceCar(), languages = ["fr"] } = options;
  const offers = options.offers ?? [aliceCar(), carlCar(), zoeLodging()];
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onClose = vi.fn<() => void>();
  const tree = (current: OfferView, all: OfferView[]) => (
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        <Tree offer={current} offers={all} onClose={onClose} />
      </I18nProvider>
    </QueryClientProvider>
  );

  const screen = await render(tree(offer, offers));
  const opener = screen.getByRole("button", { name: "Ouvrir", exact: true });
  await opener.click();
  /** The page loads other offers while the dialog is open. */
  const reload = (current: OfferView, all: OfferView[]) => screen.rerender(tree(current, all));
  return { screen, onClose, invalidate, opener, reload };
}

type Screen = Awaited<ReturnType<typeof openDialog>>["screen"];

const dialogOf = (screen: Screen) =>
  screen.getByRole("dialog", { name: fr.offers.addSomeoneTitle });
const runnerSelect = (screen: Screen) => screen.getByLabelText(fr.participation.runner);
const submit = (screen: Screen) =>
  screen.getByRole("button", { name: fr.participation.addSubmit, exact: true });

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

describe("who is offered", () => {
  test("AddToOfferDialog — ne propose que les coureurs qui peuvent prendre une place, triés par nom", async () => {
    const { screen } = await openDialog();
    await expect.element(dialogOf(screen)).toBeVisible();

    // Alice is the owner, Sam and Bob are in the car already, Carl has a car of his own: they are
    // not offered. Nina has a place in a lodging, which is not a car. Zoe and the admin are free.
    await vi.waitFor(() => {
      expect(offered(screen)).toEqual(["Admin", "Nina", "Zoe"]);
    });
    // The first option asks for a choice and cannot be the one that is sent.
    const first = optionsOf(runnerSelect(screen).element())[0];
    expect(first?.value).toBe("");
    expect(first?.disabled).toBe(true);
    expect(first?.textContent).toBe(fr.participation.chooseRunner);
    // Nothing is sent until somebody is chosen.
    await expect.element(runnerSelect(screen)).toBeRequired();
    await submit(screen).click();
    expect(mocks.take).not.toHaveBeenCalled();
  });

  test("AddToOfferDialog — pour un logement, une place dans une voiture n'empêche pas", async () => {
    const lodging = offerView("lodging2", "lodging", bob, 0);
    const { screen } = await openDialog({
      offer: lodging,
      offers: [aliceCar(), lodging, zoeLodging()],
    });
    await expect.element(dialogOf(screen)).toBeVisible();

    // Bob owns this lodging; Zoe and Nina have a bed elsewhere. The places in a car do not count, nor does the car of Carl.
    await vi.waitFor(() => {
      expect(offered(screen)).toEqual(["Admin", "Alice", "Carl", "Sam"]);
    });
  });

  test("AddToOfferDialog — sans personne à ajouter, la phrase « Tout le monde a déjà une place. »", async () => {
    // A car that is full: nobody can take a place in it.
    const full = offerView("ride1", "ride", alice, 2, [sam, bob]);
    const { screen } = await openDialog({ offer: full, offers: [full] });
    await expect.element(dialogOf(screen)).toBeVisible();

    await expect.element(screen.getByText(fr.offers.nobodyToAdd)).toBeVisible();
    expect(fr.offers.nobodyToAdd).toBe("Tout le monde a déjà une place.");
    await expect.element(runnerSelect(screen)).not.toBeInTheDocument();
    // Nothing to send: the button says so, and sends nothing.
    await expect.element(submit(screen)).toHaveAttribute("aria-disabled", "true");
    // (Playwright does not click what is aria-disabled: the click is the page's own.)
    buttonOf(submit(screen)).click();
    expect(mocks.take).not.toHaveBeenCalled();
  });

  test("AddToOfferDialog — un coureur qui prend une place pendant que la fenêtre est ouverte n'est plus proposé ni choisi", async () => {
    const { screen, reload } = await openDialog();
    await expect.element(dialogOf(screen)).toBeVisible();
    await vi.waitFor(() => {
      expect(offered(screen)).toEqual(["Admin", "Nina", "Zoe"]);
    });
    await runnerSelect(screen).selectOptions(nina.id);
    await expect.element(runnerSelect(screen)).toHaveValue(nina.id);

    // Somebody else puts Nina in the car: the page has the new places.
    const taken = offerView("ride1", "ride", alice, 4, [sam, bob, nina]);
    await reload(taken, [taken, carlCar(), zoeLodging()]);

    await vi.waitFor(() => {
      expect(offered(screen)).toEqual(["Admin", "Zoe"]);
    });
    await expect.element(runnerSelect(screen)).toHaveValue("");
    await submit(screen).click();
    expect(mocks.take).not.toHaveBeenCalled();
  });
});

describe("adding someone", () => {
  test("AddToOfferDialog — l'envoi crée la place du coureur choisi", async () => {
    const { screen, onClose, invalidate } = await openDialog();
    await expect.element(dialogOf(screen)).toBeVisible();
    await vi.waitFor(() => {
      expect(offered(screen).length).toBeGreaterThan(0);
    });

    await runnerSelect(screen).selectOptions(nina.id);
    await submit(screen).click();

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    // The place is in the offer, for the runner: who placed them is the server's to set.
    expect(mocks.take).toHaveBeenCalledTimes(1);
    expect(mocks.take).toHaveBeenCalledWith({ offer: "ride1", runner: nina.id });
    // The offers are read again, so that the page shows the new place.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: offersKey("event") });
  });

  test("AddToOfferDialog — deux envois à la suite ne créent qu'une place", async () => {
    const { screen, onClose } = await openDialog();
    const dialog = dialogOf(screen);
    await expect.element(dialog).toBeVisible();
    await vi.waitFor(() => {
      expect(offered(screen).length).toBeGreaterThan(0);
    });
    await runnerSelect(screen).selectOptions(nina.id);

    // Two submissions in the same instant (two taps before the button says it is busy).
    const form = dialog.element().querySelector("form");
    if (!form) throw new Error("no form");
    form.requestSubmit();
    form.requestSubmit();

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(mocks.take).toHaveBeenCalledTimes(1);
  });

  test("AddToOfferDialog — un refus (offer_full) est traduit, et la fenêtre reste ouverte", async () => {
    mocks.take.mockRejectedValueOnce(
      new ClientResponseError({
        status: 400,
        response: {
          status: 400,
          message: "Failed to create record.",
          data: { offer: { code: "offer_full", message: "…" } },
        },
      }),
    );
    const { screen, onClose } = await openDialog();
    const dialog = dialogOf(screen);
    await expect.element(dialog).toBeVisible();
    await vi.waitFor(() => {
      expect(offered(screen).length).toBeGreaterThan(0);
    });

    await runnerSelect(screen).selectOptions(zoe.id);
    await submit(screen).click();

    await expect.element(dialog.getByRole("alert").getByText(fr.errors.offer_full)).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("AddToOfferDialog — le bouton garde le focus pendant l'envoi et après un refus, et deux clics ne créent qu'une place", async () => {
    const pending = Promise.withResolvers<unknown>();
    mocks.take.mockReturnValueOnce(pending.promise);
    const { screen, onClose } = await openDialog();
    const dialog = dialogOf(screen);
    await expect.element(dialog).toBeVisible();
    await vi.waitFor(() => {
      expect(offered(screen).length).toBeGreaterThan(0);
    });
    await runnerSelect(screen).selectOptions(zoe.id);
    const button = buttonOf(submit(screen));

    clickTwice(button);

    await expectBusy(button);
    expect(mocks.take).toHaveBeenCalledTimes(1);

    pending.reject(
      new ClientResponseError({
        status: 400,
        response: {
          status: 400,
          message: "Failed to create record.",
          data: { offer: { code: "offer_full", message: "…" } },
        },
      }),
    );
    await expect.element(dialog.getByRole("alert").getByText(fr.errors.offer_full)).toBeVisible();
    await expectAvailable(button);
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.take).toHaveBeenCalledTimes(1);
  });

  test("AddToOfferDialog — Annuler ne crée rien et rend le focus au bouton d'ouverture", async () => {
    const { screen, onClose, opener } = await openDialog();
    await expect.element(dialogOf(screen)).toBeVisible();

    await screen.getByRole("button", { name: fr.common.cancel }).click();

    // The native dialog says it is closed a moment after the click, in Firefox.
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(mocks.take).not.toHaveBeenCalled();
    await expect.element(opener).toHaveFocus();
  });

  test("AddToOfferDialog — la liste des coureurs qui ne se charge pas le dit, et se retente", async () => {
    mocks.runners.mockRejectedValueOnce(new Error("offline"));
    const { screen } = await openDialog();
    const dialog = dialogOf(screen);

    await expect.element(dialog.getByRole("alert").getByText(fr.errors.generic)).toBeVisible();
    await dialog.getByRole("button", { name: fr.common.retry }).click();

    await vi.waitFor(() => {
      expect(offered(screen)).toEqual(["Admin", "Nina", "Zoe"]);
    });
  });

  test("AddToOfferDialog — en anglais, les textes suivent la langue", async () => {
    const full = offerView("ride1", "ride", alice, 2, [sam, bob]);
    const { screen } = await openDialog({ offer: full, offers: [full], languages: ["en"] });

    await expect
      .element(screen.getByRole("dialog", { name: en.offers.addSomeoneTitle }))
      .toBeVisible();
    await expect.element(screen.getByText(en.offers.nobodyToAdd)).toBeVisible();
    expect(en.offers.nobodyToAdd).toBe("Everyone already has a place.");
  });
});
