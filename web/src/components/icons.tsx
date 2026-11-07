// Small line icons, drawn with the current colour. They are decoration: what
// they stand for is always written beside them.

type IconProps = { className?: string };

const LINE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function PinIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...LINE} className={className}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  );
}

export function CalendarPlusIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...LINE} className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4M12 13v5M9.5 15.5h5" />
    </svg>
  );
}

export function ShareIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...LINE} className={className}>
      <circle cx="17.5" cy="5.5" r="2.5" />
      <circle cx="6.5" cy="12" r="2.5" />
      <circle cx="17.5" cy="18.5" r="2.5" />
      <path d="M8.7 10.8l6.6-3.9M8.7 13.2l6.6 3.9" />
    </svg>
  );
}

export function UserPlusIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...LINE} className={className}>
      <circle cx="10" cy="8.5" r="3.6" />
      <path d="M3.5 20c1-3.5 3.6-5.2 6.5-5.2 1.4 0 2.7.4 3.8 1.1M18.5 14v6M15.5 17h6" />
    </svg>
  );
}

export function PencilIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...LINE} className={className}>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

export function TrashIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...LINE} className={className}>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 12.5a1.5 1.5 0 0 0 1.5 1.5h6.2a1.5 1.5 0 0 0 1.5-1.5L17.5 7" />
    </svg>
  );
}

export function RunIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...LINE} className={className}>
      <circle cx="14.5" cy="4.5" r="2" />
      <path d="m7 21 3.2-5.6L13 17v4M10.2 15.4 11.5 9l-3.5 1.5L6.5 13M11.5 9l3 2.5 3.5 1M13.5 12.5" />
    </svg>
  );
}

export function ClockIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...LINE} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function ExternalIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...LINE} className={className}>
      <path d="M14 4.5h5.5V10M19.5 4.5 11 13M17.5 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

export function CalendarIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...LINE} className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

export function DownloadIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...LINE} className={className}>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
    </svg>
  );
}
