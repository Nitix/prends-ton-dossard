import { expect, test } from "vitest";

import { animationsDone } from "./animations";

test("animationsDone — attend la fin d'une animation qui finit, pas celle d'une animation sans fin", async () => {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:13.3px;top:101.37px";
  const box = document.createElement("div");
  box.style.cssText = "height:44px;width:100px";
  host.append(box);
  document.body.append(host);
  // As a dialog that rises when it opens, and as something that turns for ever.
  const rises = host.animate([{ translate: "0 12px" }, { translate: "0 0" }], { duration: 120 });
  const glows = host.animate([{ opacity: 1 }, { opacity: 0.5 }], {
    duration: 100,
    iterations: Infinity,
  });

  await animationsDone();

  expect(rises.playState).toBe("finished");
  expect(glows.playState).toBe("running");
  // Not 43.99999 or 44.0000076, as while the box is shifted.
  expect(box.getBoundingClientRect().height).toBe(44);
  glows.cancel();
  host.remove();
});

test("animationsDone — une animation annulée pendant l'attente ne la fait pas échouer", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const rises = host.animate([{ translate: "0 12px" }, { translate: "0 0" }], { duration: 5000 });

  const waiting = animationsDone();
  rises.cancel();

  await expect(waiting).resolves.toBeUndefined();
  host.remove();
});
