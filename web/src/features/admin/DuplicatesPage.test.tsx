import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ToastProvider } from "../../components/Toast";
import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { createFormatters } from "../../lib/format";
import { ensureTemporal } from "../../lib/temporal";
import { eventLabel } from "../events/eventLabel";
import { eventRecord, event2Record, f15, f42, trailType } from "../events/testFixture";
import { DuplicatesPage } from "./DuplicatesPage";
import { SEARCH_PAUSE_MS } from "./EventPicker";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;
type SendOptions = { method?: string; body?: Rec };
type BoundFilter = { raw: string; params: Rec };

const mocks = vi.hoisted(() => ({
  // What `pb.filter` was given, by the text it answered with: the answer of the real one is opaque.
  bound: new Map<string, { raw: string; params: Record<string, unknown> }>(),
  eventsList: vi.fn<(page: number, perPage: number, options: Rec) => Promise<unknown>>(),
  eventGetOne: vi.fn<(id: string, options: Rec) => Promise<unknown>>(),
  send: vi.fn<(path: string, options: SendOptions) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: { isValid: true, record: null, onChange: () => () => {} },
    // The filter says what was bound, so that a test can tell the parameters from the text.
    filter: (raw: string, params: Rec) => {
      const token = `filter-${mocks.bound.size}`;
      mocks.bound.set(token, { raw, params });
      return token;
    },
    send: mocks.send,
    collection: (name: string) =>
      ({
        events: { getList: mocks.eventsList, getOne: mocks.eventGetOne },
      })[name],
  },
}));

/** The same trail, typed a second time by somebody else: the duplicate to merge. */
const dupFormat = {
  ...f42,
  id: "fDup",
  event: "event3",
  date: "",
  distance_km: 42.2,
  expand: { race_type: trailType },
};
const dupEvent = {
  ...eventRecord,
  id: "event3",
  name: "Trail des Crêtes 2026",
  start_date: "2026-06-13",
  end_date: "",
  expand: { formats_via_event: [dupFormat] },
};
const events = [eventRecord, event2Record, dupEvent];

/** The counters of a merge of two events: formats, comments and offers moved, and one date that went. */
const EVENTS_PREVIEW = {
  movedFormats: 1,
  movedParticipations: 3,
  droppedParticipations: 0,
  clearedFormatDates: 1,
  movedComments: 2,
  movedOffers: 1,
};
/** The counters of a merge of two formats: the other one wins a duplicate, so two moved and one dropped. */
const FORMATS_PREVIEW = {
  movedFormats: 0,
  movedParticipations: 2,
  droppedParticipations: 1,
  clearedFormatDates: 0,
  movedComments: 0,
  movedOffers: 0,
};

const MERGE_EVENTS = "/api/app/admin/merge-events";
const MERGE_FORMATS = "/api/app/admin/merge-formats";

function boundFilter(options: Rec): BoundFilter {
  const found = mocks.bound.get(String(options.filter));
  if (found === undefined) throw new Error("a filter that was not made by pb.filter");
  return found;
}

