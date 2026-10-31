/**
 * Makes sure the global `Temporal` exists. Every target browser has it
 * natively except Safari, which gets the polyfill, loaded only when needed
 * so that the other browsers never download it.
 *
 * The app awaits this before rendering: nothing may use `Temporal` earlier.
 */
export async function ensureTemporal(): Promise<void> {
  if (!("Temporal" in globalThis)) {
    await import("temporal-polyfill/global");
  }
}
