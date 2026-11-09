import { expect, test, vi } from "vitest";
import { page, server, userEvent } from "vitest/browser";

import { fr } from "../../i18n/fr";
import { fontsReady } from "../../test/fontsReady";
import { FRAME } from "../../test/frame";
import { emulateMedia, resetMedia } from "../../test/media";
import { pressFocused } from "../../test/pressFocused";
import {
  base,
  distance,
  elevation,
  format,
  gpxField,
  gpxFile,
  hoursOf,
  location,
  minutesOf,
  name,
  price,
  raceType,
  renderEdit,
  renderForm,
  reuse,
  routeUrl,
  save,
  setUpFormTests,
  startDate,
  trackRead,
  formatDate,
  type Row,
} from "./formHarness";
import { mocks } from "./formMocks";
import { eventRecord, f15, f42, roadType, trailType } from "./testFixture";

vi.mock("../../lib/pb", async () => (await import("./formMocks")).pbModule);

setUpFormTests();

// --- The measures of the race type ---

const trailOfMeasures = { ...trailType, measures: ["distance", "elevation", "time_limit"] };
const backyardType = { ...base, id: "backyard000000", label: "Backyard", measures: ["time_limit"] };
const hyroxType = { ...base, id: "hyrox00000000", label: "Hyrox", measures: ["distance"] };
/** A type that only says its elevation: a format has to be measured, so the distance is shown too. */
const climbType = { ...base, id: "climb000000000", label: "Montée", measures: ["elevation"] };

/** The types that say which measures they use, and one (Route) that says nothing. */
function withMeasuredTypes() {
  mocks.raceTypes.mockResolvedValue([
    trailOfMeasures,
    backyardType,
    hyroxType,
    climbType,
    roadType,
  ]);
}

/** What a locator finds, for the checks that read the page itself. */
type Located = { element(): Element };

/** The section « Options avancées » of the row, or null when it has none. */
const advancedOf = (row: Row): HTMLDetailsElement | null => row.element().querySelector("details");
/** The summary of that section: « Options avancées », then what it holds (« : distance et D+ »). */
const moreOptions = (row: Row) => row.getByText(/^(Options avancées :|More options:)/);
const summaryText = (row: Row) => moreOptions(row).element().textContent;
/** Whether a field of the row is put away in « Options avancées ». */
const inAdvanced = (located: Located) => located.element().closest("details") !== null;
/** Whether `first` comes before `second` in the page. */
const comesBefore = (first: Located, second: Located) =>
  (first.element().compareDocumentPosition(second.element()) & Node.DOCUMENT_POSITION_FOLLOWING) !==
  0;

/** The fields of the four measures, by name. */
const measuresOfRow = (row: Row) => ({
  distance: distance(row),
  elevation: elevation(row),
  duration: hoursOf(row, fr.form.duration),
  timeLimit: hoursOf(row, fr.form.timeLimit),
});

test("FormatFieldset — les mesures du type d'abord, les autres dans « Options avancées »", async () => {
  withMeasuredTypes();
  const { screen } = await renderForm();
  const row = format(screen, 1);

  // No type chosen yet: the four measures, and nothing to put away.
  expect(advancedOf(row)).toBeNull();
  for (const measure of Object.values(measuresOfRow(row)))
    await expect.element(measure).toBeVisible();

  // A backyard has a time limit: it comes first, the others are in a closed section.
  await raceType(row).selectOptions(backyardType.id);
  const backyard = measuresOfRow(row);
  await expect.element(backyard.timeLimit).toBeVisible();
  expect(inAdvanced(backyard.timeLimit)).toBe(false);
  for (const away of [backyard.distance, backyard.elevation, backyard.duration]) {
    expect(inAdvanced(away)).toBe(true);
  }
  expect(advancedOf(row)?.open).toBe(false);
  await expect.element(moreOptions(row)).toBeVisible();
  expect(moreOptions(row).element().tagName).toBe("SUMMARY");
  // The section follows the measures and comes before the rest of the fields.
  expect(comesBefore(backyard.timeLimit, moreOptions(row))).toBe(true);
  for (const later of [gpxField(row), routeUrl(row), price(row), formatDate(row)]) {
    expect(comesBefore(moreOptions(row), later)).toBe(true);
    expect(inAdvanced(later)).toBe(false);
  }
  // The hint is above the measures that are shown, not in the section.
  const hint = row.getByText(fr.form.measuresHint);
  await expect.element(hint).toBeVisible();
  expect(inAdvanced(hint)).toBe(false);
  expect(comesBefore(hint, backyard.timeLimit)).toBe(true);

  // The summary opens it, and the fields are there.
  await moreOptions(row).click();
  expect(advancedOf(row)?.open).toBe(true);
  for (const away of [backyard.distance, backyard.elevation, backyard.duration]) {
    await expect.element(away).toBeVisible();
  }

  // A trail: its distance, its elevation and its time limit, in the order of the form; the duration is put away.
  await raceType(row).selectOptions(trailType.id);
  const trail = measuresOfRow(row);
  for (const shown of [trail.distance, trail.elevation, trail.timeLimit]) {
    expect(inAdvanced(shown)).toBe(false);
  }
  expect(comesBefore(trail.distance, trail.elevation)).toBe(true);
  expect(comesBefore(trail.elevation, trail.timeLimit)).toBe(true);
  expect(inAdvanced(trail.duration)).toBe(true);

  // Hyrox: the distance only.
  await raceType(row).selectOptions(hyroxType.id);
  const hyrox = measuresOfRow(row);
  expect(inAdvanced(hyrox.distance)).toBe(false);
  for (const away of [hyrox.elevation, hyrox.duration, hyrox.timeLimit]) {
    expect(inAdvanced(away)).toBe(true);
  }

  // A type that has chosen nothing shows the four.
  await raceType(row).selectOptions(roadType.id);
  expect(advancedOf(row)).toBeNull();
});

