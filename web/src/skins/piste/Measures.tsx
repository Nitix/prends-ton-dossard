import type { FormatMarks } from "../../features/events/FormatLine";

/**
 * How « Piste » marks the parts of a format (`FormatLine`, `FormatParts`): its
 * name in the display face, then each measure as a chip, as the plate of a
 * lane carries its figures. `size` is `md` on a card, `lg` in the title of a
 * format. Built when it is drawn, never when this module is evaluated.
 */
export function measureMarks(size: "md" | "lg" = "md"): FormatMarks {
  const big = size === "lg";
  return {
    name: (name) => (
      <span
        className={`format-name mr-0.5 font-display leading-tight font-bold text-ink ${
          big ? "text-[1.375rem]" : "text-[1.0625rem] tracking-[0.01em]"
        }`}
      >
        {name}
      </span>
    ),
    measure: (measure) => (
      <span
        className={`format-measure inline-flex items-center rounded-md bg-neutral-100 font-display font-semibold tracking-[0.02em] whitespace-nowrap text-neutral-800 tabular-nums ring-1 ring-neutral-200 ${
          big ? "px-2 py-0.5 text-base" : "px-1.5 py-px text-sm"
        }`}
      >
        {measure}
      </span>
    ),
  };
}
