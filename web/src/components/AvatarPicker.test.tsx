import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { I18nProvider } from "../i18n/I18nProvider";
import type { RunnerRecord } from "../lib/types";
import { imageFile, pixelURL, sizeOf } from "../test/images";
import { AvatarPicker } from "./AvatarPicker";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  update: vi.fn<(id: string, body: unknown) => Promise<unknown>>(),
  getURL: vi.fn<(record: Rec, filename: string, options: Rec) => string>(),
}));

vi.mock("../lib/pb", () => ({
  pb: {
    collection: (name: string) => ({ runners: { update: mocks.update } })[name],
    files: { getURL: mocks.getURL },
  },
}));

const base = {
  created: "",
  updated: "",
  collectionId: "runners0000000",
  collectionName: "runners",
};
const alice: RunnerRecord = { ...base, id: "r1", name: "Alice", user: "u-alice", avatar: "" };
const withPhoto: RunnerRecord = { ...alice, avatar: "alice_k3j9x2.webp" };

beforeEach(() => {
  mocks.update.mockReset();
  mocks.update.mockResolvedValue({ id: "r1" });
  mocks.getURL.mockReset();
  mocks.getURL.mockImplementation(() => pixelURL());
});

function refusal(status: number, data: unknown) {
  return new ClientResponseError({ status, response: { status, message: "…", data } });
}

async function renderPicker(runner: RunnerRecord = alice, languages = ["fr"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        {/* No ToastProvider: the picker has no toast, and would throw without one if it had. */}
        <AvatarPicker runner={runner} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { screen, invalidate };
}

/** The file field, found by the text of the label around it. */
const picker = (
  screen: Awaited<ReturnType<typeof renderPicker>>["screen"],
  label = fr.avatar.change,
) => screen.getByLabelText(label, { exact: true });

/** What the update was given: the id of the runner and the form of the file. */
function sentForm(): { id: string; form: FormData } {
  const [id, form] = mocks.update.mock.calls[0] ?? [];
  if (typeof id !== "string" || !(form instanceof FormData)) {
    throw new Error("update was not called with an id and a FormData");
  }
  return { id, form };
}

test("AvatarPicker — choisir un fichier le réduit puis l'envoie : update(id, FormData) dont avatar est un WebP de 512 px au plus", async () => {
  const { screen, invalidate } = await renderPicker();

  await picker(screen).upload(await imageFile(2000, 1000));

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledOnce();
  });
  const { id, form } = sentForm();
  expect(id).toBe("r1");
  expect([...form.keys()]).toEqual(["avatar"]);
  const sent = form.get("avatar");
  if (!(sent instanceof File)) throw new Error("the form has no file");
  expect(sent.name).toBe("avatar.webp");
  expect(sent.type).toBe("image/webp");
  expect(await sizeOf(sent)).toEqual({ width: 512, height: 256 });
  // The photo is shown all over the app: every page reads again, as for a rename.
  await vi.waitFor(() => {
    expect(invalidate).toHaveBeenCalledWith();
  });
  // The live region says it, and only it: no toast says it a second time.
  await expect.element(screen.getByRole("status")).toHaveTextContent(fr.avatar.saved);
  const said = screen.getByText(fr.avatar.saved);
  await expect.element(said).toBeVisible();
  expect(said.element().tagName).toBe("OUTPUT");
});

test("AvatarPicker — la zone d'état et l'alerte existent avant toute action, vides, pour être annoncées", async () => {
  // A live region that comes into the page together with its text is often not
  // announced (VoiceOver, for one): both are there from the start, and empty.
  const { screen } = await renderPicker(withPhoto);

  await expect.element(screen.getByRole("status")).toBeInTheDocument();
  await expect.element(screen.getByRole("status")).toBeEmptyDOMElement();
  await expect.element(screen.getByRole("alert")).toBeInTheDocument();
  await expect.element(screen.getByRole("alert")).toBeEmptyDOMElement();
  // Empty, they take no room: the buttons are right under the photo.
  const photo = screen.container.querySelector("img")?.getBoundingClientRect();
  const buttons = screen.container.querySelector("label")?.getBoundingClientRect();
  expect((buttons?.top ?? 0) - (photo?.bottom ?? 0)).toBe(12);
});

test("AvatarPicker — l'alerte et l'état se relaient dans leurs zones, sans se superposer", async () => {
  mocks.update.mockRejectedValueOnce(
    refusal(400, { avatar: { code: "validation_file_size_limit", message: "…" } }),
  );
  const { screen } = await renderPicker();
  const file = await imageFile(800, 600);

  await picker(screen).upload(file);
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent(fr.errors.validation_file_size_limit);
  await expect.element(screen.getByRole("status")).toBeEmptyDOMElement();
  await picker(screen).upload(file);

  // The refusal goes away when the next try starts, and success takes its place.
  await expect.element(screen.getByRole("status")).toHaveTextContent(fr.avatar.saved);
  await expect.element(screen.getByRole("alert")).toBeEmptyDOMElement();
});

