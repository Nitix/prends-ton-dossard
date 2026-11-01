import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ToastProvider } from "../../components/Toast";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { imageFile, pixelURL, sizeOf } from "../../test/images";
import { ProfilePage } from "./ProfilePage";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  store: { record: null as Rec | null, listeners: new Set<() => void>() },
  runner: { name: "Alice" },
  getFirstListItem: vi.fn<(filter: string) => Promise<unknown>>(),
  runnerUpdate: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
  userUpdate: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
  authWithPassword: vi.fn<(email: string, password: string) => Promise<unknown>>(),
  getFullList: vi.fn<(options: Rec) => Promise<unknown>>(),
  passkeyUpdate: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
  passkeyDelete: vi.fn<(id: string) => Promise<unknown>>(),
  send: vi.fn<(path: string, options: Rec) => Promise<unknown>>(),
  save: vi.fn<(token: string, record: Rec) => void>(),
  clear: vi.fn<() => void>(),
  registerPasskey: vi.fn<(name: string) => Promise<boolean>>(),
  passkeysSupported: vi.fn<() => boolean>(),
  getURL: vi.fn<(record: Rec, filename: string, options: Rec) => string>(),
}));

/** Replaces the signed-in record and tells the listeners, as the auth store of the SDK does. */
function setRecord(record: Rec | null) {
  mocks.store.record = record;
  for (const listener of mocks.store.listeners) listener();
}

vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: {
      // A new object on every read, like the SDK's LocalAuthStore.
      get record() {
        return mocks.store.record && { ...mocks.store.record };
      },
      onChange(listener: () => void) {
        mocks.store.listeners.add(listener);
        return () => mocks.store.listeners.delete(listener);
      },
      save(token: string, record: Rec) {
        mocks.save(token, record);
        setRecord(record);
      },
      clear() {
        mocks.clear();
      },
    },
    filter: (raw: string, params: Rec) => `${raw} ${JSON.stringify(params)}`,
    send: mocks.send,
    collection: (name: string) =>
      ({
        users: { update: mocks.userUpdate, authWithPassword: mocks.authWithPassword },
        runners: { getFirstListItem: mocks.getFirstListItem, update: mocks.runnerUpdate },
        passkeys: {
          getFullList: mocks.getFullList,
          update: mocks.passkeyUpdate,
          delete: mocks.passkeyDelete,
        },
      })[name],
    files: { getURL: mocks.getURL },
  },
}));

vi.mock("../auth/passkeys", () => ({
  registerPasskey: mocks.registerPasskey,
  passkeysSupported: mocks.passkeysSupported,
}));

const ALICE = {
  id: "u1",
  collectionName: "users",
  email: "alice@example.test",
  role: "member",
  updated: "2026-10-01 08:00:00.000Z",
};

const IPHONE = {
  id: "pk1",
  user: "u1",
  name: "iPhone",
  created: "2026-10-01 08:30:00.000Z",
  last_used_at: "2026-10-20 18:45:00.000Z",
};

// An empty date comes back from the API as an empty string.
const WORK_PC = {
  id: "pk2",
  user: "u1",
  name: "PC du boulot",
  created: "2026-10-05 09:00:00.000Z",
  last_used_at: "",
};

beforeEach(() => {
  for (const fn of Object.values(mocks)) {
    if (vi.isMockFunction(fn)) fn.mockReset();
  }
  mocks.store.listeners.clear();
  mocks.store.record = ALICE;
  mocks.runner.name = "Alice";

  mocks.getFirstListItem.mockImplementation(() =>
    Promise.resolve({ id: "r1", name: mocks.runner.name, user: "u1" }),
  );
  mocks.runnerUpdate.mockImplementation((_id, body) => {
    mocks.runner.name = String(body.name);
    return Promise.resolve({ id: "r1", name: body.name });
  });
  // The SDK saves the updated record in the auth store, with the same token.
  mocks.userUpdate.mockImplementation(() => {
    setRecord({ ...ALICE, updated: "2026-10-31 10:00:00.000Z" });
    return Promise.resolve(ALICE);
  });
  mocks.authWithPassword.mockResolvedValue({ token: "fresh-token", record: ALICE });
  mocks.getFullList.mockResolvedValue([IPHONE, WORK_PC]);
  mocks.passkeyUpdate.mockResolvedValue({});
  mocks.passkeyDelete.mockResolvedValue(true);
  mocks.registerPasskey.mockResolvedValue(true);
  mocks.passkeysSupported.mockReturnValue(true);
});

