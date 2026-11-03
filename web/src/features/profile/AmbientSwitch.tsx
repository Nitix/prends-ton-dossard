import { useId } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import { useAmbient } from "../../lib/ambient";

/**
 * « Animer le fond » in « Apparence »: stops, or starts again, the motion of a
 * skin whose background moves (see skins/README.md, « Motion »). The section
 * shows it only for such a skin. On by default and kept on the device
 * (lib/ambient.ts); the motifs on the page follow it at once. It is a switch,
 * as wide as its card like the choices around it: the native checkbox is
 * stretched over the card, without its own look, so that the card is the tap
 * target (and has the focus ring); the track and its knob say the state by
 * where the knob is, not by colour alone, and keep a colour of the system in
 * forced colours.
 */
export function AmbientSwitch() {
  const { t } = useI18n();
  const [on, set] = useAmbient();
  const title = useId();
  const hint = useId();

  return (
    <label className="ambient-switch group relative flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border-2 border-neutral-200 bg-card px-3.5 py-2 hover:border-iris-200 hover:bg-iris-50 has-checked:border-iris-600 has-checked:bg-iris-50">
      <input
        type="checkbox"
        role="switch"
        checked={on}
        aria-checked={on}
        onChange={(event) => {
          set(event.target.checked);
        }}
        aria-labelledby={title}
        aria-describedby={hint}
        className="absolute -inset-0.5 m-0 cursor-pointer appearance-none rounded-2xl"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={title} className="font-semibold group-has-checked:text-iris-800">
          {t.settings.animateBackground}
        </span>
        <span id={hint} className="text-sm text-neutral-600">
          {t.settings.animateBackgroundHint}
        </span>
      </span>
      <span
        aria-hidden="true"
        data-track
        className="flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-neutral-500 bg-card px-0.5 group-has-checked:border-iris-600 group-has-checked:bg-iris-600 forced-colors:border-[CanvasText]"
      >
        <span
          data-knob
          className="size-4 rounded-full bg-neutral-600 transition-transform group-has-checked:translate-x-5 group-has-checked:bg-white forced-colors:bg-[CanvasText]"
        />
      </span>
    </label>
  );
}
