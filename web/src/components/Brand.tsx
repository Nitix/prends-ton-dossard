import { useI18n } from "../i18n/I18nProvider";
import { SunArc } from "./Dawn";

/**
 * The name of the app in white on the sky, after its mark: a small white tile
 * with the sun rising on its horizon.
 */
export function BrandMark({ size = "md" }: { size?: "md" | "lg" }) {
  const { t } = useI18n();
  const big = size === "lg";

  return (
    <span className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-end justify-center overflow-hidden rounded-xl bg-white shadow-[0_6px_18px_-6px_rgb(36_27_53/0.45)] ${
          big ? "size-11" : "size-9"
        }`}
      >
        <svg viewBox="0 0 36 36" className="size-full">
          <defs>
            <linearGradient id="brand-sun" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#ffb38a" />
              <stop offset="0.55" stopColor="#ff7eb3" />
              <stop offset="1" stopColor="#8b7cff" />
            </linearGradient>
          </defs>
          <path d="M8 25a10 10 0 0 1 20 0z" fill="url(#brand-sun)" />
          <path
            d="M4.5 25a13.5 13.5 0 0 1 27 0"
            fill="none"
            stroke="url(#brand-sun)"
            strokeWidth="1.6"
            opacity="0.55"
          />
          <path d="M4 25h28" stroke="#241b35" strokeWidth="1.8" strokeLinecap="round" />
          <path
            d="M7 29.5h4M14 29.5h8M25 29.5h4"
            stroke="#5e4ae3"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span
        className={`font-display leading-none font-extrabold tracking-tight text-white drop-shadow-[0_1px_8px_rgb(42_32_112/0.35)] ${
          big ? "text-[1.75rem]" : "text-[1.3125rem]"
        }`}
      >
        {t.common.appName}
      </span>
    </span>
  );
}

/**
 * What is in the sky behind the header: two soft glows that drift (unless less
 * motion is asked for) and, unless `sun` is false, the sun that rises on the
 * horizon, on the right on a phone, between the name and the tabs on a large
 * screen.
 */
export function DawnSky({ sun = true }: { sun?: boolean }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <span className="absolute -top-16 -left-20 size-64 animate-glow rounded-full bg-iris-400/40 blur-3xl" />
      <span className="absolute -right-10 -bottom-24 size-72 animate-glow rounded-full bg-peach-300/50 blur-3xl [animation-delay:-4s]" />
      {sun && (
        <span className="absolute right-[-2.5rem] bottom-8 w-[15rem] animate-rise md:right-auto md:bottom-6 md:left-[calc(50%-17rem)] md:w-[17rem]">
          <SunArc className="block w-full" />
        </span>
      )}
    </span>
  );
}
