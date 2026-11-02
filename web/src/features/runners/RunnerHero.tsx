import type { RefObject } from "react";

import { Avatar } from "../../components/Avatar";
import { HeroArt } from "../../components/Slots";
import { useI18n } from "../../i18n/I18nProvider";
import type { RunnerRecord } from "../../lib/types";

/**
 * The top of the page of a runner, its hero: their photo (or their initials)
 * and their name, the title of the page, or « Coureur » and no photo until the
 * runner is known. The runner on the sky of the dawn drawn like a map (the
 * skin's `HeroArt`), in front of the ridges, the sun rising behind them.
 */
export function RunnerHero({
  runner,
  heading,
}: {
  /** The runner, once known: until then, the title says « Coureur » and there is no photo. */
  runner: RunnerRecord | undefined;
  /**
   * What the title of the page (the `h1` of the hero) carries, to spread on it:
   * the ref by which a failure gives it the focus (`LoadFailure`), and `tabIndex`.
   */
  heading: { ref: RefObject<HTMLHeadingElement | null>; tabIndex: -1 };
}) {
  const { t } = useI18n();

  return (
    <header className="runner-hero on-dawn relative flex items-center gap-4 overflow-hidden rounded-[1.75rem] bg-dawn-hero p-5 pb-12 text-white shadow-glow md:gap-6 md:p-7 md:pb-14">
      <HeroArt place="runner" />
      {/* On the narrowest phones (under 360 px) the photo is smaller and the name scales down
          with the screen, so that a first name such as « Guillaume » or « Maximilien » fits
          beside the photo: the name wraps between its words, never inside one. Only a word
          that could not fit on a line of its own would still be broken (`break-words`). */}
      {runner && (
        <Avatar
          runner={runner}
          thumb="256x256"
          className="avatar-soft relative size-20 shrink-0 text-2xl font-extrabold shadow-[0_0_0_4px_var(--photo-ring),0_12px_30px_-10px_var(--shade-photo)] min-[22.5rem]:size-24 min-[22.5rem]:text-3xl md:size-28"
        />
      )}
      <h1
        {...heading}
        className="runner-hero-title relative min-w-0 font-display text-[clamp(1.5rem,8vw,1.875rem)] leading-[1.1] font-extrabold display-title break-words md:text-[2.25rem]"
      >
        {runner ? runner.name : t.runner.title}
      </h1>
    </header>
  );
}
