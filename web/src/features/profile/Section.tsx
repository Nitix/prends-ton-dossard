import { useId, type ReactNode, type Ref } from "react";

import { BlockTitle } from "../../components/BlockTitle";

/**
 * A part of the profile or of the settings page: a heading, and a region named by it.
 * On the settings page, each is a white card (`boxed`); on the profile, the
 * rows of a list are cards already.
 *
 * A section that takes the focus away from what had it (a button that goes with
 * the action) gives a `headingRef`: the heading can then be focused, and only
 * from the page, since it is not in the tab order.
 */
export function Section({
  title,
  headingRef,
  boxed = true,
  children,
}: {
  title: string;
  headingRef?: Ref<HTMLHeadingElement>;
  boxed?: boolean;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={`flex flex-col gap-3 ${boxed ? "card p-4 md:p-5" : ""}`}
    >
      <BlockTitle
        id={headingId}
        ref={headingRef}
        tabIndex={headingRef === undefined ? undefined : -1}
      >
        {title}
      </BlockTitle>
      {children}
    </section>
  );
}
