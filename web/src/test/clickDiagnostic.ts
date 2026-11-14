import { vi } from "vitest";
import { type Locator } from "vitest/browser";

import { realClick } from "./touchDialogClicks";

// TEMPORARY DIAGNOSTIC (docs/TODO.md, Firefox and the buttons of AddToOfferDialog): on Firefox a
// real click on a button of a dialog reaches no pointer event at all on CI. This clicks for real
// and, when `done` does not come true, throws what is at the point of the click (the centre of
// the box): if it is not the button, or something inside the dialog, an overlay covers it.

function describeNode(node: Element | null, dialog: HTMLDialogElement | null): string {
  if (node === null) return "null";
  const own = typeof node.className === "string" ? node.className.slice(0, 60) : "";
  return `${node.tagName}.${own} inDialog=${String(dialog?.contains(node) ?? false)} text=${node.textContent?.slice(0, 20)}`;
}

function state(button: Locator): string {
  const element = button.query();
  const dialog = element?.closest("dialog") ?? document.querySelector("dialog");
  const box = element?.getBoundingClientRect();
  const dialogBox = dialog?.getBoundingClientRect();
  let point = "no box";
  if (box) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const top = document.elementFromPoint(x, y);
    point = `at(${x.toFixed(1)},${y.toFixed(1)})=${describeNode(top, dialog)}; isButton=${String(top === element || (element?.contains(top) ?? false))}`;
  }
  return [
    `open=${String(dialog?.open)}`,
    `modal=${String(dialog?.matches(":modal"))}`,
    `active=${document.activeElement?.tagName}`,
    `box=${box?.x},${box?.y},${box?.width}x${box?.height}`,
    `dialogBox=${dialogBox?.x},${dialogBox?.y},${dialogBox?.width}x${dialogBox?.height}`,
    `viewport=${window.innerWidth}x${window.innerHeight}`,
    point,
  ].join("; ");
}

export async function expectRealClickDoes(
  label: string,
  button: Locator,
  done: () => boolean,
): Promise<void> {
  const seen: string[] = [];
  const types = ["pointerdown", "mousedown", "focusin", "pointerup", "mouseup", "click"];
  const listener = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    seen.push(`${event.type}:${target?.tagName}:${target?.textContent?.slice(0, 10)}`);
  };
  for (const type of types) document.addEventListener(type, listener, true);
  // The state before the click: what covers the button is seen before anything moves.
  const before = state(button);
  try {
    await realClick(button);
    await vi.waitFor(() => {
      if (!done()) throw new Error("not done yet");
    });
  } catch (error) {
    throw new Error(
      `real click on ${label} did nothing; before: ${before}; after: ${state(button)}; events=${seen.join(" ")}`,
      { cause: error },
    );
  } finally {
    for (const type of types) document.removeEventListener(type, listener, true);
  }
}
