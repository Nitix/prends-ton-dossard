import { useState } from "react";

import { avatarURL, type AvatarThumb } from "../lib/avatar";
import { initials } from "../lib/initials";
import type { RunnerRecord } from "../lib/types";

/**
 * The photo of a runner, in a round, or their initials when there is no photo
 * or when it does not load. The picture is decorative (`alt=""`): a runner is
 * always named next to their avatar, in text, and the initials are hidden
 * from screen readers for the same reason.
 *
 * `className` goes on both, the photo and the initials: it gives the size, and
 * the colours the initials need when what is around them does not. Both carry
 * `.avatar`; the initials also carry `data-tint`, a number from 0 to 11 that
 * is always the same for a runner, for a skin that tints the initials of each
 * runner (a tint that means nothing: the name is written beside it).
 */
export function Avatar({
  runner,
  thumb,
  className = "",
}: {
  runner: RunnerRecord;
  thumb: AvatarThumb;
  className?: string;
}) {
  const url = avatarURL(runner, thumb);
  // The address that failed to load: a new photo has another one, and gets its chance.
  const [failed, setFailed] = useState<string | undefined>(undefined);

  if (url !== undefined && url !== failed) {
    return (
      <img
        src={url}
        alt=""
        decoding="async"
        loading="lazy"
        onError={() => {
          setFailed(url);
        }}
        className={`avatar rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-tint={tintOf(runner.id)}
      className={`avatar inline-flex items-center justify-center rounded-full ${className}`}
    >
      {initials(runner.name)}
    </span>
  );
}

/**
 * How many tints `data-tint` counts: 12, so that a skin with 2, 3, 4 or 6
 * tints spreads the runners evenly over them.
 */
const TINTS = 12;

/** The tint of a runner, from their id: the same on every page. */
export function tintOf(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 9973;
  return hash % TINTS;
}
