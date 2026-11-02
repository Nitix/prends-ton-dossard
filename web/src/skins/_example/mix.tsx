import type { EmptyStateProps, Variants } from "../types";

// « Exemple (dev) », depth mix: a component it replaces (see ../README.md,
// « Markup variants »). Only in a build at mix or full, and never in a build of
// the app at all, since the skin is one of development.

/** An empty list: its words on the left, after a thick line in the accent, with no drawing. */
function ExampleEmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div
      data-variant="example"
      className="card flex flex-col gap-1 px-6 pt-5 pb-6"
      style={{ borderLeft: "6px solid var(--color-iris-600)" }}
    >
      <p className="card-title">{title}</p>
      <p className="text-sm text-neutral-600">{hint}</p>
    </div>
  );
}

export const variants: Variants = { EmptyState: ExampleEmptyState };
