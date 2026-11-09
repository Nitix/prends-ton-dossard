import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, type Locator } from "vitest/browser";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import type { OfferKind } from "../../lib/types";
import { FRAME } from "../../test/frame";
import { pressFocused } from "../../test/pressFocused";
import { toEventView } from "../events/api";
import { eventRecord } from "../events/testFixture";
import type { Me } from "../participations/permissions";
import { OffersSection } from "./OffersSection";

// The tap targets and the white space of the notes are a matter of the styles,
// which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  list: vi.fn<(options: Rec) => Promise<unknown>>(),
  take: vi.fn<(body: Rec) => Promise<unknown>>(),
  leave: vi.fn<(id: string) => Promise<unknown>>(),
  remove: vi.fn<(id: string) => Promise<unknown>>(),
  create: vi.fn<(body: Rec) => Promise<unknown>>(),
  update: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
  runners: vi.fn<(options?: Rec) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    filter: (raw: string, params: Rec) => `${raw} ${JSON.stringify(params)}`,
    collection: (name: string) =>
      ({
        offers: {
          getFullList: mocks.list,
          delete: mocks.remove,
          create: mocks.create,
          update: mocks.update,
        },
        offer_members: { create: mocks.take, delete: mocks.leave },
        runners: { getFullList: mocks.runners },
      })[name],
  },
}));

beforeAll(async () => {
  await ensureTemporal();
});

const base = { created: "", updated: "", collectionId: "", collectionName: "" };
const alice = { ...base, id: "aliceRunner0000", name: "Alice", user: "u-alice" };
const bob = { ...base, id: "bobRunner000000", name: "Bob", user: "u-bob" };
// Sam has no account: somebody else places them.
const sam = { ...base, id: "samRunner000000", name: "Sam", user: "" };
const nina = { ...base, id: "ninaRunner00000", name: "Nina", user: "u-nina" };
const admin = { ...base, id: "adminRunner0000", name: "Admin", user: "u-admin" };

type Runner = typeof alice;

const meAlice: Me = { userId: "u-alice", runnerId: alice.id, isAdmin: false };
const meBob: Me = { userId: "u-bob", runnerId: bob.id, isAdmin: false };
const meNina: Me = { userId: "u-nina", runnerId: nina.id, isAdmin: false };
const meAdmin: Me = { userId: "u-admin", runnerId: admin.id, isAdmin: true };

/** A place in an offer, as the server sends it with its runner expanded. */
function place(id: string, offerId: string, runner: Runner) {
  return {
    ...base,
    collectionName: "offer_members",
    id,
    offer: offerId,
    runner: runner.id,
    added_by: runner.id,
    expand: { runner },
  };
}

type Row = ReturnType<typeof offer>;

/**
 * An offer as the server sends it, with its owner and its places expanded. An
 * expand that is empty is left out of the record: a car with nobody in it has
 * no `offer_members_via_offer`.
 */
function offer(
  id: string,
  kind: OfferKind,
  owner: Runner,
  fields: Rec = {},
  members: [string, Runner][] = [],
) {
  return {
    ...base,
    collectionName: "offers",
    id,
    event: "event",
    kind,
    owner: owner.id,
    place: "Lyon",
    seats: 0,
    date: "",
    time: "",
    end_date: "",
    url: "",
    notes: "",
    ...fields,
    expand: {
      owner,
      ...(members.length > 0 && {
        offer_members_via_offer: members.map(([memberId, runner]) => place(memberId, id, runner)),
      }),
    },
  };
}

/** Alice's car: 4 seats, Sam and then Bob in it (the server does not sort them). */
const car = () =>
  offer(
    "ride1",
    "ride",
    alice,
    {
      place: "Lyon, Part-Dieu",
      seats: 4,
      date: "2026-06-13",
      time: "06:30",
      notes: "Rendez-vous devant la gare.\nPas de chien.",
    },
    [
      ["m-sam", sam],
      ["m-bob", bob],
    ],
  );

/** Bob's lodging, for the 13th and the 14th, with Nina in it and no limit of places. */
const lodging = () =>
  offer(
    "lodging1",
    "lodging",
    bob,
    {
      place: "Gîte des Crêtes, Valloire",
      date: "2026-06-13",
      end_date: "2026-06-14",
      url: "https://gite.example.test/annonce",
    },
    [["m-nina", nina]],
  );

/** A copy of the offer whose places are these ones (and, like the server, with no list at all when there are none). */
function withPlaces(row: Row, places: ReturnType<typeof place>[]): Row {
  return {
    ...row,
    expand: {
      owner: row.expand.owner,
      ...(places.length > 0 && { offer_members_via_offer: places }),
    },
  };
}

/**
 * What the server holds: a request for the list gives it, and a place taken
 * or left and an offer deleted change it, like the real thing.
 */
let rows: Row[];
let placed: number;
let offersCreated: number;
/** Who is signed in: the owner of an offer that is created. */
let signedIn: Me | null;

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  rows = [car(), lodging()];
  placed = 0;
  offersCreated = 0;
  signedIn = null;
  mocks.runners.mockImplementation(() => Promise.resolve([sam, nina, bob, alice, admin]));
  mocks.create.mockImplementation((body) => {
    const owner = [alice, bob, sam, nina, admin].find(({ id }) => id === signedIn?.runnerId);
    if (!owner) throw new Error("nobody is signed in");
    offersCreated += 1;
    const { event: _event, kind, ...fields } = body;
    const row = offer(
      `new-offer${offersCreated}`,
      kind === "lodging" ? "lodging" : "ride",
      owner,
      fields,
    );
    rows = [...rows, row];
    return Promise.resolve(row);
  });
  mocks.update.mockImplementation((id, body) => {
    rows = rows.map((row) => (row.id === id ? { ...row, ...body } : row));
    return Promise.resolve(rows.find((row) => row.id === id));
  });
  mocks.list.mockImplementation(() => Promise.resolve(rows));
  mocks.take.mockImplementation((body) => {
    const runner = [alice, bob, sam, nina, admin].find(({ id }) => id === body.runner);
    if (!runner) throw new Error(`no runner ${String(body.runner)}`);
    placed += 1;
    const created = place(`new${placed}`, String(body.offer), runner);
    rows = rows.map((row) =>
      row.id === body.offer
        ? withPlaces(row, [...(row.expand.offer_members_via_offer ?? []), created])
        : row,
    );
    return Promise.resolve(created);
  });
  mocks.leave.mockImplementation((id) => {
    rows = rows.map((row) =>
      withPlaces(
        row,
        (row.expand.offer_members_via_offer ?? []).filter((member) => member.id !== id),
      ),
    );
    return Promise.resolve(true);
  });
  mocks.remove.mockImplementation((id) => {
    rows = rows.filter((row) => row.id !== id);
    return Promise.resolve(true);
  });
});

async function renderSection(
  options: { me?: Me | null; kind?: OfferKind; languages?: string[] } = {},
) {
  const { me = meNina, kind = "ride", languages = ["fr"] } = options;
  signedIn = me;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        <OffersSection view={toEventView(eventRecord)} kind={kind} me={me} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { screen, queryClient };
}

type Screen = Awaited<ReturnType<typeof renderSection>>["screen"];

// Intl separates a number from its unit with a no-break space: tests read the
// text as it looks.
const plain = (s: string | null) => (s ?? "").replace(/\p{Zs}/gu, " ");

/** The section, with its title: it is there from the start. */
const section = (screen: Screen, kind: OfferKind = "ride") =>
  screen.getByRole("region", { name: fr.offers.title[kind] });
/** The offer of an owner: its title is their name. */
const offerOf = (screen: Screen, owner: string) =>
  screen.getByRole("article", { name: owner, exact: true });
const button = (scope: { getByRole: Screen["getByRole"] }, name: string) =>
  scope.getByRole("button", { name, exact: true });
const deleteButton = (scope: { getByRole: Screen["getByRole"] }) => button(scope, fr.offers.delete);
/** The names of the people in an offer, in the order of its list. */
const people = (article: { getByRole: Screen["getByRole"] }) =>
  article
    .getByRole("listitem")
    .elements()
    .map((li) => li.querySelector("p")?.textContent);

/** The text of the buttons « Retirer … » of a section: who the member can remove. */
const names = (screen: Screen) =>
  screen
    .getByRole("button")
    .elements()
    .map((element) => element.textContent)
    .filter((text) => text?.startsWith("Retirer"));

/** What a line says, as it looks, once it is on the page. */
async function textOf(line: Locator): Promise<string> {
  await expect.element(line).toBeVisible();
  return plain(line.element().textContent);
}

