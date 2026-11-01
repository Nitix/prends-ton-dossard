import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ToastProvider } from "../../components/Toast";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { ParticipationRecord } from "../../lib/types";
import { buttonOf, clickTwice, expectAvailable, expectBusy } from "../../test/busyButton";
import { p1 } from "../events/testFixture";
import { ResultDialog } from "./ResultDialog";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  update: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: { collection: (name: string) => ({ participations: { update: mocks.update } })[name] },
}));

// Alice, registered on F42: nothing is known of her result yet.
const registered: ParticipationRecord = { ...p1, status: "registered" };
// The same, finished, with a whole result.
const finished: ParticipationRecord = {
  ...p1,
  status: "finished",
  finish_time_s: 15150,
  rank: 12,
  rank_of: 340,
  result_note: "3e V1H",
};

beforeEach(() => {
  mocks.update.mockReset().mockResolvedValue({ id: "p1" });
});

async function renderDialog(
  options: {
    participation?: ParticipationRecord;
    initialStatus?: "finished" | "dnf";
    languages?: string[];
    withCallbacks?: boolean;
  } = {},
) {
  const {
    participation = registered,
    initialStatus,
    languages = ["fr"],
    withCallbacks = false,
  } = options;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onClose = vi.fn<() => void>();
  const onSaved = vi.fn<() => void>();
  const onGone = vi.fn<() => void>();
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        <ToastProvider>
          <ResultDialog
            open
            onClose={onClose}
            onSaved={withCallbacks ? onSaved : undefined}
            onGone={withCallbacks ? onGone : undefined}
            eventId="event"
            participation={participation}
            initialStatus={initialStatus}
          />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  const title = languages[0] === "en" ? "Result" : fr.results.title;
  await expect.element(screen.getByRole("dialog", { name: title })).toBeVisible();
  return { screen, invalidate, onClose, onSaved, onGone };
}

type Screen = Awaited<ReturnType<typeof renderDialog>>["screen"];

const status = (screen: Screen) => screen.getByLabelText(fr.participation.status);
const hours = (screen: Screen) =>
  screen.getByLabelText(`${fr.results.time}, ${fr.results.hoursName}`);
const minutes = (screen: Screen) =>
  screen.getByLabelText(`${fr.results.time}, ${fr.results.minutesName}`);
const seconds = (screen: Screen) =>
  screen.getByLabelText(`${fr.results.time}, ${fr.results.secondsName}`);
const rank = (screen: Screen) => screen.getByLabelText(fr.results.rank, { exact: true });
const rankOf = (screen: Screen) => screen.getByLabelText(fr.results.rankTotal, { exact: true });
const note = (screen: Screen) => screen.getByLabelText(fr.results.note, { exact: true });
const save = (screen: Screen) => screen.getByRole("button", { name: fr.results.save });

/** A refusal of the validation of a record by the server: one code per field. */
const refused = (data: Record<string, string>) =>
  new ClientResponseError({
    status: 400,
    response: {
      status: 400,
      message: "…",
      data: Object.fromEntries(
        Object.entries(data).map(([field, code]) => [field, { code, message: "…" }]),
      ),
    },
  });

async function fillWholeResult(screen: Screen) {
  await hours(screen).fill("4");
  await minutes(screen).fill("12");
  await seconds(screen).fill("30");
  await rank(screen).fill("12");
  await rankOf(screen).fill("340");
  await note(screen).fill("3e V1H");
}