function refusal(status: number, data: unknown) {
  return new ClientResponseError({ status, response: { status, message: "…", data } });
}

/** How PocketBase reports the fields it refused. */
function fieldRefusal(field: string, code: string) {
  return refusal(400, { [field]: { code, message: "…" } });
}

async function renderProfile() {
  const screen = await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider languages={["fr"]}>
        <ToastProvider>
          <ProfilePage />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  // Once the runner is there, the name form is.
  await expect
    .element(screen.getByLabelText(fr.profile.name, { exact: true }))
    .toHaveValue("Alice");
  return screen;
}

type Screen = Awaited<ReturnType<typeof renderProfile>>;

/** A section of the page, by its heading. */
function section(screen: Screen, title: string) {
  return screen.getByRole("region", { name: title, exact: true });
}

/** The requests to the server, as far as the mocks tell them. */
const requests = [
  ["getFirstListItem", mocks.getFirstListItem],
  ["runnerUpdate", mocks.runnerUpdate],
  ["getFullList", mocks.getFullList],
  ["passkeyUpdate", mocks.passkeyUpdate],
  ["passkeyDelete", mocks.passkeyDelete],
  ["send", mocks.send],
] as const;

/** The requests made between the first call of `first` and the first call of `second`. */
function requestsBetween(first: { mock: { invocationCallOrder: number[] } }, second: typeof first) {
  const from = first.mock.invocationCallOrder[0] ?? Infinity;
  const to = second.mock.invocationCallOrder[0] ?? -Infinity;
  return requests.flatMap(([name, fn]) =>
    fn.mock.invocationCallOrder.filter((order) => from < order && order < to).map(() => name),
  );
}

// --- The page ---

test("ProfilePage — montre le nom, l'email actuel et les sections", async () => {
  const screen = await renderProfile();

  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.nav.profile }))
    .toBeVisible();
  await expect
    .element(section(screen, fr.profile.emailTitle).getByText(fr.profile.currentEmail(ALICE.email)))
    .toBeVisible();
  await expect.element(section(screen, fr.profile.nameTitle)).toBeVisible();
  await expect.element(section(screen, fr.profile.passwordTitle)).toBeVisible();
  await expect.element(section(screen, fr.passkeys.title)).toBeVisible();
});

test("ProfilePage — se déconnecter vide la session", async () => {
  const screen = await renderProfile();

  await screen.getByRole("button", { name: fr.profile.logout }).click();

  expect(mocks.clear).toHaveBeenCalledOnce();
});

test("ProfilePage — les boutons et les champs font au moins 44 px de haut", async () => {
  const screen = await renderProfile();
  await expect.element(screen.getByText(IPHONE.name)).toBeVisible();

  // The file field of the photo is hidden from sight: the label around it is the target.
  const tooSmall = [
    ...screen.container.querySelectorAll<HTMLElement>(
      "button, input:not([type=file]), label:has(input[type=file])",
    ),
  ]
    .filter((element) => element.getBoundingClientRect().height < 44)
    .map((element) => element.outerHTML);

  expect(tooSmall).toEqual([]);
});

// --- The photo ---

test("ProfilePage — la section Photo propose de changer ma photo, et pas de bouton tant que mon coureur charge", async () => {
  // The runner of the session is not there yet.
  mocks.getFirstListItem.mockReturnValue(new Promise(() => {}));
  const screen = await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider languages={["fr"]}>
        <ToastProvider>
          <ProfilePage />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );

  const photo = section(screen, fr.avatar.title);
  await expect.element(photo.getByText(fr.common.loading)).toBeVisible();
  await expect.element(photo.getByLabelText(fr.avatar.change)).not.toBeInTheDocument();
  await expect.element(photo.getByRole("button")).not.toBeInTheDocument();
});

