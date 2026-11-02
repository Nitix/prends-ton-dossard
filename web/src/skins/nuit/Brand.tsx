import { useI18n } from "../../i18n/I18nProvider";
import type { BrandMarkProps } from "../types";

/**
 * The mark of « Nuit »: a race bib in the reflective lime, its four safety
 * pins, and two slashes of tape across it. Decoration: the name of the app is
 * always written next to it.
 */
function BibMark({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 32 26"
      className={className}
      style={{ filter: "drop-shadow(0 0 10px var(--dawn-glow-warm))" }}
    >
      <rect x="1" y="1" width="30" height="24" rx="5.5" style={{ fill: "var(--color-iris-600)" }} />
      <g style={{ fill: "var(--color-neutral-50)" }}>
        <circle cx="6" cy="6" r="1.5" />
        <circle cx="26" cy="6" r="1.5" />
        <circle cx="6" cy="20" r="1.5" />
        <circle cx="26" cy="20" r="1.5" />
        <path d="M9.5 18 14 8h3.6l-4.5 10z" />
        <path d="M15.6 18 20.1 8h3.6l-4.5 10z" />
      </g>
    </svg>
  );
}

/** The name of the app in white on the night of the header, after the bib. */
export function BrandMark({ size = "md" }: BrandMarkProps) {
  const { t } = useI18n();
  const big = size === "lg";

  return (
    <span className={`nuit:flex nuit:items-center ${big ? "nuit:gap-3.5" : "nuit:gap-2.5"}`}>
      <BibMark className={`nuit:w-auto nuit:shrink-0 ${big ? "nuit:h-9" : "nuit:h-7"}`} />
      <span
        className={`nuit:font-display nuit:leading-none nuit:font-bold nuit:tracking-tight nuit:text-white ${
          big ? "nuit:text-[1.75rem]" : "nuit:text-[1.3125rem]"
        }`}
      >
        {t.common.appName}
      </span>
    </span>
  );
}
