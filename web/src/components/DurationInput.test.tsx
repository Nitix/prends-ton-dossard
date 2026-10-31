import { useState } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { fr } from "../i18n/fr";
import { I18nProvider } from "../i18n/I18nProvider";
import { DurationInput } from "./DurationInput";

// The size of the fields is a matter of the styles, which are not loaded otherwise.
import "../styles.css";

const LABEL = "Temps max";
const noop = vi.fn<(value: number | undefined) => void>();

/** A parent that keeps the value, as a form does. */
function Parent({
  initial,
  onChange,
}: {
  initial?: number;
  onChange: (value: number | undefined) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <I18nProvider languages={["fr"]}>
      <DurationInput
        name="limit"
        label={LABEL}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
      <button
        type="button"
        onClick={() => {
          setValue(90);
        }}
      >
        Mettre 90
      </button>
    </I18nProvider>
  );
}

const hours = (screen: Awaited<ReturnType<typeof render>>) =>
  screen.getByLabelText(`${LABEL}, ${fr.form.hours}`);
const minutes = (screen: Awaited<ReturnType<typeof render>>) =>
  screen.getByLabelText(`${LABEL}, ${fr.form.minutes}`);

test("DurationInput — les heures et les minutes saisies donnent le total de minutes", async () => {
  const onChange = vi.fn<(value: number | undefined) => void>();
  const screen = await render(<Parent onChange={onChange} />);

  await hours(screen).fill("46");
  expect(onChange).toHaveBeenLastCalledWith(2760);
  await minutes(screen).fill("30");

  expect(onChange).toHaveBeenLastCalledWith(2790);
});

test("DurationInput — les heures seules, les minutes seules", async () => {
  const onChange = vi.fn<(value: number | undefined) => void>();
  const screen = await render(<Parent onChange={onChange} />);

  await hours(screen).fill("48");
  expect(onChange).toHaveBeenLastCalledWith(2880);
  await hours(screen).fill("");
  await minutes(screen).fill("45");

  expect(onChange).toHaveBeenLastCalledWith(45);
});

test("DurationInput — vide, ou à zéro, ce n'est pas une durée", async () => {
  const onChange = vi.fn<(value: number | undefined) => void>();
  const screen = await render(<Parent initial={2790} onChange={onChange} />);

  await hours(screen).fill("0");
  await minutes(screen).fill("0");

  expect(onChange).toHaveBeenLastCalledWith(undefined);
  // What was typed is left as it is.
  await expect.element(hours(screen)).toHaveValue(0);
  await expect.element(minutes(screen)).toHaveValue(0);

  await hours(screen).fill("");
  await minutes(screen).fill("");
  expect(onChange).toHaveBeenLastCalledWith(undefined);
});

test("DurationInput — montre la valeur de départ en heures et minutes", async () => {
  const screen = await render(<Parent initial={2790} onChange={noop} />);

  await expect.element(hours(screen)).toHaveValue(46);
  await expect.element(minutes(screen)).toHaveValue(30);
});

test("DurationInput — une valeur sans minutes laisse le champ des minutes vide", async () => {
  const screen = await render(<Parent initial={2880} onChange={noop} />);

  await expect.element(hours(screen)).toHaveValue(48);
  await expect.element(minutes(screen)).toHaveValue(null);
});

test("DurationInput — une valeur qui ne peut pas être le total de deux champs ne fait pas boucler", async () => {
  // 90.5 minutes: the server only stores whole minutes, but the component must not hang on it.
  const screen = await render(<Parent initial={90.5} onChange={noop} />);

  await expect.element(hours(screen)).toHaveValue(1);
});

test("DurationInput — 90 minutes saisies restent 90 minutes, elles ne sont pas réécrites en 1 h 30", async () => {
  const onChange = vi.fn<(value: number | undefined) => void>();
  const screen = await render(<Parent onChange={onChange} />);

  await minutes(screen).fill("90");

  expect(onChange).toHaveBeenLastCalledWith(90);
  await expect.element(minutes(screen)).toHaveValue(90);
  await expect.element(hours(screen)).toHaveValue(null);
});

test("DurationInput — une valeur qui vient d'ailleurs est montrée", async () => {
  const screen = await render(<Parent onChange={noop} />);
  await hours(screen).fill("5");

  await screen.getByRole("button", { name: "Mettre 90" }).click();

  await expect.element(hours(screen)).toHaveValue(1);
  await expect.element(minutes(screen)).toHaveValue(30);
});

test("DurationInput — un groupe nommé par son libellé, deux champs nommés par leur partie, et 44 px", async () => {
  const screen = await render(<Parent onChange={noop} />);

  await expect.element(screen.getByRole("group", { name: LABEL })).toBeVisible();
  for (const field of [hours(screen), minutes(screen)]) {
    expect(field.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
});
