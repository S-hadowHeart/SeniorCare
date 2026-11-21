import { cn } from "../../lib/cn";

interface AdherenceDonutProps {
  taken: number;
  total: number;
  size?: number;
  label?: string;
}

/**
 * Medication adherence ring.
 *
 * Hand-written SVG rather than a charting library: it is a single circle and
 * two arcs, so pulling in a chart runtime for it would not pay for itself.
 */
export function AdherenceDonut({
  taken,
  total,
  size = 96,
  label = "taken",
}: AdherenceDonutProps) {
  const safeTotal = Math.max(total, 0);
  const ratio = safeTotal === 0 ? 0 : Math.min(taken / safeTotal, 1);
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * ratio;

  const tone = ratio >= 0.8 ? "var(--color-chart-success)" : ratio >= 0.5 ? "var(--color-chart-warning)" : "var(--color-chart-danger)";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`${taken} of ${total} ${label}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-chart-grid)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          className="transition-[stroke-dasharray] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-lg font-bold text-ink-900">{Math.round(ratio * 100)}%</span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-ink-500">{label}</span>
      </div>
    </div>
  );
}

/** Horizontal segmented bar showing taken / pending / missed doses. */
export function DoseBar({
  taken,
  skipped,
  missed,
  pending,
  className,
}: {
  taken: number;
  skipped: number;
  missed: number;
  pending: number;
  className?: string;
}) {
  const total = taken + skipped + missed + pending;
  if (total === 0) return null;

  const segments = [
    { key: "taken", value: taken, className: "bg-success-500", label: "Taken" },
    { key: "skipped", value: skipped, className: "bg-ink-400", label: "Skipped" },
    { key: "missed", value: missed, className: "bg-danger-500", label: "Missed" },
    { key: "pending", value: pending, className: "bg-brand-200", label: "Due" },
  ];

  return (
    <div
      className={cn("flex h-2.5 w-full overflow-hidden rounded-full bg-ink-200", className)}
      role="img"
      aria-label={segments
        .filter((segment) => segment.value > 0)
        .map((segment) => `${segment.value} ${segment.label.toLowerCase()}`)
        .join(", ")}
    >
      {segments.map((segment) =>
        segment.value > 0 ? (
          <div
            key={segment.key}
            className={segment.className}
            style={{ width: `${(segment.value / total) * 100}%` }}
          />
        ) : null,
      )}
    </div>
  );
}
