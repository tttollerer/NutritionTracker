import { describe, expect, it } from 'vitest'
import { cn, todayKey } from './utils'

describe('cn', () => {
  it('merges and dedupes tailwind classes', () => {
    const hidden = false
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-sm', hidden && 'hidden', 'font-bold')).toBe('text-sm font-bold')
  })
})

describe('todayKey', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(todayKey(new Date(2026, 5, 27))).toBe('2026-06-27')
  })
})
