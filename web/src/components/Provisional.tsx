import { useI18n } from "../i18n/I18nProvider";

// The placeholder page, until the real screens exist. The app shell around it
// owns the page's <main>.
export function Provisional() {
  const { t } = useI18n();

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <h1 className="page-title">{t.common.appName}</h1>
    </div>
  );
}
