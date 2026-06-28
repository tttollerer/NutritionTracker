import { describe, expect, it } from 'vitest'
import { classifyGlucose, fromMgdl, glucoseWarning, toMgdl } from './glucose'

describe('glucose units', () => {
  it('converts between mg/dl and mmol/l', () => {
    expect(toMgdl(5.5, 'mmol/l')).toBe(99)
    expect(toMgdl(99, 'mg/dl')).toBe(99)
    expect(fromMgdl(90, 'mmol/l')).toBeCloseTo(5, 1)
  })
})

describe('classifyGlucose', () => {
  it('classifies by context', () => {
    expect(classifyGlucose(60, 'fasting')).toBe('low')
    expect(classifyGlucose(90, 'fasting')).toBe('normal')
    expect(classifyGlucose(110, 'fasting')).toBe('elevated')
    expect(classifyGlucose(140, 'fasting')).toBe('high')
    expect(classifyGlucose(130, 'after')).toBe('normal') // nach dem Essen toleranter
    expect(classifyGlucose(210, 'after')).toBe('high')
  })

  it('warns only on low/high', () => {
    expect(glucoseWarning(60, 'fasting')).toBe('low')
    expect(glucoseWarning(90, 'fasting')).toBeNull()
    expect(glucoseWarning(220, 'after')).toBe('high')
  })
})