test("FormatFieldset — une épreuve se mesure toujours : un type sans distance, durée ni temps max montre la distance", async () => {
  withMeasuredTypes();
  const { screen } = await renderForm();
  const row = format(screen, 1);

  await raceType(row).selectOptions(climbType.id);

  const fields = measuresOfRow(row);
  expect(inAdvanced(fields.distance)).toBe(false);
  expect(inAdvanced(fields.elevation)).toBe(false);
  expect(inAdvanced(fields.duration)).toBe(true);
  expect(inAdvanced(fields.timeLimit)).toBe(true);
  await expect.element(row.getByText(fr.form.measuresHint)).toBeVisible();
});

test("FormatFieldset — sans mesure remplie, l'erreur est dite avec les mesures montrées, sans ouvrir les options", async () => {
  withMeasuredTypes();
  const { screen } = await renderForm();
  await name(screen).fill("Backyard du Lac");
  await location(screen).fill("Annecy");
  await startDate(screen).fill("2026-06-13");
  const row = format(screen, 1);
  await raceType(row).selectOptions(backyardType.id);

  await save(screen).click();

  const message = row.getByText(fr.errors.format_measure_required);
  await expect.element(message).toBeVisible();
  expect(inAdvanced(message)).toBe(false);
  expect(advancedOf(row)?.open).toBe(false);
  // The measure that is shown is linked to the message.
  expect(hoursOf(row, fr.form.timeLimit).element().getAttribute("aria-describedby")).toContain(
    message.element().id,
  );
  expect(mocks.send).not.toHaveBeenCalled();
});

test("FormatFieldset — une mesure remplie reste visible quand le type ne l'utilise pas", async () => {
  withMeasuredTypes();
  // The first format of the form (F15: 15 km, 700 m) is a backyard: its type only says the time limit.
  mocks.getOne.mockResolvedValue({
    ...eventRecord,
    expand: {
      ...eventRecord.expand,
      formats_via_event: [f42, { ...f15, race_type: backyardType.id }],
    },
  });
  const { screen } = await renderEdit();
  const first = format(screen, 1);

  await expect.element(raceType(first)).toHaveValue(backyardType.id);
  await expect.element(distance(first)).toHaveValue(15);
  await expect.element(elevation(first)).toHaveValue(700);
  await expect.element(distance(first)).toBeVisible();
  await expect.element(elevation(first)).toBeVisible();
  expect(inAdvanced(distance(first))).toBe(false);
  expect(inAdvanced(elevation(first))).toBe(false);
  // What is empty and not used is put away: the duration only.
  expect(advancedOf(first)?.open).toBe(false);
  expect(inAdvanced(hoursOf(first, fr.form.duration))).toBe(true);
  expect(advancedOf(first)?.querySelectorAll("input")).toHaveLength(2); // its hours and its minutes

  // The second format is a trail, which uses what it has.
  const second = format(screen, 2);
  expect(inAdvanced(distance(second))).toBe(false);
  expect(inAdvanced(hoursOf(second, fr.form.timeLimit))).toBe(false);
});

