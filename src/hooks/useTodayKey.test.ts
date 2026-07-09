import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTodayKey } from './useTodayKey'

describe('useTodayKey (Befund 1: „Heute" friert über Mitternacht ein)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('liefert initial den lokalen Tages-Schlüssel', () => {
    vi.setSystemTime(new Date(2026, 6, 9, 12, 0, 0))
    const { result } = renderHook(() => useTodayKey())
    expect(result.current).toBe('2026-07-09')
  })

  it('wechselt per Mitternachts-Timeout auf den neuen Tag', () => {
    vi.setSystemTime(new Date(2026, 6, 9, 23, 59, 0))
    const { result } = renderHook(() => useTodayKey())
    expect(result.current).toBe('2026-07-09')

    // 1 min bis Mitternacht + 1 s Puffer → Tick liegt sicher im neuen Tag.
    act(() => {
      vi.advanceTimersByTime(62_000)
    })
    expect(result.current).toBe('2026-07-10')
  })

  it('plant nach dem Wechsel den nächsten Mitternachts-Tick (mehrere Tage offen)', () => {
    vi.setSystemTime(new Date(2026, 6, 9, 23, 59, 0))
    const { result } = renderHook(() => useTodayKey())

    act(() => {
      vi.advanceTimersByTime(62_000) // → 10.07.
    })
    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000) // ein weiterer Tag → 11.07.
    })
    expect(result.current).toBe('2026-07-11')
  })

  it('aktualisiert bei visibilitychange (App kommt aus dem Hintergrund zurück)', () => {
    vi.setSystemTime(new Date(2026, 6, 9, 22, 0, 0))
    const { result } = renderHook(() => useTodayKey())
    expect(result.current).toBe('2026-07-09')

    // Gerät „schläft": Timer feuern nicht, aber die Systemzeit springt vor.
    vi.setSystemTime(new Date(2026, 6, 10, 7, 30, 0))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe('2026-07-10')
  })

  it('rendert bei visibilitychange am selben Tag nicht auf einen neuen Wert', () => {
    vi.setSystemTime(new Date(2026, 6, 9, 8, 0, 0))
    const { result } = renderHook(() => useTodayKey())
    const before = result.current
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe(before)
  })
})
