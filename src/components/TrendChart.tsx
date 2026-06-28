import { daysBetween } from '@/lib/measurements'

export interface ChartPoint {
  date: string
  value: number
}
export interface ChartSeries {
  points: ChartPoint[]
  color: string
  label: string
}

/**
 * Dependency-freies SVG-Liniendiagramm für Messwert-Verläufe. Unterstützt
 * mehrere überlagerte Reihen (z. B. Blutdruck systolisch/diastolisch), eine
 * gestrichelte Durchschnittslinie (nur bei einer Reihe), Achsen-Eckwerte und
 * datumsproportionale X-Position.
 */
export function TrendChart({ series, height = 140, decimals = 0 }: { series: ChartSeries[]; height?: number; decimals?: number }) {
  const all = series.flatMap((s) => s.points)
  if (all.length < 2) return null

  const W = 320
  const padL = 34
  const padR = 8
  const padT = 10
  const padB = 20
  const plotW = W - padL - padR
  const plotH = height - padT - padB

  const dates = all.map((p) => p.date)
  const minDate = dates.reduce((a, b) => (a < b ? a : b))
  const maxDate = dates.reduce((a, b) => (a > b ? a : b))
  const totalDays = Math.max(1, daysBetween(minDate, maxDate))

  const values = all.map((p) => p.value)
  let yMin = Math.min(...values)
  let yMax = Math.max(...values)
  if (yMin === yMax) {
    yMin -= 1
    yMax += 1
  }
  const pad = (yMax - yMin) * 0.1
  yMin -= pad
  yMax += pad

  const xFor = (date: string) => padL + (daysBetween(minDate, date) / totalDays) * plotW
  const yFor = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH

  const fmt = (n: number) => n.toFixed(decimals)
  const single = series.length === 1
  const avg = single ? series[0].points.reduce((a, p) => a + p.value, 0) / series[0].points.length : null

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img">
      {/* Y-Achsen-Eckwerte */}
      <text x={padL - 4} y={padT + 4} textAnchor="end" className="fill-muted-foreground text-[9px]">{fmt(yMax)}</text>
      <text x={padL - 4} y={height - padB} textAnchor="end" className="fill-muted-foreground text-[9px]">{fmt(yMin)}</text>
      {/* Baseline */}
      <line x1={padL} y1={height - padB} x2={W - padR} y2={height - padB} className="stroke-border" strokeWidth="1" />
      {/* Durchschnittslinie */}
      {avg != null && (
        <line x1={padL} y1={yFor(avg)} x2={W - padR} y2={yFor(avg)} className="stroke-muted-foreground/40" strokeWidth="1" strokeDasharray="3 3" />
      )}
      {/* Reihen */}
      {series.map((s, si) => {
        const pts = [...s.points].sort((a, b) => (a.date < b.date ? -1 : 1))
        const path = pts.map((p) => `${xFor(p.date).toFixed(1)},${yFor(p.value).toFixed(1)}`).join(' ')
        return (
          <g key={si}>
            <polyline points={path} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {pts.map((p, i) => (
              <circle key={i} cx={xFor(p.date)} cy={yFor(p.value)} r="2.5" fill={s.color} />
            ))}
          </g>
        )
      })}
      {/* X-Achsen-Eckdaten */}
      <text x={padL} y={height - 6} textAnchor="start" className="fill-muted-foreground text-[9px]">{minDate.slice(5)}</text>
      <text x={W - padR} y={height - 6} textAnchor="end" className="fill-muted-foreground text-[9px]">{maxDate.slice(5)}</text>
    </svg>
  )
}