test("ProfilePage — la section Photo vient en premier et propose de changer ma photo", async () => {
  const screen = await renderProfile();

  const headings = screen
    .getByRole("heading", { level: 2 })
    .elements()
    .map((element) => element.textContent);
  expect(headings[0]).toBe(fr.avatar.title);
  const photo = section(screen, fr.avatar.title);
  await expect.element(photo.getByLabelText(fr.avatar.change)).toBeInTheDocument();
  // No photo yet: nothing to remove, and the initial stands for it.
  await expect
    .element(photo.getByRole("button", { name: fr.avatar.remove }))
    .not.toBeInTheDocument();
  await expect.element(photo.getByText("A", { exact: true })).toBeVisible();
});

test("ProfilePage — choisir une photo l'envoie pour mon coureur, et la page lit le coureur de nouveau", async () => {
  mocks.runnerUpdate.mockResolvedValue({ id: "r1" });
  const screen = await renderProfile();

  await section(screen, fr.avatar.title)
    .getByLabelText(fr.avatar.change)
    .upload(await imageFile(1600, 1200));

  await expect
    .element(section(screen, fr.avatar.title).getByRole("status").first())
    .toHaveTextContent(fr.avatar.saved);
  expect(mocks.runnerUpdate).toHaveBeenCalledOnce();
  const [id, form] = mocks.runnerUpdate.mock.calls[0] ?? [];
  expect(id).toBe("r1");
  const sent = form instanceof FormData ? form.get("avatar") : null;
  if (!(sent instanceof File)) throw new Error("update was not given a file");
  expect(await sizeOf(sent)).toEqual({ width: 512, height: 384 });
  // The photo is shown all over the app: the runner of the session is read again.
  expect(mocks.getFirstListItem).toHaveBeenCalledTimes(2);
});

test("ProfilePage — avec une photo, elle est montrée en grand, et on peut la retirer", async () => {
  mocks.getURL.mockImplementation(() => pixelURL());
  mocks.getFirstListItem.mockResolvedValue({
    id: "r1",
    name: "Alice",
    user: "u1",
    avatar: "alice_k3j9x2.webp",
  });
  mocks.runnerUpdate.mockResolvedValue({ id: "r1" });
  const screen = await renderProfile();
  const photo = section(screen, fr.avatar.title);

  expect(photo.element().querySelector("img")?.getAttribute("src")).toBe(pixelURL());
  expect(mocks.getURL).toHaveBeenCalledWith(
    expect.objectContaining({ id: "r1" }),
    "alice_k3j9x2.webp",
    { thumb: "256x256" },
  );
  await photo.getByRole("button", { name: fr.avatar.remove }).click();

  await expect.element(photo.getByRole("status").first()).toHaveTextContent(fr.avatar.removed);
  expect(mocks.runnerUpdate).toHaveBeenCalledExactlyOnceWith("r1", { avatar: null });
});

// --- The name ---

test("ProfilePage — le nom affiché : PATCH du coureur, message, et la page suit", async () => {
  const screen = await renderProfile();
  const form = section(screen, fr.profile.nameTitle);

  await form.getByLabelText(fr.profile.name, { exact: true }).fill("Alice B");
  await form.getByRole("button", { name: fr.common.save }).click();

  await expect.element(screen.getByText(fr.profile.nameSaved)).toBeVisible();
  expect(mocks.runnerUpdate).toHaveBeenCalledWith("r1", { name: "Alice B" });
  // The runner of the session is read again: the new name is the one shown.
  await expect
    .element(form.getByLabelText(fr.profile.name, { exact: true }))
    .toHaveValue("Alice B");
  await vi.waitFor(() => {
    expect(mocks.getFirstListItem).toHaveBeenCalledTimes(2);
  });
});

test("ProfilePage — un nom déjà pris est dit sous le champ, la saisie est gardée", async () => {
  mocks.runnerUpdate.mockRejectedValue(fieldRefusal("name", "validation_not_unique"));
  const screen = await renderProfile();
  const form = section(screen, fr.profile.nameTitle);

  await form.getByLabelText(fr.profile.name, { exact: true }).fill("Bob");
  await form.getByRole("button", { name: fr.common.save }).click();

  const field = form.getByLabelText(fr.profile.name, { exact: true });
  await expect.element(form.getByRole("alert")).toHaveTextContent(fr.errors.validation_not_unique);
  await expect.element(field).toHaveValue("Bob");
  await expect.element(field).toHaveAttribute("aria-invalid", "true");
  await expect
    .element(field)
    .toHaveAccessibleDescription(`${fr.profile.nameHint} ${fr.errors.validation_not_unique}`);
  await expect.element(screen.getByText(fr.profile.nameSaved)).not.toBeInTheDocument();
});

