import { useI18n } from "../../i18n/I18nProvider";
import type { BrandMarkProps, DividerProps, HeaderArtProps, HeroArtProps } from "../types";

// The motifs of « Chrono »: the five heart-rate zones side by side (the strip
// of a watch), the dial of a stopwatch, the grid of a chart and the ruler of
// its axis. They are decoration: hidden from screen readers, with no words in
// them. The zones keep the colours of the variant (it wrote them out for what
// a class cannot reach: an SVG), bright on the ink of the sky; on the light
// page, where a mark must stand out of white, the section marker takes the
// five steps of the slope (`--color-slope-*`), which are these zones darkened.
// Nothing moves (the variant drew its arcs in once).

/** The five zones, from the first to the fifth: blue, green, yellow, orange, red. */
const ZONES = ["#7aa7d9", "#3dbe7a", "#f5c542", "#f28b30", "#e5484d"] as const;

/** The strip of the zones: five bands, a thin gap of the page between them, as wide as the parent. */
function ZoneStrip({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="100%"
      height="3"
      viewBox="0 0 100 3"
      preserveAspectRatio="none"
      className={`pointer-events-none block ${className}`}
    >
      {ZONES.map((color, i) => (
        <rect key={color} x={i * 20.2} y="0" width="19.2" height="3" fill={color} />
      ))}
    </svg>
  );
}

/** The thin grid of a chart: lines every 14 px, in white at low strength, for a ground of ink. */
const GRID = {
  backgroundImage:
    "linear-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.07) 1px, transparent 1px)",
  backgroundSize: "14px 14px",
  backgroundPosition: "-1px -1px",
} as const;

/**
 * The ticks of a bezel: sixty, a longer one every five, as the path of the
 * short ones and the path of the long ones, on a circle of `outer` round (`c`, `c`).
 */
function bezel(c: number, outer: number, short: number, long: number) {
  const paths = { short: "", long: "" };
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * 2 * Math.PI;
    const inner = outer - (i % 5 === 0 ? long : short);
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    const tick = `M${(c + cos * inner).toFixed(2)} ${(c + sin * inner).toFixed(2)}L${(c + cos * outer).toFixed(2)} ${(c + sin * outer).toFixed(2)}`;
    if (i % 5 === 0) paths.long += tick;
    else paths.short += tick;
  }
  return paths;
}

/** The bezel of the big dial behind the card of the pages to sign in, and of the small one of an empty list. */
const BIG_BEZEL = bezel(100, 98, 5, 10);
const SMALL_BEZEL = bezel(50, 48, 3.5, 7);

/** The dial of the sky: the zones in arcs round a dial, a bezel of ticks round them. */
function Dial() {
  const radius = 62;
  const circumference = 2 * Math.PI * radius;
  const share = circumference / ZONES.length;
  const dash = share - 10;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 200 200"
      className="pointer-events-none absolute -bottom-52 left-1/2 block size-[44rem] max-w-none -translate-x-1/2"
    >
      <path d={BIG_BEZEL.short} fill="none" stroke="#fff" strokeOpacity="0.16" strokeWidth="1" />
      <path d={BIG_BEZEL.long} fill="none" stroke="#fff" strokeOpacity="0.3" strokeWidth="1.8" />
      <g transform="rotate(-90 100 100)" fill="none" strokeWidth="9" strokeLinecap="round">
        {ZONES.map((color, i) => (
          <circle
            key={color}
            cx="100"
            cy="100"
            r={radius}
            stroke={color}
            strokeOpacity="0.45"
            strokeDasharray={`${dash} ${circumference}`}
            strokeDashoffset={-(i * share + 5)}
          />
        ))}
      </g>
    </svg>
  );
}

/**
 * The sky behind the name: the grid of a chart, fading to the left, and the
 * strip of the zones along the foot of the header, just over the sheet of the
 * page. On the pages to sign in: the strip on the top edge, as on a watch,
 * the grid over the page and the big dial rising behind the card.
 */
