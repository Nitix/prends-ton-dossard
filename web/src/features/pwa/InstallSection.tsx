import { useRef, useSyncExternalStore } from "react";

import { PRIMARY } from "../../components/buttons";
import { useI18n } from "../../i18n/I18nProvider";
import { Section } from "../profile/Section";
import { detectEnvironment, type InstallEnvironment } from "./environment";
import { installPrompt, subscribeInstallPrompt, takeInstallPrompt } from "./installPrompt";

/**
 * "App" on the profile page: how to put the site on the home screen.
 *
 * - Installed already: nothing, the section is not there.
 * - The browser made its offer (see installPrompt.ts): the button that shows
 *   its install dialog. The offer can be used once, so the button goes with the
 *   tap, and the title of the section takes the focus, which would otherwise
 *   fall to the page.
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
  const heading = useRef<HTMLHeadingElement>(null);
  const { standalone, ios } = environment();

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
      {offer !== null ? (
        <button type="button" onClick={install} className={`${PRIMARY} self-start`}>
          {t.install.button}
        </button>
      ) : (
        <p>{ios ? t.install.ios : t.install.other}</p>
      )}
    </Section>
  );
}
