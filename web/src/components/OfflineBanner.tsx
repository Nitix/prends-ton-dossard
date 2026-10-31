import { useEffect, useState } from "react";

import { useI18n } from "../i18n/I18nProvider";

/**
 * A banner shown while the browser has no network. TanStack Query retries
 * its requests when the network comes back, so nothing else is needed.
 */
export function OfflineBanner() {
  const { t } = useI18n();
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
    };
    const goOffline = () => {
      setOnline(false);
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // <output> is a live region (role "status"). It stays in the page so that
  // a screen reader announces the text when it appears.
  return (
    <output className="block">
      {!online && (
        <p className="bg-neutral-900 px-4 py-2 text-center text-sm font-medium text-white">
          {t.common.offline}
        </p>
      )}
    </output>
  );
}
