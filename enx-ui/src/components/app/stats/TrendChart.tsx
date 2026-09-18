'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// One measure over time. Deliberately ONE: plotting words-read and lookups
// together would need two y-scales, and a dual-axis chart can be made to show
// any correlation you like by choosing the scales. The metric switcher above
// the chart is what replaces the second axis.
//
// Recharts renders SVG, which is why it is used here rather than a canvas
// library: the marks take the app's own Tailwind tokens (`fill-brand`,
// `stroke-border`), so light and dark mode come from the same CSS variables
// as the rest of the app instead of a second, hand-kept palette that drifts.

export type TrendDatum = {
  /** Axis label, already shortened for the bucket size. */
  label: string;
  /** The full label used in the tooltip, e.g. the whole date. */
  fullLabel: string;
  /** null renders a gap, not a zero -- see `gapNote`. */
  value: number | null;
};

const HEIGHT = 240;
/** dataviz: cap bars rather than filling the band, so 7 points aren't 7 slabs. */
const MAX_BAR_WIDTH = 24;

/**
 * Clean y-axis ticks: 0, then a round step at or above the data's maximum.
 *
 * Recharts left to itself divides the data range into equal parts, which
 * gives an axis labelled 950 / 1,900 / 2,850 / 3,800 -- arithmetically fine
 * and unreadable. Worse here than elsewhere, because `formatValue` rounds
 * for display (ADR-028 Decision 8), so those ticks then PRINT as
 * 1,000 / 1,900 / 2,900 / 3,800: unevenly spaced numbers on an evenly
 * spaced axis.
 */
function axisTicks(max: number): number[] {
  // No data: a single baseline. Dividing an empty range produces fractional
  // ticks, and "<100" printed three times is not an axis.
  if (max <= 0) return [0];

  const rough = max / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10]
    .map((m) => m * magnitude)
    .find((s) => s >= rough)!;
  const top = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

export default function TrendChart({
  data,
  kind,
  formatValue,
  valueLabel,
  gapNote,
}: {
  data: TrendDatum[];
  kind: 'bar' | 'line';
  formatValue: (value: number) => string;
  /** What one value means, for the tooltip and the screen-reader table. */
  valueLabel: string;
  /** Shown when some buckets are null, explaining why they are blank. */
  gapNote?: string;
}) {
  const hasData = data.some((d) => d.value !== null && d.value > 0);
  const hasGaps = data.some((d) => d.value === null);

  const max = Math.max(0, ...data.map((d) => d.value ?? 0));
  const ticks = axisTicks(max);
  // Pinning the domain to the tick range is what stops Recharts recomputing
  // its own -- passing `ticks` alone leaves the scale unchanged and the
  // labels land in the wrong places.
  const domain: [number, number] = [0, ticks[ticks.length - 1] || 1];

  // Labels collide on a long window; Recharts drops the ones that don't fit
  // and the tooltip carries the rest.
  const labelInterval = data.length > 14 ? Math.ceil(data.length / 10) - 1 : 0;

  const axisProps = {
    tick: { fontSize: 10 },
    tickLine: false,
    axisLine: false,
    className: 'fill-muted-foreground',
  } as const;

  const tooltip = (
    <Tooltip
      cursor={{ className: 'fill-muted', opacity: 0.35 }}
      content={
        <ChartTooltip formatValue={formatValue} valueLabel={valueLabel} />
      }
    />
  );

  return (
    <div className="relative w-full">
      {/* Recharts gives the SVG no accessible name, so the chart is announced
          as nothing at all. The name goes on a wrapper rather than inside
          the library's markup, where a version bump could drop it; the table
          below is the actual alternative for anyone who cannot see it. */}
      <div role="img" aria-label={`${valueLabel} over time`}>
        <ResponsiveContainer width="100%" height={HEIGHT}>
          {kind === 'bar' ? (
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} className="stroke-border" />
              <XAxis dataKey="label" interval={labelInterval} {...axisProps} />
              <YAxis
                tickFormatter={formatValue}
                ticks={ticks}
                domain={domain}
                width={52}
                {...axisProps}
              />
              {tooltip}
              <Bar
                dataKey="value"
                maxBarSize={MAX_BAR_WIDTH}
                radius={[4, 4, 0, 0]}
              >
                {/* Per-cell, so the colour is a Tailwind class that follows
                  dark mode rather than a hard-coded hex that would not. */}
                {data.map((_, i) => (
                  <Cell key={i} className="fill-brand" />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <LineChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} className="stroke-border" />
              <XAxis dataKey="label" interval={labelInterval} {...axisProps} />
              <YAxis
                tickFormatter={formatValue}
                ticks={ticks}
                domain={domain}
                width={52}
                {...axisProps}
              />
              {tooltip}
              <Line
                type="linear"
                dataKey="value"
                // false is what turns a null into a GAP instead of a straight
                // line drawn across weeks we have no data for -- the whole
                // reason `value` is nullable.
                connectNulls={false}
                className="stroke-brand"
                strokeWidth={2}
                strokeLinecap="round"
                dot={{
                  className: 'fill-brand stroke-card',
                  strokeWidth: 2,
                  r: 3.5,
                }}
                activeDot={{
                  className: 'fill-brand stroke-card',
                  strokeWidth: 2,
                  r: 5,
                }}
                isAnimationActive={false}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>

      {!hasData && (
        // Over the plot only -- covering the table below would hide the one
        // place an all-zero window is still worth reading.
        <p
          className="absolute inset-x-0 top-0 flex items-center justify-center text-sm text-muted-foreground"
          style={{ height: HEIGHT }}
        >
          Nothing recorded in this window yet.
        </p>
      )}

      {hasGaps && gapNote && (
        <p className="mt-2 text-xs text-muted-foreground">{gapNote}</p>
      )}

      {/* A chart is not readable by a screen reader, and colour is never the
          only channel: the same numbers as a table. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          View as table
        </summary>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-medium">Period</th>
              <th className="py-1 text-right font-medium">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={`row-${i}`} className="border-t border-border">
                <td className="py-1">{d.fullLabel}</td>
                <td className="py-1 text-right tabular-nums">
                  {d.value === null ? '—' : formatValue(d.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Recharts' built-in tooltip is unstyled and shows the raw dataKey. */
function ChartTooltip({
  active,
  payload,
  formatValue,
  valueLabel,
}: {
  active?: boolean;
  payload?: { payload: TrendDatum }[];
  formatValue: (value: number) => string;
  valueLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const datum = payload[0].payload;

  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <div className="font-medium">{datum.fullLabel}</div>
      <div className="text-muted-foreground tabular-nums">
        {datum.value === null
          ? 'Not enough reading to measure'
          : `${formatValue(datum.value)} ${valueLabel}`}
      </div>
    </div>
  );
}