function installServer() {
  // The search of the pickers: the events whose name has the term, the way `~` does.
  mocks.eventsList.mockImplementation((_page, _perPage, options) => {
    const term = String(boundFilter(options).params.q).toLowerCase();
    const items = events
      .filter((event) => event.name.toLowerCase().includes(term))
      .map(({ expand: _expand, ...event }) => event);
    return Promise.resolve({ items, page: 1, perPage: 8, totalItems: items.length });
  });
  mocks.eventGetOne.mockImplementation((id) => {
    const found = events.find((event) => event.id === id);
    return found ? Promise.resolve(found) : Promise.reject(new Error(`no event ${id}`));
  });
  mocks.send.mockImplementation((path) => {
    if (path === MERGE_EVENTS) return Promise.resolve(EVENTS_PREVIEW);
    if (path === MERGE_FORMATS) return Promise.resolve(FORMATS_PREVIEW);
    return Promise.reject(new Error(`unexpected request ${path}`));
  });
}

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(() => {
  mocks.bound.clear();
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

/** How a route of the application refuses: the status, and a code. */
const coded = (status: number, code: string) => refusal(status, { code });

async function renderPage(languages = ["fr-FR"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        <ToastProvider>
          <DuplicatesPage />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { screen, queryClient };
}

type Screen = Awaited<ReturnType<typeof renderPage>>["screen"];

const t = fr.admin;
const f = createFormatters("fr-FR");
const label = (event: Parameters<typeof eventLabel>[0]) => eventLabel(event, f, fr);

/** The region of one of the pickers of an event. */
const picker = (screen: Screen, name: string) => screen.getByRole("region", { name, exact: true });

/** The radio of a line (the mode, the event or the format to keep). */
const radio = (screen: Screen, name: string | RegExp) =>
  screen.getByRole("radio", { name, exact: typeof name === "string" });

/** Types a term in a picker and chooses the event whose line is `line`. */
async function pickEvent(
  screen: Screen,
  name: string,
  term: string,
  line: string,
  searchLabel = t.searchEvent,
) {
  const region = picker(screen, name);
  await region.getByLabelText(searchLabel).fill(term);
  await region.getByRole("button", { name: line, exact: true }).click();
}

/** Chooses the two events of the merge of events: the first is the one that stays. */
async function pickTwoEvents(screen: Screen) {
  await pickEvent(screen, t.firstEvent, "trail", label(eventRecord));
  await pickEvent(screen, t.secondEvent, "trail", label(dupEvent));
}

const previewButton = (screen: Screen) => screen.getByRole("button", { name: t.preview });
const mergeButton = (screen: Screen) => screen.getByRole("button", { name: t.merge, exact: true });

/** Switches to the merge of formats and chooses the event whose formats they are. */
async function openFormatsOf(screen: Screen, event: Parameters<typeof eventLabel>[0]) {
  await radio(screen, t.modeFormats).click();
  await pickEvent(screen, t.theEvent, "trail", label(event));
}

const formatSelect = (screen: Screen, name: string) => screen.getByLabelText(name);

// --- The two modes ---

test("DuplicatesPage — le mode des événements est celui du départ, et on passe à celui des épreuves", async () => {
  const { screen } = await renderPage();

  await expect
    .element(screen.getByRole("heading", { level: 1, name: t.duplicatesTitle }))
    .toBeVisible();
  await expect.element(radio(screen, t.modeEvents)).toBeChecked();
  await expect.element(picker(screen, t.firstEvent)).toBeVisible();
  await expect.element(picker(screen, t.secondEvent)).toBeVisible();

  await radio(screen, t.modeFormats).click();

  await expect.element(radio(screen, t.modeFormats)).toBeChecked();
  await expect.element(picker(screen, t.theEvent)).toBeVisible();
  await expect.element(picker(screen, t.firstEvent)).not.toBeInTheDocument();
});

// --- Choosing events ---

test("DuplicatesPage — la recherche d'un événement est liée en paramètre, et attend une pause de frappe", async () => {
  const { screen } = await renderPage();

  const search = picker(screen, t.firstEvent).getByLabelText(t.searchEvent);
  // Three keystrokes in a row make one request, not three.
  await search.fill("t");
  await search.fill("tr");
  await search.fill("  Trail des ");

  await expect
    .element(picker(screen, t.firstEvent).getByRole("button", { name: label(eventRecord) }))
    .toBeVisible();
  expect(mocks.eventsList).toHaveBeenCalledTimes(1);
  const [, , options] = mocks.eventsList.mock.calls[0] ?? [];
  const { raw, params } = boundFilter(options ?? {});
  expect(params).toEqual({ q: "Trail des" });
  expect(raw).not.toContain("Trail");
  // The events of the past are looked for as much as those to come: no date in the filter.
  expect(raw).not.toContain("date");
});

test("DuplicatesPage — un champ vide ne cherche rien, et une recherche sans résultat le dit", async () => {
  const { screen } = await renderPage();
  const region = picker(screen, t.firstEvent);

  // Spaces are no name: nothing is looked for, and nothing is said either.
  await region.getByLabelText(t.searchEvent).fill("   ");
  await new Promise((resolve) => setTimeout(resolve, SEARCH_PAUSE_MS + 150));
  expect(mocks.eventsList).not.toHaveBeenCalled();
  await expect.element(region.getByText(t.noEventFound)).not.toBeInTheDocument();

  await region.getByLabelText(t.searchEvent).fill("zzz");

  await expect.element(region.getByText(t.noEventFound)).toBeVisible();
  expect(mocks.eventsList).toHaveBeenCalledTimes(1);
});

test("DuplicatesPage — une recherche qui échoue le dit, et laisse chercher de nouveau", async () => {
  mocks.eventsList.mockRejectedValueOnce(refusal(500, {}));
  const { screen } = await renderPage();
  const region = picker(screen, t.firstEvent);

  await region.getByLabelText(t.searchEvent).fill("trail");

  await expect.element(region.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await region.getByRole("button", { name: fr.common.retry }).click();
  await expect
    .element(region.getByRole("button", { name: label(eventRecord), exact: true }))
    .toBeVisible();
});

test("DuplicatesPage — un événement choisi se résume sur une ligne (nom, dates, lieu) et se change", async () => {
  const { screen } = await renderPage();

  await pickEvent(screen, t.firstEvent, "trail", label(eventRecord));

  const region = picker(screen, t.firstEvent);
  await expect.element(region.getByText(label(eventRecord), { exact: true })).toBeVisible();
  await expect.element(region.getByLabelText(t.searchEvent)).not.toBeInTheDocument();
  // Nothing is left in the page to take the focus away: it is on the button that changes the choice.
  await expect.element(region.getByRole("button", { name: t.changeChoice })).toHaveFocus();

  await region.getByRole("button", { name: t.changeChoice }).click();

  await expect.element(region.getByLabelText(t.searchEvent)).toBeVisible();
  await expect.element(region.getByLabelText(t.searchEvent)).toHaveFocus();
});

test("DuplicatesPage — l'événement déjà choisi n'est pas proposé pour l'autre place", async () => {
  const { screen } = await renderPage();
  await pickEvent(screen, t.firstEvent, "trail", label(eventRecord));

  const second = picker(screen, t.secondEvent);
  await second.getByLabelText(t.searchEvent).fill("trail");

  await expect
    .element(second.getByRole("button", { name: label(dupEvent), exact: true }))
    .toBeVisible();
  await expect
    .element(second.getByRole("button", { name: label(eventRecord), exact: true }))
    .not.toBeInTheDocument();
});

// --- The preview and the merge of events ---

test("DuplicatesPage — « Fusionner » désactivé avant l'aperçu, actif après ; l'appel final envoie dryRun:false", async () => {
  const { screen, queryClient } = await renderPage();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  await pickTwoEvents(screen);

  // The first of the two is kept until the admin says otherwise.
  await expect.element(radio(screen, label(eventRecord))).toBeChecked();
  await expect.element(mergeButton(screen)).toBeDisabled();

  await previewButton(screen).click();

  await expect.element(screen.getByText("1 épreuve déplacée")).toBeVisible();
  await expect.element(screen.getByText("3 participations déplacées")).toBeVisible();
  await expect.element(screen.getByText("2 commentaires déplacés")).toBeVisible();
  await expect.element(screen.getByText("1 offre déplacée")).toBeVisible();
  await expect
    .element(screen.getByText("1 date d'épreuve effacée (hors des dates de l'événement)"))
    .toBeVisible();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.send).toHaveBeenCalledWith(MERGE_EVENTS, {
    method: "POST",
    body: { keepId: "event", mergeId: "event3", dryRun: true },
  });
  await expect.element(mergeButton(screen)).toBeEnabled();

  await mergeButton(screen).click();
  const dialog = screen.getByRole("dialog", { name: t.mergeConfirmTitle.events });
  // Nothing is sent until the admin has confirmed.
  expect(mocks.send).toHaveBeenCalledTimes(1);
  await dialog.getByRole("button", { name: t.mergeConfirm }).click();

  await expect.element(screen.getByText(t.merged)).toBeVisible();
  expect(mocks.send).toHaveBeenCalledTimes(2);
  expect(mocks.send).toHaveBeenLastCalledWith(MERGE_EVENTS, {
    method: "POST",
    body: { keepId: "event", mergeId: "event3", dryRun: false },
  });
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  // The lists and the page of the event that stays ask for what the server holds now.
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["event", "event"] });
  // The comments and the offers of the merged event moved to the one that stays, and the
  // latest comments of the home page may name the one that is gone.
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["comments"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["offers"] });
  // The page starts over: nothing is chosen, nothing is previewed.
  await expect.element(picker(screen, t.firstEvent).getByLabelText(t.searchEvent)).toBeVisible();
  await expect.element(previewButton(screen)).not.toBeInTheDocument();
  // The button that opened the confirmation is gone: the focus goes to the title of the page.
  await expect
    .element(screen.getByRole("heading", { level: 1, name: t.duplicatesTitle }))
    .toHaveFocus();
});

