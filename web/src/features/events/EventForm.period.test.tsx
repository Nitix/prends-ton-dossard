import { expect, test, vi } from "vitest";
import { server } from "vitest/browser";

import { fr } from "../../i18n/fr";
import { emulateMedia, resetMedia } from "../../test/media";
import { hasDateInput } from "../../test/support";
import {
  addFormat,
  distance,
  field,
  fillEvent,
  format,
  formatDate,
  refused,
  renderEdit,
  renderForm,
  save,
  savedEvent,
  setUpFormTests,
  startDate,
  type Screen,
} from "./formHarness";
import { mocks } from "./formMocks";
import { event2Record, eventRecord, f15, f42 } from "./testFixture";

vi.mock("../../lib/pb", async () => (await import("./formMocks")).pbModule);

setUpFormTests();

/** The line under the start date that says the days of the event: an <output>, which is read out when it changes. */
const period = (screen: Screen) => screen.getByText(/^(Un jour|Du|One day|From)\b/);

/** What the line under the start date says now, to poll: it changes as the form is filled in. */
const periodNow = (screen: Screen) => () => period(screen).element().textContent;

// --- The end date comes from the formats ---

test("EventForm — plus de champ « date de fin »", async () => {
  const { screen } = await renderForm();

  await expect.element(screen.getByLabelText(/date de fin/i)).not.toBeInTheDocument();
  expect(screen.container.querySelector('[name="end_date"]')).toBeNull();
  expect(screen.container.textContent).not.toContain("plusieurs jours");
});

test("EventForm — plus de champ « date de fin » à la modification, ni en anglais", async () => {
  const { screen } = await renderForm({
    at: "/evenements/event/modifier",
    heading: "Edit the event",
    languages: ["en-GB"],
  });

  await expect.element(screen.getByLabelText(/end date/i)).not.toBeInTheDocument();
  expect(screen.container.querySelector('[name="end_date"]')).toBeNull();
  // The start date is still there.
  await expect.element(screen.getByLabelText("Start date")).toHaveValue("2026-06-13");
});

test("EventForm — la période affichée suit les dates des épreuves", async () => {
  const { screen } = await renderForm();
  // No start day yet: nothing to say.
  await expect.element(period(screen)).not.toBeInTheDocument();

  await startDate(screen).fill("2026-06-13");
  // Alone, the event is one day. The line is an <output>: a change is read out.
  await expect.poll(periodNow(screen)).toBe("Un jour : sam. 13 juin");
  expect(period(screen).element().tagName).toBe("OUTPUT");

  await formatDate(format(screen, 1)).fill("2026-06-15");
  await expect
    .poll(periodNow(screen))
    .toBe("Du sam. 13 juin au lun. 15 juin, d'après les dates des épreuves");

  // A format with no day is the first day: it moves nothing. The latest of the days is the end.
  await addFormat(screen).click();
  await expect
    .poll(periodNow(screen))
    .toBe("Du sam. 13 juin au lun. 15 juin, d'après les dates des épreuves");
  await formatDate(format(screen, 2)).fill("2026-06-16");
  await expect
    .poll(periodNow(screen))
    .toBe("Du sam. 13 juin au mar. 16 juin, d'après les dates des épreuves");
  await formatDate(format(screen, 2)).fill("2026-06-14");
  await expect
    .poll(periodNow(screen))
    .toBe("Du sam. 13 juin au lun. 15 juin, d'après les dates des épreuves");

  // No format after the first day: one day again.
  await formatDate(format(screen, 1)).fill("");
  await formatDate(format(screen, 2)).fill("2026-06-13");
  await expect.poll(periodNow(screen)).toBe("Un jour : sam. 13 juin");

  // A later start moves the first day, and the days of the formats are compared with the new one.
  await formatDate(format(screen, 1)).fill("2026-06-15");
  await startDate(screen).fill("2026-06-20");
  await expect.poll(periodNow(screen)).toBe("Un jour : sam. 20 juin");
});

