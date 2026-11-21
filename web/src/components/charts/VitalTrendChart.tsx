import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { VitalSeries } from "../../lib/types";
import { formatDateTime, formatNumber } from "../../lib/format";
import { cn } from "../../lib/cn";

interface ChartPoint {
  timestamp: number;
  label: string;
  value: number;
  secondary: number | null;
  isCritical: boolean;
}

interface VitalTrendChartProps {
  series: VitalSeries;
  height?: number;
  /** Reference band drawn behind the line, e.g. the normal range. */
  normalRange?: { min: number; max: number } | undefined;
}

/**
 * Trend chart for a single measurement.
 *
 * `ResponsiveContainer` measures the parent, which means the chart never
 * causes a layout shift (the classic CLS problem with fixed-height charts).
 * Recharts is code-split into its own chunk so it is only downloaded when a
 * chart is actually rendered.
 */
export function VitalTrendChart({ series, height = 240, normalRange }: VitalTrendChartProps) {
  const points = useMemo<ChartPoint[]>(
    () =>
      series.points.map((point) => ({
        timestamp: new Date(point.measuredAt).getTime(),
        label: formatDateTime(point.measuredAt),
        value: point.value,
        secondary: point.value2,
        isCritical: point.isCritical,
      })),
    [series.points],
  );

  const isDual = series.type === "BLOOD_PRESSURE";

  // Human-readable series names: without these Recharts falls back to the raw
  // `dataKey` ("primary"/"secondary") in the legend.
  const primaryName = isDual ? "Systolic" : series.label;
  const secondaryName = "Diastolic";

  if (points.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-ink-500">
        No readings recorded yet.
      </div>
    );
  }

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" vertical={false} />
          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(value: number) =>
              new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
            }
            tick={{ fontSize: 11, fill: "var(--color-chart-label)" }}
            stroke="var(--color-chart-axis)"
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--color-chart-label)" }}
            stroke="var(--color-chart-axis)"
            width={48}
            domain={["auto", "auto"]}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              border: "1px solid var(--color-ink-200)",
              backgroundColor: "var(--color-surface)",
              color: "var(--color-ink-800)",
              boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
              fontSize: 13,
            }}
            labelFormatter={(value) => formatDateTime(new Date(Number(value)).toISOString())}
            formatter={(value, name) => [
              `${formatNumber(Number(value))} ${series.unit}`,
              String(name),
            ]}
          />
          {normalRange ? (
            <ReferenceLine
              y={normalRange.max}
              stroke="#10b981"
              strokeDasharray="4 4"
              label={{ value: "upper", position: "right", fontSize: 10, fill: "var(--color-chart-success)" }}
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="value"
            name={primaryName}
            stroke="var(--color-chart-line)"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "var(--color-chart-line)", strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
          {isDual ? (
            <Line
              type="monotone"
              dataKey="secondary"
              name={secondaryName}
              stroke="#f59e0b"
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
          {isDual ? (
            <Legend
              verticalAlign="top"
              height={28}
              iconType="plainline"
              wrapperStyle={{ fontSize: 12, color: "var(--color-chart-legend)" }}
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Compact inline sparkline used on the dashboard cards. */
export function Sparkline({
  values,
  className,
  tone = "brand",
}: {
  values: number[];
  className?: string;
  tone?: "brand" | "danger" | "success";
}) {
  if (values.length < 2) {
    return <div className={cn("h-8 w-24", className)} aria-hidden="true" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 28 - ((value - min) / range) * 24;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const stroke = tone === "danger" ? "var(--color-chart-danger)" : tone === "success" ? "var(--color-chart-success)" : "var(--color-chart-line)";

  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={cn("h-8 w-24", className)} aria-hidden="true">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
