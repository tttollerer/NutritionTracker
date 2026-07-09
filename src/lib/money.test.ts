import { describe, expect, it } from 'vitest'
import { costByDate, formatEuro, parsePositiveNumber, sumCost } from './money'
import { describePortion } from './portion'

describe('money helpers (Haushaltskasse)', () => {
  it('formatEuro formatiert deutsch mit €-Symbol', () => {
    // Intl nutzt geschützte Leerzeichen — nur auf die Bestandteile prüfen.
    expect(formatEuro(2.49)).toMatch(/2,49\s*€/)
    expect(formatEuro(0.25)).toMatch(/0,25\s*€/)
  })

  it('sumCost summiert Kosten-Snapshots (Einträge ohne Preis zählen 0)', () => {
    expect(sumCost([{ cost: 0.25 }, { cost: 1.2 }, {}])).toBe(1.45)
    expect(sumCost([])).toBe(0)
  })

  it('costByDate gruppiert je Tag und ignoriert Gelöschtes/Preisloses', () => {
    const logs = [
      { date: '2026-07-08', cost: 1.5 },
      { date: '2026-07-08', cost: 0.5 },
      { date: '2026-07-09', cost: 2 },
      { date: '2026-07-09' }, // ohne Preis
      { date: '2026-07-09', cost: 9, deletedAt: 1 }, // soft-gelöscht
    ]
    expect(costByDate(logs)).toEqual({ '2026-07-08': 2, '2026-07-09': 2 })
  })

  it('parsePositiveNumber ist komma-tolerant und lehnt Unfug ab', () => {
    expect(parsePositiveNumber('2,49')).toBe(2.49)
    expect(parsePositiveNumber(' 500 ')).toBe(500)
    expect(parsePositiveNumber('')).toBeUndefined()
    expect(parsePositiveNumber('0')).toBeUndefined()
    expect(parsePositiveNumber('-1')).toBeUndefined()
    expect(parsePositiveNumber('abc')).toBeUndefined()
  })
})

describe('describePortion', () => {
  it('zeigt „1 Tasse (80 g)" mit Label, sonst nur die Menge', () => {
    expect(describePortion({ amount: 80, unit: 'g', label: 'Tasse' })).toBe('1 Tasse (80 g)')
    expect(describePortion({ amount: 200, unit: 'ml' })).toBe('200 ml')
  })
})
