import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import { ToastProvider } from "../../components/Toast";
import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";
import { buttonOf, clickTwice, expectAvailable, expectBusy } from "../../test/busyButton";
import type { Me } from "../participations/permissions";
import { CommentsSection } from "./CommentsSection";

// The tap targets and the white space of the text are a matter of the styles,
// which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  list: vi.fn<(options: Rec) => Promise<unknown>>(),
  create: vi.fn<(body: Rec) => Promise<unknown>>(),
  update: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
  remove: vi.fn<(id: string) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    filter: (raw: string, params: Rec) => `${raw} ${JSON.stringify(params)}`,
    collection: (name: string) =>
      ({
        comments: {
          getFullList: mocks.list,
          create: mocks.create,
          update: mocks.update,
          delete: mocks.remove,
        },
      })[name],
  },
}));

beforeAll(async () => {
  await ensureTemporal();
});

const base = { created: "", updated: "", collectionId: "", collectionName: "" };
const alice = { ...base, id: "aliceRunner0000", name: "Alice", user: "u-alice" };
const bob = { ...base, id: "bobRunner000000", name: "Bob", user: "u-bob" };
const admin = { ...base, id: "adminRunner0000", name: "Admin", user: "u-admin" };

const meAlice: Me = { userId: "u-alice", runnerId: alice.id, isAdmin: false };
const meBob: Me = { userId: "u-bob", runnerId: bob.id, isAdmin: false };
const meAdmin: Me = { userId: "u-admin", runnerId: admin.id, isAdmin: true };

/** 12:00 in Paris on the 1st of November 2026. */
const NOW = "2026-11-01T11:00:00Z";

/** A comment as the server sends it, with its author expanded. */
function comment(
  id: string,
  author: typeof alice,
  body: string,
  created: string,
  updated = created,
) {
  return {
    ...base,
    collectionName: "comments",
    id,
    event: "event1",
    author: author.id,
    body,
    created,
    updated,
    expand: { author },
  };
}

/** Two hours ago, by Alice. */
const first = comment("c1", alice, "Je viens avec Paul.", "2026-11-01 09:00:00.000Z");
/** Five minutes ago, by Bob, and edited two minutes later. */
const second = comment(
  "c2",
  bob,
  "Moi aussi !",
  "2026-11-01 10:55:00.000Z",
  "2026-11-01 10:57:00.000Z",
);

/**
 * What the server holds: a request for the list gives it, a creation, an
 * edit or a deletion changes it, like the real thing.
 */
let rows: ReturnType<typeof comment>[];

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  rows = [first, second];
  mocks.list.mockImplementation(() => Promise.resolve(rows));
  mocks.create.mockImplementation((body) => {
    const row = comment("new", alice, String(body.body), "2026-11-01 11:00:00.000Z");
    rows = [...rows, row];
    return Promise.resolve(row);
  });
  mocks.update.mockImplementation((id, body) => {
    rows = rows.map((row) =>
      row.id === id
        ? { ...row, body: String(body.body), updated: "2026-11-01 11:00:00.000Z" }
        : row,
    );
    return Promise.resolve({});
  });
  mocks.remove.mockImplementation((id) => {
    rows = rows.filter((row) => row.id !== id);
    return Promise.resolve(true);
  });
});

const clock = () => Temporal.Instant.from(NOW);

async function renderSection(options: { me?: Me | null; languages?: string[] } = {}) {
  const { me = meAlice, languages = ["fr"] } = options;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        <TodayProvider value={Temporal.PlainDate.from("2026-11-01")} now={clock}>
          <ToastProvider>
            <CommentsSection eventId="event1" me={me} />
          </ToastProvider>
        </TodayProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { screen, queryClient };
}

type Screen = Awaited<ReturnType<typeof renderSection>>["screen"];

// Intl separates a number from its unit with a no-break space: tests read the
// text as it looks.
const plain = (s: string | null) => (s ?? "").replace(/\p{Zs}/gu, " ");

const heading = (screen: Screen, n: number) =>
  screen.getByRole("heading", { level: 2, name: fr.comments.title(n) });