test("ProfilePage — un nom fait d'espaces est refusé sans appeler le serveur", async () => {
  const screen = await renderProfile();
  const form = section(screen, fr.profile.nameTitle);

  await form.getByLabelText(fr.profile.name, { exact: true }).fill("   ");
  await form.getByRole("button", { name: fr.common.save }).click();

  await expect.element(form.getByRole("alert")).toHaveTextContent(fr.errors.validation_required);
  expect(mocks.runnerUpdate).not.toHaveBeenCalled();
});

// --- The email ---

test("ProfilePage — changer d'email : /api/app/me/email, puis le nouveau jeton est gardé", async () => {
  const record = { ...ALICE, email: "new@example.test" };
  mocks.send.mockResolvedValue({ token: "new-token", record });
  const screen = await renderProfile();
  const form = section(screen, fr.profile.emailTitle);

  await form.getByLabelText(fr.profile.newEmail, { exact: true }).fill("new@example.test");
  await form.getByLabelText(fr.profile.currentPassword, { exact: true }).fill("current-pass");
  await form.getByRole("button", { name: fr.profile.changeEmail }).click();

  await expect.element(screen.getByText(fr.profile.emailSaved)).toBeVisible();
  expect(mocks.send).toHaveBeenCalledWith("/api/app/me/email", {
    method: "POST",
    body: { email: "new@example.test", password: "current-pass" },
  });
  // The old token is dead: the one of the answer is what the session now is.
  expect(mocks.save).toHaveBeenCalledWith("new-token", record);
  await expect.element(form.getByText(fr.profile.currentEmail("new@example.test"))).toBeVisible();
  // The form starts over: no password is left in the page.
  await expect.element(form.getByLabelText(fr.profile.newEmail, { exact: true })).toHaveValue("");
  await expect
    .element(form.getByLabelText(fr.profile.currentPassword, { exact: true }))
    .toHaveValue("");
});

test("ProfilePage — un mot de passe faux est dit sous le champ, l'email saisi est gardé", async () => {
  mocks.send.mockRejectedValue(refusal(400, { code: "wrong_password" }));
  const screen = await renderProfile();
  const form = section(screen, fr.profile.emailTitle);

  await form.getByLabelText(fr.profile.newEmail, { exact: true }).fill("new@example.test");
  await form.getByLabelText(fr.profile.currentPassword, { exact: true }).fill("not-it");
  await form.getByRole("button", { name: fr.profile.changeEmail }).click();

  await expect.element(form.getByRole("alert")).toHaveTextContent(fr.errors.wrong_password);
  await expect
    .element(form.getByLabelText(fr.profile.currentPassword, { exact: true }))
    .toHaveAccessibleDescription(fr.errors.wrong_password);
  await expect
    .element(form.getByLabelText(fr.profile.newEmail, { exact: true }))
    .toHaveValue("new@example.test");
  expect(mocks.save).not.toHaveBeenCalled();
});

test.each([
  ["email_taken", fr.errors.email_taken],
  ["email_invalid", fr.errors.email_invalid],
])("ProfilePage — %s est dit sous le champ email", async (code, message) => {
  mocks.send.mockRejectedValue(refusal(400, { code }));
  const screen = await renderProfile();
  const form = section(screen, fr.profile.emailTitle);

  await form.getByLabelText(fr.profile.newEmail, { exact: true }).fill("bob@example.test");
  await form.getByLabelText(fr.profile.currentPassword, { exact: true }).fill("current-pass");
  await form.getByRole("button", { name: fr.profile.changeEmail }).click();

  await expect.element(form.getByRole("alert")).toHaveTextContent(message);
  await expect
    .element(form.getByLabelText(fr.profile.newEmail, { exact: true }))
    .toHaveAccessibleDescription(message);
  expect(mocks.save).not.toHaveBeenCalled();
});