test("DuplicatesPage — la confirmation redit ce qui est gardé, ce qui est supprimé et l'aperçu", async () => {
  const { screen } = await renderPage();
  await pickTwoEvents(screen);
  // The second one is kept this time.
  await radio(screen, label(dupEvent)).click();
  await previewButton(screen).click();
  await expect.element(mergeButton(screen)).toBeEnabled();

  await mergeButton(screen).click();

  const dialog = screen.getByRole("dialog", { name: t.mergeConfirmTitle.events });
  await expect.element(dialog.getByText(t.keptLine(label(dupEvent)))).toBeVisible();
  await expect.element(dialog.getByText(t.removedLine(label(eventRecord)))).toBeVisible();
  await expect.element(dialog.getByText("1 épreuve déplacée")).toBeVisible();
  await expect.element(dialog.getByText("3 participations déplacées")).toBeVisible();
  await expect.element(dialog.getByText("2 commentaires déplacés")).toBeVisible();
  await expect.element(dialog.getByText("1 offre déplacée")).toBeVisible();
  await expect.element(dialog.getByText(t.mergeIrreversible)).toBeVisible();
  expect(mocks.send).toHaveBeenCalledTimes(1);

  // Cancelling sends nothing and leaves the preview where it was.
  await dialog.getByRole("button", { name: fr.common.cancel }).click();
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  await expect.element(mergeButton(screen)).toBeEnabled();
  await expect.element(mergeButton(screen)).toHaveFocus();
});

