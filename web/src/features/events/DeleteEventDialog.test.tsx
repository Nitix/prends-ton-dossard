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
import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { buttonOf, clickTwice, expectAvailable, expectBusy } from "../../test/busyButton";
import { toEventView, type EventView } from "./api";
import { DeleteEventDialog } from "./DeleteEventDialog";
import {
  aliceRunner,
  event2Record,
  eventRecord,
  p1,
  p2,
  p3,
  pNinaSupporter,
  pNinaUndecided,
  withParticipations,
} from "./testFixture";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  remove: vi.fn<(id: string) => Promise<unknown>>(),
  // What goes with the event: its comments, and its offers (cars and lodgings).
  comments: vi.fn<(options: Rec) => Promise<unknown>>(),
  offers: vi.fn<(options: Rec) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    filter: (raw: string, params: Rec) => `${raw} ${JSON.stringify(params)}`,
    collection: (name: string) =>
      ({
        events: { delete: mocks.remove },
        comments: { getFullList: mocks.comments },
        offers: { getFullList: mocks.offers },
      })[name],
  },
}));

const base = { created: "", updated: "", collectionId: "", collectionName: "" };

/** A comment of the event, as the server sends it. */
const commentRecord = (id: string) => ({
  ...base,
  id,
  event: "event",
  author: aliceRunner.id,
  body: "Bonjour",
  expand: { author: aliceRunner },
});

/** A car or a lodging of the event, as the server sends it. */
const offerRecord = (id: string, kind: "ride" | "lodging") => ({
  ...base,
  id,
  event: "event",
  kind,
  owner: aliceRunner.id,
  place: "Lyon",
  seats: 0,
  expand: { owner: aliceRunner },
});

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
  mocks.comments.mockReset().mockResolvedValue([]);
  mocks.offers.mockReset().mockResolvedValue([]);
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

test("DeleteEventDialog — nomme aussi les supporteurs", async () => {
  // Nina is supporter of the event: the server deletes her participation too.
  const withSupporter = toEventView(withParticipations(eventRecord, [pNinaSupporter]));

  const { screen } = await renderDialog(withSupporter);

  await expect.element(screen.getByText("Alice, Bob, Nina et Sam")).toBeVisible();
});

test("DeleteEventDialog — si les supporteurs sont seuls, elle les cite quand même", async () => {
  const onlyNina = toEventView({
    ...eventRecord,
    expand: { ...eventRecord.expand, participations_via_event: [pNinaSupporter] },
  });

  const { screen } = await renderDialog(onlyNina);

  await expect.element(screen.getByText("Nina", { exact: true })).toBeVisible();
  expect(screen.getByRole("dialog").element().textContent).toContain(fr.event.deleteParticipants);
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

test("DeleteEventDialog — dit que les commentaires, les voitures, les logements et leurs places partent aussi", async () => {
  const { screen } = await renderDialog();

  const text = screen.getByRole("dialog").element().textContent;
  for (const word of ["commentaires", "voitures", "logements", "places"]) {
    expect(text).toContain(word);
  }
});

test("DeleteEventDialog — en anglais, le même avertissement", async () => {
  const { screen } = await renderDialog(trail, ["en-GB"]);

  await expect.element(screen.getByText(en.event.deleteWarning("Trail des Crêtes"))).toBeVisible();
  const text = screen.getByRole("dialog").element().textContent;
  for (const word of ["comments", "cars", "lodgings", "places"]) {
    expect(text).toContain(word);
  }
});

test("DeleteEventDialog — pour un doublon, elle renvoie à Admin > Doublons, qui garde les commentaires et les offres", async () => {
  const { screen } = await renderDialog();

  const hint = fr.event.deleteDuplicate(`${fr.nav.admin} > ${fr.admin.duplicatesTitle}`);
  await expect.element(screen.getByText(hint)).toBeVisible();
  expect(hint).toContain("Admin > Doublons");
});

test("DeleteEventDialog — compte ce qui part avec l'événement : commentaires, voitures, logements", async () => {
  mocks.comments.mockResolvedValue([commentRecord("c1"), commentRecord("c2"), commentRecord("c3")]);
  mocks.offers.mockResolvedValue([
    offerRecord("o1", "ride"),
    offerRecord("o2", "ride"),
    offerRecord("o3", "lodging"),
  ]);

  const { screen } = await renderDialog();

  await expect.element(screen.getByText("3 commentaires, 2 voitures et 1 logement")).toBeVisible();
  expect(screen.getByRole("dialog").element().textContent).toContain(fr.event.deleteContents);
});

test("DeleteEventDialog — au singulier, et sans ce qui n'existe pas", async () => {
  mocks.comments.mockResolvedValue([commentRecord("c1")]);
  mocks.offers.mockResolvedValue([offerRecord("o1", "lodging")]);

  const { screen } = await renderDialog();

  await expect.element(screen.getByText("1 commentaire et 1 logement")).toBeVisible();
});

test("DeleteEventDialog — en anglais, les comptes suivent la langue", async () => {
  mocks.comments.mockResolvedValue([commentRecord("c1"), commentRecord("c2")]);
  mocks.offers.mockResolvedValue([offerRecord("o1", "ride")]);

  const { screen } = await renderDialog(trail, ["en-GB"]);

  await expect.element(screen.getByText("2 comments and 1 car")).toBeVisible();
});

test("DeleteEventDialog — sans commentaire ni offre, ou tant qu'on ne les connaît pas, la phrase suffit", async () => {
  // Nothing goes with it: no line of counts.
  const empty = await renderDialog();
  await vi.waitFor(() => {
    expect(mocks.comments).toHaveBeenCalled();
    expect(mocks.offers).toHaveBeenCalled();
  });
  expect(empty.screen.getByRole("dialog").element().textContent).not.toContain(
    fr.event.deleteContents,
  );
  await empty.screen.unmount();

  // The lists cannot be read: the warning is all there is, and the deletion is not held up.
  mocks.comments.mockRejectedValue(new Error("offline"));
  mocks.offers.mockReturnValue(new Promise(() => {}));
  const unknown = await renderDialog();
  await expect
    .element(unknown.screen.getByText(fr.event.deleteWarning("Trail des Crêtes")))
    .toBeVisible();
  expect(unknown.screen.getByRole("dialog").element().textContent).not.toContain(
    fr.event.deleteContents,
  );
  await expect.element(confirm(unknown.screen)).toBeEnabled();
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
  // Its participations went with it, the ones whose result was to enter too.
  expect(keys).toContainEqual(["results-to-enter"]);
  // Its comments and its offers went with it, and the home page lists the latest comments of all the events.
  expect(keys).toContainEqual(["comments"]);
  expect(keys).toContainEqual(["offers"]);
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

test("DeleteEventDialog — Supprimer garde le focus pendant l'envoi et après un refus, et un double envoi ne supprime qu'une fois", async () => {
  const pending = Promise.withResolvers<unknown>();
  mocks.remove.mockReturnValueOnce(pending.promise);
  const { screen, router } = await renderDialog();
  const button = buttonOf(confirm(screen));

  clickTwice(button);

  await expectBusy(button);
  expect(mocks.remove).toHaveBeenCalledTimes(1);

  pending.reject(
    new ClientResponseError({
      status: 403,
      response: { status: 403, message: "…", data: { code: "forbidden" } },
    }),
  );
  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.forbidden);
  await expectAvailable(button);
  expect(router.state.location.pathname).toBe("/evenements/event");
  expect(mocks.remove).toHaveBeenCalledTimes(1);
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