test("ProfilePage — une panne pendant le changement d'email affiche le message générique", async () => {
  mocks.send.mockRejectedValue(new TypeError("Failed to fetch"));
  const screen = await renderProfile();
  const form = section(screen, fr.profile.emailTitle);

  await form.getByLabelText(fr.profile.newEmail, { exact: true }).fill("new@example.test");
  await form.getByLabelText(fr.profile.currentPassword, { exact: true }).fill("current-pass");
  await form.getByRole("button", { name: fr.profile.changeEmail }).click();

  await expect.element(form.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await expect
    .element(form.getByLabelText(fr.profile.newEmail, { exact: true }))
    .toHaveValue("new@example.test");
});

// --- The password ---

async function fillPasswords(screen: Screen, old: string, next: string, confirm: string) {
  const form = section(screen, fr.profile.passwordTitle);
  await form.getByLabelText(fr.profile.currentPassword, { exact: true }).fill(old);
  await form.getByLabelText(fr.profile.newPassword, { exact: true }).fill(next);
  await form.getByLabelText(fr.auth.passwordConfirm, { exact: true }).fill(confirm);
  return form;
}

test("ProfilePage — changer le mot de passe : met le compte à jour, puis se reconnecte aussitôt avec le nouveau", async () => {
  const screen = await renderProfile();
  const form = await fillPasswords(screen, "old-password", "new-password-1", "new-password-1");

  await form.getByRole("button", { name: fr.auth.changePassword }).click();

  await expect.element(screen.getByText(fr.profile.passwordSaved)).toBeVisible();
  expect(mocks.userUpdate).toHaveBeenCalledWith("u1", {
    oldPassword: "old-password",
    password: "new-password-1",
    passwordConfirm: "new-password-1",
  });
  // The update replaced the key of the token: the session is renewed with the new password...
  expect(mocks.authWithPassword).toHaveBeenCalledWith("alice@example.test", "new-password-1");
  expect(mocks.authWithPassword.mock.invocationCallOrder[0]).toBeGreaterThan(
    mocks.userUpdate.mock.invocationCallOrder[0] ?? Infinity,
  );
  // ...and no request goes out with the dead token in between, which the
  // client would take for the end of the session.
  expect(requestsBetween(mocks.userUpdate, mocks.authWithPassword)).toEqual([]);
  expect(mocks.clear).not.toHaveBeenCalled();
});

test("ProfilePage — après le changement, plus aucun mot de passe dans la page", async () => {
  const screen = await renderProfile();
  const form = await fillPasswords(screen, "old-password", "new-password-1", "new-password-1");

  await form.getByRole("button", { name: fr.auth.changePassword }).click();

  await expect.element(screen.getByText(fr.profile.passwordSaved)).toBeVisible();
  await expect
    .element(form.getByLabelText(fr.profile.currentPassword, { exact: true }))
    .toHaveValue("");
  await expect
    .element(form.getByLabelText(fr.profile.newPassword, { exact: true }))
    .toHaveValue("");
  await expect
    .element(form.getByLabelText(fr.auth.passwordConfirm, { exact: true }))
    .toHaveValue("");
});

test("ProfilePage — un mot de passe actuel faux est dit sous son champ, sans reconnexion, la saisie est gardée", async () => {
  mocks.userUpdate.mockRejectedValue(
    fieldRefusal("oldPassword", "validation_invalid_old_password"),
  );
  const screen = await renderProfile();
  const form = await fillPasswords(screen, "not-it", "new-password-1", "new-password-1");

  await form.getByRole("button", { name: fr.auth.changePassword }).click();

  await expect
    .element(form.getByRole("alert"))
    .toHaveTextContent(fr.errors.validation_invalid_old_password);
  await expect
    .element(form.getByLabelText(fr.profile.currentPassword, { exact: true }))
    .toHaveAccessibleDescription(fr.errors.validation_invalid_old_password);
  await expect
    .element(form.getByLabelText(fr.profile.newPassword, { exact: true }))
    .toHaveValue("new-password-1");
  expect(mocks.authWithPassword).not.toHaveBeenCalled();
  await expect.element(screen.getByText(fr.profile.passwordSaved)).not.toBeInTheDocument();
});

test("ProfilePage — un mot de passe trop court est dit sous son champ, avec la règle", async () => {
  mocks.userUpdate.mockRejectedValue(fieldRefusal("password", "validation_min_text_constraint"));
  const screen = await renderProfile();
  const form = await fillPasswords(screen, "old-password", "short", "short");

  await form.getByRole("button", { name: fr.auth.changePassword }).click();

  await expect
    .element(form.getByRole("alert"))
    .toHaveTextContent(fr.errors.validation_min_text_constraint);
  await expect
    .element(form.getByLabelText(fr.profile.newPassword, { exact: true }))
    .toHaveAccessibleDescription(
      `${fr.auth.passwordHint} ${fr.errors.validation_min_text_constraint}`,
    );
  expect(mocks.authWithPassword).not.toHaveBeenCalled();
});

test("ProfilePage — deux mots de passe différents sont dits sous la confirmation", async () => {
  mocks.userUpdate.mockRejectedValue(fieldRefusal("passwordConfirm", "validation_values_mismatch"));
  const screen = await renderProfile();
  const form = await fillPasswords(screen, "old-password", "new-password-1", "new-password-2");

  await form.getByRole("button", { name: fr.auth.changePassword }).click();

  await expect
    .element(form.getByRole("alert"))
    .toHaveTextContent(fr.errors.validation_values_mismatch);
  await expect
    .element(form.getByLabelText(fr.auth.passwordConfirm, { exact: true }))
    .toHaveAccessibleDescription(fr.errors.validation_values_mismatch);
  expect(mocks.authWithPassword).not.toHaveBeenCalled();
});

test("ProfilePage — si la reconnexion échoue, la session est fermée et on le dit", async () => {
  mocks.authWithPassword.mockRejectedValue(new TypeError("Failed to fetch"));
  const screen = await renderProfile();
  const form = await fillPasswords(screen, "old-password", "new-password-1", "new-password-1");

  await form.getByRole("button", { name: fr.auth.changePassword }).click();

  // The old token is dead: nothing else would work, so the sign-in page is next.
  await expect.element(screen.getByText(fr.profile.passwordSignInAgain)).toBeVisible();
  expect(mocks.clear).toHaveBeenCalledOnce();
});

test("ProfilePage — une panne pendant le changement ne ferme pas la session", async () => {
  mocks.userUpdate.mockRejectedValue(new TypeError("Failed to fetch"));
  const screen = await renderProfile();
  const form = await fillPasswords(screen, "old-password", "new-password-1", "new-password-1");

  await form.getByRole("button", { name: fr.auth.changePassword }).click();

  await expect.element(form.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  expect(mocks.authWithPassword).not.toHaveBeenCalled();
  expect(mocks.clear).not.toHaveBeenCalled();
});

// --- The passkeys ---

test("ProfilePage — liste les clés d'accès de l'utilisateur, avec leur dernier usage", async () => {
  const screen = await renderProfile();
  const list = section(screen, fr.passkeys.title);

  await expect.element(list.getByText(IPHONE.name)).toBeVisible();
  await expect.element(list.getByText(WORK_PC.name)).toBeVisible();
  await expect.element(list.getByText(/Utilisée le 20 oct\. 2026/)).toBeVisible();
  // A text is matched in full unless it is a regular expression.
  await expect.element(list.getByText(new RegExp(fr.passkeys.neverUsed))).toBeVisible();
  // An admin may read everybody's passkeys: the list asks for its own.
  expect(mocks.getFullList).toHaveBeenCalledWith({
    filter: 'user = {:id} {"id":"u1"}',
    sort: "-created",
  });
});

test("ProfilePage — sans clé, le dit", async () => {
  mocks.getFullList.mockResolvedValue([]);
  const screen = await renderProfile();

  await expect
    .element(section(screen, fr.passkeys.title).getByText(fr.passkeys.empty))
    .toBeVisible();
});

test("ProfilePage — si la liste ne se charge pas, propose de réessayer", async () => {
  mocks.getFullList.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const screen = await renderProfile();
  const list = section(screen, fr.passkeys.title);

  await expect.element(list.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await list.getByRole("button", { name: fr.common.retry }).click();

  await expect.element(list.getByText(IPHONE.name)).toBeVisible();
});

test('ProfilePage — liste les clés et supprime après confirmation (pb.collection("passkeys").delete appelé avec l\'id)', async () => {
  mocks.getFullList.mockResolvedValueOnce([IPHONE, WORK_PC]).mockResolvedValue([WORK_PC]);
  const screen = await renderProfile();
  const list = section(screen, fr.passkeys.title);
  await expect.element(list.getByText(IPHONE.name)).toBeVisible();

  await list.getByRole("button", { name: `${fr.common.delete} ${IPHONE.name}` }).click();

  // Nothing is deleted before the user confirms.
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.removeTitle });
  await expect.element(dialog).toBeVisible();
  await expect.element(dialog.getByText(fr.passkeys.removeWarning(IPHONE.name))).toBeVisible();
  expect(mocks.passkeyDelete).not.toHaveBeenCalled();

  await dialog.getByRole("button", { name: fr.common.delete, exact: true }).click();

  expect(mocks.passkeyDelete).toHaveBeenCalledWith("pk1");
  await expect.element(screen.getByText(fr.passkeys.removed)).toBeVisible();
  await expect.element(list.getByText(IPHONE.name)).not.toBeInTheDocument();
  await expect.element(list.getByText(WORK_PC.name)).toBeVisible();
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
});

test("ProfilePage — annuler la suppression ne supprime rien", async () => {
  const screen = await renderProfile();
  const list = section(screen, fr.passkeys.title);
  await list.getByRole("button", { name: `${fr.common.delete} ${IPHONE.name}` }).click();

  await screen
    .getByRole("dialog", { name: fr.passkeys.removeTitle })
    .getByRole("button", { name: fr.common.cancel })
    .click();

  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  expect(mocks.passkeyDelete).not.toHaveBeenCalled();
  await expect.element(list.getByText(IPHONE.name)).toBeVisible();
});

test("ProfilePage — une suppression refusée est dite dans la fenêtre, qui reste ouverte", async () => {
  mocks.passkeyDelete.mockRejectedValue(new TypeError("Failed to fetch"));
  const screen = await renderProfile();
  await section(screen, fr.passkeys.title)
    .getByRole("button", { name: `${fr.common.delete} ${IPHONE.name}` })
    .click();
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.removeTitle });

  await dialog.getByRole("button", { name: fr.common.delete, exact: true }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await expect.element(screen.getByText(fr.passkeys.removed)).not.toBeInTheDocument();
});