test("DuplicatesPage — celui qu'on garde est celui du bouton radio : l'autre est fusionné", async () => {
  const { screen } = await renderPage();
  await pickTwoEvents(screen);

  await radio(screen, label(dupEvent)).click();
  await previewButton(screen).click();

  await expect.element(mergeButton(screen)).toBeEnabled();
  expect(mocks.send).toHaveBeenCalledWith(MERGE_EVENTS, {
    method: "POST",
    body: { keepId: "event3", mergeId: "event", dryRun: true },
  });
});

test("DuplicatesPage — changer celui qu'on garde invalide l'aperçu", async () => {
  const { screen } = await renderPage();
  await pickTwoEvents(screen);
  await previewButton(screen).click();
  await expect.element(mergeButton(screen)).toBeEnabled();
  await expect.element(screen.getByText("1 épreuve déplacée")).toBeVisible();

  await radio(screen, label(dupEvent)).click();

  await expect.element(mergeButton(screen)).toBeDisabled();
  await expect.element(screen.getByText("1 épreuve déplacée")).not.toBeInTheDocument();
});

test("DuplicatesPage — changer un des deux événements invalide l'aperçu", async () => {
  const { screen } = await renderPage();
  await pickTwoEvents(screen);
  await previewButton(screen).click();
  await expect.element(mergeButton(screen)).toBeEnabled();

  await picker(screen, t.secondEvent).getByRole("button", { name: t.changeChoice }).click();

  // With one of the two missing there is nothing left to preview or to merge.
  await expect.element(mergeButton(screen)).not.toBeInTheDocument();
  await pickEvent(screen, t.secondEvent, "lyon", label(event2Record));
  // Back to two events, but not the same two: it has to be previewed again.
  await expect.element(mergeButton(screen)).toBeDisabled();
  await expect.element(screen.getByText("1 épreuve déplacée")).not.toBeInTheDocument();

  await previewButton(screen).click();
  await expect.element(mergeButton(screen)).toBeEnabled();
  expect(mocks.send).toHaveBeenLastCalledWith(MERGE_EVENTS, {
    method: "POST",
    body: { keepId: "event", mergeId: "event2", dryRun: true },
  });
});

test("DuplicatesPage — un aperçu sans rien à déplacer le dit", async () => {
  mocks.send.mockResolvedValueOnce({
    movedFormats: 0,
    movedParticipations: 0,
    droppedParticipations: 0,
    clearedFormatDates: 0,
    movedComments: 0,
    movedOffers: 0,
  });
  const { screen } = await renderPage();
  await pickTwoEvents(screen);

  await previewButton(screen).click();

  await expect.element(screen.getByText(t.mergeNothing.events)).toBeVisible();
  await expect.element(mergeButton(screen)).toBeEnabled();
});