/** The element the browser gives the focus to: `toHaveFocus` reads it, a test of a locator does not need it. */
const focused = () => document.activeElement;

/** What the SDK throws for the 400 of a place that the server refuses. */
function refusal(field: string, code: string): ClientResponseError {
  return new ClientResponseError({
    status: 400,
    response: {
      status: 400,
      message: "Failed to create record.",
      data: { [field]: { code, message: "…" } },
    },
  });
}

/** What the SDK throws for a record that is not there any more (deleted by somebody else). */
function notFound(): ClientResponseError {
  return new ClientResponseError({
    status: 404,
    response: { status: 404, message: "The requested resource wasn't found.", data: {} },
  });
}

/** The title of an offer, where the focus goes when its button goes away. */
const titleOf = (screen: Screen, owner: string) =>
  offerOf(screen, owner).getByRole("heading", { level: 3, name: owner, exact: true });
/** The title of the section, where the focus goes when its offer goes away. */
const sectionTitle = (screen: Screen, kind: OfferKind = "ride") =>
  screen.getByRole("heading", { level: 2, name: fr.offers.title[kind] });

// --- The list ---

describe("the list", () => {
  test("OffersSection — une voiture : propriétaire, départ, date, heure, places prises, passagers", async () => {
    const { screen } = await renderSection();

    await expect.element(section(screen)).toBeVisible();
    const one = offerOf(screen, "Alice");
    await expect.element(one).toBeVisible();
    await expect.element(one.getByRole("heading", { level: 3, name: "Alice" })).toBeVisible();
    // The detail line: where, which day, which time.
    expect(await textOf(one.getByText(/^Départ de/))).toBe(
      "Départ de Lyon, Part-Dieu · sam. 13 juin · 06:30",
    );
    // The places, in words; nobody is told the car is full.
    await expect.element(one.getByText("2 places prises sur 4")).toBeVisible();
    await expect.element(one.getByText(fr.offers.full)).not.toBeInTheDocument();
    // The passengers by name, whatever the order of the server.
    expect(people(one)).toEqual(["Bob", "Sam"]);
    // The notes keep their line breaks.
    const notes = one.getByText(/Rendez-vous devant la gare/);
    await expect.element(notes).toBeVisible();
    expect(notes.element().textContent).toBe("Rendez-vous devant la gare.\nPas de chien.");
    expect(getComputedStyle(notes.element()).whiteSpace).toBe("pre-wrap");
    // The page asks for the offers of the event, by creation, with the owner and the people.
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.stringContaining("event"),
        sort: "created",
        expand: "owner,offer_members_via_offer.runner",
      }),
    );
    // The lodging is in the other section.
    await expect.element(offerOf(screen, "Bob")).not.toBeInTheDocument();
  });

  test("OffersSection — un logement : nom, dates, lien vers l'annonce, places non précisées", async () => {
    const { screen } = await renderSection({ kind: "lodging" });

    await expect.element(section(screen, "lodging")).toBeVisible();
    const one = offerOf(screen, "Bob");
    await expect.element(one).toBeVisible();
    expect(await textOf(one.getByText(/^Gîte/))).toBe(
      "Gîte des Crêtes, Valloire · du sam. 13 juin au dim. 14 juin",
    );
    // The link to the listing opens in another tab, without giving it access to this one.
    const link = one.getByRole("link", { name: fr.offers.seeAd });
    await expect.element(link).toBeVisible();
    await expect.element(link).toHaveAttribute("href", "https://gite.example.test/annonce");
    await expect.element(link).toHaveAttribute("target", "_blank");
    const rel = link.element().getAttribute("rel") ?? "";
    expect(rel.split(" ")).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
    // No limit of places: the people are counted, the places are not.
    await expect.element(one.getByText("1 personne, places non précisées")).toBeVisible();
    await expect.element(one.getByText(fr.offers.full)).not.toBeInTheDocument();
    expect(people(one)).toEqual(["Nina"]);
    await expect.element(offerOf(screen, "Alice")).not.toBeInTheDocument();
  });

  test("OffersSection — un logement sans date de départ n'a que sa date, et un lien qui n'est pas web n'est jamais un lien", async () => {
    rows = [
      offer("l1", "lodging", bob, { place: "Chez Paul", date: "2026-06-13" }),
      offer("l2", "lodging", alice, { place: "Camping", url: "javascript:alert(1)" }),
      // Arriving and leaving the same day: said once.
      offer("l3", "lodging", sam, {
        place: "Auberge",
        date: "2026-06-13",
        end_date: "2026-06-13",
      }),
    ];

    const { screen } = await renderSection({ kind: "lodging" });

    // One day alone is the arrival.
    expect(await textOf(offerOf(screen, "Bob").getByText(/^Chez Paul/))).toBe(
      "Chez Paul · sam. 13 juin",
    );
    // Nothing but the name, and no link for what is not a web address.
    expect(await textOf(offerOf(screen, "Alice").getByText(/^Camping/))).toBe("Camping");
    await expect.element(offerOf(screen, "Alice").getByRole("link")).not.toBeInTheDocument();
    expect(await textOf(offerOf(screen, "Sam").getByText(/^Auberge/))).toBe(
      "Auberge · sam. 13 juin",
    );
  });

  test("OffersSection — une voiture sans date ni heure n'a que son départ", async () => {
    rows = [offer("r1", "ride", sam, { place: "Annecy", seats: 2 })];

    const { screen } = await renderSection();

    const one = offerOf(screen, "Sam");
    expect(await textOf(one.getByText(/^Départ de/))).toBe("Départ de Annecy");
    await expect.element(one.getByText("0 place prise sur 2")).toBeVisible();
    await expect.element(one.getByRole("listitem")).not.toBeInTheDocument();
  });

  test("OffersSection — une offre pleine le dit en texte, et une place de trop aussi", async () => {
    rows = [
      offer("r1", "ride", alice, { place: "Lyon", seats: 1 }, [["m1", bob]]),
      // The server lets two members take the last place together.
      offer("r2", "ride", sam, { place: "Paris", seats: 1 }, [
        ["m2", bob],
        ["m3", nina],
      ]),
    ];

    const { screen } = await renderSection({ me: null });

    const full = offerOf(screen, "Alice");
    await expect.element(full.getByText(/^1 place prise sur 1/)).toBeVisible();
    await expect.element(full.getByText(fr.offers.full)).toBeVisible();
    const over = offerOf(screen, "Sam");
    await expect.element(over.getByText(/^2 places prises sur 1/)).toBeVisible();
    await expect.element(over.getByText(fr.offers.full)).toBeVisible();
  });

  test("OffersSection — sans offre, la phrase « Personne ne propose… »", async () => {
    rows = [lodging()];

    const rides = await renderSection();
    await expect.element(section(rides.screen)).toBeVisible();
    await expect
      .element(section(rides.screen).getByText("Personne ne propose de voiture pour l'instant."))
      .toBeVisible();
    await expect.element(rides.screen.getByRole("article")).not.toBeInTheDocument();
    await rides.screen.unmount();

    rows = [car()];
    const lodgings = await renderSection({ kind: "lodging" });
    await expect
      .element(
        section(lodgings.screen, "lodging").getByText(
          "Personne ne propose de logement pour l'instant.",
        ),
      )
      .toBeVisible();
  });

  test("OffersSection — en anglais, les textes et les dates suivent la langue", async () => {
    const { screen } = await renderSection({ languages: ["en-GB"] });

    await expect.element(screen.getByRole("region", { name: en.offers.title.ride })).toBeVisible();
    const one = offerOf(screen, "Alice");
    expect(await textOf(one.getByText(/^Leaving from/))).toBe(
      "Leaving from Lyon, Part-Dieu · Sat 13 Jun · 06:30",
    );
    await expect.element(one.getByText("2 of 4 seats taken")).toBeVisible();
    // Nina has nothing: she can take a place, and remove nobody.
    await expect.element(button(one, en.offers.take.ride)).toBeVisible();
    await expect.element(button(one, "Remove Sam")).not.toBeInTheDocument();
  });

  test("OffersSection — pendant le chargement elle le dit, et sur une erreur elle le dit et se retente", async () => {
    // The title is there from the start: the section does not appear from nowhere.
    mocks.list.mockReturnValueOnce(new Promise(() => {}));
    const { screen } = await renderSection();
    await expect.element(section(screen)).toBeVisible();
    await expect.element(section(screen).getByText(fr.common.loading)).toBeVisible();
    await screen.unmount();

    mocks.list.mockReset();
    mocks.list.mockRejectedValueOnce(new Error("boom"));
    const retried = await renderSection();
    const failed = section(retried.screen);
    await expect.element(failed.getByRole("alert")).toHaveTextContent(fr.errors.generic);
    mocks.list.mockImplementation(() => Promise.resolve(rows));

    await failed.getByRole("button", { name: fr.common.retry }).click();

    await expect.element(offerOf(retried.screen, "Alice")).toBeVisible();
    await expect.element(retried.screen.getByRole("alert")).not.toBeInTheDocument();
  });

  test("OffersSection — sans coureur connu, on lit mais on n'agit pas", async () => {
    const { screen } = await renderSection({ me: null });

    await expect.element(offerOf(screen, "Alice")).toBeVisible();
    await expect.element(screen.getByRole("button")).not.toBeInTheDocument();
  });
});

