import { ON_DAWN, PRIMARY } from "../../components/buttons";
import { ExternalIcon } from "../../components/icons";
import { useI18n } from "../../i18n/I18nProvider";

/**
 * The link to the official page of the registration of an event (`href`, an
 * address checked by `webAddress`): it opens in another tab, without giving it
 * access to this one. On the sky of the hero, it is a white pill. The hero of
 * an event shows it, and so does the reminder of the page under it.
 */
export function RegisterLink({
  href,
  tone = "primary",
  className,
}: {
  href: string;
  tone?: "primary" | "onDawn";
  className?: string;
}) {
  const { t } = useI18n();

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${tone === "onDawn" ? ON_DAWN : PRIMARY} inline-flex items-center gap-2 self-start ${className ?? ""}`}
    >
      {t.event.register}
      <ExternalIcon className="size-4 shrink-0" />
    </a>
  );
}