test("DuplicatesPage — l'aperçu est en anglais pour un navigateur anglais", async () => {
  mocks.send.mockResolvedValueOnce({ ...EVENTS_PREVIEW, droppedParticipations: 1 });
  const { screen } = await renderPage(["en-GB"]);
  const fe = createFormatters("en-GB");
  const line = (event: Parameters<typeof eventLabel>[0]) => eventLabel(event, fe, en);

  const search = en.admin.searchEvent;
  await pickEvent(screen, en.admin.firstEvent, "trail", line(eventRecord), search);
  await pickEvent(screen, en.admin.secondEvent, "trail", line(dupEvent), search);
  await screen.getByRole("button", { name: en.admin.preview }).click();

  await expect.element(screen.getByText("1 duplicate participation removed")).toBeVisible();
  await expect.element(screen.getByText("3 participations moved")).toBeVisible();
});

// --- Refusals ---

for (const code of [
  "merge_same_record",
  "merge_formats_different_events",
  "not_found",
  "forbidden",
] as const) {
  test(`DuplicatesPage — l'aperçu refusé avec ${code} le dit, et « Fusionner » reste désactivé`, async () => {
    mocks.send.mockRejectedValueOnce(coded(code === "forbidden" ? 403 : 400, code));
    const { screen } = await renderPage();
    await pickTwoEvents(screen);

    await previewButton(screen).click();

    await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors[code]);
    await expect.element(mergeButton(screen)).toBeDisabled();
    // The admin can try again: the next preview that works clears the message.
    await previewButton(screen).click();
    await expect.element(mergeButton(screen)).toBeEnabled();
    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  });

  test(`DuplicatesPage — la fusion refusée avec ${code} le dit dans la fenêtre, qui reste ouverte`, async () => {
    const { screen } = await renderPage();
    await pickTwoEvents(screen);
    await previewButton(screen).click();
    await expect.element(mergeButton(screen)).toBeEnabled();
    mocks.send.mockRejectedValueOnce(coded(code === "forbidden" ? 403 : 400, code));

    await mergeButton(screen).click();
    const dialog = screen.getByRole("dialog", { name: t.mergeConfirmTitle.events });
    await dialog.getByRole("button", { name: t.mergeConfirm }).click();

    await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors[code]);
    await expect.element(dialog.getByRole("button", { name: t.mergeConfirm })).toBeEnabled();
    await expect.element(screen.getByText(t.merged)).not.toBeInTheDocument();
    // The selection and the preview are still there once the dialog is closed.
    await dialog.getByRole("button", { name: fr.common.cancel }).click();
    await expect.element(mergeButton(screen)).toBeEnabled();
  });
}

test("DuplicatesPage — introuvable fait redemander les événements et leurs épreuves", async () => {
  mocks.send.mockRejectedValueOnce(coded(404, "not_found"));
  const { screen, queryClient } = await renderPage();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  await pickTwoEvents(screen);

  await previewButton(screen).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.not_found);
  // What the page shows is not what the server holds: one of the two is gone.
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["event"] });
});

test("DuplicatesPage — un échec sans code (réseau) a le message générique", async () => {
  mocks.send.mockRejectedValueOnce(new ClientResponseError(new TypeError("Failed to fetch")));
  const { screen } = await renderPage();
  await pickTwoEvents(screen);

  await previewButton(screen).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
});

// --- Formats ---

test("DuplicatesPage — deux épreuves d'un événement : aperçu et fusion avec merge-formats", async () => {
  const { screen, queryClient } = await renderPage();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  await openFormatsOf(screen, eventRecord);

  // The two formats come from the event that was chosen.
  const first = formatSelect(screen, t.firstFormat);
  const second = formatSelect(screen, t.secondFormat);
  await expect.element(first).toHaveValue("");
  await first.selectOptions(f42.id);
  await second.selectOptions(f15.id);
  await expect.element(radio(screen, /42\skm/)).toBeChecked();
  await expect.element(mergeButton(screen)).toBeDisabled();

  await previewButton(screen).click();

  await expect.element(screen.getByText("2 participations déplacées")).toBeVisible();
  await expect.element(screen.getByText("1 participation en double supprimée")).toBeVisible();
  expect(mocks.send).toHaveBeenCalledWith(MERGE_FORMATS, {
    method: "POST",
    body: { keepId: f42.id, mergeId: f15.id, dryRun: true },
  });
  await mergeButton(screen).click();
  const dialog = screen.getByRole("dialog", { name: t.mergeConfirmTitle.formats });
  await dialog.getByRole("button", { name: t.mergeConfirm }).click();

  await expect.element(screen.getByText(t.merged)).toBeVisible();
  expect(mocks.send).toHaveBeenLastCalledWith(MERGE_FORMATS, {
    method: "POST",
    body: { keepId: f42.id, mergeId: f15.id, dryRun: false },
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["event", eventRecord.id] });
  // The page starts over, in the same mode.
  await expect.element(radio(screen, t.modeFormats)).toBeChecked();
  await expect.element(picker(screen, t.theEvent).getByLabelText(t.searchEvent)).toBeVisible();
});