// --- Taking and leaving a place ---

describe("taking and leaving a place", () => {
  test("OffersSection — « Je monte » crée ma place, « Je descends » la supprime", async () => {
    const { screen } = await renderSection({ me: meNina });
    const one = offerOf(screen, "Alice");
    await expect.element(one).toBeVisible();
    await expect.element(button(one, fr.offers.leave.ride)).not.toBeInTheDocument();

    await button(one, fr.offers.take.ride).click();

    // Her place, for herself: the server says who adds her.
    await expect.element(one.getByText("3 places prises sur 4")).toBeVisible();
    expect(mocks.take).toHaveBeenCalledTimes(1);
    expect(mocks.take).toHaveBeenCalledWith({ offer: "ride1", runner: nina.id });
    expect(people(one)).toEqual(["Bob", "Nina", "Sam"]);
    // The inverse button is there, and has the focus the other one had.
    await expect.element(button(one, fr.offers.take.ride)).not.toBeInTheDocument();
    await expect.element(button(one, fr.offers.leave.ride)).toHaveFocus();

    await button(one, fr.offers.leave.ride).click();

    await expect.element(one.getByText("2 places prises sur 4")).toBeVisible();
    expect(mocks.leave).toHaveBeenCalledTimes(1);
    expect(mocks.leave).toHaveBeenCalledWith("new1");
    expect(people(one)).toEqual(["Bob", "Sam"]);
    await expect.element(button(one, fr.offers.leave.ride)).not.toBeInTheDocument();
    await expect.element(button(one, fr.offers.take.ride)).toHaveFocus();
  });

  test("OffersSection — « J'y dors » et « Je n'y dors plus » pour un logement", async () => {
    const { screen } = await renderSection({ me: meAlice, kind: "lodging" });
    const one = offerOf(screen, "Bob");
    await expect.element(one).toBeVisible();

    await button(one, fr.offers.take.lodging).click();

    await expect.element(one.getByText("2 personnes, places non précisées")).toBeVisible();
    expect(mocks.take).toHaveBeenCalledWith({ offer: "lodging1", runner: alice.id });
    await expect.element(button(one, fr.offers.leave.lodging)).toHaveFocus();

    await button(one, fr.offers.leave.lodging).click();

    await expect.element(one.getByText("1 personne, places non précisées")).toBeVisible();
    await expect.element(button(one, fr.offers.take.lodging)).toHaveFocus();
  });

  test("OffersSection — un double clic sur « Je monte » ne crée qu'une place, et le bouton garde le focus pendant l'envoi", async () => {
    const pending = Promise.withResolvers<unknown>();
    mocks.take.mockReturnValue(pending.promise);
    const { screen } = await renderSection({ me: meNina });
    const one = offerOf(screen, "Alice");
    await expect.element(one).toBeVisible();

    // Two clicks in the same tick, as a double tap does.
    const element = button(one, fr.offers.take.ride).element();
    if (!(element instanceof HTMLButtonElement)) throw new Error("not a button");
    element.focus();
    element.click();
    element.click();

    // It says it is busy, and it is not disabled: it keeps the focus.
    await expect.element(button(one, fr.offers.take.ride)).toHaveAttribute("aria-disabled", "true");
    expect(element.disabled).toBe(false);
    expect(focused()).toBe(element);
    expect(mocks.take).toHaveBeenCalledTimes(1);
    pending.resolve({ id: "new" });
    await vi.waitFor(() => {
      expect(mocks.list).toHaveBeenCalledTimes(2);
    });
    expect(mocks.take).toHaveBeenCalledTimes(1);
  });

  test("OffersSection — pas de « Je monte » sur une offre pleine, dans sa propre voiture, ni avec une place ailleurs", async () => {
    rows = [
      // Alice's car is full; Bob is in it.
      offer("r1", "ride", alice, { place: "Lyon", seats: 1 }, [["m1", bob]]),
      // Sam's is open.
      offer("r2", "ride", sam, { place: "Paris", seats: 3 }),
    ];

    // Nina has nothing: she may take the open car, not the full one.
    const free = await renderSection({ me: meNina });
    await expect.element(offerOf(free.screen, "Sam")).toBeVisible();
    await expect.element(button(offerOf(free.screen, "Sam"), fr.offers.take.ride)).toBeVisible();
    await expect
      .element(button(offerOf(free.screen, "Alice"), fr.offers.take.ride))
      .not.toBeInTheDocument();
    await expect.element(offerOf(free.screen, "Alice").getByText(fr.offers.full)).toBeVisible();
    await free.screen.unmount();

    // Alice drives: she takes a place in no car, hers included.
    const driver = await renderSection({ me: meAlice });
    await expect.element(offerOf(driver.screen, "Sam")).toBeVisible();
    await expect
      .element(driver.screen.getByRole("button", { name: fr.offers.take.ride }))
      .not.toBeInTheDocument();
    await driver.screen.unmount();

    // Bob has a place in Alice's car: none in Sam's, and he may leave hers.
    const passenger = await renderSection({ me: meBob });
    await expect.element(offerOf(passenger.screen, "Sam")).toBeVisible();
    await expect
      .element(passenger.screen.getByRole("button", { name: fr.offers.take.ride }))
      .not.toBeInTheDocument();
    await expect
      .element(button(offerOf(passenger.screen, "Alice"), fr.offers.leave.ride))
      .toBeVisible();
    await expect
      .element(button(offerOf(passenger.screen, "Sam"), fr.offers.leave.ride))
      .not.toBeInTheDocument();
  });

  test("OffersSection — les sortes sont séparées : une place en voiture n'empêche pas de dormir sur place", async () => {
    // Nina has a seat in Alice's car, and no bed yet.
    rows = [
      offer("r1", "ride", alice, { place: "Lyon", seats: 4 }, [["m1", nina]]),
      offer("l1", "lodging", bob, { place: "Gîte" }),
    ];

    const { screen } = await renderSection({ me: meNina, kind: "lodging" });

    await expect.element(button(offerOf(screen, "Bob"), fr.offers.take.lodging)).toBeVisible();
  });

  test("OffersSection — un refus (offer_full) est traduit", async () => {
    mocks.take.mockRejectedValueOnce(refusal("offer", "offer_full"));
    const { screen } = await renderSection({ me: meNina });
    const one = offerOf(screen, "Alice");
    await expect.element(one).toBeVisible();

    await button(one, fr.offers.take.ride).click();

    // In the alert of the offer, in words.
    await expect.element(one.getByRole("alert")).toHaveTextContent("Il n'y a plus de place.");
    // Nothing was added, and the button is still there, with the focus, for another try.
    expect(people(one)).toEqual(["Bob", "Sam"]);
    await expect.element(button(one, fr.offers.take.ride)).toHaveFocus();
    await expect
      .element(button(one, fr.offers.take.ride))
      .not.toHaveAttribute("aria-disabled", "true");
    // The list is asked for again: the place may have been taken by somebody else while the page was open.
    await vi.waitFor(() => {
      expect(mocks.list).toHaveBeenCalledTimes(2);
    });

    // Another try goes through, and the message goes away.
    await button(one, fr.offers.take.ride).click();
    await expect.element(button(one, fr.offers.leave.ride)).toBeVisible();
    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  });

  test("OffersSection — un refus après lequel l'offre est pleine : le bouton s'en va, et le focus va sur le titre de l'offre", async () => {
    // While Nina was looking, the car filled up: the server refuses, and the list it gives back has no place left.
    mocks.take.mockImplementationOnce(() => {
      rows = [
        offer("ride1", "ride", alice, { place: "Lyon, Part-Dieu", seats: 3 }, [
          ["m-sam", sam],
          ["m-bob", bob],
          ["m-admin", admin],
        ]),
      ];
      return Promise.reject(refusal("offer", "offer_full"));
    });
    const { screen } = await renderSection({ me: meNina });
    const one = offerOf(screen, "Alice");
    await expect.element(button(one, fr.offers.take.ride)).toBeVisible();

    await button(one, fr.offers.take.ride).click();

    // The refusal is told, and so is the car that is full now.
    await expect.element(one.getByRole("alert")).toHaveTextContent("Il n'y a plus de place.");
    await expect.element(one.getByText(fr.offers.full)).toBeVisible();
    await expect.element(button(one, fr.offers.take.ride)).not.toBeInTheDocument();
    // The button went with the answer: the focus is on the offer, never on the page.
    await expect.element(titleOf(screen, "Alice")).toHaveFocus();
    expect(focused()).not.toBe(document.body);
  });

  test("OffersSection — un refus après lequel j'ai déjà une place ailleurs : le focus va sur le titre de l'offre", async () => {
    // Nina took a place in another car, on another screen: the places of this one did not change, its button goes.
    const alices = offer("r1", "ride", alice, { place: "Lyon", seats: 3 });
    rows = [alices, offer("r2", "ride", sam, { place: "Paris", seats: 3 })];
    mocks.take.mockImplementationOnce(() => {
      rows = [alices, offer("r2", "ride", sam, { place: "Paris", seats: 3 }, [["m-nina", nina]])];
      return Promise.reject(refusal("runner", "offer_already_member"));
    });
    const { screen } = await renderSection({ me: meNina });
    const one = offerOf(screen, "Alice");
    await expect.element(button(one, fr.offers.take.ride)).toBeVisible();

    await button(one, fr.offers.take.ride).click();

    await expect
      .element(one.getByRole("alert"))
      .toHaveTextContent("Cette personne a déjà une place de cette sorte pour cet événement.");
    await expect.element(button(one, fr.offers.take.ride)).not.toBeInTheDocument();
    await expect.element(titleOf(screen, "Alice")).toHaveFocus();
  });

  test("OffersSection — une offre supprimée par un autre pendant l'action : le focus va sur le titre de la section", async () => {
    mocks.take.mockImplementationOnce(() => {
      rows = rows.filter((row) => row.id !== "ride1");
      return Promise.reject(notFound());
    });
    const { screen } = await renderSection({ me: meNina });
    await expect.element(button(offerOf(screen, "Alice"), fr.offers.take.ride)).toBeVisible();

    await button(offerOf(screen, "Alice"), fr.offers.take.ride).click();

    // The offer and its button are gone: the section is still there, and it has the focus.
    await expect.element(screen.getByText(fr.offers.empty.ride)).toBeVisible();
    await expect.element(offerOf(screen, "Alice")).not.toBeInTheDocument();
    await expect.element(sectionTitle(screen)).toHaveFocus();
  });

  test("OffersSection — la page montre la réponse bien après la fin de la requête : le focus la suit", async () => {
    // The request is over, and the list is in the cache, when the page draws it a moment later.
    notifyManager.setScheduler((callback) => {
      setTimeout(callback, 150);
    });
    try {
      const { screen } = await renderSection({ me: meNina });
      const one = offerOf(screen, "Alice");
      await expect.element(button(one, fr.offers.take.ride)).toBeVisible();

      await button(one, fr.offers.take.ride).click();

      await expect.element(button(one, fr.offers.leave.ride)).toHaveFocus();
    } finally {
      notifyManager.setScheduler((callback) => {
        setTimeout(callback, 0);
      });
    }
  });

  test("OffersSection — une place prise dont la relecture échoue ne laisse rien en attente : le focus ne bouge pas plus tard", async () => {
    const { screen, queryClient } = await renderSection({ me: meNina });
    const one = offerOf(screen, "Alice");
    await expect.element(button(one, fr.offers.take.ride)).toBeVisible();
    // The place is taken, but the list cannot be read again: the page keeps what it showed.
    mocks.list.mockRejectedValueOnce(new Error("offline"));

    await button(one, fr.offers.take.ride).click();

    await vi.waitFor(() => {
      expect(mocks.take).toHaveBeenCalledTimes(1);
      expect(mocks.list).toHaveBeenCalledTimes(2);
    });
    await expect.element(button(one, fr.offers.take.ride)).toHaveFocus();

    // Later the member is elsewhere (nothing has the focus), and a refresh brings the new places: it is not the member's action any more, the focus stays.
    if (!(document.activeElement instanceof HTMLElement)) throw new Error("nothing is focused");
    document.activeElement.blur();
    await queryClient.invalidateQueries({ queryKey: ["offers", "event"] });
    await expect.element(button(one, fr.offers.leave.ride)).toBeVisible();
    expect(focused()).toBe(document.body);
  });

  test("OffersSection — un serveur qui ne répond pas : l'échec est dit sans attendre la relecture de la liste", async () => {
    const { screen } = await renderSection({ me: meNina });
    const one = offerOf(screen, "Alice");
    await expect.element(button(one, fr.offers.take.ride)).toBeVisible();
    // The list cannot be read again for a while (the client retries it): the failure does not wait for it.
    mocks.list.mockReturnValue(new Promise(() => {}));
    mocks.take.mockRejectedValueOnce(new ClientResponseError({ status: 500, response: {} }));

    await button(one, fr.offers.take.ride).click();

    await expect.element(one.getByRole("alert")).toHaveTextContent(fr.errors.generic);
    // The button is back with the focus for another try, and the list was asked for again all the same.
    await expect
      .element(button(one, fr.offers.take.ride))
      .not.toHaveAttribute("aria-disabled", "true");
    await expect.element(button(one, fr.offers.take.ride)).toHaveFocus();
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  test("OffersSection — un refus inconnu donne le message générique, dans l'offre qui l'a reçu seulement", async () => {
    mocks.take.mockRejectedValueOnce(new Error("boom"));
    rows = [offer("r1", "ride", alice, { seats: 2 }), offer("r2", "ride", sam, { seats: 2 })];
    const { screen } = await renderSection({ me: meNina });
    await expect.element(offerOf(screen, "Sam")).toBeVisible();

    await button(offerOf(screen, "Sam"), fr.offers.take.ride).click();

    await expect
      .element(offerOf(screen, "Sam").getByRole("alert"))
      .toHaveTextContent(fr.errors.generic);
    await expect.element(offerOf(screen, "Alice").getByRole("alert")).not.toBeInTheDocument();
  });
});

// --- Removing someone ---

describe("removing someone", () => {
  test("OffersSection — Retirer : pour soi, pour le propriétaire et pour un admin seulement", async () => {
    // A passenger removes themselves, nobody else.
    const passenger = await renderSection({ me: meBob });
    await expect.element(offerOf(passenger.screen, "Alice")).toBeVisible();
    expect(names(passenger.screen)).toEqual(["Retirer Bob"]);
    await passenger.screen.unmount();

    // The owner removes everyone, Sam who has no account included.
    const owner = await renderSection({ me: meAlice });
    await expect.element(offerOf(owner.screen, "Alice")).toBeVisible();
    expect(names(owner.screen)).toEqual(["Retirer Bob", "Retirer Sam"]);
    await owner.screen.unmount();

    // An admin too.
    const boss = await renderSection({ me: meAdmin });
    await expect.element(offerOf(boss.screen, "Alice")).toBeVisible();
    expect(names(boss.screen)).toEqual(["Retirer Bob", "Retirer Sam"]);
    await boss.screen.unmount();

    // Another member removes nobody; and nobody without a runner yet.
    const other = await renderSection({ me: meNina });
    await expect.element(offerOf(other.screen, "Alice")).toBeVisible();
    expect(names(other.screen)).toEqual([]);
    await other.screen.unmount();

    const nobody = await renderSection({ me: null });
    await expect.element(offerOf(nobody.screen, "Alice")).toBeVisible();
    expect(names(nobody.screen)).toEqual([]);
  });

  test("OffersSection — le propriétaire retire quelqu'un : sa place est libre, et le focus va sur le titre de l'offre", async () => {
    const { screen } = await renderSection({ me: meAlice });
    const one = offerOf(screen, "Alice");
    await expect.element(one.getByText("2 places prises sur 4")).toBeVisible();

    await button(one, fr.offers.removeFor("Sam")).click();

    await expect.element(one.getByText("1 place prise sur 4")).toBeVisible();
    expect(mocks.leave).toHaveBeenCalledTimes(1);
    expect(mocks.leave).toHaveBeenCalledWith("m-sam");
    expect(people(one)).toEqual(["Bob"]);
    // The button went with the row: the focus is on the offer, never on the page.
    await expect.element(one.getByRole("heading", { level: 3, name: "Alice" })).toHaveFocus();
  });

  test("OffersSection — se retirer soi-même rend « Je monte », qui prend le focus", async () => {
    const { screen } = await renderSection({ me: meBob });
    const one = offerOf(screen, "Alice");
    await expect.element(one.getByText("2 places prises sur 4")).toBeVisible();

    await button(one, fr.offers.removeFor("Bob")).click();

    await expect.element(one.getByText("1 place prise sur 4")).toBeVisible();
    expect(mocks.leave).toHaveBeenCalledWith("m-bob");
    await expect.element(button(one, fr.offers.take.ride)).toHaveFocus();
  });

  test("OffersSection — retirer une place déjà libérée ailleurs : la ligne s'en va, et le focus va sur le titre de l'offre", async () => {
    mocks.leave.mockImplementationOnce(() => {
      rows = rows.map((row) =>
        withPlaces(
          row,
          (row.expand.offer_members_via_offer ?? []).filter((member) => member.id !== "m-sam"),
        ),
      );
      return Promise.reject(notFound());
    });
    const { screen } = await renderSection({ me: meAlice });
    const one = offerOf(screen, "Alice");
    await expect.element(button(one, fr.offers.removeFor("Sam"))).toBeVisible();

    await button(one, fr.offers.removeFor("Sam")).click();

    await expect.element(one.getByRole("alert")).toHaveTextContent(fr.errors.generic);
    expect(people(one)).toEqual(["Bob"]);
    await expect.element(titleOf(screen, "Alice")).toHaveFocus();
  });

  test("OffersSection — un refus à la suppression d'une place est traduit dans l'offre", async () => {
    mocks.leave.mockRejectedValueOnce(new Error("boom"));
    const { screen } = await renderSection({ me: meAlice });
    const one = offerOf(screen, "Alice");
    await expect.element(one).toBeVisible();

    await pressFocused(button(one, fr.offers.removeFor("Sam")));

    await expect.element(one.getByRole("alert")).toHaveTextContent(fr.errors.generic);
    expect(people(one)).toEqual(["Bob", "Sam"]);
    await expect.element(button(one, fr.offers.removeFor("Sam"))).toHaveFocus();
  });
});

// --- Deleting an offer ---

describe("deleting an offer", () => {
  test("OffersSection — Supprimer seulement pour le propriétaire et pour un admin", async () => {
    const owner = await renderSection({ me: meAlice });
    await expect.element(offerOf(owner.screen, "Alice")).toBeVisible();
    await expect.element(deleteButton(offerOf(owner.screen, "Alice"))).toBeVisible();
    await owner.screen.unmount();

    const other = await renderSection({ me: meBob });
    await expect.element(offerOf(other.screen, "Alice")).toBeVisible();
    await expect.element(deleteButton(offerOf(other.screen, "Alice"))).not.toBeInTheDocument();
    await other.screen.unmount();

    // An admin deletes any offer, whoever's.
    const boss = await renderSection({ me: meAdmin });
    await expect.element(offerOf(boss.screen, "Alice")).toBeVisible();
    await expect.element(deleteButton(offerOf(boss.screen, "Alice"))).toBeVisible();
  });

  test("OffersSection — Supprimer nomme les personnes qui perdent leur place", async () => {
    const { screen } = await renderSection({ me: meAlice });
    const one = offerOf(screen, "Alice");
    await expect.element(one).toBeVisible();

    await deleteButton(one).click();

    // Everybody who is in the offer is named, since they lose their place with it.
    const dialog = screen.getByRole("dialog", {
      name: "Supprimer cette offre ? Bob et Sam perdront leur place.",
    });
    await expect.element(dialog).toBeVisible();
    expect(mocks.remove).not.toHaveBeenCalled();

    // Cancelling deletes nothing and gives the focus back to the button.
    await dialog.getByRole("button", { name: fr.common.cancel }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(mocks.remove).not.toHaveBeenCalled();
    await expect.element(deleteButton(one)).toHaveFocus();

    // Confirming deletes the offer and its places, and the focus is on the title of the section, never on the page.
    await deleteButton(one).click();
    await dialog.getByRole("button", { name: fr.offers.delete }).click();

    await expect.element(screen.getByText(fr.offers.empty.ride)).toBeVisible();
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith("ride1");
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(offerOf(screen, "Alice")).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("heading", { level: 2, name: fr.offers.title.ride }))
      .toHaveFocus();
  });

  test("OffersSection — la confirmation d'une seule personne l'accorde, et sans personne elle ne nomme personne", async () => {
    rows = [
      offer("l1", "lodging", alice, { place: "Gîte" }, [["m1", bob]]),
      offer("l2", "lodging", sam, { place: "Camping" }),
    ];
    const { screen } = await renderSection({ me: meAdmin, kind: "lodging" });
    await expect.element(offerOf(screen, "Alice")).toBeVisible();

    await deleteButton(offerOf(screen, "Alice")).click();
    const one = screen.getByRole("dialog", {
      name: "Supprimer cette offre ? Bob perdra sa place.",
    });
    await expect.element(one).toBeVisible();
    await one.getByRole("button", { name: fr.common.cancel }).click();

    await deleteButton(offerOf(screen, "Sam")).click();
    const empty = screen.getByRole("dialog", { name: fr.offers.deleteConfirmEmpty });
    await expect.element(empty).toBeVisible();
    expect(plain(empty.element().textContent)).not.toContain("perd");
  });

  test("OffersSection — trois personnes ou plus sont nommées en liste", async () => {
    rows = [
      offer("r1", "ride", alice, { place: "Lyon", seats: 4 }, [
        ["m1", sam],
        ["m2", bob],
        ["m3", nina],
      ]),
    ];
    const { screen } = await renderSection({ me: meAlice });
    await expect.element(offerOf(screen, "Alice")).toBeVisible();

    await deleteButton(offerOf(screen, "Alice")).click();

    await expect
      .element(
        screen.getByRole("dialog", {
          name: "Supprimer cette offre ? Bob, Nina et Sam perdront leur place.",
        }),
      )
      .toBeVisible();
  });

  test("OffersSection — la confirmation en anglais", async () => {
    const { screen } = await renderSection({ me: meAlice, languages: ["en-GB"] });
    await expect.element(offerOf(screen, "Alice")).toBeVisible();

    await button(offerOf(screen, "Alice"), en.offers.delete).click();

    await expect
      .element(
        screen.getByRole("dialog", {
          name: "Delete this offer? Bob and Sam will lose their place.",
        }),
      )
      .toBeVisible();
  });

  test("OffersSection — l'admin supprime l'offre d'un autre", async () => {
    const { screen } = await renderSection({ me: meAdmin });
    await expect.element(offerOf(screen, "Alice")).toBeVisible();

    await deleteButton(offerOf(screen, "Alice")).click();
    await screen.getByRole("dialog").getByRole("button", { name: fr.offers.delete }).click();

    await expect.element(screen.getByText(fr.offers.empty.ride)).toBeVisible();
    expect(mocks.remove).toHaveBeenCalledWith("ride1");
  });

  test("OffersSection — un refus à la suppression est traduit, et la fenêtre reste ouverte", async () => {
    mocks.remove.mockRejectedValueOnce(new Error("boom"));
    const { screen } = await renderSection({ me: meAlice });
    await expect.element(offerOf(screen, "Alice")).toBeVisible();

    await deleteButton(offerOf(screen, "Alice")).click();
    const dialog = screen.getByRole("dialog");
    await dialog.getByRole("button", { name: fr.offers.delete }).click();

    await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.generic);
    await expect.element(offerOf(screen, "Alice")).toBeVisible();
  });

  test("OffersSection — la confirmation suit la liste : une offre supprimée par un autre ferme la fenêtre", async () => {
    const { screen, queryClient } = await renderSection({ me: meAlice });
    await expect.element(offerOf(screen, "Alice")).toBeVisible();
    await deleteButton(offerOf(screen, "Alice")).click();
    const dialog = screen.getByRole("dialog");
    await expect.element(dialog).toBeVisible();

    rows = [];
    await queryClient.invalidateQueries({ queryKey: ["offers", "event"] });

    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(screen.getByText(fr.offers.empty.ride)).toBeVisible();
    // The offer and the button that opened the window are gone: the title of the section has the focus.
    await expect.element(sectionTitle(screen)).toHaveFocus();
  });

  test("OffersSection — annuler la confirmation ne laisse rien en attente : une offre supprimée plus tard ne prend pas le focus", async () => {
    const { screen, queryClient } = await renderSection({ me: meAlice });
    await expect.element(offerOf(screen, "Alice")).toBeVisible();
    await deleteButton(offerOf(screen, "Alice")).click();
    await screen.getByRole("dialog").getByRole("button", { name: fr.common.cancel }).click();
    await expect.element(deleteButton(offerOf(screen, "Alice"))).toHaveFocus();

    // Nothing has the focus, and somebody else deletes the offer: not the member's action.
    if (!(document.activeElement instanceof HTMLElement)) throw new Error("nothing is focused");
    document.activeElement.blur();
    rows = [];
    await queryClient.invalidateQueries({ queryKey: ["offers", "event"] });

    await expect.element(screen.getByText(fr.offers.empty.ride)).toBeVisible();
    expect(focused()).toBe(document.body);
  });

  test("OffersSection — un double envoi de la confirmation ne supprime qu'une fois, et le bouton garde le focus", async () => {
    const pending = Promise.withResolvers<unknown>();
    mocks.remove.mockReturnValue(pending.promise);
    const { screen } = await renderSection({ me: meAlice });
    await expect.element(offerOf(screen, "Alice")).toBeVisible();
    await deleteButton(offerOf(screen, "Alice")).click();
    const dialog = screen.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: fr.offers.delete });
    await expect.element(confirm).toBeVisible();

    // Two clicks in the same tick, as a double tap does.
    const element = confirm.element();
    if (!(element instanceof HTMLButtonElement)) throw new Error("not a button");
    element.focus();
    element.click();
    element.click();

    // It says it is busy, and it is not disabled: it keeps the focus.
    await expect.element(confirm).toHaveAttribute("aria-disabled", "true");
    expect(element.disabled).toBe(false);
    expect(focused()).toBe(element);
    expect(mocks.remove).toHaveBeenCalledTimes(1);

    rows = [];
    pending.resolve(true);
    await expect.element(screen.getByText(fr.offers.empty.ride)).toBeVisible();
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    await expect.element(sectionTitle(screen)).toHaveFocus();
  });
});

