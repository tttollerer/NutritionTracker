import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Trash2, Check } from 'lucide-react'
import type { AiItem } from '@/lib/ai'
import { getReview, clearReview } from '@/lib/reviewStore'
import { createFood, getAllergies, logFood } from '@/db/repo'
import { todayKey } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Chip } from '@/components/ui/Chip'

const AMOUNT_PRESETS = [50, 100, 150, 200]

export function Review() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const payload = getReview()
  const [items, setItems] = useState<AiItem[]>(payload?.items ?? [])
  const allergies = useLiveQuery(() => getAllergies(), []) ?? []

  useEffect(() => {
    if (!payload) navigate('/add', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!payload) return null

  function patch(i: number, p: Partial<AiItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...p } : it)))
  }
  function patchPer(i: number, p: Partial<AiItem['per100']>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, per100: { ...it.per100, ...p } } : it)))
  }
  function remove(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i))
  }

  function allergyHit(name: string): string[] {
    const lower = name.toLowerCase()
    return allergies.filter((a) => lower.includes(a.toLowerCase()))
  }

  async function confirm() {
    const date = todayKey()
    for (const it of items) {
      const per: 'g' | 'ml' = it.unit === 'ml' ? 'ml' : 'g'
      const food = await createFood({
        name: it.name,
        per,
        kcal: it.per100.kcal,
        protein: it.per100.protein,
        carbs: it.per100.carbs,
        fat: it.per100.fat,
        source: payload!.source === 'openfoodfacts' ? 'openfoodfacts' : 'ai',
        barcode: payload!.barcode,
      })
      await logFood({ food, date, meal: payload!.meal, amount: it.amount || 100, unit: it.unit })
    }
    clearReview()
    navigate('/')
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('review.title')} />
      <p className="text-xs text-muted-foreground">{t('review.estimate')}</p>

      {items.length === 0 ? (
        <p className="rounded-2xl bg-muted/50 p-6 text-center text-sm text-muted-foreground">
          {t('review.empty')}
        </p>
      ) : (
        items.map((it, i) => {
          const hits = allergyHit(it.name)
          return (
            <Card key={i} className="space-y-3 p-4">
              <div className="flex items-start gap-2">
                <Input value={it.name} onChange={(e) => patch(i, { name: e.target.value })} className="flex-1" />
                <button
                  aria-label={t('common.delete')}
                  onClick={() => remove(i)}
                  className="flex h-12 w-10 items-center justify-center text-muted-foreground hover:text-destructive"
                >
                  <Trash2 size={18} />
                </button>
              </div>

              {it.confidence != null && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{t('review.confidence')}</span>
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(it.confidence * 100)}%` }} />
                  </div>
                  <span>{Math.round(it.confidence * 100)}%</span>
                </div>
              )}

              {hits.length > 0 && (
                <p className="rounded-lg bg-warning/15 px-3 py-2 text-xs text-warning">
                  ⚠️ {t('review.allergyWarn', { list: hits.join(', ') })}
                </p>
              )}

              {/* Menge + Presets */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={it.amount}
                    onChange={(e) => patch(i, { amount: Number(e.target.value) })}
                    className="w-24"
                  />
                  <div className="flex gap-1 rounded-xl bg-muted p-1">
                    {(['g', 'ml'] as const).map((u) => (
                      <button
                        key={u}
                        onClick={() => patch(i, { unit: u })}
                        className={`min-h-[40px] rounded-lg px-3 text-sm ${it.unit === u ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {AMOUNT_PRESETS.map((a) => (
                    <Chip key={a} label={`${a}`} selected={it.amount === a} onClick={() => patch(i, { amount: a })} />
                  ))}
                </div>
              </div>

              {/* Nährwerte je 100 */}
              <div>
                <p className="mb-1 text-xs text-muted-foreground">{t('review.perInfo', { unit: it.unit === 'ml' ? 'ml' : 'g' })}</p>
                <div className="grid grid-cols-4 gap-2">
                  {(['kcal', 'protein', 'carbs', 'fat'] as const).map((k) => (
                    <label key={k} className="space-y-1">
                      <span className="block text-center text-[10px] uppercase text-muted-foreground">{k}</span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={it.per100[k]}
                        onChange={(e) => patchPer(i, { [k]: Number(e.target.value) })}
                        className="px-1 text-center text-sm"
                      />
                    </label>
                  ))}
                </div>
              </div>
            </Card>
          )
        })
      )}

      {items.length > 0 && (
        <Button className="w-full" onClick={confirm}>
          <Check size={20} /> {t('review.confirm')}
        </Button>
      )}
    </div>
  )
}