test("ProfilePage — ajouter une clé : le nom est demandé dans une fenêtre, puis la liste suit", async () => {
  const TABLET = { ...IPHONE, id: "pk3", name: "Tablette", last_used_at: "" };
  mocks.getFullList
    .mockResolvedValueOnce([IPHONE, WORK_PC])
    .mockResolvedValue([IPHONE, WORK_PC, TABLET]);
  const screen = await renderProfile();
  const list = section(screen, fr.passkeys.title);

  await list.getByRole("button", { name: fr.passkeys.add, exact: true }).click();
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.addTitle });
  await dialog.getByLabelText(fr.passkeys.name, { exact: true }).fill("Tablette");
  await dialog.getByRole("button", { name: fr.passkeys.addSubmit }).click();

  await expect.element(screen.getByText(fr.passkeys.added)).toBeVisible();
  expect(mocks.registerPasskey).toHaveBeenCalledExactlyOnceWith("Tablette");
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(list.getByText("Tablette")).toBeVisible();
});

test("ProfilePage — si l'utilisateur annule l'invite du navigateur, rien n'est dit et la fenêtre reste", async () => {
  mocks.registerPasskey.mockResolvedValue(false);
  const screen = await renderProfile();
  await section(screen, fr.passkeys.title)
    .getByRole("button", { name: fr.passkeys.add, exact: true })
    .click();
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.addTitle });
  await dialog.getByLabelText(fr.passkeys.name, { exact: true }).fill("Tablette");

  await dialog.getByRole("button", { name: fr.passkeys.addSubmit }).click();

  await vi.waitFor(() => {
    expect(mocks.registerPasskey).toHaveBeenCalledOnce();
  });
  // The name is kept, so that the user can try again.
  await expect
    .element(dialog.getByLabelText(fr.passkeys.name, { exact: true }))
    .toHaveValue("Tablette");
  await expect.element(dialog.getByRole("button", { name: fr.passkeys.addSubmit })).toBeEnabled();
  await expect.element(dialog.getByRole("alert")).not.toBeInTheDocument();
  await expect.element(screen.getByText(fr.passkeys.added)).not.toBeInTheDocument();
});

