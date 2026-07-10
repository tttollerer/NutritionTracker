import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Trash2, Check, ChevronDown, ChevronLeft, Camera, Info, ShoppingBasket, Sparkles } from 'lucide-react'
import { analyzeImage, type AiItem } from '@/lib/ai'
import { toApiError } from '@/lib/apiError'
import { getReview, setReview, clearReview, presetsFor, presetLabel, amountForUnitSwitch } from '@/lib/reviewStore'
import { checkAllergens } from '@/lib/allergens'
import { NUTRIENT_BY_KEY } from '@/lib/nutrients'
import { useOverlays } from '@/lib/overlays-context'
import { createFood, findFoodByName, getAllergies, logFood, savePhoto, saveReviewToPantry } from '@/db/repo'
import { undoPantryAdd } from '@/lib/pantryStock'
import type { Unit } from '@/db/types'
import { todayKey } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Chip } from '@/components/ui/Chip'
import { Spinner } from '@/components/ui/Spinner'

export function Review() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { showUndo } = useOverlays()
  const payload = getReview()
  const [items, setItems] = useState<AiItem[]>(payload?.items ?? [])
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  // Verfeinerungsschleife (Paket B): Zusatzinfo → Neu-Schätzung mit demselben Bild.
  const [refineText, setRefineText] = useState('')
  const [refining, setRefining] = useState(false)
  const [refineErrorKey, setRefineErrorKey] = useState<string | null>(null)
  // Nutzer hat Items angefasst → vor dem Ersetzen einmal bestätigen lassen.
  const [touched, setTouched] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  // Lernschleife: Namen (lowercase), die beim Laden im Katalog gefunden und
  // mit der gemerkten üblichen Portion vorbelegt wurden.
  const [knownNames, setKnownNames] = useState<Set<string>>(new Set())
  const allergies = useLiveQuery(() => getAllergies(), []) ?? []

  useEffect(() => {
    if (!payload) navigate('/add', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Lernschleife/Vorausfüllen: bekannte Lebensmittel (Namens-Match gegen den
  // Katalog) bekommen ihre gemerkte defaultPortion als vorausgefüllte Menge.
  // Läuft einmal beim Laden — spätere Nutzer-Eingaben werden nie überschrieben.
  useEffect(() => {
    let cancelled = false
    async function prefill() {
      const initial = payload?.items ?? []
      const found = new Set<string>()
      const portions = new Map<string, { amount: number; unit: Unit }>()
      for (const it of initial) {
        const match = await findFoodByName(it.name)
        if (match?.defaultPortion) {
          found.add(it.name.trim().toLowerCase())
          portions.set(it.name.trim().toLowerCase(), match.defaultPortion)
        }
      }
      if (cancelled || found.size === 0) return
      setKnownNames(found)
      setItems((prev) =>
        prev.map((it) => {
          const p = portions.get(it.name.trim().toLowerCase())
          return p ? { ...it, amount: p.amount, unit: p.unit } : it
        }),
      )
    }
    void prefill()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!payload) return null

  function patch(i: number, p: Partial<AiItem>) {
    setTouched(true)
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...p } : it)))
  }
  function patchPer(i: number, p: Partial<AiItem['per100']>) {
    setTouched(true)
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, per100: { ...it.per100, ...p } } : it)))
  }
  function patchMicro(i: number, key: string, value: number) {
    setTouched(true)
    setItems((prev) =>
      prev.map((it, idx) =>
        idx === i ? { ...it, per100: { ...it.per100, micros: { ...(it.per100.micros ?? {}), [key]: value } } } : it,
      ),
    )
  }
  function remove(i: number) {
    setTouched(true)
    setItems((prev) => prev.filter((_, idx) => idx !== i))
  }

  /**
   * „Neu schätzen": dasselbe (bereits verkleinerte) Bild erneut analysieren —
   * mit kombiniertem Hint aus dem ursprünglichen Capture-Hint + der Zusatzinfo
   * (z. B. „Das ist Joghurtsauce, nicht Mayo"). Das Ergebnis ERSETZT die Items;
   * bei bereits editierten Items verlangt der erste Tap eine Bestätigung.
   */
  async function refine() {
    const p = payload
    if (!p?.imageBase64 || refining || !refineText.trim()) return
    if (touched && !confirmReplace) {
      setConfirmReplace(true)
      return
    }
    setRefineErrorKey(null)
    setRefining(true)
    try {
      // Server-Limit: hint max. 280 Zeichen (AnalyzeRequestSchema).
      const combinedHint = [p.hint, refineText.trim()].filter(Boolean).join('. ').slice(0, 280)
      const result = await analyzeImage(p.mode ?? 'meal', p.imageBase64, combinedHint || undefined)
      setReview({
        ...p,
        items: result.items,
        notes: result.notes,
        questions: result.questions,
        hint: combinedHint || undefined,
      })
      setItems(result.items)
      setKnownNames(new Set()) // Vorbelegungs-Badges gelten für die alten Items nicht mehr
      setRefineText('')
      setTouched(false)
      setConfirmReplace(false)
    } catch (err) {
      setRefineErrorKey(toApiError(err).i18nKey)
    } finally {
      setRefining(false)
    }
  }

  // Echter Abgleich: OFF-Allergen-/Spuren-Tags des Produkts (Primärquelle) +
  // Namens-Keywords als Fallback gegen die hinterlegten Allergien.
  function allergyHit(name: string) {
    return checkAllergens({ allergens: payload?.allergens, traces: payload?.traces, name }, allergies)
  }
  // Harte Treffer („enthält") erfordern eine bewusste Bestätigung vor dem Übernehmen.
  const hasContains = items.some((it) => allergyHit(it.name).contains.length > 0)

  async function confirm() {
    if (busy || (hasContains && !ack)) return
    setBusy(true) // Doppel-Tap-Schutz: Button disabled + früher Guard oben
    try {
      const date = todayKey()
      // Mahlzeitenfoto einmal speichern, ID an alle Einträge hängen.
      const photoBlobId = payload!.photo ? await savePhoto(payload!.photo) : undefined
      for (const it of items) {
        const per: 'g' | 'ml' = it.unit === 'ml' ? 'ml' : 'g'
        // createFood upsertet per Barcode/Name (Dedupe seit Welle 2) — bekannte
        // Produkte werden aktualisiert statt dupliziert; logFood merkt sich
        // anschließend die Menge als defaultPortion (Lernschleife).
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
        await logFood({ food, date, meal: payload!.meal, amount: it.amount || (it.unit === 'portion' ? 1 : 100), unit: it.unit, photoBlobId })
      }
      clearReview()
      navigate('/')
    } finally {
      setBusy(false)
    }
  }

  /**
   * „Nur in den Vorrat": geprüfte Items als FoodItems upserten (pantry=true,
   * bereits vorrätige Produkte +1 Packung, eingestellte Menge als übliche
   * Portion) — OHNE LogEntries. Undo nimmt je Item eine Packung zurück.
   */
  async function toPantry() {
    if (busy || (hasContains && !ack)) return
    setBusy(true)
    try {
      const foods = await saveReviewToPantry(items, {
        source: payload!.source === 'openfoodfacts' ? 'openfoodfacts' : 'ai',
        barcode: payload!.barcode,
        allergens: payload!.allergens,
        traces: payload!.traces,
      })
      clearReview()
      showUndo(t('review.pantrySaved', { count: foods.length }), async () => {
        await Promise.all(foods.map((f) => undoPantryAdd(f.id)))
      })
      navigate('/add')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Lokaler Header mit Zurück-Pfeil (PageHeader hat bewusst keinen Back-Slot). */}
      <header className="flex items-center gap-1">
        <button
          onClick={() => navigate(-1)}
          aria-label={t('common.back')}
          className="focus-ring -ml-2 flex h-12 w-10 items-center justify-center rounded-md text-muted-foreground"
        >
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-2xl font-bold">{t('review.title')}</h1>
      </header>
      <p className="text-xs text-muted-foreground">{t('review.estimate')}</p>

      {/* Hinweiszeile der KI (AnalyzeResult.notes) — dezent über den Items. */}
      {payload.notes && (
        <p className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            <span className="font-medium">{t('review.aiNotes')}: </span>
            {payload.notes}
          </span>
        </p>
      )}

      {items.length === 0 ? (
        /* Empty-State mit genau EINER offensichtlichen Aktion: neu fotografieren. */
        <div className="space-y-4 rounded-lg bg-muted/50 p-6 text-center">
          <p className="text-sm text-muted-foreground">{t('review.empty')}</p>
          <Button className="w-full" onClick={() => navigate(-1)}>
            <Camera size={20} /> {t('review.retake')}
          </Button>
        </div>
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

              {knownNames.has(it.name.trim().toLowerCase()) && (
                <p className="text-xs text-primary">{t('review.knownFood')}</p>
              )}

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

              {/* Menge + Presets. 'portion' ist eine sichtbare dritte Einheit:
                  Liefert die KI unit='portion', zeigt der Toggle das aktiv an und
                  die Presets sind Portionszähler (¼–2) statt Gramm-Werte — sonst
                  würde der Preset „100" 100 Portionen (~10.000 g) loggen. */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step={it.unit === 'portion' ? 0.25 : 1}
                    value={it.amount}
                    onChange={(e) => patch(i, { amount: Number(e.target.value) })}
                    className="w-24"
                  />
                  <div role="group" aria-label={t('entry.unitToggle')} className="flex gap-1 rounded-md bg-muted p-1">
                    {(['g', 'ml', 'portion'] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        aria-pressed={it.unit === u}
                        onClick={() => patch(i, { unit: u, amount: amountForUnitSwitch(it.amount, u) })}
                        className={`focus-ring min-h-[40px] rounded-sm px-3 text-sm ${it.unit === u ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
                      >
                        {u === 'portion' ? t('today.edit.unitPortion') : u}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {presetsFor(it.unit).map((a) => (
                    <Chip key={a} label={presetLabel(a)} selected={it.amount === a} onClick={() => patch(i, { amount: a })} />
                  ))}
                </div>
              </div>

              {/* Nährwerte je 100 (bei 'portion' bezogen auf 100 g Basis) */}
              <div>
                <p className="mb-1 text-xs text-muted-foreground">{t('review.perInfo', { unit: it.unit === 'ml' ? 'ml' : 'g' })}</p>
                <div className="grid grid-cols-4 gap-2">
                  {(['kcal', 'protein', 'carbs', 'fat'] as const).map((k) => (
                    <label key={k} className="space-y-1">
                      <span className="block truncate text-center text-[10px] uppercase text-muted-foreground">
                        {k === 'kcal' ? 'kcal' : t(`today.macros.${k}`)}
                      </span>
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

      {/* ── Schätzung verbessern (Paket B): nur mit vorhandenem Analyse-Bild ── */}
      {payload.imageBase64 && (
        <Card className="space-y-3 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles size={16} aria-hidden="true" className="text-primary" /> {t('review.refineTitle')}
          </p>
          <p className="text-xs text-muted-foreground">{t('review.refineHint')}</p>

          {/* Rückfragen der KI als antippbare Chips → Tap füllt das Eingabefeld */}
          {(payload.questions?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2">
              {payload.questions!.map((q) => (
                <Chip key={q} label={q} selected={refineText === q} onClick={() => setRefineText(q)} />
              ))}
            </div>
          )}

          <Input
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            placeholder={t('review.refinePlaceholder')}
            aria-label={t('review.refineTitle')}
          />

          {refineErrorKey && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {t(refineErrorKey)}
            </p>
          )}
          {confirmReplace && !refining && (
            <p className="rounded-lg bg-warning/15 px-3 py-2 text-xs font-medium text-warning-text">
              {t('review.refineReplaceWarn')}
            </p>
          )}

          <Button
            variant="secondary"
            className="w-full"
            onClick={() => void refine()}
            disabled={refining || busy || !refineText.trim()}
          >
            {refining ? <Spinner size={18} /> : <Sparkles size={18} />}{' '}
            {refining ? t('review.refining') : confirmReplace ? t('review.refineConfirm') : t('review.refineCta')}
          </Button>
        </Card>
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
          <Button className="w-full" onClick={confirm} disabled={busy || refining || (hasContains && !ack)}>
            {busy ? <Spinner size={20} /> : <Check size={20} />} {busy ? t('review.saving') : t('review.confirm')}
          </Button>
          {/* Sekundär: als Einkauf in den Vorrat — speichert ohne zu loggen. */}
          <Button variant="secondary" className="w-full" onClick={() => void toPantry()} disabled={busy || refining || (hasContains && !ack)}>
            <ShoppingBasket size={20} /> {t('review.toPantry')}
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
