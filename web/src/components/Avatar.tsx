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
 * the colours the initials need when what is around them does not.
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
        className={`rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center rounded-full ${className}`}
    >
      {initials(runner.name)}
    </span>
  );
}
