import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { Status } from "../../lib/types";
import { StatusField } from "./fields";

function renderField(props: {
  started: boolean;
  value?: Status;
  locked?: "undecided" | "support";
}) {
  const { value = "interested", ...rest } = props;
  return render(
    <I18nProvider languages={["fr"]}>
      <StatusField value={value} onChange={vi.fn<(status: Status) => void>()} {...rest} />
    </I18nProvider>,
  );
}

/** What the select of the status offers, in order. */
async function offered(screen: Awaited<ReturnType<typeof renderField>>) {
  const select = screen.getByLabelText(fr.participation.status).element();
  if (!(select instanceof HTMLSelectElement)) throw new Error("not a select");
  return Array.from(select.options).map((option) => option.textContent);
}

test("StatusField — le jour de la course, les cinq statuts sont proposés", async () => {
  const screen = await renderField({ started: true });

  expect(await offered(screen)).toEqual([
    fr.status.interested,
    fr.status.registered,
    fr.status.finished,
    fr.status.dnf,
    fr.status.dns,
  ]);
});

test("StatusField — avant le jour de la course, ni « Terminé » ni « Abandon »", async () => {
  const screen = await renderField({ started: false });

  expect(await offered(screen)).toEqual([
    fr.status.interested,
    fr.status.registered,
    fr.status.dns,
  ]);
});

test("StatusField — le statut actuel reste dans la liste, même quand il n'est plus proposé", async () => {
  const screen = await renderField({ started: false, value: "finished" });

  expect(await offered(screen)).toEqual([
    fr.status.interested,
    fr.status.registered,
    fr.status.finished,
    fr.status.dns,
  ]);
  await expect.element(screen.getByLabelText(fr.participation.status)).toHaveValue("finished");
});

test("StatusField — sans épreuve (verrouillé), « Intéressé » et « Supporteur » seulement, avant comme après la course", async () => {
  for (const started of [false, true]) {
    const undecided = await renderField({ started, locked: "undecided" });
    expect(await offered(undecided)).toEqual([fr.status.interested, fr.status.supporter]);
    await undecided.unmount();
  }
});
