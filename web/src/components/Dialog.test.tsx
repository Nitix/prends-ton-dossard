import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { fr } from "../i18n/fr";
import { I18nProvider } from "../i18n/I18nProvider";
import { Dialog } from "./Dialog";

afterEach(() => {
  vi.restoreAllMocks();
});

function sample(open: boolean, onClose: () => void) {
  return (
    <I18nProvider languages={["fr"]}>
      <Dialog open={open} onClose={onClose} title="Retirer la course">
        <button type="button">Dans la boîte</button>
      </Dialog>
    </I18nProvider>
  );
}

test("Dialog — fermée, elle n'est ni visible ni rendue", async () => {
  const screen = await render(sample(false, () => {}));

  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  expect(screen.container.textContent).not.toContain("Dans la boîte");
});

test("Dialog — ouverte, c'est un <dialog> modal nommé par son titre", async () => {
  const screen = await render(sample(true, () => {}));

  const dialog = screen.getByRole("dialog", { name: "Retirer la course" });
  await expect.element(dialog).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Dans la boîte" })).toBeVisible();
  expect(dialog.element()).toBeInstanceOf(HTMLDialogElement);
  // showModal() puts it on the top layer: that is what ":modal" matches.
  expect(dialog.element().matches(":modal")).toBe(true);
});

test("Dialog — Échap appelle onClose", async () => {
  const onClose = vi.fn<() => void>();
  await render(sample(true, onClose));

  await userEvent.keyboard("{Escape}");

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

test("Dialog — le bouton Fermer appelle onClose", async () => {
  const onClose = vi.fn<() => void>();
  const screen = await render(sample(true, onClose));

  await screen.getByRole("button", { name: fr.common.close }).click();

  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

test("Dialog — quand le parent la ferme, onClose n'est pas rappelée", async () => {
  const onClose = vi.fn<() => void>();
  const screen = await render(sample(true, onClose));
  await expect.element(screen.getByRole("dialog")).toBeVisible();

  await screen.rerender(sample(false, onClose));

  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  // The native "close" event is dispatched after the effect that closes it.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(onClose).not.toHaveBeenCalled();
});

test("Dialog — peut être rouverte", async () => {
  const screen = await render(sample(true, () => {}));
  await screen.rerender(sample(false, () => {}));

  await screen.rerender(sample(true, () => {}));

  await expect.element(screen.getByRole("dialog", { name: "Retirer la course" })).toBeVisible();
});