test("DuplicatesPage — une épreuve choisie n'est pas proposée pour l'autre place", async () => {
  const { screen } = await renderPage();
  await openFormatsOf(screen, eventRecord);

  await formatSelect(screen, t.firstFormat).selectOptions(f42.id);

  const second = formatSelect(screen, t.secondFormat);
  await expect.element(second.getByRole("option", { name: /15\skm/ })).toBeInTheDocument();
  await expect.element(second.getByRole("option", { name: /42\skm/ })).not.toBeInTheDocument();
});

test("DuplicatesPage — les épreuves se reconnaissent à leur mesure et à leurs participants", async () => {
  const { screen } = await renderPage();
  await openFormatsOf(screen, eventRecord);

  const first = formatSelect(screen, t.firstFormat);
  // Trail 42 km, 10 h limit, 2 400 m, on the second day: Alice and Bob are on it. The event lasts
  // two days, so the day is told too. (The spaces of a number are not plain ones.)
  await expect
    .element(
      first.getByRole("option", {
        name: /Trail\s42\skm · 2\s400\sm\sD\+ · max\s10h · dim\.\s14\sjuin · Alice et Bob$/,
      }),
    )
    .toBeInTheDocument();
  await expect
    .element(
      first.getByRole("option", {
        name: /Trail\s15\skm · 700\sm\sD\+ · sam\.\s13\sjuin · Sam$/,
      }),
    )
    .toBeInTheDocument();
});

test("DuplicatesPage — changer d'épreuve invalide l'aperçu", async () => {
  const { screen } = await renderPage();
  await openFormatsOf(screen, eventRecord);
  await formatSelect(screen, t.firstFormat).selectOptions(f42.id);
  await formatSelect(screen, t.secondFormat).selectOptions(f15.id);
  await previewButton(screen).click();
  await expect.element(mergeButton(screen)).toBeEnabled();

  await formatSelect(screen, t.secondFormat).selectOptions("");

  await expect.element(mergeButton(screen)).not.toBeInTheDocument();
  await expect.element(screen.getByText("2 participations déplacées")).not.toBeInTheDocument();
});

test("DuplicatesPage — changer d'événement vide le choix des épreuves", async () => {
  const { screen } = await renderPage();
  await openFormatsOf(screen, eventRecord);
  await formatSelect(screen, t.firstFormat).selectOptions(f42.id);

  await picker(screen, t.theEvent).getByRole("button", { name: t.changeChoice }).click();
  await pickEvent(screen, t.theEvent, "lyon", label(event2Record));

  // The 10 km of Lyon is the only format of its event: there is nothing to merge it with.
  await expect.element(screen.getByText(t.needTwoFormats)).toBeVisible();
  await expect.element(formatSelect(screen, t.firstFormat)).not.toBeInTheDocument();
});

test("DuplicatesPage — un événement dont les épreuves ne viennent pas affiche l'erreur", async () => {
  const { screen } = await renderPage();
  mocks.eventGetOne.mockRejectedValueOnce(refusal(500, {}));

  await openFormatsOf(screen, eventRecord);

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await screen.getByRole("button", { name: fr.common.retry }).click();
  await expect.element(formatSelect(screen, t.firstFormat)).toBeVisible();
});

// --- Layout ---

test("DuplicatesPage — les zones tactiles font au moins 44 px, sur un téléphone", async () => {
  await page.viewport(375, 812);
  const { screen } = await renderPage();
  await pickTwoEvents(screen);
  await previewButton(screen).click();
  await expect.element(mergeButton(screen)).toBeEnabled();

  const targets = [
    radio(screen, t.modeEvents),
    radio(screen, label(eventRecord)),
    previewButton(screen),
    mergeButton(screen),
    picker(screen, t.firstEvent).getByRole("button", { name: t.changeChoice }),
  ];
  for (const target of targets) {
    const box = target.element().closest("label, button")?.getBoundingClientRect();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  }
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
});
