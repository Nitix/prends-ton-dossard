import { expect, test, vi } from "vitest";

import {
  addFormat,
  distance,
  fillEvent,
  format,
  formatDate,
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
    .toMatch(/^From Sat,? 13 Jun to Mon,? 15 Jun, from the formats' dates$/);
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
