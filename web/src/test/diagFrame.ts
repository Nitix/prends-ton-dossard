// TEMPORARY diagnostic of the emulated Pixel (round 11), removed after one CI run.
import type { Locator } from "vitest/browser";

const rect = (element: Element | null | undefined) => {
  if (!element) return "none";
  const box = element.getBoundingClientRect();
  return `${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)}`;
};

/** One line about where the frame and an element are, and what a trial click says. */
export async function frameFacts(label: string, target: Locator): Promise<string> {
  let trial = "ok";
  try {
    await target.click({ trial: true, timeout: 1500 });
  } catch (error) {
    trial = String(error).replaceAll("\n", " / ").slice(-170);
  }
  const top = window.top;
  const frame = window.frameElement;
  return `DIAG3 ${label} win=${window.innerWidth}x${window.innerHeight} top=${top?.innerWidth}x${top?.innerHeight} frame=${rect(frame)} frameCss=${frame ? getComputedStyle(frame).transform : ""} vv=${window.visualViewport?.width}x${window.visualViewport?.height} target=${rect(target.element())} trial=${trial}`.slice(
    0,
    295,
  );
}