export function HeaderArt({ place }: HeaderArtProps) {
  if (place === "header") {
    return (
      <span aria-hidden="true" className="pointer-events-none absolute inset-0">
        <span
          className="absolute inset-0 mask-[linear-gradient(to_left,#000,transparent_70%)]"
          style={GRID}
        />
        <ZoneStrip className="absolute inset-x-0 bottom-7 w-full" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span
        className="absolute inset-0 mask-[radial-gradient(closest-side,#000,transparent)]"
        style={GRID}
      />
      <Dial />
      <ZoneStrip className="absolute inset-x-0 top-0 w-full" />
    </span>
  );
}

/**
 * The mark of the app: the five zones round a dial with a gap between each,
 * like the heart-rate gauge of a watch, and the hand of the stopwatch in the
 * middle (the colour of the text). Drawn in a box of 36.
 */
function BrandRing({ className = "" }: { className?: string }) {
  const stroke = 4.7;
  const radius = (36 - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const share = circumference / ZONES.length;
  const gap = 2.5 + stroke;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 36 36"
      className={`shrink-0 ${className}`}
    >
      <g transform="rotate(-90 18 18)" fill="none" strokeWidth={stroke} strokeLinecap="round">
        {ZONES.map((color, i) => (
          <circle
            key={color}
            cx="18"
            cy="18"
            r={radius}
            stroke={color}
            strokeDasharray={`${share - gap} ${circumference}`}
            strokeDashoffset={-(i * share + gap / 2)}
          />
        ))}
      </g>
      <line
        x1="18"
        y1="18"
        x2={18 + radius * 0.5}
        y2={18 - radius * 0.32}
        stroke="currentColor"
        strokeWidth={stroke * 0.85}
        strokeLinecap="round"
      />
      <circle cx="18" cy="18" r={stroke * 0.8} fill="currentColor" />
    </svg>
  );
}

/** The dial of a stopwatch before the name of the app, on the sky. */
export function BrandMark({ size = "md" }: BrandMarkProps) {
  const { t } = useI18n();
  const big = size === "lg";

  return (
    <span className="flex items-center gap-3">
      <BrandRing className={`text-white ${big ? "size-11" : "size-9"}`} />
      <span
        className={`font-display leading-none font-bold tracking-[-0.02em] text-white ${
          big ? "text-[1.75rem]" : "text-[1.3125rem]"
        }`}
      >
        {t.common.appName}
      </span>
    </span>
  );
}

/** The poster of an event or of a runner: the grid of a chart behind the figures, the strip of the zones along the foot. */
export function HeroArt({ place }: HeroArtProps) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span
        className={`absolute inset-0 ${
          place === "event"
            ? "mask-[linear-gradient(to_bottom,rgb(0_0_0/0.35),#000)]"
            : "mask-[linear-gradient(to_left,#000,transparent_80%)]"
        }`}
        style={GRID}
      />
      <ZoneStrip className="absolute inset-x-0 bottom-0 w-full" />
    </span>
  );
}

/** Between two blocks of the home page: the ruler of the axis of a chart, a tick every 6 px and a longer one every 30. */
export function Divider({ className = "" }: DividerProps) {
  return (
    <div aria-hidden="true" className={`flex h-8 w-full items-center ${className}`}>
      <span
        className="block h-2 w-full"
        style={{
          background:
            "linear-gradient(var(--color-neutral-300), var(--color-neutral-300)) bottom / 100% 1px no-repeat, repeating-linear-gradient(to right, var(--color-neutral-300) 0 1px, transparent 1px 6px) bottom / 100% 4px no-repeat, repeating-linear-gradient(to right, var(--color-neutral-400) 0 1px, transparent 1px 30px) bottom / 100% 8px no-repeat",
        }}
      />
    </div>
  );
}

/** Before the title of a block: the zones as the bars of a gauge, from the lowest to the tallest. */
export function SectionMarker() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="12"
      viewBox="0 0 16 12"
      className="flex-none"
    >
      {[1, 2, 3, 4, 5].map((zone) => (
        <rect
          key={zone}
          x={(zone - 1) * 3.4}
          y={12 - (3 + zone * 1.8)}
          width="2.2"
          height={3 + zone * 1.8}
          rx="1"
          style={{ fill: `var(--color-slope-${zone})` }}
        />
      ))}
    </svg>
  );
}

/** A watch with nothing to time: a bezel, the five zones empty round the dial, the hand at rest. Over the words of an empty list. */
export function EmptyArt() {
  const radius = 29;
  const circumference = 2 * Math.PI * radius;
  const share = circumference / ZONES.length;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 100 100"
      className="mb-2 size-[4.5rem] shrink-0"
    >
      <path d={SMALL_BEZEL.short} fill="none" className="stroke-neutral-300" strokeWidth="1" />
      <path d={SMALL_BEZEL.long} fill="none" className="stroke-neutral-500" strokeWidth="1.6" />
      <g
        transform="rotate(-90 50 50)"
        fill="none"
        className="stroke-neutral-200"
        strokeWidth="5"
        strokeLinecap="round"
      >
        {ZONES.map((color, i) => (
          <circle
            key={color}
            cx="50"
            cy="50"
            r={radius}
            strokeDasharray={`${share - 7} ${circumference}`}
            strokeDashoffset={-(i * share + 3.5)}
          />
        ))}
      </g>
      <line
        x1="50"
        y1="50"
        x2="50"
        y2="30"
        className="stroke-neutral-600"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="50" cy="50" r="3" className="fill-neutral-600" />
    </svg>
  );
}