test("AvatarPicker — pendant la préparation, le dit, et un deuxième fichier n'est pas envoyé", async () => {
  mocks.update.mockReturnValue(new Promise(() => {}));
  const { screen } = await renderPicker();

  await picker(screen).upload(await imageFile(800, 600));

  await expect.element(screen.getByRole("status")).toHaveTextContent(fr.avatar.preparing);
  // Not disabled, which would drop the focus to the page: it ignores the file.
  await expect.element(picker(screen)).toHaveAttribute("aria-disabled", "true");
  await picker(screen).upload(await imageFile(640, 480));
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(mocks.update).toHaveBeenCalledOnce();
});

test("AvatarPicker — le même fichier peut être choisi de nouveau après un refus", async () => {
  mocks.update.mockRejectedValueOnce(
    refusal(400, { avatar: { code: "validation_file_size_limit" } }),
  );
  const { screen } = await renderPicker();
  const file = await imageFile(800, 600);

  await picker(screen).upload(file);
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent(fr.errors.validation_file_size_limit);
  await picker(screen).upload(file);

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });
});

test("AvatarPicker — une image illisible (HEIC) affiche t.avatar.decodeFailed et n'envoie rien", async () => {
  const { screen } = await renderPicker();
  const heic = new File(["ceci n'est pas une image"], "photo.heic", { type: "image/heic" });

  await picker(screen).upload(heic);

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.avatar.decodeFailed);
  expect(mocks.update).not.toHaveBeenCalled();
});

test("AvatarPicker — en anglais, l'image illisible est dite en anglais", async () => {
  const { screen } = await renderPicker(alice, ["en-GB"]);
  const heic = new File(["not an image"], "photo.heic", { type: "image/heic" });

  await picker(screen, en.avatar.change).upload(heic);

  await expect.element(screen.getByRole("alert")).toHaveTextContent(en.avatar.decodeFailed);
});

test("AvatarPicker — un refus du serveur (validation_file_size_limit) est traduit", async () => {
  mocks.update.mockRejectedValue(
    refusal(400, { avatar: { code: "validation_file_size_limit", message: "…" } }),
  );
  const { screen, invalidate } = await renderPicker();

  await picker(screen).upload(await imageFile(800, 600));

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent(fr.errors.validation_file_size_limit);
  // Nothing changed: nothing to read again, and no success.
  expect(invalidate).not.toHaveBeenCalled();
  await expect.element(screen.getByText(fr.avatar.saved)).not.toBeInTheDocument();
});

test("AvatarPicker — un échec sans code (le réseau) donne le message générique", async () => {
  mocks.update.mockRejectedValue(new ClientResponseError(new TypeError("Failed to fetch")));
  const { screen } = await renderPicker();

  await picker(screen).upload(await imageFile(800, 600));

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
});

test("AvatarPicker — « Retirer la photo » n'apparaît qu'avec une photo, et envoie {avatar: null}", async () => {
  const without = await renderPicker(alice);
  await expect.element(picker(without.screen)).toBeInTheDocument();
  await expect
    .element(without.screen.getByRole("button", { name: fr.avatar.remove }))
    .not.toBeInTheDocument();
  await without.screen.unmount();

  const { screen, invalidate } = await renderPicker(withPhoto);
  await screen.getByRole("button", { name: fr.avatar.remove }).click();

  await vi.waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("r1", { avatar: null });
  });
  await vi.waitFor(() => {
    expect(invalidate).toHaveBeenCalledWith();
  });
  await expect.element(screen.getByRole("status")).toHaveTextContent(fr.avatar.removed);
  // Said once, by the live region: no toast.
  await expect.element(screen.getByText(fr.avatar.removed)).toBeVisible();
  // The button goes away with the photo: the focus goes to the other control, not to the page.
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(picker(screen).element());
  });
});

test("AvatarPicker — un refus du retrait est dit", async () => {
  mocks.update.mockRejectedValue(refusal(404, { code: "not_found" }));
  const { screen } = await renderPicker(withPhoto);

  await screen.getByRole("button", { name: fr.avatar.remove }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.not_found);
});

test("AvatarPicker — montre la photo en 256x256, ou les initiales", async () => {
  const photo = await renderPicker(withPhoto);
  expect(photo.screen.container.querySelector("img")?.getAttribute("src")).toBe(pixelURL());
  expect(mocks.getURL).toHaveBeenCalledWith(withPhoto, "alice_k3j9x2.webp", { thumb: "256x256" });
  await photo.screen.unmount();

  const initials = await renderPicker(alice);
  await expect.element(initials.screen.getByText("A", { exact: true })).toBeVisible();
});

test("AvatarPicker — les boutons font au moins 44 px", async () => {
  const { screen } = await renderPicker(withPhoto);
  await expect.element(screen.getByRole("button", { name: fr.avatar.remove })).toBeVisible();

  // The file field is hidden from sight: the label around it is what is tapped.
  const targets = [...screen.container.querySelectorAll<HTMLElement>("button, label")];
  expect(targets.length).toBe(2);
  const tooSmall = targets
    .filter((element) => element.getBoundingClientRect().height < 44)
    .map((element) => element.outerHTML);

  expect(tooSmall).toEqual([]);
});

test("AvatarPicker — le champ fichier ne propose que des images et se laisse atteindre au clavier", async () => {
  const { screen } = await renderPicker();

  const input = picker(screen);
  await expect.element(input).toHaveAttribute("type", "file");
  await expect.element(input).toHaveAttribute("accept", "image/*");
  await expect.element(input).toHaveClass("sr-only");
});
