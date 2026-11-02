import type { ReactNode } from "react";

import { EmptyArt } from "./Slots";

/**
 * What a list says when it has nothing: its words in a white card, under the
 * art of the skin (`EmptyArt`: for Crête, the faint contour lines of a blank
 * map and a small dawn on the summits). The words say it all; the drawing is
 * decoration.
 */
export function EmptyState({ title, hint }: { title: ReactNode; hint: ReactNode }) {
  return (
    <div className="card relative isolate flex flex-col items-center gap-1 overflow-hidden px-6 pt-5 pb-6 text-center">
      <EmptyArt />
      <p className="card-title">{title}</p>
      <p className="text-sm text-neutral-600">{hint}</p>
    </div>
  );
}
