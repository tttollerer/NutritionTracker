import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatDayLong,
  formatDayShort,
  getActiveDate,
  setActiveDate,
  shiftDayKey,
  useActiveDate,
} from './dayContext'
import { renderHook, act } from '@testing-library/react'
import { todayKey } from './utils'

const STORAGE_KEY = 'nutriscan.activeDate'
const yesterday = shiftDayKey(todayKey(), -1)

describe('dayContext (aktives Zieldatum fürs Nachtragen)', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('fällt ohne gesetzten Wert auf heute zurück', () => {
    expect(getActiveDate()).toBe(todayKey())
  })

  it('merkt sich einen vergangenen Tag (sessionStorage) und liefert ihn zurück', () => {
    setActiveDate(yesterday)
    expect(getActiveDate()).toBe(yesterday)
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(yesterday)
  })

  it('null setzt zurück auf „heute folgen"', () => {
    setActiveDate(yesterday)
    setActiveDate(null)
    expect(getActiveDate()).toBe(todayKey())
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('heute selbst wird normalisiert (kein Override gespeichert)', () => {
    setActiveDate(todayKey())
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(getActiveDate()).toBe(todayKey())
  })

  it('ignoriert Müll und Zukunftswerte im Storage', () => {
    sessionStorage.setItem(STORAGE_KEY, 'kein-datum')
    expect(getActiveDate()).toBe(todayKey())
    sessionStorage.setItem(STORAGE_KEY, shiftDayKey(todayKey(), 3))
    expect(getActiveDate()).toBe(todayKey())
  })

  it('useActiveDate reagiert auf setActiveDate', () => {
    const { result } = renderHook(() => useActiveDate())
    expect(result.current).toBe(todayKey())
    act(() => setActiveDate(yesterday))
    expect(result.current).toBe(yesterday)
    act(() => setActiveDate(null))
    expect(result.current).toBe(todayKey())
  })
})

describe('Datums-Helfer', () => {
  it('shiftDayKey über Monats-/Jahresgrenzen', () => {
    expect(shiftDayKey('2026-07-01', -1)).toBe('2026-06-30')
    expect(shiftDayKey('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDayKey('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('formatiert Banner- und Kopf-Datum deutsch', () => {
    // 2026-07-03 ist ein Freitag.
    expect(formatDayLong('2026-07-03')).toBe('Freitag, 03.07.')
    expect(formatDayShort('2026-07-03')).toContain('03.07.')
  })

  it('setActiveDate wirft nicht, wenn sessionStorage fehlt', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => setActiveDate(yesterday)).not.toThrow()
    expect(getActiveDate()).toBe(todayKey())
    spy.mockRestore()
  })
})
