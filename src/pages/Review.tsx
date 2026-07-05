import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Trash2, Check, ChevronDown } from 'lucide-react'
import type { AiItem } from '@/lib/ai'
import { getReview, clearReview } from '@/lib/reviewStore'
import { checkAllergens } from '@/lib/allergens'
import { NUTRIENT_BY_KEY } from '@/lib/nutrients'
import { createFood, getAllergies, logFood, savePhoto } from '@/db/repo'
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
  const [ack, setAck] = useState(false)
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
  function patchMicro(i: number, key: string, value: number) {
    setItems((prev) =>
      prev.map((it, idx) =>
        idx === i ? { ...it, per100: { ...it.per100, micros: { ...(it.per100.micros ?? {}), [key]: value } } } : it,
      ),
    )
  }
  function remove(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i))
  }

  // Echter Abgleich: OFF-Allergen-/Spuren-Tags des Produkts (Primärquelle) +
  // Namens-Keywords als Fallback gegen die hinterlegten Allergien.
  function allergyHit(name: string) {
    return checkAllergens({ allergens: payload?.allergens, traces: payload?.traces, name }, allergies)
  }
  // Harte Treffer („enthält") erfordern eine bewusste Bestätigung vor dem Übernehmen.
  const hasContains = items.some((it) => allergyHit(it.name).contains.length > 0)

  async function confirm() {
    if (hasContains && !ack) return
    const date = todayKey()
    // Mahlzeitenfoto einmal speichern, ID an alle Einträge hängen.
    const photoBlobId = payload!.photo ? await savePhoto(payload!.photo) : undefined
    for (const it of items) {
      const per: 'g' | 'ml' = it.unit === 'ml' ? 'ml' : 'g'
      const food = await createFood({
        name: it.name,
        per,
        kcal: it.per100.kcal,
        protein: it.per100.protein,
        carbs: it.per100.carbs,
        fat: it.per100.fat,
        micros: it.per100.micros,
        allergens: payload!.allergens,
        traces: payload!.traces,
        source: payload!.source === 'openfoodfacts' ? 'openfoodfacts' : 'ai',
        barcode: payload!.barcode,
      })
      await logFood({ food, date, meal: payload!.meal, amount: it.amount || 100, unit: it.unit, photoBlobId })
    }
    clearReview()
    navigate('/')
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('review.title')} />
      <p className="text-xs text-muted-foreground">{t('review.estimate')}</p>

      {items.length === 0 ? (
        <p className="rounded-lg bg-muted/50 p-6 text-center text-sm text-muted-foreground">
          {t('review.empty')}
        </p>
      ) : (
        items.map((it, i) => {
          const { contains, traces } = allergyHit(it.name)
          const allergenNames = (keys: string[]) =>
            keys.map((h) => t(`onboarding.allergens.${h}`, { defaultValue: h })).join(', ')
          return (
            <Card key={i} className="space-y-3 p-4">
              <div className="flex items-start gap-2">
                <Input value={it.name} onChange={(e) => patch(i, { name: e.target.value })} className="flex-1" />
                <button
                  aria-label={t('common.delete')}
                  onClick={() => remove(i)}
                  className="focus-ring flex h-12 w-10 items-center justify-center rounded-md text-muted-foreground hover:text-destructive"
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

              {contains.length > 0 && (
                <p className="rounded-lg border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs font-medium text-destructive">
                  ⚠️ {t('review.allergyWarn', { list: allergenNames(contains) })}
                </p>
              )}
              {traces.length > 0 && (
                <p className="rounded-lg border border-warning/40 bg-warning/15 px-3 py-2 text-xs font-medium text-warning-text">
                  ⚠️ {t('review.allergyTraces', { list: allergenNames(traces) })}
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
                  <div role="group" aria-label={t('entry.unitToggle')} className="flex gap-1 rounded-md bg-muted p-1">
                    {(['g', 'ml'] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        aria-pressed={it.unit === u}
                        onClick={() => patch(i, { unit: u })}
                        className={`focus-ring min-h-[40px] rounded-sm px-3 text-sm ${it.unit === u ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
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

              {/* Mikronährstoffe (geschätzt) — sichtbar & korrigierbar */}
              {it.per100.micros && (
                <ItemMicros micros={it.per100.micros} onChange={(k, v) => patchMicro(i, k, v)} />
              )}
            </Card>
          )
        })
      )}

      {items.length > 0 && (
        <div className="space-y-3">
          {hasContains && (
            <label className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[hsl(var(--destructive))]"
              />
              <span>{t('review.allergyAck')}</span>
            </label>
          )}
          <Button className="w-full" onClick={confirm} disabled={hasContains && !ack}>
            <Check size={20} /> {t('review.confirm')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** Geschätzte Mikronährstoffe je 100 g/ml — einklappbar und vor dem Übernehmen korrigierbar. */
function ItemMicros({ micros, onChange }: { micros: Record<string, number>; onChange: (key: string, value: number) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // Nur bekannte Katalog-Nährstoffe anzeigen (in Katalog-Reihenfolge).
  const keys = Object.keys(NUTRIENT_BY_KEY).filter((k) => k in micros)
  if (keys.length === 0) return null
  return (
    <div className="border-t border-border pt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="focus-ring flex items-center gap-1 rounded-md text-xs font-medium text-muted-foreground"
      >
        <ChevronDown size={14} className={open ? 'rotate-180' : ''} />
        {t('review.microsTitle', { count: keys.length })}
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {keys.map((k) => (
            <label key={k} className="space-y-1">
              <span className="block text-center text-[10px] text-muted-foreground">
                {t(`nutrients.names.${k}`, { defaultValue: k })} ({NUTRIENT_BY_KEY[k].unit})
              </span>
              <Input
                type="number"
                inputMode="decimal"
                value={micros[k]}
                onChange={(e) => onChange(k, Number(e.target.value))}
                className="px-1 text-center text-sm"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