/** Waits for the button to be there, and reads its height. */
async function heightOf(target: Locator) {
  await expect.element(target).toBeVisible();
  return target.element().getBoundingClientRect().height;
}

// --- Offering a car or a lodging ---

const propose = (scope: { getByRole: Screen["getByRole"] }, kind: OfferKind = "ride") =>
  button(scope, fr.offers.propose[kind]);

describe("offering", () => {
  test("OffersSection — « Proposer une voiture » absent quand j'ai déjà une place ou une voiture", async () => {
    // Nina has no car and no place in one: she may offer hers.
    const nobody = await renderSection({ me: meNina });
    await expect.element(offerOf(nobody.screen, "Alice")).toBeVisible();
    await expect.element(propose(nobody.screen)).toBeVisible();
    await nobody.screen.unmount();

    // Alice has a car already.
    const driver = await renderSection({ me: meAlice });
    await expect.element(offerOf(driver.screen, "Alice")).toBeVisible();
    await expect.element(propose(driver.screen)).not.toBeInTheDocument();
    await driver.screen.unmount();

    // Bob has a place in it.
    const passenger = await renderSection({ me: meBob });
    await expect.element(offerOf(passenger.screen, "Alice")).toBeVisible();
    await expect.element(propose(passenger.screen)).not.toBeInTheDocument();
    await passenger.screen.unmount();

    // An admin who has neither may offer one, like anybody.
    const boss = await renderSection({ me: meAdmin });
    await expect.element(offerOf(boss.screen, "Alice")).toBeVisible();
    await expect.element(propose(boss.screen)).toBeVisible();
    await boss.screen.unmount();

    // Nobody known: the offers are read, and nothing is proposed.
    const stranger = await renderSection({ me: null });
    await expect.element(offerOf(stranger.screen, "Alice")).toBeVisible();
    await expect.element(propose(stranger.screen)).not.toBeInTheDocument();
  });

  test("OffersSection — une place ou un logement à soi ne compte que pour sa sorte", async () => {
    // In the lodgings: Bob owns one, Nina has a bed in it. Alice has nothing there, though she has a car.
    const owner = await renderSection({ me: meBob, kind: "lodging" });
    await expect.element(offerOf(owner.screen, "Bob")).toBeVisible();
    await expect.element(propose(owner.screen, "lodging")).not.toBeInTheDocument();
    await owner.screen.unmount();

    const guest = await renderSection({ me: meNina, kind: "lodging" });
    await expect.element(offerOf(guest.screen, "Bob")).toBeVisible();
    await expect.element(propose(guest.screen, "lodging")).not.toBeInTheDocument();
    await guest.screen.unmount();

    const driver = await renderSection({ me: meAlice, kind: "lodging" });
    await expect.element(offerOf(driver.screen, "Bob")).toBeVisible();
    await expect.element(propose(driver.screen, "lodging")).toBeVisible();
    // The lodging button is not the car's.
    await expect.element(propose(driver.screen, "ride")).not.toBeInTheDocument();
  });

  test("OffersSection — sans offre, on peut proposer ; pendant le chargement et sur une erreur, non", async () => {
    rows = [];
    const empty = await renderSection({ me: meNina });
    await expect.element(empty.screen.getByText(fr.offers.empty.ride)).toBeVisible();
    await expect.element(propose(empty.screen)).toBeVisible();
    await empty.screen.unmount();

    // Whether the member already has a place is known from the list: until there is one, nothing is offered.
    mocks.list.mockReturnValueOnce(new Promise(() => {}));
    const loading = await renderSection({ me: meNina });
    await expect.element(section(loading.screen).getByText(fr.common.loading)).toBeVisible();
    await expect.element(propose(loading.screen)).not.toBeInTheDocument();
    await loading.screen.unmount();

    mocks.list.mockRejectedValueOnce(new Error("boom"));
    const failed = await renderSection({ me: meNina });
    await expect.element(section(failed.screen).getByRole("alert")).toBeVisible();
    await expect.element(propose(failed.screen)).not.toBeInTheDocument();
  });

  test("OffersSection — en anglais, « Offer a car » et « Offer lodging »", async () => {
    const rides = await renderSection({ me: meNina, languages: ["en"] });
    await expect
      .element(rides.screen.getByRole("button", { name: en.offers.propose.ride, exact: true }))
      .toBeVisible();
    expect(en.offers.propose).toEqual({ ride: "Offer a car", lodging: "Offer lodging" });
    await rides.screen.unmount();

    const lodgings = await renderSection({ me: meAlice, kind: "lodging", languages: ["en"] });
    await expect
      .element(
        lodgings.screen.getByRole("button", { name: en.offers.propose.lodging, exact: true }),
      )
      .toBeVisible();
  });

  test("OffersSection — Proposer une voiture ouvre le formulaire ; l'offre créée est sur la page, et le focus sur le titre de la section", async () => {
    const { screen } = await renderSection({ me: meNina });
    await expect.element(offerOf(screen, "Alice")).toBeVisible();

    await propose(screen).click();

    const dialog = screen.getByRole("dialog", { name: fr.offers.form.titleNew.ride });
    await expect.element(dialog).toBeVisible();
    await dialog.getByLabelText(fr.offers.form.place.ride, { exact: true }).fill("Annecy, gare");
    await dialog.getByLabelText(fr.offers.form.seats.ride, { exact: true }).fill("3");
    await dialog.getByRole("button", { name: fr.offers.form.save, exact: true }).click();

    // Her car is on the page, the window is closed, and the button is gone: she has a car now.
    await expect.element(offerOf(screen, "Nina")).toBeVisible();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith({
      event: "event",
      kind: "ride",
      place: "Annecy, gare",
      seats: 3,
      date: "2026-06-13",
      time: "",
      notes: "",
    });
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(propose(screen)).not.toBeInTheDocument();
    // The focus is not lost on the page: it goes to the title of the section.
    await expect
      .element(screen.getByRole("heading", { level: 2, name: fr.offers.title.ride }))
      .toHaveFocus();
  });

  test("OffersSection — Annuler dans le formulaire rend le focus au bouton Proposer, qui reste", async () => {
    const { screen } = await renderSection({ me: meNina });
    await expect.element(offerOf(screen, "Alice")).toBeVisible();

    await propose(screen).click();
    const dialog = screen.getByRole("dialog", { name: fr.offers.form.titleNew.ride });
    await expect.element(dialog).toBeVisible();
    await dialog.getByRole("button", { name: fr.common.cancel }).click();

    await expect.element(dialog).not.toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
    await expect.element(propose(screen)).toHaveFocus();
  });

  test("OffersSection — Proposer un logement : le formulaire du logement, et son offre sur la page", async () => {
    const { screen } = await renderSection({ me: meAlice, kind: "lodging" });
    await expect.element(offerOf(screen, "Bob")).toBeVisible();

    await propose(screen, "lodging").click();

    const dialog = screen.getByRole("dialog", { name: fr.offers.form.titleNew.lodging });
    await expect.element(dialog).toBeVisible();
    await dialog.getByLabelText(fr.offers.form.place.lodging, { exact: true }).fill("Camping");
    await dialog.getByRole("button", { name: fr.offers.form.save, exact: true }).click();

    await expect.element(offerOf(screen, "Alice")).toBeVisible();
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ event: "event", kind: "lodging", place: "Camping", seats: 0 }),
    );
    await expect.element(propose(screen, "lodging")).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("heading", { level: 2, name: fr.offers.title.lodging }))
      .toHaveFocus();
  });

  test("OffersSection — une offre refusée (offer_already_member) reste dans la fenêtre, et le bouton aussi", async () => {
    mocks.create.mockRejectedValueOnce(refusal("kind", "offer_already_member"));
    const { screen } = await renderSection({ me: meNina });
    await expect.element(offerOf(screen, "Alice")).toBeVisible();

    await propose(screen).click();
    const dialog = screen.getByRole("dialog", { name: fr.offers.form.titleNew.ride });
    await dialog.getByLabelText(fr.offers.form.place.ride, { exact: true }).fill("Annecy");
    await dialog.getByLabelText(fr.offers.form.seats.ride, { exact: true }).fill("3");
    await dialog.getByRole("button", { name: fr.offers.form.save, exact: true }).click();

    await expect
      .element(dialog.getByRole("alert").getByText(fr.errors.offer_already_member))
      .toBeVisible();
    await expect.element(dialog).toBeVisible();
  });
});

