import { skinnable } from "../skins/components";
import type { EmptyStateProps } from "../skins/types";
import { EmptyArt } from "./Slots";

/**
 * What a list says when it has nothing: its words in a white card, under the
 * art of the skin (`EmptyArt`: for Crête, the faint contour lines of a blank
 * map and a small dawn on the summits). The words say it all; the drawing is
 * decoration.
 */
export function EmptyStateBase({ title, hint }: EmptyStateProps) {
  return (
    <div className="empty-state card relative isolate flex flex-col items-center gap-1 overflow-hidden px-6 pt-5 pb-6 text-center">
      <EmptyArt />
      <p className="card-title">{title}</p>
      <p className="text-sm text-neutral-600">{hint}</p>
    </div>
  );
}

/** The empty state, as the skin of the page draws it at the depth of the build (Crête's above, by default). */
export const EmptyState = skinnable("EmptyState", EmptyStateBase);
