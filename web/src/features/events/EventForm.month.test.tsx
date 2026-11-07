import { expect, test, vi } from "vitest";

import { fr } from "../../i18n/fr";
import {
  distance,
  format,
  formatDate,
  location,
  name,
  raceType,
  renderEdit,
  renderForm,
  save,
  savedEvent,
  setUpFormTests,
  startDate,
  type Screen,
} from "./formHarness";
import { mocks } from "./formMocks";
import { eventRecord, trailType } from "./testFixture";

vi.mock("../../lib/pb", async () => (await import("./formMocks")).pbModule);

setUpFormTests();

const unknownDay = (screen: Screen) => screen.getByLabelText(fr.form.dayUnknown);
const monthSelect = (screen: Screen) => screen.getByLabelText(fr.form.month, { exact: true });
const period = (screen: Screen) => screen.container.querySelector(".period-line")?.textContent;

test("EventForm — « Le jour n'est pas encore connu » montre la liste des mois", async () => {
  // Today is 1 June 2026: from June 2025 to June 2029, a month each.
  const { screen } = await renderForm();
  await expect.element(startDate(screen)).toBeVisible();
  await expect.element(monthSelect(screen)).not.toBeInTheDocument();

  await unknownDay(screen).click();

  await expect.element(startDate(screen)).not.toBeInTheDocument();
  await expect.element(monthSelect(screen)).toBeVisible();
  const options = [...monthSelect(screen).element().querySelectorAll("option")];
  expect(options).toHaveLength(12 + 1 + 36);
  expect(options[0]?.value).toBe("2025-06");
  expect(options.at(-1)?.value).toBe("2029-06");
  expect(options[0]?.textContent).toBe("juin 2025");
});

test("EventForm — les dates des épreuves laissent la place à une phrase, et reviennent quand on décoche", async () => {
  const { screen } = await renderForm();
  await formatDate(format(screen, 1)).fill("2026-06-14");

  await unknownDay(screen).click();

  await expect.element(screen.getByText(fr.form.formatDatesLater)).toBeVisible();
  await expect.element(screen.getByLabelText(fr.form.formatDate)).not.toBeInTheDocument();

  await unknownDay(screen).click();

  await expect.element(screen.getByText(fr.form.formatDatesLater)).not.toBeInTheDocument();
  // The draft kept what was typed.
  await expect.element(formatDate(format(screen, 1))).toHaveValue("2026-06-14");
});

test("EventForm — la ligne de période : « juin 2027, date à préciser »", async () => {
  const { screen } = await renderForm();
  await unknownDay(screen).click();

  await monthSelect(screen).selectOptions("2027-06");

  await expect.poll(() => period(screen)).toBe("juin 2027, date à préciser");
  expect(monthSelect(screen).element().getAttribute("aria-describedby")).toContain(
    screen.container.querySelector(".period-line")?.id,
  );
});

test("EventForm — la liste garde le mois enregistré hors de l'intervalle", async () => {
  mocks.getOne.mockResolvedValue({
    ...eventRecord,
    start_date: "2020-03-01",
    end_date: "2020-03-31",
    date_precision: "month",
  });
  const { screen } = await renderEdit();

  await expect.element(unknownDay(screen)).toBeChecked();
  await expect.element(monthSelect(screen)).toHaveValue("2020-03");
  const options = [...monthSelect(screen).element().querySelectorAll("option")].map(
    (option) => option.value,
  );
  expect(options).toHaveLength(12 + 1 + 36 + 1);
  expect(options[0]).toBe("2020-03");
  expect(options).toEqual(options.toSorted());
});

test("EventForm — une course au mois s'enregistre au 1er du mois, sans date d'épreuve", async () => {
  const { screen, router } = await renderForm();
  await name(screen).fill("Trail du Lac");
  await location(screen).fill("Annecy");
  await formatDate(format(screen, 1)).fill("2026-06-14");
  await raceType(format(screen, 1)).selectOptions(trailType.id);
  await distance(format(screen, 1)).fill("42");
  await unknownDay(screen).click();
  await monthSelect(screen).selectOptions("2027-06");

  await save(screen).click();

  await savedEvent(router);
  expect(mocks.calls.find(({ collection }) => collection === "events")?.body).toMatchObject({
    start_date: "2027-06-01",
    end_date: "2027-06-30",
    date_precision: "month",
  });
  expect(mocks.calls.find(({ collection }) => collection === "formats")?.body?.date).toBe("");
});

test("EventForm — l'heure d'ouverture désactivée dit pourquoi : il faut un jour", async () => {
  const { screen } = await renderForm();
  const time = screen.getByLabelText(fr.form.registrationOpeningTime, { exact: true });

  await expect.element(time).toBeDisabled();
  const hint = screen.getByText(fr.form.registrationOpeningTimeNeedsDay);
  await expect.element(hint).toBeVisible();
  expect(time.element().getAttribute("aria-describedby")).toContain(hint.element().id);

  await screen.getByLabelText(fr.form.registrationOpening, { exact: true }).fill("2026-05-01");
  await expect.element(time).toBeEnabled();
  await expect
    .element(screen.getByText(fr.form.registrationOpeningTimeNeedsDay))
    .not.toBeInTheDocument();
});
