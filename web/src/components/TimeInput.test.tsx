import { useState } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { fr } from "../i18n/fr";
import { I18nProvider } from "../i18n/I18nProvider";
import { TimeInput } from "./TimeInput";

// The size of the fields is a matter of the styles, which are not loaded otherwise.
import "../styles.css";

const LABEL = "Temps";
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
      <TimeInput
        name="time"
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
          setValue(5400);
        }}
      >
        Mettre 1 h 30
      </button>
    </I18nProvider>
  );
}

type Screen = Awaited<ReturnType<typeof render>>;
const hours = (screen: Screen) => screen.getByLabelText(`${LABEL}, ${fr.results.hoursName}`);
const minutes = (screen: Screen) => screen.getByLabelText(`${LABEL}, ${fr.results.minutesName}`);
const seconds = (screen: Screen) => screen.getByLabelText(`${LABEL}, ${fr.results.secondsName}`);

test("TimeInput — 4, 12, 30 donne 15150 secondes", async () => {
  const onChange = vi.fn<(value: number | undefined) => void>();
  const screen = await render(<Parent onChange={onChange} />);

  await hours(screen).fill("4");
  expect(onChange).toHaveBeenLastCalledWith(14400);
  await minutes(screen).fill("12");
  expect(onChange).toHaveBeenLastCalledWith(15120);
  await seconds(screen).fill("30");

  expect(onChange).toHaveBeenLastCalledWith(15150);
});

test("TimeInput — les minutes et les secondes seules, sans heures", async () => {
  const onChange = vi.fn<(value: number | undefined) => void>();
  const screen = await render(<Parent onChange={onChange} />);

  await minutes(screen).fill("42");
  await seconds(screen).fill("5");

  expect(onChange).toHaveBeenLastCalledWith(2525);
});

test("TimeInput — vide donne undefined", async () => {
  const onChange = vi.fn<(value: number | undefined) => void>();
  const screen = await render(<Parent initial={15150} onChange={onChange} />);

  await hours(screen).fill("");
  await minutes(screen).fill("");
  await seconds(screen).fill("");

  expect(onChange).toHaveBeenLastCalledWith(undefined);
});

test("TimeInput — à zéro, ce n'est pas un temps, et ce qui est tapé reste", async () => {
  const onChange = vi.fn<(value: number | undefined) => void>();
  const screen = await render(<Parent initial={15150} onChange={onChange} />);

  await hours(screen).fill("0");
  await minutes(screen).fill("0");
  await seconds(screen).fill("0");

  expect(onChange).toHaveBeenLastCalledWith(undefined);
  await expect.element(hours(screen)).toHaveValue(0);
  await expect.element(minutes(screen)).toHaveValue(0);
  await expect.element(seconds(screen)).toHaveValue(0);
});

test("TimeInput — 90 minutes tapées restent 90", async () => {
  const onChange = vi.fn<(value: number | undefined) => void>();
  const screen = await render(<Parent onChange={onChange} />);

  await minutes(screen).fill("90");

  expect(onChange).toHaveBeenLastCalledWith(5400);
  // They are not written again as 1 h 30.
  await expect.element(minutes(screen)).toHaveValue(90);
  await expect.element(hours(screen)).toHaveValue(null);
});

test("TimeInput — montre la valeur de départ en heures, minutes et secondes", async () => {
  const screen = await render(<Parent initial={15150} onChange={noop} />);

  await expect.element(hours(screen)).toHaveValue(4);
  await expect.element(minutes(screen)).toHaveValue(12);
  await expect.element(seconds(screen)).toHaveValue(30);
});

test("TimeInput — une partie à zéro laisse son champ vide", async () => {
  const screen = await render(<Parent initial={14405} onChange={noop} />);

  await expect.element(hours(screen)).toHaveValue(4);
  await expect.element(minutes(screen)).toHaveValue(null);
  await expect.element(seconds(screen)).toHaveValue(5);
});

test("TimeInput — une valeur qui ne peut pas être le total des champs ne fait pas boucler", async () => {
  // 90.5 seconds: the server only stores whole seconds, but the component must not hang on it.
  const screen = await render(<Parent initial={90.5} onChange={noop} />);

  await expect.element(minutes(screen)).toHaveValue(1);
});

test("TimeInput — une valeur qui vient d'ailleurs est montrée", async () => {
  const screen = await render(<Parent onChange={noop} />);
  await hours(screen).fill("5");

  await screen.getByRole("button", { name: "Mettre 1 h 30" }).click();

  await expect.element(hours(screen)).toHaveValue(1);
  await expect.element(minutes(screen)).toHaveValue(30);
  await expect.element(seconds(screen)).toHaveValue(null);
});

test("TimeInput — un groupe nommé par son libellé, trois champs nommés par leur partie, et 44 px", async () => {
  const screen = await render(<Parent onChange={noop} />);

  await expect.element(screen.getByRole("group", { name: LABEL })).toBeVisible();
  for (const field of [hours(screen), minutes(screen), seconds(screen)]) {
    expect(field.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
});

test("TimeInput — les unités sont écrites à côté des champs, et ses trois champs tiennent sur 311 px (un téléphone, dans une fenêtre)", async () => {
  const screen = await render(
    <div style={{ width: 311 }}>
      <Parent onChange={noop} />
    </div>,
  );

  const group = screen.getByRole("group", { name: LABEL });
  await expect
    .element(group)
    .toHaveTextContent(`${LABEL}${fr.results.hours}${fr.results.minutes}${fr.results.seconds}`);
  // On a single line, and not wider than the room it has.
  const tops = new Set(
    [hours(screen), minutes(screen), seconds(screen)].map(
      (field) => field.element().getBoundingClientRect().top,
    ),
  );
  expect(tops.size).toBe(1);
  expect(group.element().scrollWidth).toBeLessThanOrEqual(311);
});

test("TimeInput — décrit ses champs par l'aide ou l'erreur donnée, et se dit invalide", async () => {
  const screen = await render(
    <I18nProvider languages={["fr"]}>
      <TimeInput name="time" label={LABEL} onChange={noop} describedBy="why" invalid />
      <p id="why">Trop long</p>
    </I18nProvider>,
  );

  for (const field of [hours(screen), minutes(screen), seconds(screen)]) {
    await expect.element(field).toHaveAccessibleDescription("Trop long");
    await expect.element(field).toHaveAttribute("aria-invalid", "true");
  }
});
