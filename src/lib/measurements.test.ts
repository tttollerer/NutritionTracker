import { describe, expect, it } from 'vitest'
import type { Measurement, Settings } from '@/db/types'
import { clampValue, dueMetrics, enabledMetrics, METRIC_BY_KEY, trend } from './measurements'

const baseSettings: Settings = {
  id: 'app',
  bloodSugar: false,
  sugarWarner: false,
  glucoseUnit: 'mg/dl',
  updatedAt: 0,
}

const mk = (type: string, date: string, value: number): Measurement => ({
  id: `${type}-${date}`,
  type,
  value,
  unit: 'kg',
  date,
  loggedAt: 0,
  updatedAt: 0,
})

describe('enabledMetrics', () => {
  it('gates labs/vitals/diabetes behind opt-in, body always on', () => {
    const body = enabledMetrics(baseSettings).map((m) => m.key)
    expect(body).toContain('weight')
    expect(body).not.toContain('ferritin')
    expect(body).not.toContain('insulin')

    const full = enabledMetrics({ ...baseSettings, labValues: true, vitals: true, bloodSugar: true }).map((m) => m.key)
    expect(full).toContain('ferritin')
    expect(full).toContain('systolic')
    expect(full).toContain('insulin')
  })
})

describe('dueMetrics', () => {
  it('flags never-logged metrics and those past their interval', () => {
    const today = '2026-06-28'
    const due = dueMetrics(baseSettings, { weight: '2026-06-20' }, today).map((m) => m.key)
    // Gewicht vor 8 Tagen, Intervall 7 → fällig.
    expect(due).toContain('weight')
    // Körperfett nie erfasst → fällig.
    expect(due).toContain('bodyFat')
  })

  it('does not flag a freshly logged metric', () => {
    const today = '2026-06-28'
    const due = dueMetrics(baseSettings, { weight: '2026-06-27', bodyFat: '2026-06-20', waist: '2026-06-20', hip: '2026-06-20', arm: '2026-06-20' }, today).map((m) => m.key)
    expect(due).not.toContain('weight')
  })

  it('never flags ad-hoc metrics (intervalDays 0) like insulin', () => {
    const due = dueMetrics({ ...baseSettings, bloodSugar: true }, {}, '2026-06-28').map((m) => m.key)
    expect(due).not.toContain('insulin')
  })
})

describe('trend', () => {
  it('computes weekly rate from a weight series', () => {
    const series = [mk('weight', '2026-06-14', 80), mk('weight', '2026-06-28', 79)]
    const r = trend(series, '2026-06-28', 28)!
    expect(r.latest).toBe(79)
    expect(r.delta).toBe(-1)
    // -1 kg über 14 Tage = -0.5 kg/Woche
    expect(r.ratePerWeek).toBeCloseTo(-0.5, 5)
  })

  it('returns null without data in the window', () => {
    expect(trend([], '2026-06-28')).toBeNull()
  })
})

describe('clampValue', () => {
  it('keeps values inside the metric range', () => {
    expect(clampValue(METRIC_BY_KEY.weight, 9999)).toBe(METRIC_BY_KEY.weight.max)
    expect(clampValue(METRIC_BY_KEY.weight, 0)).toBe(METRIC_BY_KEY.weight.min)
  })
})
