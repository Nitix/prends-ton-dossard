import type { EmptyStateProps, VariantPropsOf, Variants } from "../types";

// « Exemple (dev) », depth mix: the components it replaces (see ../README.md,
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

/**
 * An event in a list: Crête's card (`Base`, every feature of it), framed by a
 * thick line in the accent, dashed in the agenda. A variant that wraps the base.
 */
function ExampleEventCard({ Base, ...props }: VariantPropsOf<"EventCard">) {
  return (
    <div
      data-variant="example"
      data-list={props.list}
      style={{
        borderLeft: `6px ${props.list === "agenda" ? "dashed" : "solid"} var(--color-iris-600)`,
        borderRadius: "1.5rem",
      }}
    >
      <Base {...props} />
    </div>
  );
}

export const variants: Variants = { EmptyState: ExampleEmptyState, EventCard: ExampleEventCard };