test("ResultDialog — les deux champs du classement ont un nom qui se comprend seul, « sur » reste affiché", async () => {
  const { screen } = await renderDialog();

  // « Classement, sur » read out says nothing: the second field is the number of finishers.
  expect(fr.results.rankTotal).toBe("Nombre de classés");
  await expect
    .element(screen.getByRole("spinbutton", { name: "Classement", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("spinbutton", { name: "Nombre de classés", exact: true }))
    .toBeVisible();
  // The words between the two fields are for the eyes only: the layout is the same.
  await expect.element(screen.getByText(fr.results.rankOf, { exact: true })).toBeVisible();
  expect(screen.getByRole("spinbutton", { name: /sur/ }).elements()).toHaveLength(0);
});

test("ResultDialog — en anglais, « Number of finishers »", async () => {
  const { screen } = await renderDialog({ languages: ["en"] });

  await expect.element(screen.getByRole("spinbutton", { name: "Rank", exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("spinbutton", { name: "Number of finishers", exact: true }))
    .toBeVisible();
  await expect.element(screen.getByText("out of", { exact: true })).toBeVisible();
});

test("ResultDialog — envoie statut, temps, rang, nombre et note", async () => {
  const { screen, onClose, invalidate } = await renderDialog();
  // A participation that is not finished starts from « Terminé ».
  await expect.element(status(screen)).toHaveValue("finished");

  await fillWholeResult(screen);
  await save(screen).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p1", {
    status: "finished",
    finish_time_s: 15150,
    rank: 12,
    rank_of: 340,
    result_note: "3e V1H",
  });
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(keys).toContainEqual(["events"]);
  expect(keys).toContainEqual(["event", "event"]);
  expect(keys).toContainEqual(["pending"]);
});

test("ResultDialog — ce qui n'est pas rempli part à zéro, et la note sans les blancs autour", async () => {
  const { screen, onClose } = await renderDialog();

  await minutes(screen).fill("42");
  await note(screen).fill("  une boucle de trop  ");
  await save(screen).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p1", {
    status: "finished",
    finish_time_s: 2520,
    rank: 0,
    rank_of: 0,
    result_note: "une boucle de trop",
  });
});

test("ResultDialog — vider un champ d'un résultat existant l'efface", async () => {
  const { screen, onClose } = await renderDialog({ participation: finished });

  await hours(screen).fill("");
  await minutes(screen).fill("");
  await seconds(screen).fill("");
  await rank(screen).fill("");
  await rankOf(screen).fill("");
  await note(screen).fill("");
  await save(screen).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p1", {
    status: "finished",
    finish_time_s: 0,
    rank: 0,
    rank_of: 0,
    result_note: "",
  });
});

test("ResultDialog — en Abandon, ni temps ni rang", async () => {
  const { screen, onClose } = await renderDialog();
  await hours(screen).fill("4");
  await rank(screen).fill("12");
  await rankOf(screen).fill("340");

  await status(screen).selectOptions("dnf");

  // Neither is offered, and the note is.
  await expect.element(hours(screen)).not.toBeInTheDocument();
  await expect.element(minutes(screen)).not.toBeInTheDocument();
  await expect.element(seconds(screen)).not.toBeInTheDocument();
  await expect.element(rank(screen)).not.toBeInTheDocument();
  await expect.element(rankOf(screen)).not.toBeInTheDocument();
  await expect.element(note(screen)).toBeVisible();

  await note(screen).fill("abandon au km 30");
  await save(screen).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  // What was typed for a finish is not sent: it would be a time on a DNF.
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith("p1", {
    status: "dnf",
    finish_time_s: 0,
    rank: 0,
    rank_of: 0,
    result_note: "abandon au km 30",
  });
});

test("ResultDialog — revenir à Terminé retrouve ce qui était tapé", async () => {
  const { screen } = await renderDialog();
  await hours(screen).fill("4");
  await rank(screen).fill("12");

  await status(screen).selectOptions("dnf");
  await status(screen).selectOptions("finished");

  await expect.element(hours(screen)).toHaveValue(4);
  await expect.element(rank(screen)).toHaveValue(12);
});

test("ResultDialog — rank_above_total s'affiche sous le classement, qui prend le focus", async () => {
  mocks.update.mockRejectedValue(refused({ rank: "rank_above_total" }));
  const { screen, onClose } = await renderDialog();
  await hours(screen).fill("4");
  await rank(screen).fill("400");
  await rankOf(screen).fill("340");

  await save(screen).click();

  const alert = screen.getByRole("alert");
  await expect.element(alert).toHaveTextContent(fr.errors.rank_above_total);
  await expect.element(rank(screen)).toHaveAttribute("aria-invalid", "true");
  await expect.element(rank(screen)).toHaveAccessibleDescription(fr.errors.rank_above_total);
  // The time is fine: not marked.
  await expect.element(hours(screen)).toHaveAttribute("aria-invalid", "false");
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(rank(screen).element());
  });
  // The error is under the rank, and the dialog stays open with what was typed.
  expect(rank(screen).element().compareDocumentPosition(alert.element())).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(note(screen).element().compareDocumentPosition(alert.element())).toBe(
    Node.DOCUMENT_POSITION_PRECEDING,
  );
  expect(onClose).not.toHaveBeenCalled();
  await expect.element(rank(screen)).toHaveValue(400);
  await expect.element(hours(screen)).toHaveValue(4);
  await expect.element(save(screen)).not.toHaveAttribute("aria-disabled");
});

