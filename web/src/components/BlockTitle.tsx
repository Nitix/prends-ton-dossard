import type { ComponentPropsWithRef } from "react";

import { SectionMarker } from "./Slots";

/**
 * The title of a block of a page: an `h2` that starts with the mark of the skin
 * (Crête's small sun on the horizon), in the style of `.block-title`. Its class
 * `.section-title` is the hook of a skin that restyles it. Every block title
 * is one, so that none goes without its mark.
 */
export function BlockTitle({ className, children, ...props }: ComponentPropsWithRef<"h2">) {
  return (
    <h2
      {...props}
      className={className ? `block-title section-title ${className}` : "block-title section-title"}
    >
      <SectionMarker />
      {children}
    </h2>
  );
}
