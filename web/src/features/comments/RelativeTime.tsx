import { useI18n } from "../../i18n/I18nProvider";
import { elapsed, instantOf } from "../../lib/dates";
import { useClock } from "../../lib/useToday";

/**
 * When something happened, in words: « il y a 2 heures ». The date and time in
 * full are in the tooltip (`title`) and in the machine-readable `datetime`.
 * `at` is a date-time of PocketBase.
 */
export function RelativeTime({ at }: { at: string }) {
  const { f } = useI18n();
  const clock = useClock();
  const instant = instantOf(at);
  const { value, unit } = elapsed(instant, clock());

  return (
    <time dateTime={instant.toString()} title={f.dateTime(instant)}>
      {f.ago(value, unit)}
    </time>
  );
}
