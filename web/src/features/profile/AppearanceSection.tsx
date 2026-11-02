import { useId, useState } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import { useThemeChoice, type ThemeChoice } from "../../lib/theme";
import { SKINS, useSkin } from "../../skins";
import type { Skin } from "../../skins/types";
import { Section } from "./Section";

// The faces of the samples of the cards (« Aa » in the font of each skin's
// titles): with this section, on the settings page, and nowhere else. A face
// is fetched when its sample is drawn; it is the file of the skin's own face.
import "../../skins/samples.css";

const CHOICES: readonly ThemeChoice[] = ["auto", "light", "dark"];

/**
 * « Apparence » on the settings page: the look of the app on this device.
 * First « Thème », the skin (see skins/): a card for each, with its name, two
 * of its colours and a sample of the font of its titles (skins/samples.css). Then the mode, for a skin that has
 * both: Auto follows the setting of the phone; Clair and Sombre win over it.
 * A skin with one mode says so instead, and the mode chosen is kept for the
 * others. Each choice applies at once and is kept on the device (see
 * skins/index.ts and lib/theme.ts). The sky of Crête's header is the same in
 * both modes.
 *
 * Radio buttons, each a whole card or line: the native radio is stretched over
 * it, without its own look, so that the card is the tap target (and has the
 * focus ring); the dot drawn beside the words says which one is chosen, not
 * the colour alone, and keeps a colour of the system in forced colours.
 */
export function AppearanceSection() {
  const { t, lang } = useI18n();
  const [choice, choose] = useThemeChoice();
  const [skin, chooseSkin] = useSkin();
  // The skin just chosen, while its look loads (skins/index.ts): its card says
  // so at once; the page takes it once its look is there (or keeps its own, if
  // the look cannot be loaded).
  const [pending, setPending] = useState<string | null>(null);
  const skinTitle = useId();
  const labels: Record<ThemeChoice, string> = {
    auto: t.settings.themeAuto,
    light: t.settings.themeLight,
    dark: t.settings.themeDark,
  };

  return (
    <Section title={t.settings.appearance}>
      <div className="flex flex-col gap-2">
        <h3 id={skinTitle} className="eyebrow">
          {t.settings.skin}
        </h3>
        <div role="radiogroup" aria-labelledby={skinTitle} className="grid grid-cols-2 gap-2">
          {SKINS.map((one) => (
            <SkinCard
              key={one.id}
              skin={one}
              name={one.label[lang]}
              sample={t.settings.fontSample}
              checked={one.id === (pending ?? skin.id)}
              onChoose={() => {
                setPending(one.id);
                void chooseSkin(one.id).finally(() => {
                  setPending((now) => (now === one.id ? null : now));
                });
              }}
            />
          ))}
        </div>
      </div>
      {skin.modes.length === 1 ? (
        <p className="text-sm text-neutral-600">
          {skin.modes[0] === "dark" ? t.settings.onlyDark : t.settings.onlyLight}
        </p>
      ) : (
        <ModeChoices choice={choice} choose={choose} labels={labels} />
      )}
    </Section>
  );
}

/** A skin in the picker: its two colours, a sample of its font, its name after the dot (exported for its test). */
export function SkinCard({
  skin,
  name,
  sample,
  checked,
  onChoose,
}: {
  skin: Skin;
  name: string;
  sample: string;
  checked: boolean;
  onChoose: () => void;
}) {
  return (
    <label className="skin-choice group relative flex min-h-[4.75rem] cursor-pointer flex-col justify-between gap-2 rounded-2xl border-2 border-neutral-200 bg-card p-3 hover:border-iris-200 hover:bg-iris-50 has-checked:border-iris-600 has-checked:bg-iris-50 has-checked:text-iris-800">
      <input
        type="radio"
        name="skin"
        value={skin.id}
        checked={checked}
        onChange={onChoose}
        className="absolute -inset-0.5 m-0 cursor-pointer appearance-none rounded-2xl"
      />
      <span aria-hidden="true" className="flex items-center justify-between gap-2">
        <span className="flex">
          {skin.swatches.map((colour, i) => (
            <span
              // The two colours, always in that order: their place is their key.
              key={i}
              data-swatch
              className="size-5 rounded-full ring-2 inset-ring ring-card inset-ring-neutral-600 not-first:-ml-1.5"
              style={{ backgroundColor: colour }}
            />
          ))}
        </span>
        <span
          data-font-sample
          aria-hidden="true"
          className="text-xl leading-none font-bold"
          // The font of the skin's titles, whether the skin is worn or not (skins/samples.css).
          style={{ fontFamily: skin.fontSample }}
        >
          {sample}
        </span>
      </span>
      <span className="flex items-center gap-2 text-sm font-semibold">
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-neutral-500 group-has-checked:border-iris-600"
        >
          <span
            data-dot
            className="size-2.5 scale-0 rounded-full bg-iris-600 transition-transform group-has-checked:scale-100 forced-colors:bg-[CanvasText]"
          />
        </span>
        {name}
      </span>
    </label>
  );
}

/** Auto, Clair, Sombre: the mode of a skin that has both. */
function ModeChoices({
  choice,
  choose,
  labels,
}: {
  choice: ThemeChoice;
  choose: (choice: ThemeChoice) => void;
  labels: Record<ThemeChoice, string>;
}) {
  const { t } = useI18n();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="eyebrow mb-2">{t.settings.mode}</legend>
      {CHOICES.map((value) => (
        <label
          key={value}
          className="mode-choice group relative flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border-2 border-neutral-200 bg-card px-3.5 py-2 hover:border-iris-200 hover:bg-iris-50 has-checked:border-iris-600 has-checked:bg-iris-50 has-checked:font-semibold has-checked:text-iris-800"
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
