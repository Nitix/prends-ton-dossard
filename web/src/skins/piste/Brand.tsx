import { useI18n } from "../../i18n/I18nProvider";
import type { BrandMarkProps } from "../types";

/**
 * The name of the app as a wordmark: the display face, slanted, in capitals,
 * its last word on a skewed block of the track red, like the number on a
 * runner's chest. It reads « Prends ton dossard » like plain text: the block is
 * decoration.
 */
export function BrandMark({ size = "md" }: BrandMarkProps) {
  const { t } = useI18n();
  const name = t.common.appName;
  const cut = name.lastIndexOf(" ");
  const lead = cut === -1 ? "" : name.slice(0, cut);
  const last = cut === -1 ? name : name.slice(cut + 1);
  // The big one is tall and tight: on the narrowest phones it steps down, so that the name fits.
  const text =
    size === "lg"
      ? "piste:text-[2rem] piste:sm:text-[2.5rem]"
      : "piste:text-[1.75rem] piste:md:text-[1.875rem]";

  return (
    <span
      className={`piste:font-display piste:leading-none piste:font-extrabold piste:uppercase piste:italic ${text}`}
    >
      {lead !== "" && (
        <span className="piste:tracking-[0.02em]" style={{ color: "var(--color-neutral-50)" }}>
          {lead}
        </span>
      )}{" "}
      <span className="piste:relative piste:isolate piste:ml-1 piste:inline-block piste:px-1.5 piste:text-white">
        <span
          aria-hidden="true"
          className="piste:absolute piste:inset-x-0 piste:-inset-y-0.5 piste:-z-10 piste:-skew-x-[16deg] piste:rounded-[3px]"
          style={{
            backgroundImage:
              "linear-gradient(to bottom right, var(--color-iris-500), var(--color-iris-700))",
            boxShadow: "0 6px 16px -6px var(--dawn-glow-warm)",
          }}
        />
        {last}
      </span>
    </span>
  );
}