test("ProfilePage — un refus du serveur à l'ajout est dit dans la fenêtre", async () => {
  mocks.registerPasskey.mockRejectedValue(refusal(400, { code: "passkey_failed" }));
  const screen = await renderProfile();
  await section(screen, fr.passkeys.title)
    .getByRole("button", { name: fr.passkeys.add, exact: true })
    .click();
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.addTitle });
  await dialog.getByLabelText(fr.passkeys.name, { exact: true }).fill("Tablette");

  await dialog.getByRole("button", { name: fr.passkeys.addSubmit }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.passkey_failed);
  await expect
    .element(dialog.getByLabelText(fr.passkeys.name, { exact: true }))
    .toHaveValue("Tablette");
});

test("ProfilePage — un appareil qui a déjà une clé pour le compte est dit comme tel", async () => {
  mocks.registerPasskey.mockRejectedValue(
    new DOMException("Already registered", "InvalidStateError"),
  );
  const screen = await renderProfile();
  await section(screen, fr.passkeys.title)
    .getByRole("button", { name: fr.passkeys.add, exact: true })
    .click();
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.addTitle });
  await dialog.getByLabelText(fr.passkeys.name, { exact: true }).fill("Tablette");

  await dialog.getByRole("button", { name: fr.passkeys.addSubmit }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.passkeys.alreadyRegistered);
});

