import { skinnable } from "../../skins/components";
import type { FormatTitleProps } from "../../skins/types";

const SEPARATOR = " · ";

/**
 * The words of the title of a format's section, on the page of an event: its
 * name in ink, then its measures after it in grey, one text read as one line
 * (« Trail 42 km · 2 400 m D+ · max 10 h »). The page puts them in the title
 * of the section (`BlockTitle`, which gives the focus and the mark). A skin's
 * variant may draw the measures as tags or chips (`FormatParts`, in
 * FormatLine.tsx), keeping every word in its order.
 */
export function FormatTitleBase({ parts }: FormatTitleProps) {
  const [first, ...rest] = parts;
  return (
    <span className="format-title min-w-0">
      {first}
      {rest.length > 0 && (
        <span className="format-measures font-semibold text-neutral-600">{`${SEPARATOR}${rest.join(SEPARATOR)}`}</span>
      )}
    </span>
  );
}

/** The words of a format's title, as the skin of the page draws them at the depth of the build (Crête's above, by default). */
export const FormatTitle = skinnable("FormatTitle", FormatTitleBase);
