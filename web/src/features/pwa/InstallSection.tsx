import { useCallback, useRef, useSyncExternalStore } from "react";

import { PRIMARY } from "../../components/buttons";
import { useI18n } from "../../i18n/I18nProvider";
import { Section } from "../profile/Section";
import { detectEnvironment, type InstallEnvironment } from "./environment";
import {
  installPrompt,
  isInstalled,
  subscribeInstallPrompt,
  takeInstallPrompt,
} from "./installPrompt";

/**
 * "App" on the settings page: how to put the site on the home screen.
 *
 * - Running installed already: nothing, the section is not there.
 * - Installed since the page was opened (`appinstalled`): the section stays,
 *   and says so. It would be wrong to send somebody to their browser's menu to
 *   install what is installed.
 * - The browser made its offer (see installPrompt.ts): the button that shows
 *   its install dialog. The offer can be used once, so the button goes with the
 *   tap. It can also go with `appinstalled`, when the site is installed some
 *   other way. Either way, the title of the section takes the focus, which
 *   would otherwise fall to the page.
 * - On an iPhone or an iPad, which make no offer: where to tap.
 * - Elsewhere: the menu of the browser.
 *
 * `environment` is only for tests: it defaults to what the browser says.
 */
export function InstallSection({
  environment = detectEnvironment,
}: {
  environment?: () => InstallEnvironment;
}) {
  const { t } = useI18n();
  const offer = useSyncExternalStore(subscribeInstallPrompt, installPrompt);
  const installed = useSyncExternalStore(subscribeInstallPrompt, isInstalled);
  const heading = useRef<HTMLHeadingElement>(null);
  const { standalone, ios } = environment();

  // The ref of the button. Its cleanup runs as the button is removed from the
  // page, while it is still there: if it has the focus then, the title takes it.
  // The function must be the same from one render to the next, or React would
  // run the cleanup each time the page draws again.
  const giveFocusBack = useCallback((button: HTMLButtonElement) => {
    return () => {
      if (document.activeElement === button) heading.current?.focus();
    };
  }, []);

  if (standalone) return null;

  const install = () => {
    const event = takeInstallPrompt();
    if (event === null) return;
    heading.current?.focus();
    // Whatever the choice, it is over: the page has nothing more to do.
    void event.prompt().catch(() => undefined);
  };

  return (
    <Section title={t.install.title} headingRef={heading}>
      {installed ? (
        <p>{t.install.done}</p>
      ) : offer !== null ? (
        <button
          ref={giveFocusBack}
          type="button"
          onClick={install}
          className={`${PRIMARY} self-start`}
        >
          {t.install.button}
        </button>
      ) : (
        <p>{ios ? t.install.ios : t.install.other}</p>
      )}
    </Section>
  );
}
