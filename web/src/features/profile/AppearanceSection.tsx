import { useI18n } from "../../i18n/I18nProvider";
import { useThemeChoice, type ThemeChoice } from "../../lib/theme";
import { Section } from "./Section";

const CHOICES: readonly ThemeChoice[] = ["auto", "light", "dark"];

/**
 * « Apparence » on the settings page: the theme of the app on this device.
 * Auto follows the setting of the phone; Clair and Sombre win over it. The
 * choice applies at once and is kept on the device (see lib/theme.ts). The sky
 * of the header is the same in both themes.
 *
 * Three radio buttons, each the whole line: the native radio is stretched over
 * its line, without its own look, so that the line is the tap target (and has
 * the focus ring); the dot drawn beside the words says which one is chosen,
 * not the colour alone, and keeps a colour of the system in forced colours.
 */
export function AppearanceSection() {
  const { t } = useI18n();
  const [choice, choose] = useThemeChoice();
  const labels: Record<ThemeChoice, string> = {
    auto: t.settings.themeAuto,
    light: t.settings.themeLight,
    dark: t.settings.themeDark,
  };

  return (
    <Section title={t.settings.appearance}>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{t.settings.appearance}</legend>
        {CHOICES.map((value) => (
          <label
            key={value}
            className="group relative flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border-2 border-neutral-200 bg-card px-3.5 py-2 hover:border-iris-200 hover:bg-iris-50 has-checked:border-iris-600 has-checked:bg-iris-50 has-checked:font-semibold has-checked:text-iris-800"
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={choice === value}
              onChange={() => {
                choose(value);
              }}
              className="absolute -inset-0.5 m-0 cursor-pointer appearance-none rounded-2xl"
            />
            <span
              aria-hidden="true"
              className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-neutral-500 group-has-checked:border-iris-600"
            >
              <span
                data-dot
                className="size-2.5 scale-0 rounded-full bg-iris-600 transition-transform group-has-checked:scale-100 forced-colors:bg-[CanvasText]"
              />
            </span>
            <ThemeIcon choice={value} />
            {labels[value]}
          </label>
        ))}
      </fieldset>
    </Section>
  );
}

/** A small drawing of each choice: the half-lit disc of auto, the sun, the moon. */
function ThemeIcon({ choice }: { choice: ThemeChoice }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5 shrink-0 text-neutral-600 group-has-checked:text-iris-700"
    >
      {choice === "auto" && (
        <>
          <circle cx="12" cy="12" r="7.5" />
          <path d="M12 4.5a7.5 7.5 0 0 0 0 15z" fill="currentColor" stroke="none" />
        </>
      )}
      {choice === "light" && (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
        </>
      )}
      {choice === "dark" && (
        <>
          <path d="M19.5 14.6A7.8 7.8 0 1 1 9.4 4.5a6.2 6.2 0 0 0 10.1 10.1z" />
          <path d="M17 3.5v3M15.5 5h3" />
        </>
      )}
    </svg>
  );
}
