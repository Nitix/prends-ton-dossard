/**
 * The HTML of a drawing with its ids set aside: an id of `useId` (`«r0»`,
 * `_r_0_`, `:r0:`) is new at each render, so two renders of the same drawing
 * differ by them only. Tests that compare what a skin draws compare this.
 */
export function withoutIds(html: string): string {
  return html.replace(/«[^»]*»|_r_[0-9a-z]+_|:r[0-9a-z]+:/g, "ID");
}