test("EventForm — la période est dite en anglais, avec la langue des dates", async () => {
  const { screen } = await renderForm({ languages: ["en-GB"], heading: "Create an event" });
  await screen.getByLabelText("Start date").fill("2026-06-13");

  await expect.poll(periodNow(screen)).toMatch(/^One day: Sat,? 13 Jun$/);

  await screen.getByLabelText("Race date").fill("2026-06-15");
  await expect
    .poll(periodNow(screen))
    .toMatch(/^From Sat,? 13 Jun to Mon,? 15 Jun, going by the race dates$/);
});

test("EventForm — la période d'un événement dont les épreuves ne changent rien n'a pas d'« avant »", async () => {
  const { screen } = await renderEdit();

  // F42 is on the 14th, the event ends on the 14th.
  await expect
    .poll(periodNow(screen))
    .toMatch(/^Du sam\. 13 juin au dim\. 14 juin, d'après les dates des épreuves$/);
});

test("EventForm — la période affichée suit les dates des épreuves : un événement de plusieurs jours dont les épreuves n'ont pas de date devient d'un jour, et le formulaire le dit avant l'enregistrement", async () => {
  // Review focus 3: the event lasts two days, no format has a day of its own.
  mocks.getOne.mockResolvedValue({
    ...eventRecord,
    expand: { ...eventRecord.expand, formats_via_event: [{ ...f42, date: "" }, f15] },
  });
  const { screen, router } = await renderEdit();

  await expect
    .poll(periodNow(screen))
    .toBe("Un jour : sam. 13 juin (avant : du sam. 13 juin au dim. 14 juin)");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(router.state.location.pathname).toBe("/evenements/event");
  });
  // What the line said is what was saved.
  expect(mocks.calls.find(({ collection }) => collection === "events")?.body).toMatchObject({
    start_date: "2026-06-13",
    end_date: "",
  });
});

