import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ToastProvider } from "../../components/Toast";
import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { TypesPage } from "./TypesPage";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  // What the server holds; the mutations below change it, as the real ones do.
  db: { raceTypes: [] as Rec[] },
  list: vi.fn<(options?: Rec) => Promise<unknown>>(),
  create: vi.fn<(body: Rec) => Promise<unknown>>(),
  update: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
  remove: vi.fn<(id: string) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: { isValid: true, record: null, onChange: () => () => {} },
    filter: (raw: string) => raw,
    collection: (name: string) =>
      ({
        race_types: {
          getFullList: mocks.list,
          create: mocks.create,
          update: mocks.update,
          delete: mocks.remove,
        },
      })[name],
  },
}));

const base = { created: "", updated: "", collectionId: "", collectionName: "race_types" };
const raceType = (id: string, label: string) => ({ ...base, id, label });

function installServer() {
  mocks.db.raceTypes = [
    raceType("rt-trail", "Trail"),
    raceType("rt-road", "Route"),
    raceType("rt-backyard", "Backyard"),
  ];
  // The server sends them in any order: the page sorts them.
  mocks.list.mockImplementation(() =>
    Promise.resolve(mocks.db.raceTypes.map((type) => ({ ...type }))),
  );
  mocks.create.mockImplementation((body) => {
    mocks.db.raceTypes.push(raceType("rt-new", String(body.label)));
    return Promise.resolve({});
  });
  mocks.update.mockImplementation((id, body) => {
    Object.assign(mocks.db.raceTypes.find((type) => type.id === id) ?? {}, body);
    return Promise.resolve({});
  });
  mocks.remove.mockImplementation((id) => {
    mocks.db.raceTypes = mocks.db.raceTypes.filter((type) => type.id !== id);
    return Promise.resolve(true);
  });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) {
    if (vi.isMockFunction(fn)) fn.mockReset();
  }
  installServer();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await page.viewport(414, 896);
});

function refusal(status: number, data: unknown) {
  return new ClientResponseError({ status, response: { status, message: "…", data } });
}

/** How PocketBase reports the fields it refused. */
const fieldRefusal = (field: string, code: string) =>
  refusal(400, { [field]: { code, message: "…" } });

/** How a route of the application, or a rule of a collection, refuses with a code. */
const coded = (status: number, code: string) => refusal(status, { code });

async function renderPage(languages = ["fr-FR"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        <ToastProvider>
          <TypesPage />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  await expect.element(screen.getByRole("heading", { level: 2, name: "Trail" })).toBeVisible();
  return { screen, queryClient };
}

type Screen = Awaited<ReturnType<typeof renderPage>>["screen"];

const t = fr.admin;

/** The button of an action of a row, by the action and the type it is about. */
const action = (screen: Screen, label: string, type: string) =>
  screen.getByRole("button", { name: t.forItem(label, type), exact: true });

const heading = (screen: Screen, name: string) =>
  screen.getByRole("heading", { level: 2, name, exact: true });

// --- The list ---

test("TypesPage — liste les types par ordre alphabétique", async () => {
  const { screen } = await renderPage();

  await expect.element(screen.getByRole("heading", { level: 1, name: t.typesTitle })).toBeVisible();
  const names = screen
    .getByRole("heading", { level: 2 })
    .elements()
    .map((element) => element.textContent);
  expect(names).toEqual(["Backyard", "Route", "Trail"]);
  for (const type of ["Backyard", "Route", "Trail"]) {
    await expect.element(action(screen, t.rename, type)).toBeVisible();
    await expect.element(action(screen, fr.common.delete, type)).toBeVisible();
  }
});

test("TypesPage — sans type, la page le dit", async () => {
  mocks.list.mockResolvedValue([]);
  const screen = await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider languages={["fr-FR"]}>
        <ToastProvider>
          <TypesPage />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );

  await expect.element(screen.getByText(t.typesEmpty)).toBeVisible();
  await expect.element(screen.getByRole("button", { name: t.addType })).toBeVisible();
});

test("TypesPage — une liste qui ne vient pas affiche l'erreur, et Réessayer la redemande", async () => {
  mocks.list.mockRejectedValueOnce(refusal(500, {}));
  const screen = await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider languages={["fr-FR"]}>
        <ToastProvider>
          <TypesPage />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await screen.getByRole("button", { name: fr.common.retry }).click();

  await expect.element(heading(screen, "Trail")).toBeVisible();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});

