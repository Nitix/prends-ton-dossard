import { Link } from "@tanstack/react-router";

import { useI18n } from "../i18n/I18nProvider";

/**
 * The tabs of the app: a bar at the bottom of the screen on a phone, at the
 * top from the `md` breakpoint. The tab of the current page is bold and
 * underlined (or overlined), not only coloured, and carries `aria-current`.
 */
export function TabBar({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useI18n();

  return (
    <nav
      aria-label={t.nav.main}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white md:sticky md:top-0 md:bottom-auto md:border-t-0 md:border-b"
    >
      <div className="mx-auto flex max-w-3xl items-center md:gap-4 md:px-4">
        <span className="hidden text-lg font-semibold md:block">{t.common.appName}</span>
        <ul className="flex flex-1 md:flex-none">
          <Tab to="/" exact label={t.nav.home} />
          <Tab to="/liste" label={t.nav.list} />
          <Tab to="/agenda" label={t.nav.calendar} />
          <Tab to="/profil" label={t.nav.profile} />
          {isAdmin && <Tab to="/admin/membres" label={t.nav.admin} />}
        </ul>
      </div>
    </nav>
  );
}

function Tab({
  to,
  label,
  exact = false,
}: {
  to: "/" | "/liste" | "/agenda" | "/profil" | "/admin/membres";
  label: string;
  exact?: boolean;
}) {
  return (
    <li className="flex-1 md:flex-none">
      <Link
        to={to}
        activeOptions={{ exact, includeSearch: false }}
        className="flex h-14 min-w-11 items-center justify-center border-t-4 border-transparent px-3 text-sm hover:bg-neutral-100 aria-[current=page]:border-neutral-900 aria-[current=page]:font-bold md:border-t-0 md:border-b-4"
      >
        {label}
      </Link>
    </li>
  );
}
