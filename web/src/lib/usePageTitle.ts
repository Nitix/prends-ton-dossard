import { useEffect } from "react";

import { useI18n } from "../i18n/I18nProvider";

/**
 * Sets `document.title` to "<title> · Prends ton dossard", or to the name of
 * the app alone for `null`, while the page is shown, and again when the title
 * (or the language) changes. The title is set as text: nothing in it is
 * interpreted, whoever typed it. Each page calls it with its own title, so that
 * the tab, the history and a screen reader say which page this is (WCAG 2.4.2).
 *
 * It is not a `<title>` rendered by React, whose element would come up into
 * `<head>` after the one of `index.html`, nor a `head` of the router: the pages
 * read their data through TanStack Query, not through loaders.
 */
export function usePageTitle(title: string | null): void {
  const { t } = useI18n();
  const appName = t.common.appName;

  useEffect(() => {
    document.title = title === null ? appName : `${title} · ${appName}`;
  }, [title, appName]);

  // A page that goes away leaves the name of the app until the next one sets its
  // own. Apart from the effect above, so that a change of title writes once.
  useEffect(
    () => () => {
      document.title = appName;
    },
    [appName],
  );
}