/** The comment of an author: the item of the list that has their name on a line of its own. */
const item = (screen: Screen, author: string) =>
  screen.getByRole("listitem").filter({ has: page.getByText(author, { exact: true }) });
const field = (screen: Screen) => screen.getByLabelText(fr.comments.newLabel);
const send = (screen: Screen) => screen.getByRole("button", { name: fr.comments.send });

/** What the SDK throws for the 400 of a record whose `body` is invalid. */
function bodyError(code: string): ClientResponseError {
  return new ClientResponseError({
    status: 400,
    response: {
      status: 400,
      message: "Failed to create record.",
      data: { body: { code, message: "…" } },
    },
  });
}

/** What the SDK throws for a comment that is not there any more (deleted by somebody else). */
function notFound(): ClientResponseError {
  return new ClientResponseError({
    status: 404,
    response: { status: 404, message: "The requested resource wasn't found.", data: {} },
  });
}

// --- The list ---

describe("the list", () => {
  test("CommentsSection — du plus ancien au plus récent, avec auteur, date relative et « modifié »", async () => {
    const { screen } = await renderSection();

    await expect.element(heading(screen, 2)).toBeVisible();
    const names = screen
      .getByRole("listitem")
      .elements()
      .map((li) => li.querySelector("p")?.textContent);
    expect(names).toEqual(["Alice", "Bob"]);
    // The server sorts: the page asks for the event, by creation, with the author.
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.stringContaining("event1"),
        sort: "created",
        expand: "author",
      }),
    );

    const one = item(screen, "Alice");
    await expect.element(one.getByText("Je viens avec Paul.")).toBeVisible();
    const when = one.getByText("il y a 2 heures");
    await expect.element(when).toBeVisible();
    const time = when.element();
    expect(time.tagName).toBe("TIME");
    expect(time.getAttribute("datetime")).toBe("2026-11-01T09:00:00Z");
    // The full date, in Paris time, in the tooltip.
    expect(plain(time.getAttribute("title"))).toBe("1 novembre 2026 à 10:00");
    await expect.element(one.getByText(fr.comments.edited)).not.toBeInTheDocument();

    const two = item(screen, "Bob");
    await expect.element(two.getByText("il y a 5 minutes")).toBeVisible();
    await expect.element(two.getByText(fr.comments.edited)).toBeVisible();
  });

  test("CommentsSection — « modifié » seulement si updated dépasse created de plus d'une seconde : 1 ms d'écart (deux lectures d'horloge) n'est pas une modification", async () => {
    rows = [
      comment(
        "c3",
        alice,
        "Tout juste écrit",
        "2026-11-01 10:59:59.999Z",
        "2026-11-01 11:00:00.000Z",
      ),
    ];

    const { screen } = await renderSection();

    await expect.element(screen.getByText("Tout juste écrit")).toBeVisible();
    await expect.element(screen.getByText(fr.comments.edited)).not.toBeInTheDocument();
  });

  test("CommentsSection — le texte s'affiche tel quel, balises comprises, avec ses retours à la ligne", async () => {
    rows = [comment("c4", bob, "<b>gras</b>\nligne 2", "2026-11-01 10:00:00.000Z")];

    const { screen } = await renderSection();

    const text = screen.getByText(/gras/);
    await expect.element(text).toBeVisible();
    const element = text.element();
    // The tags are read as text: nothing was turned into an element.
    expect(element.textContent).toBe("<b>gras</b>\nligne 2");
    expect(element.querySelector("b")).toBeNull();
    expect(screen.container.querySelector("b")).toBeNull();
    // And the line break stays on the page.
    expect(getComputedStyle(element).whiteSpace).toBe("pre-wrap");
  });

  test("CommentsSection — sans commentaire, elle le dit", async () => {
    rows = [];

    const { screen } = await renderSection();

    await expect.element(heading(screen, 0)).toBeVisible();
    await expect.element(screen.getByText(fr.comments.empty)).toBeVisible();
    expect(screen.getByRole("listitem").elements()).toHaveLength(0);
  });

  test("CommentsSection — en anglais, les textes et les dates suivent la langue", async () => {
    const { screen } = await renderSection({ languages: ["en-GB"] });

    await expect
      .element(screen.getByRole("heading", { level: 2, name: "Comments (2)" }))
      .toBeVisible();
    await expect.element(screen.getByText("2 hours ago")).toBeVisible();
    await expect.element(screen.getByText(en.comments.edited)).toBeVisible();
    await expect.element(screen.getByLabelText("Your comment")).toBeVisible();
    await expect.element(screen.getByText("Ctrl+Enter to send")).toBeVisible();
  });

  test("CommentsSection — pendant le chargement elle le dit, et sur une erreur elle le dit et se retente", async () => {
    // The title is there from the start, with no count (it is not known yet): the section does not appear from nowhere.
    mocks.list.mockReturnValueOnce(new Promise(() => {}));
    const { screen } = await renderSection();
    const loadingSection = screen.getByRole("region", { name: fr.comments.heading });
    await expect.element(loadingSection).toBeVisible();
    await expect.element(loadingSection.getByText(fr.common.loading)).toBeVisible();
    await expect.element(screen.getByLabelText(fr.comments.newLabel)).not.toBeInTheDocument();
    await screen.unmount();

    mocks.list.mockReset();
    mocks.list.mockRejectedValueOnce(new Error("boom"));
    const retried = await renderSection();
    const failedSection = retried.screen.getByRole("region", { name: fr.comments.heading });
    await expect.element(failedSection).toBeVisible();
    await expect.element(failedSection.getByRole("alert")).toHaveTextContent(fr.errors.generic);
    mocks.list.mockImplementation(() => Promise.resolve(rows));

    await failedSection.getByRole("button", { name: fr.common.retry }).click();

    // The same section now has its count.
    await expect.element(heading(retried.screen, 2)).toBeVisible();
    await expect.element(retried.screen.getByRole("alert")).not.toBeInTheDocument();
  });
});