test("ProfilePage — un nom d'espaces est refusé à l'ajout, sans demander la clé au navigateur", async () => {
  const screen = await renderProfile();
  await section(screen, fr.passkeys.title)
    .getByRole("button", { name: fr.passkeys.add, exact: true })
    .click();
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.addTitle });
  await dialog.getByLabelText(fr.passkeys.name, { exact: true }).fill("   ");

  await dialog.getByRole("button", { name: fr.passkeys.addSubmit }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.validation_required);
  expect(mocks.registerPasskey).not.toHaveBeenCalled();
});

test("ProfilePage — renommer une clé : la fenêtre propose le nom actuel", async () => {
  const screen = await renderProfile();
  const list = section(screen, fr.passkeys.title);

  await list.getByRole("button", { name: `${fr.passkeys.rename} ${IPHONE.name}` }).click();
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.renameTitle });
  const field = dialog.getByLabelText(fr.passkeys.name, { exact: true });
  await expect.element(field).toHaveValue("iPhone");
  await field.fill("iPhone 15");
  await dialog.getByRole("button", { name: fr.common.save }).click();

  expect(mocks.passkeyUpdate).toHaveBeenCalledExactlyOnceWith("pk1", { name: "iPhone 15" });
  await expect.element(screen.getByText(fr.passkeys.renamed)).toBeVisible();
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
});

test("ProfilePage — un renommage refusé est dit dans la fenêtre", async () => {
  mocks.passkeyUpdate.mockRejectedValue(fieldRefusal("name", "validation_required"));
  const screen = await renderProfile();
  await section(screen, fr.passkeys.title)
    .getByRole("button", { name: `${fr.passkeys.rename} ${IPHONE.name}` })
    .click();
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.renameTitle });

  await dialog.getByLabelText(fr.passkeys.name, { exact: true }).fill("x");
  await dialog.getByRole("button", { name: fr.common.save }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.validation_required);
  await expect.element(screen.getByText(fr.passkeys.renamed)).not.toBeInTheDocument();
});

test("ProfilePage — sans WebAuthn, le bouton d'ajout est masqué mais la liste reste", async () => {
  mocks.passkeysSupported.mockReturnValue(false);
  const screen = await renderProfile();
  const list = section(screen, fr.passkeys.title);

  await expect.element(list.getByText(IPHONE.name)).toBeVisible();
  await expect
    .element(list.getByRole("button", { name: fr.passkeys.add, exact: true }))
    .not.toBeInTheDocument();
});
