import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { ClientResponseError } from "pocketbase";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ToastProvider } from "../../components/Toast";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { toEventView, type EventView } from "./api";
import { DeleteEventDialog } from "./DeleteEventDialog";
import {
  event2Record,
  eventRecord,
  p1,
  p2,
  p3,
  pNinaUndecided,
  withParticipations,
} from "./testFixture";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

const mocks = vi.hoisted(() => ({
  remove: vi.fn<(id: string) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: { collection: (name: string) => ({ events: { delete: mocks.remove } })[name] },
}));

let trail: EventView;
let lyon: EventView;

beforeAll(async () => {
  await ensureTemporal();
  // Alice, Bob (F42) and Sam (F15).
  trail = toEventView(eventRecord);
  // Nobody is on it.
  lyon = toEventView(event2Record);
});

beforeEach(() => {
  mocks.remove.mockReset().mockResolvedValue(true);
});

async function renderDialog(view: EventView = trail, languages = ["fr-FR"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["event", view.event.id], view);
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onClose = vi.fn<() => void>();

  const root = createRootRoute({ component: Outlet });
  const eventPage = createRoute({
    getParentRoute: () => root,
    path: "/evenements/$id",
    component: () => <DeleteEventDialog open onClose={onClose} view={view} />,
  });
  const list = createRoute({
    getParentRoute: () => root,
    path: "/liste",
    component: () => <p>Page de la liste</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([eventPage, list]),
    history: createMemoryHistory({ initialEntries: [`/evenements/${view.event.id}`] }),
  });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  await expect.element(screen.getByRole("dialog")).toBeVisible();
  return { screen, router, queryClient, invalidate, onClose };
}

const confirm = (screen: Awaited<ReturnType<typeof renderDialog>>["screen"]) =>
  screen.getByRole("button", { name: fr.common.delete });

test("DeleteEventDialog — affiche « Alice, Bob et Sam »", async () => {
  const { screen } = await renderDialog();

  await expect.element(screen.getByText("Alice, Bob et Sam")).toBeVisible();
  // The sentence it belongs to says what the list is.
  expect(screen.getByRole("dialog").element().textContent).toContain(fr.event.deleteParticipants);
});

test("DeleteEventDialog — en anglais britannique : « Alice, Bob and Sam »", async () => {
  const { screen } = await renderDialog(trail, ["en-GB"]);

  await expect.element(screen.getByText("Alice, Bob and Sam")).toBeVisible();
});

test("DeleteEventDialog — un coureur sur deux épreuves n'est cité qu'une fois", async () => {
  // Alice is on F42, and on F15 too: she is named once, with Bob and Sam.
  const twice = toEventView(
    withParticipations(eventRecord, [{ ...p1, id: "p1b", format: "f15", expand: p1.expand }]),
  );

  const { screen } = await renderDialog(twice);

  await expect.element(screen.getByText("Alice, Bob et Sam")).toBeVisible();
});

test("DeleteEventDialog — cite aussi les intéressés sans épreuve et les non partants", async () => {
  // Nina is interested with no format, and Bob does not start: the server deletes both.
  const everyone = toEventView({
    ...eventRecord,
    expand: {
      ...eventRecord.expand,
      participations_via_event: [{ ...p2, status: "dns" }, p1, p3, pNinaUndecided],
    },
  });

  const { screen } = await renderDialog(everyone);

  await expect.element(screen.getByText("Alice, Bob, Nina et Sam")).toBeVisible();
});

test("DeleteEventDialog — si seuls des intéressés sans épreuve sont inscrits, elle les cite quand même", async () => {
  // Nina only: nobody is on a format.
  const onlyNina = toEventView({
    ...eventRecord,
    expand: { ...eventRecord.expand, participations_via_event: [pNinaUndecided] },
  });

  const { screen } = await renderDialog(onlyNina);

  await expect.element(screen.getByText("Nina", { exact: true })).toBeVisible();
});

test("DeleteEventDialog — dit quel événement est supprimé, avec ses épreuves et leurs participations", async () => {
  const { screen } = await renderDialog();

  await expect.element(screen.getByText(fr.event.deleteWarning("Trail des Crêtes"))).toBeVisible();
});

test("DeleteEventDialog — sans participant, elle n'en cite aucun", async () => {
  const { screen } = await renderDialog(lyon);

  await expect.element(screen.getByText(fr.event.deleteWarning("10 km de Lyon"))).toBeVisible();
  expect(screen.container.textContent).not.toContain(fr.event.deleteParticipants);
});

test("DeleteEventDialog — Supprimer efface l'événement, renvoie vers /liste et le dit", async () => {
  const { screen, router, queryClient, invalidate } = await renderDialog();

  await confirm(screen).click();

  await vi.waitFor(() => {
    expect(router.state.location.pathname).toBe("/liste");
  });
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("event");
  await expect.element(screen.getByText("Page de la liste")).toBeVisible();
  await expect.element(screen.getByText(fr.event.deleted)).toBeVisible();
  // The lists are out of date, and the page of the event is gone.
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(keys).toContainEqual(["events"]);
  expect(keys).toContainEqual(["pending"]);
  await vi.waitFor(() => {
    expect(queryClient.getQueryData(["event", "event"])).toBeUndefined();
  });
});

test("DeleteEventDialog — un refus est dit dans la fenêtre : rien ne bouge", async () => {
  mocks.remove.mockRejectedValue(
    new ClientResponseError({
      status: 403,
      response: { status: 403, message: "…", data: { code: "forbidden" } },
    }),
  );
  const { screen, router } = await renderDialog();

  await confirm(screen).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.forbidden);
  expect(router.state.location.pathname).toBe("/evenements/event");
  await expect.element(confirm(screen)).toBeEnabled();
});

test("DeleteEventDialog — Annuler ferme sans rien supprimer", async () => {
  const { screen, onClose, router } = await renderDialog();

  await screen.getByRole("button", { name: fr.common.cancel }).click();

  expect(onClose).toHaveBeenCalledOnce();
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(router.state.location.pathname).toBe("/evenements/event");
});

test("DeleteEventDialog — le bouton rouge et celui d'annulation font au moins 44 px", async () => {
  const { screen } = await renderDialog();

  for (const button of [confirm(screen), screen.getByRole("button", { name: fr.common.cancel })]) {
    expect(button.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
});
