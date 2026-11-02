import { useI18n } from "../../i18n/I18nProvider";
import type { BrandMarkProps } from "../types";
import { BibMark } from "./Bib";

/**
 * The name of the app set like the title of a bib: the little bib of the mark,
 * then the name in Archivo, white on the navy of the sky, over a stroke of sun
 * like a marker pen (under the letters: white on the yellow would not read).
 */
export function BrandMark({ size = "md" }: BrandMarkProps) {
  const { t } = useI18n();
  const big = size === "lg";

  return (
    <span className="flex items-center gap-2.5">
      <BibMark className={`w-auto shrink-0 -rotate-6 ${big ? "h-8" : "h-7"}`} />
      <span
        className={`brand-name px-0.5 font-display leading-none font-black tracking-tight text-white ${
          big ? "text-[1.25rem] min-[24rem]:text-[1.5rem] sm:text-[1.75rem]" : "text-[1.3125rem]"
        }`}
        style={{
          backgroundImage:
            "linear-gradient(transparent 80%, var(--color-blush-200) 80%, var(--color-blush-200) 96%, transparent 96%)",
        }}
      >
        {t.common.appName}
      </span>
    </span>
  );
}
