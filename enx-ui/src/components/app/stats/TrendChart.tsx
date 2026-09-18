'use client'

import { useEffect, useRef, useState } from 'react'

// One measure over time. Deliberately ONE: plotting words-read and lookups
// together would need two y-scales, and a dual-axis chart can be made to show
// any correlation you like by choosing the scales. The metric switcher above
// the chart is what replaces the second axis.

export type TrendDatum = {
  /** Axis label, already shortened for the bucket size. */
  label: string
  /** The full label used in the tooltip, e.g. the whole date. */
  fullLabel: string
  /** null renders a gap, not a zero -- see `gapNote`. */
  value: number | null
}

const HEIGHT = 240
const PAD_LEFT = 44
const PAD_RIGHT = 12
const PAD_TOP = 12
const PAD_BOTTOM = 28
const MAX_BAR_WIDTH = 24
/** Surface-colored gap between touching bars (dataviz: the gap separates, not a stroke). */
const BAR_GAP = 2

/** Clean y-axis ticks: 0, then a round step at or above the data's maximum. */
function axisTicks(max: number): number[] {
  if (max <= 0) return [0, 1]
  const rough = max / 3
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough)!
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 100) / 100)
  return ticks
}

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(720)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(280, entry.contentRect.width))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

export default function TrendChart({
  data,
  kind,
  formatValue,
  valueLabel,
  gapNote,
}: {
  data: TrendDatum[]
  kind: 'bar' | 'line'
  formatValue: (value: number) => string
  /** What one value means, for the tooltip and the screen-reader table. */
  valueLabel: string
  /** Shown when some buckets are null, explaining why they are blank. */
  gapNote?: string
}) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)

  const values = data.map((d) => d.value).filter((v): v is number => v !== null)
  const max = values.length > 0 ? Math.max(...values) : 0
  const ticks = axisTicks(max)
  const top = ticks[ticks.length - 1]

  const plotWidth = Math.max(1, width - PAD_LEFT - PAD_RIGHT)
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM
  const band = plotWidth / Math.max(1, data.length)
  // Clamped, so a value the axis wasn't scaled for lands on the edge of the
  // plot instead of somewhere down the page. Counts and ratios can't go
  // negative today, which is exactly why an unclamped mark escaping the
  // chart would be a confusing thing to debug later.
  const y = (v: number) =>
    PAD_TOP + plotHeight * (1 - Math.max(0, Math.min(v, top)) / top)
  const bandCenter = (i: number) => PAD_LEFT + band * (i + 0.5)

  // Bars are capped rather than filling their band, so a 7-point day view
  // doesn't render seven slabs.
  const barWidth = Math.min(MAX_BAR_WIDTH, Math.max(2, band - BAR_GAP))

  // Every label collides on a 365-point year; show a readable subset and let
  // the tooltip carry the rest.
  const labelStride = Math.ceil((data.length * 56) / plotWidth)

  const hasData = values.some((v) => v > 0)
  const hasGaps = data.some((d) => d.value === null)

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={`${valueLabel} over time`}
      >
        {/* Recessive hairline grid: solid, one step off the surface. */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD_LEFT}
              x2={width - PAD_RIGHT}
              y1={y(t)}
              y2={y(t)}
              className="stroke-border"
              strokeWidth={1}
            />
            {/* An empty window gets a bare baseline: labelling the
                placeholder scale would put a number on the axis that
                describes nothing. */}
            {(max > 0 || t === 0) && (
              <text
                x={PAD_LEFT - 8}
                y={y(t) + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {formatValue(t)}
              </text>
            )}
          </g>
        ))}

        {kind === 'bar' &&
          data.map((d, i) => {
            if (d.value === null || d.value <= 0) return null
            const h = Math.max(2, plotHeight * (Math.min(d.value, top) / top))
            return (
              <rect
                key={d.label + i}
                x={bandCenter(i) - barWidth / 2}
                y={HEIGHT - PAD_BOTTOM - h}
                width={barWidth}
                height={h}
                // 4px rounded data-end; the baseline end stays square
                // because the radius is clipped by the axis line below it.
                rx={Math.min(4, barWidth / 2)}
                className="fill-brand"
                opacity={hover === null || hover === i ? 1 : 0.65}
              />
            )
          })}

        {kind === 'line' && (
          <>
            {/* Each unbroken run of values is its own path, so a gap is a
                gap rather than a straight line across the missing weeks. */}
            {runsOf(data).map((run, ri) => (
              <path
                key={ri}
                d={run
                  .map(
                    (i, k) =>
                      `${k === 0 ? 'M' : 'L'} ${bandCenter(i)} ${y(data[i].value!)}`
                  )
                  .join(' ')}
                fill="none"
                className="stroke-brand"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {data.map((d, i) =>
              d.value === null ? null : (
                <circle
                  key={d.label + i}
                  cx={bandCenter(i)}
                  cy={y(d.value)}
                  r={hover === i ? 5 : 3.5}
                  className="fill-brand stroke-card"
                  // Surface ring, so a marker stays legible over the line.
                  strokeWidth={2}
                />
              )
            )}
          </>
        )}

        {/* Baseline, drawn last so bars sit on it. */}
        <line
          x1={PAD_LEFT}
          x2={width - PAD_RIGHT}
          y1={HEIGHT - PAD_BOTTOM}
          y2={HEIGHT - PAD_BOTTOM}
          className="stroke-border"
          strokeWidth={1}
        />

        {data.map((d, i) =>
          i % labelStride === 0 ? (
            <text
              key={`label-${i}`}
              x={bandCenter(i)}
              y={HEIGHT - PAD_BOTTOM + 16}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {d.label}
            </text>
          ) : null
        )}

        {/* Full-height hit bands: the hover target is the column, not the
            2px-wide mark inside it. */}
        {data.map((d, i) => (
          <rect
            key={`hit-${i}`}
            x={PAD_LEFT + band * i}
            y={PAD_TOP}
            width={band}
            height={plotHeight}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
          />
        ))}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: `${Math.min(Math.max(bandCenter(hover), 60), width - 60)}px`,
            top: `${PAD_TOP}px`,
          }}
        >
          <div className="font-medium">{data[hover].fullLabel}</div>
          <div className="text-muted-foreground tabular-nums">
            {data[hover].value === null
              ? 'Not enough reading to measure'
              : `${formatValue(data[hover].value!)} ${valueLabel}`}
          </div>
        </div>
      )}

      {!hasData && (
        // Over the plot only -- inset-0 would also cover the table below,
        // which is the one place an all-zero window is still worth reading.
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

      {/* Identity is never color-alone: the same numbers as a table. */}
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
  )
}

/** Indices of `data`, grouped into runs of consecutive non-null values. */
function runsOf(data: TrendDatum[]): number[][] {
  const runs: number[][] = []
  let current: number[] = []
  data.forEach((d, i) => {
    if (d.value === null) {
      if (current.length > 0) runs.push(current)
      current = []
    } else {
      current.push(i)
    }
  })
  if (current.length > 0) runs.push(current)
  return runs.filter((r) => r.length > 0)
}