test("TypesPage — la page est en anglais pour un navigateur anglais", async () => {
  const { screen } = await renderPage(["en-GB"]);

  await expect
    .element(screen.getByRole("heading", { level: 1, name: en.admin.typesTitle }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: en.admin.forItem(en.admin.rename, "Trail") }))
    .toBeVisible();
});

// --- Adding ---

test("TypesPage — ajouter un type : le nom est nettoyé, un toast le dit, la liste est à jour", async () => {
  const { screen, queryClient } = await renderPage();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");

  await screen.getByRole("button", { name: t.addType }).click();
  const dialog = screen.getByRole("dialog", { name: t.createTypeTitle });
  await dialog.getByLabelText(t.typeLabel, { exact: true }).fill("  Ultra ");
  await dialog.getByRole("button", { name: t.createSubmit }).click();

  await expect.element(screen.getByText(t.typeCreated)).toBeVisible();
  expect(mocks.create).toHaveBeenCalledWith({ label: "Ultra" });
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(heading(screen, "Ultra")).toBeVisible();
  // The forms of the events offer this list too.
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["race_types"] });
});

test("TypesPage — un nom déjà pris est refusé sous le champ, et reste dans le champ", async () => {
  mocks.create.mockRejectedValueOnce(fieldRefusal("label", "validation_not_unique"));
  const { screen } = await renderPage();

  await screen.getByRole("button", { name: t.addType }).click();
  const dialog = screen.getByRole("dialog", { name: t.createTypeTitle });
  await dialog.getByLabelText(t.typeLabel, { exact: true }).fill("trail");
  await dialog.getByRole("button", { name: t.createSubmit }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(t.typeExists);
  await expect.element(dialog.getByLabelText(t.typeLabel, { exact: true })).toHaveValue("trail");
  await expect
    .element(dialog.getByLabelText(t.typeLabel, { exact: true }))
    .toHaveAttribute("aria-invalid", "true");
  await expect.element(screen.getByText(t.typeCreated)).not.toBeInTheDocument();
});

test("TypesPage — un nom fait d'espaces est refusé sans rien envoyer", async () => {
  const { screen } = await renderPage();

  await screen.getByRole("button", { name: t.addType }).click();
  const dialog = screen.getByRole("dialog", { name: t.createTypeTitle });
  await dialog.getByLabelText(t.typeLabel, { exact: true }).fill("   ");
  await dialog.getByRole("button", { name: t.createSubmit }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.validation_required);
  expect(mocks.create).not.toHaveBeenCalled();
});

test("TypesPage — un échec sans code a le message générique, et la fenêtre reste ouverte", async () => {
  mocks.create.mockRejectedValueOnce(new ClientResponseError(new TypeError("Failed to fetch")));
  const { screen } = await renderPage();

  await screen.getByRole("button", { name: t.addType }).click();
  const dialog = screen.getByRole("dialog", { name: t.createTypeTitle });
  await dialog.getByLabelText(t.typeLabel, { exact: true }).fill("Ultra");
  await dialog.getByRole("button", { name: t.createSubmit }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await expect.element(dialog.getByRole("button", { name: t.createSubmit })).toBeEnabled();
});

// --- Renaming ---

test("TypesPage — renommer un type : le champ part du nom actuel, les événements sont à jour", async () => {
  const { screen, queryClient } = await renderPage();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");

  await action(screen, t.rename, "Route").click();
  const dialog = screen.getByRole("dialog", { name: t.renameTypeTitle });
  const label = dialog.getByLabelText(t.typeLabel, { exact: true });
  await expect.element(label).toHaveValue("Route");
  await label.fill("Course sur route");
  await dialog.getByRole("button", { name: fr.common.save }).click();

  await expect.element(screen.getByText(t.typeRenamed)).toBeVisible();
  expect(mocks.update).toHaveBeenCalledWith("rt-road", { label: "Course sur route" });
  await expect.element(heading(screen, "Course sur route")).toBeVisible();
  await expect.element(heading(screen, "Route")).not.toBeInTheDocument();
  // The events show the label of their types: they ask for it again.
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["race_types"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["event"] });
});

test("TypesPage — renommer en un nom déjà pris, majuscules comprises, est refusé sous le champ", async () => {
  mocks.update.mockRejectedValueOnce(fieldRefusal("label", "validation_not_unique"));
  const { screen } = await renderPage();

  await action(screen, t.rename, "Route").click();
  const dialog = screen.getByRole("dialog", { name: t.renameTypeTitle });
  await dialog.getByLabelText(t.typeLabel, { exact: true }).fill("TRAIL");
  await dialog.getByRole("button", { name: fr.common.save }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(t.typeExists);
  await expect.element(heading(screen, "Route")).toBeVisible();
});

// --- Deleting ---

test("TypesPage — supprimer demande confirmation, puis le type disparaît", async () => {
  const { screen } = await renderPage();

  await action(screen, fr.common.delete, "Backyard").click();
  const dialog = screen.getByRole("dialog", { name: t.deleteTypeTitle });
  await expect.element(dialog.getByText(t.deleteTypeWarning("Backyard"))).toBeVisible();
  // Nothing is deleted until it is confirmed.
  expect(mocks.remove).not.toHaveBeenCalled();
  await dialog.getByRole("button", { name: fr.common.delete }).click();

  await expect.element(screen.getByText(t.typeDeleted)).toBeVisible();
  expect(mocks.remove).toHaveBeenCalledWith("rt-backyard");
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(heading(screen, "Backyard")).not.toBeInTheDocument();
  // The button that opened the dialog is gone: the focus goes to the title of the page.
  await expect.element(screen.getByRole("heading", { level: 1, name: t.typesTitle })).toHaveFocus();
});

test("TypesPage — annuler la suppression ne supprime rien", async () => {
  const { screen } = await renderPage();

  await action(screen, fr.common.delete, "Backyard").click();
  await screen
    .getByRole("dialog", { name: t.deleteTypeTitle })
    .getByRole("button", { name: fr.common.cancel })
    .click();

  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  expect(mocks.remove).not.toHaveBeenCalled();
  await expect.element(heading(screen, "Backyard")).toBeVisible();
  await expect.element(action(screen, fr.common.delete, "Backyard")).toHaveFocus();
});

test("TypesPage — un type utilisé par une épreuve n'est pas supprimé : le refus est dit dans la fenêtre", async () => {
  mocks.remove.mockRejectedValueOnce(coded(400, "race_type_in_use"));
  const { screen } = await renderPage();

  await action(screen, fr.common.delete, "Trail").click();
  const dialog = screen.getByRole("dialog", { name: t.deleteTypeTitle });
  await dialog.getByRole("button", { name: fr.common.delete }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.race_type_in_use);
  // The window stays open on the type, which is still in the list.
  await expect.element(dialog.getByRole("button", { name: fr.common.delete })).toBeEnabled();
  await expect.element(screen.getByText(t.typeDeleted)).not.toBeInTheDocument();
  await dialog.getByRole("button", { name: fr.common.cancel }).click();
  await expect.element(heading(screen, "Trail")).toBeVisible();
});

test("TypesPage — un type déjà supprimé ailleurs : la liste est redemandée", async () => {
  const { screen } = await renderPage();
  mocks.remove.mockImplementationOnce(() => {
    // Somebody else deleted it first.
    mocks.db.raceTypes = mocks.db.raceTypes.filter((type) => type.id !== "rt-backyard");
    return Promise.reject(refusal(404, {}));
  });

  await action(screen, fr.common.delete, "Backyard").click();
  await screen
    .getByRole("dialog", { name: t.deleteTypeTitle })
    .getByRole("button", { name: fr.common.delete })
    .click();

  await expect.element(heading(screen, "Backyard")).not.toBeInTheDocument();
});

// --- Layout ---

test("TypesPage — les zones tactiles font au moins 44 px, sur un téléphone", async () => {
  await page.viewport(375, 812);
  const { screen } = await renderPage();

  const targets = [
    screen.getByRole("button", { name: t.addType }),
    action(screen, t.rename, "Trail"),
    action(screen, fr.common.delete, "Trail"),
  ];
  for (const target of targets) {
    const { width, height } = target.element().getBoundingClientRect();
    expect(height).toBeGreaterThanOrEqual(44);
    expect(width).toBeGreaterThanOrEqual(44);
  }
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
});