test("EventForm — la période dit aussi « avant » quand une épreuve change la fin, et plus rien quand la fin redevient celle qu'elle était", async () => {
  const { screen } = await renderEdit();

  await formatDate(format(screen, 2)).fill("2026-06-15");
  await expect
    .poll(periodNow(screen))
    .toBe(
      "Du sam. 13 juin au lun. 15 juin, d'après les dates des épreuves (avant : du sam. 13 juin au dim. 14 juin)",
    );

  // Back to the stored end: nothing changes any more.
  await formatDate(format(screen, 2)).fill("2026-06-14");
  await expect
    .poll(periodNow(screen))
    .toMatch(/^Du sam\. 13 juin au dim\. 14 juin, d'après les dates des épreuves$/);
});

test("EventForm — la période dit « was » en anglais, avec la langue des dates", async () => {
  mocks.getOne.mockResolvedValue({
    ...eventRecord,
    expand: { ...eventRecord.expand, formats_via_event: [{ ...f42, date: "" }, f15] },
  });
  const { screen } = await renderForm({
    at: "/evenements/event/modifier",
    heading: "Edit the event",
    languages: ["en-GB"],
  });

  await expect
    .poll(periodNow(screen))
    .toMatch(/^One day: Sat,? 13 Jun \(was: from Sat,? 13 Jun to Sun,? 14 Jun\)$/);
});

test("EventForm — un événement d'un jour à qui une épreuve donne une fin n'a pas d'« avant »", async () => {
  mocks.getOne.mockResolvedValue(event2Record);
  const { screen } = await renderEdit("event2");

  await expect.poll(periodNow(screen)).toBe("Un jour : lun. 22 juin");
  await formatDate(format(screen, 1)).fill("2026-06-23");

  await expect
    .poll(periodNow(screen))
    .toMatch(/^Du lun\. 22 juin au mar\. 23 juin, d'après les dates des épreuves$/);
});

test("EventForm — le lot envoie la date de fin calculée : la plus tardive des épreuves", async () => {
  const { screen, router } = await renderForm();
  await fillEvent(screen);
  await formatDate(format(screen, 1)).fill("2026-06-14");
  await addFormat(screen).click();
  await distance(format(screen, 2)).fill("10");
  await formatDate(format(screen, 2)).fill("2026-06-16");
  await addFormat(screen).click();
  await distance(format(screen, 3)).fill("5");

  await save(screen).click();

  await savedEvent(router);
  expect(mocks.calls.find(({ collection }) => collection === "events")?.body).toMatchObject({
    start_date: "2026-06-13",
    end_date: "2026-06-16",
  });
  // The server checks each format against it: they all are in 13-16 June.
  const days = mocks.calls.filter(({ collection }) => collection === "formats");
  expect(days.map(({ body }) => body?.date)).toEqual(["2026-06-14", "2026-06-16", ""]);
});

test("EventForm — le lot envoie une date de fin vide quand aucune épreuve n'est après le début", async () => {
  const { screen, router } = await renderForm();
  await fillEvent(screen);
  await formatDate(format(screen, 1)).fill("2026-06-13");

  await save(screen).click();

  await savedEvent(router);
  const body = mocks.calls.find(({ collection }) => collection === "events")?.body;
  // Always sent, an empty text included: that is how a date of the event is cleared.
  expect(body).toHaveProperty("end_date", "");
});

test("EventForm — la modification envoie la date de fin calculée, avec l'épreuve déplacée après le lot si le jour est nouveau", async () => {
  const { screen, router } = await renderEdit();
  // F15 (no day) goes to the 16th, after the stored end (the 14th): the event gains days.
  await formatDate(format(screen, 1)).fill("2026-06-16");

  await save(screen).click();

  await vi.waitFor(() => {
    expect(router.state.location.pathname).toBe("/evenements/event");
  });
  expect(mocks.send).toHaveBeenCalledOnce();
  // F15 and F42 first, F15 without the day the event does not have yet, then the event, then F15's day.
  expect(mocks.calls.map(({ id }) => id)).toEqual(["f15", "f42", "event", "f15"]);
  expect(mocks.calls[0]?.body).toMatchObject({ date: "" });
  expect(mocks.calls[2]?.body).toMatchObject({ start_date: "2026-06-13", end_date: "2026-06-16" });
  expect(mocks.calls[3]?.body).toEqual({ date: "2026-06-16" });
});

// --- The line under the start date, and what saving would do to the days ---

/** The event of the fixture with no day on its formats: it ends on the 14th, and the form would end it on the 13th. */
const UNDATED = {
  ...eventRecord,
  expand: { ...eventRecord.expand, formats_via_event: [{ ...f42, date: "" }, f15] },
};

const LONG = "Plus de deux semaines : vérifie les dates des épreuves.";

/** The sentence just above « Enregistrer » that says the event would lose days. */
const shortens = (screen: Screen) => screen.getByText(/^(Enregistrer raccourcit|Saving shortens)/);

const inputOf = (located: { element(): Element }): HTMLInputElement => {
  const element = located.element();
  if (!(element instanceof HTMLInputElement)) throw new Error("not an input");
  return element;
};

test("EventForm — M4 : en anglais, la période dit « going by the race dates », avec les mots de l'interface", async () => {
  const { screen } = await renderForm({ languages: ["en-GB"], heading: "Create an event" });
  await screen.getByLabelText("Start date").fill("2026-06-13");
  await screen.getByLabelText("Race date").fill("2026-06-15");

  await expect.poll(periodNow(screen)).toMatch(/going by the race dates$/);
  // The English interface calls a format a race, and never says « formats ».
  expect(periodNow(screen)()).not.toMatch(/format/i);
});

test("EventForm — M2 : plus de deux semaines, la période dit de vérifier les dates des épreuves", async () => {
  const { screen } = await renderForm();
  await startDate(screen).fill("2026-06-13");
  const date = formatDate(format(screen, 1));

  // Two weeks to the day is not more than two weeks.
  await date.fill("2026-06-27");
  await expect
    .poll(periodNow(screen))
    .toBe("Du sam. 13 juin au sam. 27 juin, d'après les dates des épreuves");

  // A day more is, and so is a year typed wrong (2027 for 2026).
  await date.fill("2026-06-28");
  await expect
    .poll(periodNow(screen))
    .toBe(`Du sam. 13 juin au dim. 28 juin, d'après les dates des épreuves. ${LONG}`);
  await date.fill("2027-06-15");
  await expect.poll(periodNow(screen)).toMatch(/dates des épreuves\. Plus de deux semaines/);
  expect(periodNow(screen)().endsWith(LONG)).toBe(true);

  // Typed right again: the warning goes.
  await date.fill("2026-06-15");
  await expect
    .poll(periodNow(screen))
    .toBe("Du sam. 13 juin au lun. 15 juin, d'après les dates des épreuves");
});

test("EventForm — M2 : le texte est anglais en anglais, et vient après « (was : …) »", async () => {
  mocks.getOne.mockResolvedValue(UNDATED);
  const { screen } = await renderForm({
    at: "/evenements/event/modifier",
    heading: "Edit the event",
    languages: ["en-GB"],
  });

  await screen.getByLabelText("Race date").first().fill("2027-06-15");

  await expect
    .poll(periodNow(screen))
    .toMatch(
      /^From Sat,? 13 Jun to Tue,? 15 Jun, going by the race dates \(was: from Sat,? 13 Jun to Sun,? 14 Jun\)\. More than two weeks: check the race dates\.$/,
    );
});

test("EventForm — M3 : un événement v4 dont la fin est le début n'a pas d'« avant », ni de phrase au-dessus d'« Enregistrer »", async () => {
  // v4 let an end be the start. That is one day, and saving it as one day changes nothing.
  mocks.getOne.mockResolvedValue({ ...UNDATED, end_date: "2026-06-13" });
  const { screen } = await renderEdit();

  await expect.poll(periodNow(screen)).toBe("Un jour : sam. 13 juin");
  await expect.element(screen.getByText(/\(avant :/)).not.toBeInTheDocument();
  await expect.element(shortens(screen)).not.toBeInTheDocument();
  expect(save(screen).element().hasAttribute("aria-describedby")).toBe(false);
});

test("EventForm — M3 : « avant » reste dit quand la fin stockée n'est ni le début ni la fin calculée", async () => {
  mocks.getOne.mockResolvedValue(UNDATED);
  const { screen } = await renderEdit();

  await expect
    .poll(periodNow(screen))
    .toBe("Un jour : sam. 13 juin (avant : du sam. 13 juin au dim. 14 juin)");
});

test("EventForm — M5 : la période décrit la date de début, après le refus du serveur s'il y en a un", async () => {
  mocks.send.mockRejectedValue(refused(0, 400, { start_date: field("date_invalid") }));
  const { screen } = await renderForm();
  await fillEvent(screen);
  await expect.poll(periodNow(screen)).toBe("Un jour : sam. 13 juin");
  const output = period(screen).element();
  const describedBy = () =>
    startDate(screen).element().getAttribute("aria-describedby")?.split(" ");
  expect(output.id).not.toBe("");
  expect(describedBy()).toEqual([output.id]);

  await save(screen).click();

  const message = screen.getByText(fr.errors.date_invalid);
  await expect.element(message).toBeVisible();
  expect(describedBy()).toEqual([message.element().id, output.id]);
});

test("EventForm — M5 : pendant qu'une année se tape, la période garde son texte : rien n'est lu avant une date complète", async () => {
  const { screen } = await renderForm();
  await startDate(screen).fill("2026-06-13");
  await expect.poll(periodNow(screen)).toBe("Un jour : sam. 13 juin");
  const output = period(screen).element();
  // Every text that the region is given: that is what a screen reader reads out.
  const written: string[] = [];
  const watcher = new MutationObserver(() => {
    written.push(output.textContent ?? "");
  });
  watcher.observe(output, { childList: true, characterData: true, subtree: true });

  try {
    // Chromium gives a day for each key of a year: 0002-06-13, 0020-06-13, 0202-06-13, then 2027-06-13.
    for (const typed of ["0002-06-13", "0020-06-13", "0202-06-13"]) {
      await startDate(screen).fill(typed);
      await expect.element(startDate(screen)).toHaveValue(typed);
    }
    await startDate(screen).fill("2026-06-13");
    // The same in the date of a format, and then with a start that is complete.
    await formatDate(format(screen, 1)).fill("0020-06-15");
    await expect.element(formatDate(format(screen, 1))).toHaveValue("0020-06-15");
    await formatDate(format(screen, 1)).fill("2026-06-15");
    await expect
      .poll(periodNow(screen))
      .toBe("Du sam. 13 juin au lun. 15 juin, d'après les dates des épreuves");
  } finally {
    watcher.disconnect();
  }

  // One write, of a text that was complete: nothing was said of the years in between.
  expect(written).toEqual(["Du sam. 13 juin au lun. 15 juin, d'après les dates des épreuves"]);
});

test.skipIf(!hasDateInput)(
  "EventForm — M1 : la date d'une épreuve a pour minimum le début, et le navigateur refuse celle d'avant",
  async () => {
    const { screen } = await renderForm();
    const date = formatDate(format(screen, 1));
    // No start day yet: no day is before it.
    expect(inputOf(date).min).toBe("");

    await fillEvent(screen);
    expect(inputOf(date).min).toBe("2026-06-13");
    // The picker and the check follow a start that moves.
    await startDate(screen).fill("2026-06-10");
    expect(inputOf(date).min).toBe("2026-06-10");
    await startDate(screen).fill("2026-06-13");

    await date.fill("2026-06-12");
    expect(inputOf(date).validity.rangeUnderflow).toBe(true);
    await save(screen).click();
    // Not sent: the browser reports the field, and takes the focus there.
    expect(mocks.send).not.toHaveBeenCalled();
    await expect.element(date).toHaveFocus();
    // That day does not make the event longer.
    expect(periodNow(screen)()).toBe("Un jour : sam. 13 juin");

    // The first day itself, and the days after, are fine.
    await date.fill("2026-06-13");
    expect(inputOf(date).validity.valid).toBe(true);
    await date.fill("2026-06-14");
    expect(inputOf(date).validity.valid).toBe(true);
  },
);

test.skipIf(!hasDateInput)(
  "EventForm — M1 : à la modification, un début reporté après le jour d'une épreuve est refusé par le navigateur, sur la date de cette épreuve",
  async () => {
    const { screen } = await renderEdit();
    // F42 (the second format) is on the 14th: the event, now from the 15th, would not have its day.
    await startDate(screen).fill("2026-06-15");
    const date = formatDate(format(screen, 2));
    await expect.element(date).toHaveValue("2026-06-14");
    expect(inputOf(date).min).toBe("2026-06-15");
    expect(inputOf(date).validity.rangeUnderflow).toBe(true);

    await save(screen).click();

    // The server is not asked, and the field to correct has the focus.
    expect(mocks.send).not.toHaveBeenCalled();
    await expect.element(date).toHaveFocus();

    // The day moves along with the event, and is fine.
    await date.fill("2026-06-15");
    expect(inputOf(date).validity.valid).toBe(true);
  },
);

test("EventForm — I1 : un événement qui perdrait des jours le dit juste au-dessus d'« Enregistrer », que le bouton décrit", async () => {
  mocks.getOne.mockResolvedValue(UNDATED);
  const { screen, router } = await renderEdit();

  const note = shortens(screen);
  await expect.element(note).toBeVisible();
  expect(note.element().textContent).toBe(
    "Enregistrer raccourcit l'événement (avant : du sam. 13 juin au dim. 14 juin). Pour garder ces jours, donne sa date à l'épreuve du dernier jour.",
  );
  // Right above the buttons, and the button says it too.
  expect(note.element().nextElementSibling).toBe(save(screen).element().parentElement);
  expect(note.element().id).not.toBe("");
  expect(save(screen).element().getAttribute("aria-describedby")).toBe(note.element().id);

  // The advice works: the race of the last day gets its day, and the days are kept.
  await formatDate(format(screen, 1)).fill("2026-06-14");
  await expect.element(note).not.toBeInTheDocument();
  expect(save(screen).element().hasAttribute("aria-describedby")).toBe(false);
  await save(screen).click();
  await vi.waitFor(() => {
    expect(router.state.location.pathname).toBe("/evenements/event");
  });
  expect(mocks.calls.find(({ collection }) => collection === "events")?.body).toMatchObject({
    end_date: "2026-06-14",
  });
});

test("EventForm — I1 : un événement qui finit plus tôt, sans devenir d'un jour, le dit aussi", async () => {
  // The days of the event go to the 18th, the formats only to the 15th.
  mocks.getOne.mockResolvedValue({ ...eventRecord, end_date: "2026-06-18" });
  const { screen } = await renderEdit();
  await formatDate(format(screen, 1)).fill("2026-06-15");

  await expect.element(shortens(screen)).toBeVisible();
  expect(shortens(screen).element().textContent).toContain(
    "(avant : du sam. 13 juin au jeu. 18 juin)",
  );
});

test("EventForm — I1 : rien au-dessus d'« Enregistrer » quand l'événement ne raccourcit pas", async () => {
  const { screen } = await renderEdit();
  // Nothing changes.
  await expect
    .poll(periodNow(screen))
    .toBe("Du sam. 13 juin au dim. 14 juin, d'après les dates des épreuves");
  await expect.element(shortens(screen)).not.toBeInTheDocument();
  expect(save(screen).element().hasAttribute("aria-describedby")).toBe(false);

  // It gets longer: the line under the start date says it, and no days are lost.
  await formatDate(format(screen, 1)).fill("2026-06-16");
  await expect
    .poll(periodNow(screen))
    .toBe(
      "Du sam. 13 juin au mar. 16 juin, d'après les dates des épreuves (avant : du sam. 13 juin au dim. 14 juin)",
    );
  await expect.element(shortens(screen)).not.toBeInTheDocument();
  expect(save(screen).element().hasAttribute("aria-describedby")).toBe(false);
});

test("EventForm — I1 : la création n'a rien à raccourcir", async () => {
  const { screen } = await renderForm();
  await fillEvent(screen);

  await expect.poll(periodNow(screen)).toBe("Un jour : sam. 13 juin");
  await expect.element(shortens(screen)).not.toBeInTheDocument();
});

test("EventForm — I1 : en anglais, la phrase est anglaise", async () => {
  mocks.getOne.mockResolvedValue(UNDATED);
  const { screen } = await renderForm({
    at: "/evenements/event/modifier",
    heading: "Edit the event",
    languages: ["en-GB"],
  });

  await expect
    .poll(() => shortens(screen).element().textContent)
    .toMatch(
      /^Saving shortens the event \(was: from Sat,? 13 Jun to Sun,? 14 Jun\)\. To keep these days, give the race of the last day its date\.$/,
    );
});

test("EventForm — I1 : la phrase au-dessus d'« Enregistrer » se lit le jour, la nuit et en couleurs forcées", async (context) => {
  mocks.getOne.mockResolvedValue(UNDATED);
  const { screen } = await renderEdit();
  const note = shortens(screen).element();
  // By day and by night, its text is the text of the labels of the fields, whose contrast is pinned (dark.test.ts).
  const label = screen.getByText(fr.form.startDate, { exact: true }).element();

  try {
    await emulateMedia({ colorScheme: "light", forcedColors: "none" });
    const day = getComputedStyle(note).color;
    expect(day).toBe(getComputedStyle(label).color);
    await emulateMedia({ colorScheme: "dark", forcedColors: "none" });
    // The scheme is applied a moment after the command answers (WebKit on Linux).
    await expect.poll(() => getComputedStyle(note).color).not.toBe(day);
    const night = getComputedStyle(note).color;
    expect(night).toBe(getComputedStyle(label).color);

    // In forced colours the browser picks the colours: the text is not the colour of the ground.
    await emulateMedia({ colorScheme: "light", forcedColors: "active" });
    // Safari has no forced colours mode (Playwright only answers the media query there).
    if (
      server.browser === "webkit" ||
      (server.browser !== "chromium" && !matchMedia("(forced-colors: active)").matches)
    )
      context.skip();
    expect(getComputedStyle(note).color).not.toBe(getComputedStyle(document.body).backgroundColor);
    expect(getComputedStyle(note).color).toBe(getComputedStyle(label).color);
  } finally {
    await resetMedia();
  }
});