// --- Editing an offer, and adding someone to it ---

const edit = (scope: { getByRole: Screen["getByRole"] }) => button(scope, fr.offers.edit);
const addSomeone = (scope: { getByRole: Screen["getByRole"] }) =>
  button(scope, fr.offers.addSomeone);

describe("managing an offer", () => {
  test("OffersSection — Modifier et Ajouter quelqu'un pour le propriétaire et un admin seulement", async () => {
    const owner = await renderSection({ me: meAlice });
    await expect.element(offerOf(owner.screen, "Alice")).toBeVisible();
    await expect.element(edit(offerOf(owner.screen, "Alice"))).toBeVisible();
    await expect.element(addSomeone(offerOf(owner.screen, "Alice"))).toBeVisible();
    await owner.screen.unmount();

    // A passenger, a member who is not in the car, and nobody known.
    for (const me of [meBob, meNina, null]) {
      const other = await renderSection({ me });
      await expect.element(offerOf(other.screen, "Alice")).toBeVisible();
      await expect.element(edit(offerOf(other.screen, "Alice"))).not.toBeInTheDocument();
      await expect.element(addSomeone(offerOf(other.screen, "Alice"))).not.toBeInTheDocument();
      await other.screen.unmount();
    }

    // An admin changes any offer, whoever's, and places anybody in it.
    const boss = await renderSection({ me: meAdmin });
    await expect.element(offerOf(boss.screen, "Alice")).toBeVisible();
    await expect.element(edit(offerOf(boss.screen, "Alice"))).toBeVisible();
    await expect.element(addSomeone(offerOf(boss.screen, "Alice"))).toBeVisible();
  });

  test("OffersSection — Ajouter quelqu'un n'est pas proposé sur une offre pleine, mais Modifier et Supprimer le restent", async () => {
    // Alice's car has 2 seats, and Sam and Bob are in them; Bob's lodging gives no limit.
    rows = [
      offer("ride1", "ride", alice, { place: "Lyon", seats: 2 }, [
        ["m-sam", sam],
        ["m-bob", bob],
      ]),
      lodging(),
    ];
    const rides = await renderSection({ me: meAlice });
    const full = offerOf(rides.screen, "Alice");
    await expect.element(full.getByText(fr.offers.full)).toBeVisible();
    await expect.element(addSomeone(full)).not.toBeInTheDocument();
    await expect.element(edit(full)).toBeVisible();
    await expect.element(deleteButton(full)).toBeVisible();
    await rides.screen.unmount();

    // An offer with no limit is never full: an admin can always put someone in.
    const lodgings = await renderSection({ me: meAdmin, kind: "lodging" });
    await expect.element(addSomeone(offerOf(lodgings.screen, "Bob"))).toBeVisible();
  });

  test("OffersSection — les boutons qui se répètent d'une offre à l'autre sont décrits par le titre de leur offre", async () => {
    rows = [
      offer("r1", "ride", alice, { place: "Lyon", seats: 3 }),
      offer("r2", "ride", sam, { place: "Paris", seats: 3 }),
    ];
    // The admin manages both offers: three buttons each, with the same names.
    const boss = await renderSection({ me: meAdmin });
    for (const owner of ["Alice", "Sam"]) {
      const one = offerOf(boss.screen, owner);
      await expect.element(one).toBeVisible();
      for (const name of [fr.offers.addSomeone, fr.offers.edit, fr.offers.delete]) {
        await expect.element(button(one, name)).toHaveAccessibleDescription(owner);
      }
    }
    await boss.screen.unmount();

    // « Je monte » is on each offer where a place can be taken.
    const guest = await renderSection({ me: meNina });
    for (const owner of ["Alice", "Sam"]) {
      const one = offerOf(guest.screen, owner);
      await expect.element(button(one, fr.offers.take.ride)).toHaveAccessibleDescription(owner);
    }
  });

  test("OffersSection — Modifier ouvre le formulaire prérempli, enregistre, et rend le focus à Modifier", async () => {
    const { screen } = await renderSection({ me: meAlice });
    const one = offerOf(screen, "Alice");
    await expect.element(one).toBeVisible();

    await edit(one).click();

    const dialog = screen.getByRole("dialog", { name: fr.offers.form.titleEdit });
    await expect.element(dialog).toBeVisible();
    const where = dialog.getByLabelText(fr.offers.form.place.ride, { exact: true });
    await expect.element(where).toHaveValue("Lyon, Part-Dieu");
    await expect
      .element(dialog.getByLabelText(fr.offers.form.seats.ride, { exact: true }))
      .toHaveValue(4);
    await where.fill("Lyon, Perrache");
    await dialog.getByRole("button", { name: fr.offers.form.save, exact: true }).click();

    // The page has the new place, and the window is closed: the focus is on the button that opened it.
    expect(await textOf(offerOf(screen, "Alice").getByText(/^Départ de/))).toBe(
      "Départ de Lyon, Perrache · sam. 13 juin · 06:30",
    );
    await expect.element(dialog).not.toBeInTheDocument();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith("ride1", {
      place: "Lyon, Perrache",
      seats: 4,
      date: "2026-06-13",
      time: "06:30",
      notes: "Rendez-vous devant la gare.\nPas de chien.",
    });
    await expect.element(edit(offerOf(screen, "Alice"))).toHaveFocus();
  });

  test("OffersSection — un admin modifie le logement d'un autre", async () => {
    const { screen } = await renderSection({ me: meAdmin, kind: "lodging" });
    const one = offerOf(screen, "Bob");
    await expect.element(one).toBeVisible();

    await edit(one).click();

    const dialog = screen.getByRole("dialog", { name: fr.offers.form.titleEdit });
    await expect.element(dialog).toBeVisible();
    await expect
      .element(dialog.getByLabelText(fr.offers.form.endDate, { exact: true }))
      .toHaveValue("2026-06-14");
    await dialog.getByLabelText(fr.offers.form.url, { exact: true }).fill("");
    await dialog.getByRole("button", { name: fr.offers.form.save, exact: true }).click();

    await expect.element(dialog).not.toBeInTheDocument();
    expect(mocks.update).toHaveBeenCalledWith("lodging1", {
      place: "Gîte des Crêtes, Valloire",
      seats: 0,
      date: "2026-06-13",
      end_date: "2026-06-14",
      url: "",
      notes: "",
    });
    // The listing link goes with the address.
    await expect
      .element(offerOf(screen, "Bob").getByRole("link", { name: fr.offers.seeAd }))
      .not.toBeInTheDocument();
  });

  test("OffersSection — Ajouter quelqu'un ne propose que ceux qui peuvent prendre une place ; l'envoi les place, et le focus revient au bouton", async () => {
    const { screen } = await renderSection({ me: meAlice });
    const one = offerOf(screen, "Alice");
    await expect.element(one).toBeVisible();

    await addSomeone(one).click();

    const dialog = screen.getByRole("dialog", { name: fr.offers.addSomeoneTitle });
    await expect.element(dialog).toBeVisible();
    const who = dialog.getByLabelText(fr.participation.runner);
    // Alice owns the car, Sam and Bob are in it: Nina and the admin are left.
    await vi.waitFor(() => {
      const select = who.element();
      if (!(select instanceof HTMLSelectElement)) throw new Error("not a select");
      expect(
        Array.from(select.options)
          .filter((option) => option.value !== "")
          .map((option) => option.textContent),
      ).toEqual(["Admin", "Nina"]);
    });
    await who.selectOptions(nina.id);
    await dialog.getByRole("button", { name: fr.participation.addSubmit, exact: true }).click();

    await expect.element(offerOf(screen, "Alice").getByText("3 places prises sur 4")).toBeVisible();
    expect(mocks.take).toHaveBeenCalledTimes(1);
    expect(mocks.take).toHaveBeenCalledWith({ offer: "ride1", runner: nina.id });
    expect(people(offerOf(screen, "Alice"))).toEqual(["Bob", "Nina", "Sam"]);
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(addSomeone(offerOf(screen, "Alice"))).toHaveFocus();
  });

  test("OffersSection — Ajouter quelqu'un qui remplit l'offre : le bouton s'en va avec la dernière place, et le focus va sur le titre de l'offre", async () => {
    rows = [
      offer("ride1", "ride", alice, { place: "Lyon", seats: 3 }, [
        ["m-sam", sam],
        ["m-bob", bob],
      ]),
    ];
    const { screen } = await renderSection({ me: meAlice });
    const one = offerOf(screen, "Alice");
    await expect.element(one).toBeVisible();
    await addSomeone(one).click();
    const dialog = screen.getByRole("dialog", { name: fr.offers.addSomeoneTitle });
    const who = dialog.getByLabelText(fr.participation.runner);
    await expect.element(who).toBeVisible();
    await who.selectOptions(nina.id);

    await dialog.getByRole("button", { name: fr.participation.addSubmit, exact: true }).click();

    await expect.element(offerOf(screen, "Alice").getByText(fr.offers.full)).toBeVisible();
    await expect.element(dialog).not.toBeInTheDocument();
    // The button that opened the window is gone with the last place: the title of the offer has the focus.
    await expect.element(addSomeone(offerOf(screen, "Alice"))).not.toBeInTheDocument();
    await expect.element(titleOf(screen, "Alice")).toHaveFocus();
  });

  test("OffersSection — Ajouter quelqu'un : la page montre la réponse bien après la fin de la requête, et le focus la suit", async () => {
    rows = [
      offer("ride1", "ride", alice, { place: "Lyon", seats: 3 }, [
        ["m-sam", sam],
        ["m-bob", bob],
      ]),
    ];
    // The request is over, and the list is in the cache, when the page draws it a moment later.
    notifyManager.setScheduler((callback) => {
      setTimeout(callback, 150);
    });
    try {
      const { screen } = await renderSection({ me: meAlice });
      await expect.element(offerOf(screen, "Alice")).toBeVisible();
      await addSomeone(offerOf(screen, "Alice")).click();
      const dialog = screen.getByRole("dialog", { name: fr.offers.addSomeoneTitle });
      const who = dialog.getByLabelText(fr.participation.runner);
      await expect.element(who).toBeVisible();
      await who.selectOptions(nina.id);

      await dialog.getByRole("button", { name: fr.participation.addSubmit, exact: true }).click();

      await expect.element(dialog).not.toBeInTheDocument();
      await expect.element(titleOf(screen, "Alice")).toHaveFocus();
    } finally {
      notifyManager.setScheduler((callback) => {
        setTimeout(callback, 0);
      });
    }
  });

  test("OffersSection — une offre supprimée par un autre pendant que sa fenêtre Modifier est ouverte : le focus va sur le titre de la section", async () => {
    const { screen, queryClient } = await renderSection({ me: meAlice });
    await expect.element(offerOf(screen, "Alice")).toBeVisible();
    await edit(offerOf(screen, "Alice")).click();
    const dialog = screen.getByRole("dialog", { name: fr.offers.form.titleEdit });
    await expect.element(dialog).toBeVisible();

    rows = [];
    await queryClient.invalidateQueries({ queryKey: ["offers", "event"] });

    // The offer goes, and the window with it: the title of the section has the focus, never the page.
    await expect.element(screen.getByText(fr.offers.empty.ride)).toBeVisible();
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(sectionTitle(screen)).toHaveFocus();
  });

  test("OffersSection — une offre supprimée par un autre pendant que sa fenêtre Ajouter quelqu'un est ouverte : le focus va sur le titre de la section", async () => {
    const { screen, queryClient } = await renderSection({ me: meAlice });
    await expect.element(offerOf(screen, "Alice")).toBeVisible();
    await addSomeone(offerOf(screen, "Alice")).click();
    const dialog = screen.getByRole("dialog", { name: fr.offers.addSomeoneTitle });
    await expect.element(dialog).toBeVisible();

    rows = [];
    await queryClient.invalidateQueries({ queryKey: ["offers", "event"] });

    await expect.element(screen.getByText(fr.offers.empty.ride)).toBeVisible();
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(sectionTitle(screen)).toHaveFocus();
  });

  test("OffersSection — fermer la fenêtre Modifier ne laisse rien en attente : une offre supprimée plus tard ne prend pas le focus", async () => {
    const { screen, queryClient } = await renderSection({ me: meAlice });
    await expect.element(offerOf(screen, "Alice")).toBeVisible();
    await edit(offerOf(screen, "Alice")).click();
    await screen.getByRole("dialog").getByRole("button", { name: fr.common.cancel }).click();
    await expect.element(edit(offerOf(screen, "Alice"))).toHaveFocus();

    // Nothing has the focus, and somebody else deletes the offer: not the member's action.
    if (!(document.activeElement instanceof HTMLElement)) throw new Error("nothing is focused");
    document.activeElement.blur();
    rows = [];
    await queryClient.invalidateQueries({ queryKey: ["offers", "event"] });

    await expect.element(screen.getByText(fr.offers.empty.ride)).toBeVisible();
    expect(focused()).toBe(document.body);
  });

  test("OffersSection — l'admin place quelqu'un dans la voiture d'un autre", async () => {
    const { screen } = await renderSection({ me: meAdmin });
    const one = offerOf(screen, "Alice");
    await expect.element(one).toBeVisible();

    await addSomeone(one).click();

    const dialog = screen.getByRole("dialog", { name: fr.offers.addSomeoneTitle });
    await expect.element(dialog).toBeVisible();
    const who = dialog.getByLabelText(fr.participation.runner);
    await expect.element(who).toBeVisible();
    await who.selectOptions(admin.id);
    await dialog.getByRole("button", { name: fr.participation.addSubmit, exact: true }).click();

    await expect.element(dialog).not.toBeInTheDocument();
    expect(mocks.take).toHaveBeenCalledWith({ offer: "ride1", runner: admin.id });
  });
});