test("FormatFieldset — une valeur saisie puis un autre type : la mesure reste visible, celle qui est vide s'en va", async () => {
  withMeasuredTypes();
  const { screen } = await renderForm();
  const row = format(screen, 1);
  await raceType(row).selectOptions(trailType.id);
  await distance(row).fill("42");
  await elevation(row).fill("2400");

  // A backyard does not use the distance or the elevation, but they are filled.
  await raceType(row).selectOptions(backyardType.id);
  expect(inAdvanced(distance(row))).toBe(false);
  expect(inAdvanced(elevation(row))).toBe(false);
  await expect.element(distance(row)).toBeVisible();
  await expect.element(elevation(row)).toBeVisible();
  expect(inAdvanced(hoursOf(row, fr.form.duration))).toBe(true);

  // Emptied, the elevation goes away with the next change of type.
  await elevation(row).fill("");
  await raceType(row).selectOptions(hyroxType.id);
  expect(inAdvanced(distance(row))).toBe(false);
  expect(inAdvanced(elevation(row))).toBe(true);
});

test("FormatFieldset — changer de type ne perd aucune valeur", async () => {
  withMeasuredTypes();
  const { screen } = await renderForm();
  await name(screen).fill("Trail du Lac");
  await location(screen).fill("Annecy");
  await startDate(screen).fill("2026-06-13");
  const row = format(screen, 1);
  await raceType(row).selectOptions(trailType.id);
  await distance(row).fill("42");
  await elevation(row).fill("2400");
  await hoursOf(row, fr.form.timeLimit).fill("10");
  // The duration is not one of a trail's: it is typed in the section of the others.
  await moreOptions(row).click();
  await hoursOf(row, fr.form.duration).fill("6");
  await minutesOf(row, fr.form.duration).fill("30");

  for (const type of [backyardType, hyroxType, climbType, roadType, trailType, backyardType]) {
    await raceType(row).selectOptions(type.id);
    await expect.element(distance(row)).toHaveValue(42);
    await expect.element(elevation(row)).toHaveValue(2400);
    await expect.element(hoursOf(row, fr.form.timeLimit)).toHaveValue(10);
    await expect.element(hoursOf(row, fr.form.duration)).toHaveValue(6);
    await expect.element(minutesOf(row, fr.form.duration)).toHaveValue(30);
    // All four have a value: none is put away.
    expect(advancedOf(row)).toBeNull();
  }

  await save(screen).click();
  await vi.waitFor(() => {
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  expect(mocks.calls[1]?.body).toMatchObject({
    race_type: backyardType.id,
    distance_km: 42,
    elevation_gain_m: 2400,
    duration_min: 390,
    time_limit_min: 600,
  });
});

test("FormatFieldset — saisir dans « Options avancées » garde le focus, et le champ ne bouge pas pendant la frappe", async () => {
  withMeasuredTypes();
  const { screen } = await renderForm();
  const row = format(screen, 1);
  await raceType(row).selectOptions(backyardType.id);
  await moreOptions(row).click();

  await distance(row).click();
  await userEvent.keyboard("1");
  await userEvent.keyboard("2");
  await userEvent.keyboard("5");

  await expect.element(distance(row)).toHaveValue(125);
  await expect.element(distance(row)).toHaveFocus();
  // It stays where the person is typing, in the section.
  expect(inAdvanced(distance(row))).toBe(true);
});

test("FormatFieldset — refermer « Options avancées » sur des valeurs les met avec les mesures, et le focus va au titre de l'épreuve", async () => {
  withMeasuredTypes();
  const { screen } = await renderForm();
  const row = format(screen, 1);
  await raceType(row).selectOptions(hyroxType.id);
  await moreOptions(row).click();
  await elevation(row).fill("300");
  await hoursOf(row, fr.form.duration).fill("2");
  await hoursOf(row, fr.form.timeLimit).fill("5");

  // Closing the section on filled fields: they come out of it, and it has nothing left.
  await moreOptions(row).click();

  await vi.waitFor(() => {
    expect(advancedOf(row)).toBeNull();
  });
  await expect.element(elevation(row)).toHaveValue(300);
  await expect.element(elevation(row)).toBeVisible();
  await expect.element(hoursOf(row, fr.form.duration)).toBeVisible();
  // The summary that had the focus is gone with the section: the focus goes to the title of the format.
  await expect.element(row.getByText(fr.form.formatTitle(1), { exact: true })).toHaveFocus();
});

test("FormatFieldset — refermer « Options avancées » ne fait sortir que les champs remplis, et le focus reste sur le résumé", async () => {
  withMeasuredTypes();
  const { screen } = await renderForm();
  const row = format(screen, 1);
  await raceType(row).selectOptions(backyardType.id);
  await moreOptions(row).click();
  await elevation(row).fill("300");

  await moreOptions(row).click();

  // The elevation has a value: it comes out. The distance and the duration are empty: they stay in the section.
  await vi.waitFor(() => {
    expect(inAdvanced(elevation(row))).toBe(false);
  });
  expect(inAdvanced(distance(row))).toBe(true);
  expect(advancedOf(row)?.open).toBe(false);
  await expect.element(moreOptions(row)).toHaveFocus();
});

test("FormatFieldset — « Options avancées » s'ouvre et se ferme au clavier", async () => {
  withMeasuredTypes();
  const { screen } = await renderForm();
  const row = format(screen, 1);
  await raceType(row).selectOptions(backyardType.id);

  const toggle = moreOptions(row).element();
  if (!(toggle instanceof HTMLElement)) throw new Error("not an element");
  toggle.focus();
  await userEvent.keyboard("{Enter}");
  expect(advancedOf(row)?.open).toBe(true);
  await expect.element(distance(row)).toBeVisible();
  await userEvent.keyboard("{Enter}");
  expect(advancedOf(row)?.open).toBe(false);
  await userEvent.keyboard(" ");
  expect(advancedOf(row)?.open).toBe(true);
});

test("FormatFieldset — « Reprendre ces valeurs » montre la distance et le D+ même quand le type ne les utilise pas", async () => {
  withMeasuredTypes();
  const { screen } = await renderForm();
  const row = format(screen, 1);
  await raceType(row).selectOptions(backyardType.id);
  expect(inAdvanced(distance(row))).toBe(true);

  await gpxField(row).upload(gpxFile());
  await expect.element(trackRead(row)).toBeVisible();
  await pressFocused(reuse(row));

  await expect.element(distance(row)).toHaveValue(22.2);
  await expect.element(elevation(row)).toHaveValue(200);
  expect(inAdvanced(distance(row))).toBe(false);
  expect(inAdvanced(elevation(row))).toBe(false);
  await expect.element(distance(row)).toBeVisible();
  // The button that was pressed is still there, with the focus.
  await expect.element(reuse(row)).toHaveFocus();
});

test("FormatFieldset — le résumé de « Options avancées » fait au moins 44 px, sur un téléphone", async () => {
  await page.viewport(375, 812);
  try {
    withMeasuredTypes();
    const { screen } = await renderForm();
    const row = format(screen, 1);
    await raceType(row).selectOptions(backyardType.id);
    await fontsReady();

    const box = moreOptions(row).element().getBoundingClientRect();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  } finally {
    await page.viewport(FRAME.width, FRAME.height);
  }
});

test("FormatFieldset — le résumé de « Options avancées » se lit le jour, la nuit et en couleurs forcées", async (context) => {
  withMeasuredTypes();
  const { screen } = await renderForm();
  const row = format(screen, 1);
  await raceType(row).selectOptions(backyardType.id);
  const opener = moreOptions(row).element();
  // By day and by night, its text is the text of the labels of the fields, whose contrast is pinned (dark.test.ts).
  const label = row.getByText(fr.format.price, { exact: true }).element();

  try {
    await emulateMedia({ colorScheme: "light", forcedColors: "none" });
    const day = getComputedStyle(opener).color;
    expect(day).toBe(getComputedStyle(label).color);
    await emulateMedia({ colorScheme: "dark", forcedColors: "none" });
    // The scheme is applied a moment after the command answers (WebKit on Linux).
    await expect.poll(() => getComputedStyle(opener).color).not.toBe(day);
    const night = getComputedStyle(opener).color;
    expect(night).toBe(getComputedStyle(label).color);

    // In forced colours the browser picks the colours: the text, and the marker that says open or closed, are not the colour of the ground.
    await emulateMedia({ colorScheme: "light", forcedColors: "active" });
    // Safari has no forced colours mode (Playwright only answers the media query there).
    if (
      server.browser === "webkit" ||
      (server.browser !== "chromium" && !matchMedia("(forced-colors: active)").matches)
    )
      context.skip();
    const ground = getComputedStyle(row.element()).backgroundColor;
    expect(getComputedStyle(opener).color).not.toBe(ground);
    expect(getComputedStyle(opener, "::marker").color).not.toBe(ground);
    expect(getComputedStyle(opener).display).toBe("list-item");
  } finally {
    await resetMedia();
  }
});

test("FormatFieldset — le résumé le plus long, en anglais, tient sur un téléphone", async () => {
  await page.viewport(375, 812);
  try {
    withMeasuredTypes();
    const { screen } = await renderForm({ languages: ["en-GB"], heading: "Create an event" });
    const row = screen.getByRole("group", { name: "Race 1", exact: true });
    await row.getByLabelText("Race type").selectOptions(backyardType.id);
    await fontsReady();

    const opener = moreOptions(row).element();
    // Three measures in it: it may take two lines, and never more than the screen.
    expect(opener.textContent).toMatch(/^More options: distance, elevation gain,? and duration$/);
    expect(opener.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(opener.getBoundingClientRect().right).toBeLessThanOrEqual(375);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  } finally {
    await page.viewport(FRAME.width, FRAME.height);
  }
});

test("FormatFieldset — en anglais, « More options » et le rappel de la mesure sont en anglais", async () => {
  withMeasuredTypes();
  const { screen } = await renderForm({ languages: ["en-GB"], heading: "Create an event" });
  const row = screen.getByRole("group", { name: "Race 1", exact: true });

  await row.getByLabelText("Race type").selectOptions(backyardType.id);

  await expect.element(moreOptions(row)).toBeVisible();
  // It says what is in it, in English too, with the list of the language.
  expect(summaryText(row)).toMatch(/^More options: distance, elevation gain,? and duration$/);
  await expect
    .element(row.getByText("At least one measure is required: distance, duration or time limit."))
    .toBeVisible();
});

test("FormatFieldset — M6 : le résumé de « Options avancées » dit ce qu'il contient, et suit les champs qui en sortent", async () => {
  withMeasuredTypes();
  const { screen } = await renderForm();
  const row = format(screen, 1);

  // A backyard shows its time limit: the other three are in the section.
  await raceType(row).selectOptions(backyardType.id);
  expect(summaryText(row)).toBe("Options avancées : distance, D+ et durée");
  await raceType(row).selectOptions(hyroxType.id);
  expect(summaryText(row)).toBe("Options avancées : D+, durée et temps max");
  // One measure left in it.
  await raceType(row).selectOptions(trailType.id);
  expect(summaryText(row)).toBe("Options avancées : durée");

  // A field that has a value comes out of the section when it is closed, and the summary follows.
  await raceType(row).selectOptions(backyardType.id);
  await moreOptions(row).click();
  await elevation(row).fill("300");
  await moreOptions(row).click();
  await vi.waitFor(() => {
    expect(summaryText(row)).toBe("Options avancées : distance et durée");
  });
});

test("FormatFieldset — T2-2 : une saisie refusée par le navigateur dans « Options avancées » fermé ouvre la section, et le champ prend le focus", async () => {
  withMeasuredTypes();
  const { screen } = await renderForm();
  await name(screen).fill("Backyard du Lac");
  await location(screen).fill("Annecy");
  await startDate(screen).fill("2026-06-13");
  const row = format(screen, 1);
  await raceType(row).selectOptions(backyardType.id);
  await hoursOf(row, fr.form.timeLimit).fill("2");
  await moreOptions(row).click();
  await distance(row).click();
  // Not a number: the field reads it as empty, so nothing is filled, but the browser says it is invalid.
  await userEvent.keyboard("e");
  const field = distance(row).element();
  if (!(field instanceof HTMLInputElement)) throw new Error("not an input");
  expect(field.validity.badInput).toBe(true);
  expect(field.value).toBe("");
  await moreOptions(row).click();
  // Closed, with the invalid field in it: nothing comes out of the section.
  await vi.waitFor(() => {
    expect(advancedOf(row)?.open).toBe(false);
  });
  expect(inAdvanced(distance(row))).toBe(true);

  await save(screen).click();

  // Nothing is sent, and the browser can report the field, since it is shown now.
  expect(mocks.send).not.toHaveBeenCalled();
  expect(advancedOf(row)?.open).toBe(true);
  await expect.element(distance(row)).toBeVisible();
  await expect.element(distance(row)).toHaveFocus();
});