test("ResultDialog — l'erreur d'un temps s'affiche sous le temps, dont les heures prennent le focus", async () => {
  mocks.update.mockRejectedValue(refused({ finish_time_s: "validation_min_text_constraint" }));
  const { screen } = await renderDialog();
  await minutes(screen).fill("42");
  await rank(screen).fill("12");

  await save(screen).click();

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent(fr.errors.validation_min_text_constraint);
  for (const part of [hours(screen), minutes(screen), seconds(screen)]) {
    await expect.element(part).toHaveAttribute("aria-invalid", "true");
    await expect
      .element(part)
      .toHaveAccessibleDescription(fr.errors.validation_min_text_constraint);
  }
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(hours(screen).element());
  });
});

test("ResultDialog — l'erreur d'une note s'affiche sous la note, qui prend le focus", async () => {
  mocks.update.mockRejectedValue(refused({ result_note: "validation_max_text_constraint" }));
  const { screen } = await renderDialog();
  await note(screen).fill("trop long");

  await save(screen).click();

  await expect
    .element(note(screen))
    .toHaveAccessibleDescription(
      `${fr.results.noteHint} ${fr.errors.validation_max_text_constraint}`,
    );
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(note(screen).element());
  });
});

test("ResultDialog — un refus qui ne vise pas un champ s'affiche au-dessus des boutons, et le bouton garde le focus", async () => {
  mocks.update.mockRejectedValue(
    new ClientResponseError({
      status: 403,
      response: { status: 403, message: "…", data: { code: "forbidden" } },
    }),
  );
  const { screen, onClose } = await renderDialog();
  const submit = buttonOf(save(screen));

  clickTwice(submit);

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.forbidden);
  await expectAvailable(submit);
  expect(onClose).not.toHaveBeenCalled();
});

test("ResultDialog — pendant l'envoi le bouton se dit occupé sans perdre le focus, et un double envoi n'envoie qu'une fois", async () => {
  const pending = Promise.withResolvers<unknown>();
  mocks.update.mockReturnValueOnce(pending.promise);
  const { screen, onClose } = await renderDialog();
  await minutes(screen).fill("42");
  const submit = buttonOf(save(screen));

  clickTwice(submit);

  await expectBusy(submit);
  expect(mocks.update).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();

  pending.resolve({ id: "p1" });
  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce();
  });
  expect(mocks.update).toHaveBeenCalledTimes(1);
});

test("ResultDialog — préremplit un résultat existant", async () => {
  const { screen } = await renderDialog({ participation: finished });

  await expect.element(status(screen)).toHaveValue("finished");
  await expect.element(hours(screen)).toHaveValue(4);
  await expect.element(minutes(screen)).toHaveValue(12);
  await expect.element(seconds(screen)).toHaveValue(30);
  await expect.element(rank(screen)).toHaveValue(12);
  await expect.element(rankOf(screen)).toHaveValue(340);
  await expect.element(note(screen)).toHaveValue("3e V1H");
});

test("ResultDialog — un abandon existant montre sa note, sans temps", async () => {
  const dnf: ParticipationRecord = { ...p1, status: "dnf", result_note: "abandon au km 30" };
  const { screen } = await renderDialog({ participation: dnf });

  await expect.element(status(screen)).toHaveValue("dnf");
  await expect.element(note(screen)).toHaveValue("abandon au km 30");
  await expect.element(hours(screen)).not.toBeInTheDocument();
});

test("ResultDialog — un résultat que le serveur envoie à zéro laisse les champs vides", async () => {
  // PocketBase sends 0 for a number that is not set, and "" for a text.
  const empty: ParticipationRecord = {
    ...p1,
    status: "finished",
    finish_time_s: 0,
    rank: 0,
    rank_of: 0,
    result_note: "",
  };
  const { screen } = await renderDialog({ participation: empty });

  await expect.element(hours(screen)).toHaveValue(null);
  await expect.element(rank(screen)).toHaveValue(null);
  await expect.element(rankOf(screen)).toHaveValue(null);
  await expect.element(note(screen)).toHaveValue("");
});