describe("tap targets", () => {
  test("OffersSection — zones tactiles d'au moins 44 px", async () => {
    await page.viewport(390, 844);
    const heights: number[] = [];

    // A runner who has nothing: she may stay at Bob's, and read the listing.
    const guest = await renderSection({ me: meAlice, kind: "lodging" });
    const lodgingOffer = offerOf(guest.screen, "Bob");
    heights.push(
      await heightOf(button(lodgingOffer, fr.offers.take.lodging)),
      await heightOf(lodgingOffer.getByRole("link", { name: fr.offers.seeAd })),
    );
    await guest.screen.unmount();

    // The owner of a car: she removes someone, and deletes the offer.
    const owner = await renderSection({ me: meAlice });
    const ride = offerOf(owner.screen, "Alice");
    heights.push(
      await heightOf(button(ride, fr.offers.removeFor("Sam"))),
      await heightOf(button(ride, fr.offers.delete)),
    );
    await owner.screen.unmount();

    // A passenger leaves.
    const passenger = await renderSection({ me: meBob });
    heights.push(await heightOf(button(offerOf(passenger.screen, "Alice"), fr.offers.leave.ride)));

    expect(heights).toHaveLength(5);
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
    await page.viewport(FRAME.width, FRAME.height);
  });

  test("OffersSection — Proposer, Modifier et Ajouter quelqu'un font au moins 44 px", async () => {
    await page.viewport(390, 844);
    const heights: number[] = [];

    const guest = await renderSection({ me: meNina });
    await expect.element(offerOf(guest.screen, "Alice")).toBeVisible();
    heights.push(await heightOf(propose(guest.screen)));
    await guest.screen.unmount();

    const owner = await renderSection({ me: meAlice });
    const ride = offerOf(owner.screen, "Alice");
    heights.push(await heightOf(edit(ride)), await heightOf(addSomeone(ride)));

    expect(heights).toHaveLength(3);
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
    await page.viewport(FRAME.width, FRAME.height);
  });
});
