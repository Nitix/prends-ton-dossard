/**
 * Waits until the animations that have an end are over: the dialog that rises
 * as it opens, a title that pops. While they run, a box is shifted by a
 * fraction of a pixel, and the height measured then can be 43.99997 for a box
 * of 44: a test that measures right after a dialog opens waits for this first.
 * An animation that never ends (the app has none, but a page might) is not
 * waited for.
 */
export async function animationsDone(): Promise<void> {
  const ending = document.getAnimations().filter(({ effect }) => {
    const end = effect?.getComputedTiming().endTime;
    return typeof end === "number" && Number.isFinite(end);
  });
  // An animation that is cancelled (its element is gone) is over too.
  await Promise.all(ending.map((animation) => animation.finished.catch(() => undefined)));
}