test("ResultDialog — le statut de départ : initialStatus, sinon le statut s'il est Terminé ou Abandon, sinon Terminé", async () => {
  const fromInitial = await renderDialog({ initialStatus: "dnf" });
  await expect.element(status(fromInitial.screen)).toHaveValue("dnf");
  await fromInitial.screen.unmount();

  // initialStatus wins over the status the participation has.
  const over = await renderDialog({ participation: finished, initialStatus: "dnf" });
  await expect.element(status(over.screen)).toHaveValue("dnf");
  await over.screen.unmount();

  const dnf = await renderDialog({ participation: { ...p1, status: "dnf" } });
  await expect.element(status(dnf.screen)).toHaveValue("dnf");
  await dnf.screen.unmount();

  for (const other of ["interested", "registered", "dns"] as const) {
    const shown = await renderDialog({ participation: { ...p1, status: other } });
    await expect.element(status(shown.screen)).toHaveValue("finished");
    await shown.screen.unmount();
  }
});

test("ResultDialog — le statut ne propose que Terminé et Abandon", async () => {
  const { screen } = await renderDialog();

  const select = status(screen).element();
  if (!(select instanceof HTMLSelectElement)) throw new Error("not a select");
  expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
    fr.status.finished,
    fr.status.dnf,
  ]);
});

test("ResultDialog — le classement et le nombre sont des nombres d'au moins 1, la note de 200 caractères au plus", async () => {
  const { screen } = await renderDialog();

  for (const field of [rank(screen), rankOf(screen)]) {
    await expect.element(field).toHaveAttribute("type", "number");
    await expect.element(field).toHaveAttribute("min", "1");
    await expect.element(field).toHaveAttribute("step", "1");
  }
  const text = note(screen).element();
  expect(text.tagName).toBe("TEXTAREA");
  await expect.element(note(screen)).toHaveAttribute("maxlength", "200");
  // The hint is read with the field.
  await expect.element(note(screen)).toHaveAccessibleDescription(fr.results.noteHint);
});

test("ResultDialog — les champs et les boutons font au moins 44 px", async () => {
  const { screen } = await renderDialog();

  for (const control of [
    status(screen),
    hours(screen),
    minutes(screen),
    seconds(screen),
    rank(screen),
    rankOf(screen),
    note(screen),
    save(screen),
    screen.getByRole("button", { name: fr.common.cancel }),
  ]) {
    expect(control.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
});

test("ResultDialog — Annuler ferme sans rien envoyer", async () => {
  const { screen, onClose } = await renderDialog();
  await minutes(screen).fill("42");

  await screen.getByRole("button", { name: fr.common.cancel }).click();

  expect(onClose).toHaveBeenCalledOnce();
  expect(mocks.update).not.toHaveBeenCalled();
});

test("ResultDialog — onSaved prévient l'appelant à la place de onClose, quand le résultat est enregistré", async () => {
  const { screen, onClose, onSaved, onGone } = await renderDialog({ withCallbacks: true });
  await minutes(screen).fill("42");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(onSaved).toHaveBeenCalledOnce();
  });
  expect(onClose).not.toHaveBeenCalled();
  expect(onGone).not.toHaveBeenCalled();
});

test("ResultDialog — une participation introuvable (404) le dit dans un message, rafraîchit les listes et prévient l'appelant par onGone", async () => {
  mocks.update.mockRejectedValue(
    new ClientResponseError({
      status: 404,
      response: { status: 404, message: "The requested resource wasn't found.", data: {} },
    }),
  );
  const { screen, onClose, onSaved, onGone, invalidate } = await renderDialog({
    withCallbacks: true,
  });
  await minutes(screen).fill("42");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(onGone).toHaveBeenCalledOnce();
  });
  // The message stays once the dialog is closed: it is a toast.
  await expect.element(screen.getByText(fr.errors.not_found)).toBeVisible();
  expect(onSaved).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(keys).toContainEqual(["events"]);
  expect(keys).toContainEqual(["event", "event"]);
});

test("ResultDialog — en anglais : Time, Rank, Number of finishers, Note", async () => {
  const { screen } = await renderDialog({ participation: finished, languages: ["en"] });

  await expect.element(screen.getByLabelText("Time, hours")).toHaveValue(4);
  await expect.element(screen.getByLabelText("Rank", { exact: true })).toHaveValue(12);
  await expect.element(screen.getByLabelText("Number of finishers")).toHaveValue(340);
  await expect.element(screen.getByLabelText("Note", { exact: true })).toHaveValue("3e V1H");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeVisible();
});
