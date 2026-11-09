import { useState } from "react";
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

function nested(innerOpen: boolean, onOuterClose: () => void, onInnerClose: () => void) {
  return (
    <I18nProvider languages={["fr"]}>
      <Dialog open onClose={onOuterClose} title="Dehors">
        <Dialog open={innerOpen} onClose={onInnerClose} title="Dedans">
          <p>Contenu</p>
        </Dialog>
      </Dialog>
    </I18nProvider>
  );
}

test("Dialog — fermer la fenêtre qu'elle contient n'appelle pas son propre onClose", async () => {
  const onOuterClose = vi.fn<() => void>();
  const onInnerClose = vi.fn<() => void>();
  const screen = await render(nested(false, onOuterClose, onInnerClose));
  await expect.element(screen.getByRole("dialog", { name: "Dehors" })).toBeVisible();
  // The outer dialog is open first, as a dialog that asks for a confirmation is.
  await screen.rerender(nested(true, onOuterClose, onInnerClose));
  await expect.element(screen.getByRole("dialog", { name: "Dedans" })).toBeVisible();

  // The topmost dialog is the one Esc closes.
  await userEvent.keyboard("{Escape}");

  await vi.waitFor(() => {
    expect(onInnerClose).toHaveBeenCalledTimes(1);
  });
  // The event of the inner dialog goes up the React tree, past the outer one.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(onOuterClose).not.toHaveBeenCalled();
});

// Safari does not give the focus to a button that is clicked (and takes it from the page).
// Chromium does, unless the press is cancelled: so the opener here cancels `mousedown`.
function SafariOpener({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <I18nProvider languages={["fr"]}>
      <button
        type="button"
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          setOpen(true);
        }}
      >
        Ouvrir
      </button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        title="Retirer la course"
      >
        <button type="button">Dans la boîte</button>
      </Dialog>
    </I18nProvider>
  );
}

test("Dialog — dans Safari, un bouton qui n'a pas le focus le retrouve à la fermeture, par Fermer ou par Échap", async () => {
  const screen = await render(<SafariOpener onClose={() => {}} />);
  const opener = screen.getByRole("button", { name: "Ouvrir" });

  await opener.click();
  expect(document.activeElement).not.toBe(opener.element());
  await screen.getByRole("button", { name: fr.common.close }).click();
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(opener.element());
  });

  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await opener.click();
  await expect.element(screen.getByRole("dialog")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(opener.element());
  });
});
