import { useId, type ReactNode, type Ref } from "react";

/**
 * A part of the profile or of the settings page: a heading, and a region named by it.
 *
 * A section that takes the focus away from what had it (a button that goes with
 * the action) gives a `headingRef`: the heading can then be focused, and only
 * from the page, since it is not in the tab order.
 */
export function Section({
  title,
  headingRef,
  children,
}: {
  title: string;
  headingRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={headingRef === undefined ? undefined : -1}
        className="text-lg font-semibold"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
