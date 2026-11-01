import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useI18n } from "../i18n/I18nProvider";

/**
 * The tabs of the app: a white bar that floats at the bottom of the screen on a
 * phone, and a white capsule at the top, over the sky of the header, from the
 * `md` breakpoint (it stays there as the page scrolls). The tab of the current
 * page is a pill of sunrise, its label bold and white, not only coloured, and
 * carries `aria-current`.
 */
export function TabBar({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useI18n();

  return (
    <nav
      aria-label={t.nav.main}
      className="pointer-events-none fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 px-3 md:sticky md:top-3 md:bottom-auto md:-mt-[6rem] md:mb-[0.875rem] md:px-5"
    >
      <div className="mx-auto flex max-w-5xl justify-end">
        <ul className="pointer-events-auto flex w-full gap-1 rounded-[1.75rem] border border-neutral-200/70 bg-white/95 p-1.5 shadow-bar backdrop-blur-md md:w-auto md:rounded-full">
          <Tab to="/" exact label={t.nav.home} icon={<HomeIcon />} />
          <Tab to="/liste" label={t.nav.list} icon={<ListIcon />} />
          <Tab to="/agenda" label={t.nav.calendar} icon={<CalendarIcon />} />
          {/* Not `exact`: it is also the current page for the settings, under it. */}
          <Tab to="/profil" label={t.nav.profile} icon={<ProfileIcon />} />
          {isAdmin && <Tab to="/admin/membres" label={t.nav.admin} icon={<AdminIcon />} />}
        </ul>
      </div>
    </nav>
  );
}

function Tab({
  to,
  label,
  icon,
  exact = false,
}: {
  to: "/" | "/liste" | "/agenda" | "/profil" | "/admin/membres";
  label: string;
  icon: ReactNode;
  exact?: boolean;
}) {
  return (
    <li className="flex-1 md:flex-none">
      <Link
        to={to}
        activeOptions={{ exact, includeSearch: false }}
        className="press flex h-14 min-w-11 flex-col items-center justify-center gap-0.5 rounded-[1.375rem] px-2 text-[0.75rem] font-medium text-neutral-600 hover:bg-iris-50 hover:text-ink aria-[current=page]:bg-dawn-deep aria-[current=page]:font-bold aria-[current=page]:text-white aria-[current=page]:shadow-glow md:h-11 md:flex-row md:gap-2 md:rounded-full md:px-4 md:text-sm"
      >
        <span aria-hidden="true" className="size-[1.375rem] md:hidden lg:block lg:size-5">
          {icon}
        </span>
        {label}
      </Link>
    </li>
  );
}

const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  className: "size-full",
} as const;

/** The sun on the horizon. */
function HomeIcon() {
  return (
    <svg {...ICON}>
      <path d="M6 16a6 6 0 0 1 12 0" />
      <path d="M3 16h18M7 20h10M12 4v2.5M4.6 8.6l1.8 1.4M19.4 8.6l-1.8 1.4" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg {...ICON}>
      <rect x="3.5" y="4" width="17" height="6.5" rx="2.2" />
      <rect x="3.5" y="13.5" width="17" height="6.5" rx="2.2" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg {...ICON}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <circle cx="12" cy="15" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg {...ICON}>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20.5c1.2-3.8 4-5.6 7.5-5.6s6.3 1.8 7.5 5.6" />
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg {...ICON}>
      <path d="M12 3.5 19 6v5.5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </svg>
  );
}
