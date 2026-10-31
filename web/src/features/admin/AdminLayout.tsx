import { Link, Outlet } from "@tanstack/react-router";

import { useI18n } from "../../i18n/I18nProvider";

/**
 * What every page under /admin shares: a small menu to go from one admin page
 * to another (the « Admin » tab of the app goes to the first of them), and
 * the page itself. The link of the page on display carries `aria-current`.
 */
export function AdminLayout() {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t.admin.adminNav}>
        <ul className="flex flex-wrap gap-2">
          <NavLink to="/admin/membres" label={t.admin.membersTitle} />
          <NavLink to="/admin/types" label={t.admin.typesTitle} />
          <NavLink to="/admin/doublons" label={t.admin.duplicatesTitle} />
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}

function NavLink({
  to,
  label,
}: {
  to: "/admin/membres" | "/admin/types" | "/admin/doublons";
  label: string;
}) {
  return (
    <li>
      <Link
        to={to}
        className="flex min-h-11 min-w-11 items-center rounded-lg border border-neutral-300 px-3 text-sm aria-[current=page]:border-neutral-900 aria-[current=page]:bg-neutral-900 aria-[current=page]:font-semibold aria-[current=page]:text-white"
      >
        {label}
      </Link>
    </li>
  );
}
