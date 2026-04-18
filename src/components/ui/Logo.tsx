/**
 * emx Logo — a heart-shaped mark built from vertical "slider / equalizer" bars.
 *
 * The bars visually reference two things at once:
 *   1. the voting sliders this app is built around (SPEC §6 / §3.2)
 *   2. an audio equalizer — i.e. the "song contest" half of the brand
 *
 * Legally: this is deliberately NOT the Eurovision mark. That mark is a solid
 * filled heart with the host country's flag inside. Ours is an outline heart
 * formed from discrete bars, with a gold→hot-pink palette gradient instead of
 * any flag. Distinct enough to be safe, familiar enough to read as "Eurovision-y".
 *
 * Colors are driven by CSS variables (`--gold`, `--hot-pink`) so the logo
 * automatically follows the palette defined in globals.css.
 */
interface LogoProps {
  /** Rendered pixel size (square). Defaults to 64. */
  size?: number;
  /** Optional className — use to apply Tailwind sizing, drop-shadow, etc. */
  className?: string;
  /**
   * If true, the gradient ID is suffixed with a deterministic-ish token to
   * avoid collisions when multiple Logos render on the same page.
   * You probably don't need this; default is false.
   */
  uniqueGradient?: boolean;
}

// Heart silhouette traced at 9 vertical samples across x ∈ [-1, +1].
// Each entry is [centerX, topY, height] in a 100×100 viewBox.
// Derived geometrically: upper outline dips to form the valley between the
// two lobes at x=0; lower outline bottoms out at x=0 (the heart's point).
const BARS: ReadonlyArray<readonly [cx: number, y: number, h: number]> = [
  [20, 56, 3],   // left edge stub
  [27.5, 35, 33],
  [35, 26, 49.5], // left lobe peak
  [42.5, 35, 45],
  [50, 50, 33],   // center: valley on top, point on bottom
  [57.5, 35, 45],
  [65, 26, 49.5], // right lobe peak
  [72.5, 35, 33],
  [80, 56, 3],   // right edge stub
] as const;

const BAR_WIDTH = 6;
const BAR_RADIUS = 3;

export default function Logo({
  size = 64,
  className = "",
  uniqueGradient = false,
}: LogoProps) {
  const gradId = uniqueGradient
    ? `emx-heart-grad-${Math.random().toString(36).slice(2, 8)}`
    : "emx-heart-grad";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="eurovisionmaxxing logo"
      className={className}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--gold)" />
          <stop offset="100%" stopColor="var(--hot-pink)" />
        </linearGradient>
      </defs>
      {BARS.map(([cx, y, h], i) => (
        <rect
          key={i}
          x={cx - BAR_WIDTH / 2}
          y={y}
          width={BAR_WIDTH}
          height={h}
          rx={BAR_RADIUS}
          ry={BAR_RADIUS}
          fill={`url(#${gradId})`}
        />
      ))}
    </svg>
  );
}