// --- Writing ---

describe("writing", () => {
  test("CommentsSection — Envoyer et Ctrl+Entrée créent le commentaire, le champ se vide et garde le focus", async () => {
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();
    // The hint is the description of the field.
    await expect.element(field(screen)).toHaveAccessibleDescription(fr.comments.sendHint);

    // With the button: the text is sent as it is written, the field empties, the button keeps the focus.
    await field(screen).fill("On covoiture ?");
    await send(screen).click();

    await expect.element(heading(screen, 3)).toBeVisible();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenLastCalledWith({ event: "event1", body: "On covoiture ?" });
    await expect.element(screen.getByText("On covoiture ?")).toBeVisible();
    await expect.element(field(screen)).toHaveValue("");
    await expect.element(send(screen)).toHaveFocus();

    // With Ctrl+Enter, then Cmd+Enter: the field is not left.
    await field(screen).fill("Deuxième");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");

    await expect.element(heading(screen, 4)).toBeVisible();
    expect(mocks.create).toHaveBeenLastCalledWith({ event: "event1", body: "Deuxième" });
    await expect.element(field(screen)).toHaveValue("");
    await expect.element(field(screen)).toHaveFocus();

    await field(screen).fill("Troisième");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");

    await expect.element(heading(screen, 5)).toBeVisible();
    expect(mocks.create).toHaveBeenLastCalledWith({ event: "event1", body: "Troisième" });
    await expect.element(field(screen)).toHaveFocus();
    expect(mocks.create).toHaveBeenCalledTimes(3);
  });

  test("CommentsSection — Entrée seule va à la ligne, elle n'envoie pas", async () => {
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();

    await field(screen).fill("ligne 1");
    await userEvent.keyboard("{Enter}ligne 2");

    await expect.element(field(screen)).toHaveValue("ligne 1\nligne 2");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test("CommentsSection — un double envoi n'en crée qu'un", async () => {
    const pending = Promise.withResolvers<unknown>();
    mocks.create.mockReturnValue(pending.promise);
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();
    await field(screen).fill("Une seule fois");

    // Two clicks in the same tick, as a double tap does, then the keyboard: all while the first is on its way.
    const button = buttonOf(send(screen));
    button.click();
    button.click();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");

    // The button says it is busy, and it is not disabled: it keeps the focus.
    await expect.element(send(screen)).toHaveAttribute("aria-disabled", "true");
    expect(buttonOf(send(screen)).disabled).toBe(false);
    expect(mocks.create).toHaveBeenCalledTimes(1);

    // The request is done: the field is empty, and a new text can go.
    pending.resolve({ id: "new" });
    await expect.element(field(screen)).toHaveValue("");
    await expect.element(send(screen)).not.toHaveAttribute("aria-disabled", "true");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  test("CommentsSection — le bouton garde le focus pendant l'envoi", async () => {
    const pending = Promise.withResolvers<unknown>();
    mocks.create.mockReturnValue(pending.promise);
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();
    await field(screen).fill("Patience");

    await send(screen).click();

    await expect.element(send(screen)).toHaveAttribute("aria-disabled", "true");
    await expect.element(send(screen)).toHaveFocus();
    pending.resolve({ id: "new" });
    await expect.element(send(screen)).not.toHaveAttribute("aria-disabled", "true");
    await expect.element(send(screen)).toHaveFocus();
  });

  test("CommentsSection — un texte vide n'est pas envoyé", async () => {
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();

    await send(screen).click();
    await field(screen).fill("  \n \t ");
    await send(screen).click();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");

    expect(mocks.create).not.toHaveBeenCalled();
  });

  test("CommentsSection — le texte envoyé n'a plus d'espaces autour", async () => {
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();

    await field(screen).fill("  Bonjour  \n");
    await send(screen).click();

    await expect.element(heading(screen, 3)).toBeVisible();
    expect(mocks.create).toHaveBeenCalledWith({ event: "event1", body: "Bonjour" });
  });

  test("CommentsSection — un refus du serveur est traduit", async () => {
    mocks.create.mockRejectedValueOnce(bodyError("validation_max_text_constraint"));
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();
    await field(screen).fill("x".repeat(2001));

    await send(screen).click();

    await expect.element(screen.getByRole("alert")).toHaveTextContent("Ce texte est trop long.");
    // The text is still there to be shortened, and the button is available again.
    await expect.element(field(screen)).toHaveValue("x".repeat(2001));
    await expect.element(field(screen)).toHaveAttribute("aria-invalid", "true");
    await expect.element(send(screen)).not.toHaveAttribute("aria-disabled", "true");
    expect(mocks.create).toHaveBeenCalledTimes(1);

    // Another try goes through, and the message goes away.
    await field(screen).fill("Plus court");
    await send(screen).click();

    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
    await expect.element(heading(screen, 3)).toBeVisible();
  });

  test("CommentsSection — un refus inconnu donne le message générique", async () => {
    mocks.create.mockRejectedValueOnce(new Error("boom"));
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();
    await field(screen).fill("Bonjour");

    await send(screen).click();

    await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  });

  test("CommentsSection — sans coureur connu, on lit mais on n'écrit pas", async () => {
    const { screen } = await renderSection({ me: null });

    await expect.element(heading(screen, 2)).toBeVisible();
    await expect.element(screen.getByText("Je viens avec Paul.")).toBeVisible();
    await expect.element(screen.getByLabelText(fr.comments.newLabel)).not.toBeInTheDocument();
    await expect.element(screen.getByRole("button")).not.toBeInTheDocument();
  });
});

// --- Editing and deleting ---

const edit = (screen: Screen, author: string) =>
  item(screen, author).getByRole("button", { name: fr.comments.edit });
const remove = (screen: Screen, author: string) =>
  item(screen, author).getByRole("button", { name: fr.comments.remove });

describe("editing and deleting", () => {
  test("CommentsSection — Modifier et Supprimer seulement pour l'auteur ; Supprimer aussi pour un admin", async () => {
    // Alice: her own comment, not Bob's.
    const alicePage = await renderSection({ me: meAlice });
    await expect.element(heading(alicePage.screen, 2)).toBeVisible();
    await expect.element(edit(alicePage.screen, "Alice")).toBeVisible();
    await expect.element(remove(alicePage.screen, "Alice")).toBeVisible();
    await expect.element(edit(alicePage.screen, "Bob")).not.toBeInTheDocument();
    await expect.element(remove(alicePage.screen, "Bob")).not.toBeInTheDocument();
    await alicePage.screen.unmount();

    // Bob, the other way round.
    const bobPage = await renderSection({ me: meBob });
    await expect.element(heading(bobPage.screen, 2)).toBeVisible();
    await expect.element(edit(bobPage.screen, "Bob")).toBeVisible();
    await expect.element(remove(bobPage.screen, "Bob")).toBeVisible();
    await expect.element(edit(bobPage.screen, "Alice")).not.toBeInTheDocument();
    await expect.element(remove(bobPage.screen, "Alice")).not.toBeInTheDocument();
    await bobPage.screen.unmount();

    // The admin deletes any comment, and edits none.
    const adminPage = await renderSection({ me: meAdmin });
    await expect.element(heading(adminPage.screen, 2)).toBeVisible();
    await expect.element(remove(adminPage.screen, "Alice")).toBeVisible();
    await expect.element(remove(adminPage.screen, "Bob")).toBeVisible();
    await expect.element(edit(adminPage.screen, "Alice")).not.toBeInTheDocument();
    await expect.element(edit(adminPage.screen, "Bob")).not.toBeInTheDocument();
  });

  test("CommentsSection — modifier envoie le nouveau texte ; Annuler rend le focus", async () => {
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();

    // Cancelling: the text is a field with the text so far, which has the focus.
    await edit(screen, "Alice").click();
    const editor = item(screen, "Alice").getByLabelText(fr.comments.editLabel);
    await expect.element(editor).toHaveValue("Je viens avec Paul.");
    await expect.element(editor).toHaveFocus();
    // Its name is not the one of the button that opened it.
    await expect.element(editor).toHaveAccessibleName(fr.comments.editLabel);
    await editor.fill("Je ne viens plus.");
    await item(screen, "Alice").getByRole("button", { name: fr.comments.cancel }).click();

    expect(mocks.update).not.toHaveBeenCalled();
    await expect.element(item(screen, "Alice").getByText("Je viens avec Paul.")).toBeVisible();
    await expect.element(edit(screen, "Alice")).toHaveFocus();

    // Saving: the new text goes, and is the one that is shown, with « modifié ».
    await edit(screen, "Alice").click();
    await item(screen, "Alice")
      .getByLabelText(fr.comments.editLabel)
      .fill("  Je viens avec Paul et Julie.  ");
    await item(screen, "Alice").getByRole("button", { name: fr.comments.save }).click();

    await expect
      .element(item(screen, "Alice").getByText("Je viens avec Paul et Julie."))
      .toBeVisible();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith("c1", { body: "Je viens avec Paul et Julie." });
    await expect.element(item(screen, "Alice").getByText(fr.comments.edited)).toBeVisible();
    await expect
      .element(item(screen, "Alice").getByLabelText(fr.comments.editLabel))
      .not.toBeInTheDocument();
    await expect.element(edit(screen, "Alice")).toHaveFocus();
  });

  test("CommentsSection — enregistrer sans changement ne demande rien au serveur, et un texte vide n'est pas enregistré", async () => {
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();

    await edit(screen, "Alice").click();
    await item(screen, "Alice").getByRole("button", { name: fr.comments.save }).click();
    await expect
      .element(item(screen, "Alice").getByLabelText(fr.comments.editLabel))
      .not.toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();

    await edit(screen, "Alice").click();
    await item(screen, "Alice").getByLabelText(fr.comments.editLabel).fill("   ");
    await item(screen, "Alice").getByRole("button", { name: fr.comments.save }).click();
    // Still editing: the empty text was not sent, and the field says why.
    await expect.element(item(screen, "Alice").getByLabelText(fr.comments.editLabel)).toBeVisible();
    await expect
      .element(item(screen, "Alice").getByRole("alert"))
      .toHaveTextContent(fr.errors.validation_required);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test("CommentsSection — Ctrl+Entrée enregistre une modification", async () => {
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();

    await edit(screen, "Alice").click();
    await item(screen, "Alice").getByLabelText(fr.comments.editLabel).fill("Corrigé");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");

    await expect.element(item(screen, "Alice").getByText("Corrigé")).toBeVisible();
    expect(mocks.update).toHaveBeenCalledWith("c1", { body: "Corrigé" });
  });

  test("CommentsSection — un refus du serveur à la modification est traduit, et le champ reste ouvert", async () => {
    mocks.update.mockRejectedValueOnce(bodyError("validation_max_text_constraint"));
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();

    await edit(screen, "Alice").click();
    await item(screen, "Alice").getByLabelText(fr.comments.editLabel).fill("x".repeat(2001));
    await item(screen, "Alice").getByRole("button", { name: fr.comments.save }).click();

    await expect
      .element(item(screen, "Alice").getByRole("alert"))
      .toHaveTextContent("Ce texte est trop long.");
    await expect.element(item(screen, "Alice").getByLabelText(fr.comments.editLabel)).toBeVisible();
  });

  test("CommentsSection — supprimer demande confirmation, puis le focus va sur le titre", async () => {
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();

    // Cancelling the confirmation deletes nothing and gives the focus back to the button.
    await remove(screen, "Alice").click();
    const dialog = screen.getByRole("dialog", { name: fr.comments.removeConfirm });
    await expect.element(dialog).toBeVisible();
    expect(mocks.remove).not.toHaveBeenCalled();
    await dialog.getByRole("button", { name: fr.comments.cancel }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(mocks.remove).not.toHaveBeenCalled();
    await expect.element(remove(screen, "Alice")).toHaveFocus();

    // Confirming: the comment goes, and the focus is on the title, never on the page.
    await remove(screen, "Alice").click();
    await dialog.getByRole("button", { name: fr.comments.remove }).click();

    await expect.element(heading(screen, 1)).toBeVisible();
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith("c1");
    await expect.element(screen.getByText("Je viens avec Paul.")).not.toBeInTheDocument();
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(heading(screen, 1)).toHaveFocus();
  });

  test("CommentsSection — Supprimer, dans la fenêtre, garde le focus pendant l'envoi et après un refus, et un double envoi ne supprime qu'une fois", async () => {
    const pending = Promise.withResolvers<unknown>();
    mocks.remove.mockReturnValueOnce(pending.promise);
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();
    await remove(screen, "Alice").click();
    const dialog = screen.getByRole("dialog", { name: fr.comments.removeConfirm });
    const confirm = buttonOf(dialog.getByRole("button", { name: fr.comments.remove }));

    clickTwice(confirm);

    await expectBusy(confirm);
    expect(mocks.remove).toHaveBeenCalledTimes(1);

    pending.reject(new Error("boom"));
    await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.generic);
    await expectAvailable(confirm);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  test("CommentsSection — l'admin supprime le commentaire d'un autre", async () => {
    const { screen } = await renderSection({ me: meAdmin });
    await expect.element(heading(screen, 2)).toBeVisible();

    await remove(screen, "Bob").click();
    await screen
      .getByRole("dialog", { name: fr.comments.removeConfirm })
      .getByRole("button", { name: fr.comments.remove })
      .click();

    await expect.element(heading(screen, 1)).toBeVisible();
    expect(mocks.remove).toHaveBeenCalledWith("c2");
  });

  test("CommentsSection — un refus du serveur à la suppression est traduit, et la fenêtre reste ouverte", async () => {
    mocks.remove.mockRejectedValueOnce(new Error("boom"));
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();

    await remove(screen, "Alice").click();
    const dialog = screen.getByRole("dialog", { name: fr.comments.removeConfirm });
    await dialog.getByRole("button", { name: fr.comments.remove }).click();

    await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.generic);
    await expect.element(screen.getByText("Je viens avec Paul.")).toBeVisible();
  });
});

describe("a comment that is gone, or a server that does not answer", () => {
  test("CommentsSection — modifier un commentaire que quelqu'un a supprimé : la liste se rafraîchit, le toast le dit, le focus va au titre", async () => {
    mocks.update.mockImplementationOnce(() => {
      rows = rows.filter((row) => row.id !== "c1");
      return Promise.reject(notFound());
    });
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();
    await edit(screen, "Alice").click();
    await item(screen, "Alice").getByLabelText(fr.comments.editLabel).fill("Corrigé");

    await item(screen, "Alice").getByRole("button", { name: fr.comments.save }).click();

    // The list was asked for again: the comment is gone, and the text field with it.
    await expect.element(heading(screen, 1)).toBeVisible();
    await expect.element(screen.getByText("Je viens avec Paul.")).not.toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledTimes(2);
    // The message is the translated one, and the focus is on the title, never on the page.
    await expect.element(screen.getByText(fr.errors.not_found)).toBeVisible();
    await expect.element(heading(screen, 1)).toHaveFocus();
  });

  test("CommentsSection — supprimer un commentaire déjà supprimé : la liste se rafraîchit, la fenêtre le dit", async () => {
    mocks.remove.mockImplementationOnce(() => {
      rows = rows.filter((row) => row.id !== "c1");
      return Promise.reject(notFound());
    });
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();

    await remove(screen, "Alice").click();
    const dialog = screen.getByRole("dialog", { name: fr.comments.removeConfirm });
    await dialog.getByRole("button", { name: fr.comments.remove }).click();

    await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.not_found);
    // The comment is not on the page any more, whoever deleted it.
    await expect.element(heading(screen, 1)).toBeVisible();
    await expect.element(screen.getByText("Je viens avec Paul.")).not.toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledTimes(2);
    // Closing the window: its button is gone, the title has the focus.
    await dialog.getByRole("button", { name: fr.comments.cancel }).click();
    await expect.element(heading(screen, 1)).toHaveFocus();
  });

  test("CommentsSection — un refus qui change la liste (400) la rafraîchit aussi, et le champ reste ouvert", async () => {
    mocks.update.mockRejectedValueOnce(bodyError("validation_max_text_constraint"));
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();
    await edit(screen, "Alice").click();
    await item(screen, "Alice").getByLabelText(fr.comments.editLabel).fill("x".repeat(2001));

    await item(screen, "Alice").getByRole("button", { name: fr.comments.save }).click();

    await expect
      .element(item(screen, "Alice").getByRole("alert"))
      .toHaveTextContent("Ce texte est trop long.");
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  test("CommentsSection — un serveur qui ne répond pas : le refus est dit sans attendre la relecture de la liste", async () => {
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();
    // The list cannot be read again for a while (the client retries): the refusal does not wait for it.
    mocks.list.mockReturnValue(new Promise(() => {}));
    mocks.update.mockRejectedValueOnce(new Error("boom"));
    mocks.remove.mockRejectedValueOnce(new ClientResponseError({ status: 500, response: {} }));

    await edit(screen, "Alice").click();
    await item(screen, "Alice").getByLabelText(fr.comments.editLabel).fill("Corrigé");
    await item(screen, "Alice").getByRole("button", { name: fr.comments.save }).click();
    await expect
      .element(item(screen, "Alice").getByRole("alert"))
      .toHaveTextContent(fr.errors.generic);
    await item(screen, "Alice").getByRole("button", { name: fr.comments.cancel }).click();

    await remove(screen, "Alice").click();
    const dialog = screen.getByRole("dialog", { name: fr.comments.removeConfirm });
    await dialog.getByRole("button", { name: fr.comments.remove }).click();
    await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.generic);
    // The list was asked for again all the same, in the background.
    expect(mocks.list).toHaveBeenCalledTimes(3);
  });
});

describe("tap targets", () => {
  test("CommentsSection — zones tactiles d'au moins 44 px", async () => {
    await page.viewport(390, 844);
    const { screen } = await renderSection();
    await expect.element(heading(screen, 2)).toBeVisible();

    const targets = [
      field(screen),
      send(screen),
      item(screen, "Alice").getByRole("button", { name: fr.comments.edit }),
      item(screen, "Alice").getByRole("button", { name: fr.comments.remove }),
    ];
    for (const target of targets) {
      const { width, height } = target.element().getBoundingClientRect();
      expect(width).toBeGreaterThanOrEqual(44);
      expect(height).toBeGreaterThanOrEqual(44);
    }
    await page.viewport(414, 896);
  });
});
