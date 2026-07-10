import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Camera, ChevronLeft, Minus, Plus, ShoppingBasket, Trash2 } from 'lucide-react'
import type { ReceiptItem } from '@/lib/apiContract'
import { clearReceiptDraft, getReceiptDraft, saveReceiptToPantry, undoReceiptSave } from '@/lib/receipt'
import { parsePositiveNumber } from '@/lib/money'
import { useOverlays } from '@/lib/overlays-context'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'

/** Editierbare Zeile des Bon-Prüf-Screens; per100 läuft unsichtbar mit durch. */
interface Row {
  name: string
  quantity: number
  priceText: string
  per100?: ReceiptItem['per100']
}

/**
 * Prüf-Screen des Kassenbon-Scans (/receipt): erkannte Positionen als
 * editierbare Liste (Name · Stück · Preis) — „Alle in den Vorrat" übernimmt
 * jede Position per addToPantry/incrementPantry und setzt den Positionspreis
 * (setFoodPrice mit Historie). Muster: src/pages/Review.tsx.
 */
export function ReceiptReview() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { showUndo } = useOverlays()
  const [draft] = useState(() => getReceiptDraft())
  const [rows, setRows] = useState<Row[]>(() =>
    (draft ?? []).map((it) => ({
      name: it.name,
      quantity: Math.max(1, Math.round(it.quantity)),
      // Deutsche Komma-Schreibweise fürs Eingabefeld (Muster Barcode-Preisfeld).
      priceText: it.price != null ? String(it.price).replace('.', ',') : '',
      per100: it.per100,
    })),
  )
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!draft) navigate('/pantry', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!draft) return null

  function patch(i: number, p: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)))
  }
  function remove(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i))
  }

  // Nur Positionen mit Namen werden übernommen — leere Zeilen zählen nicht.
  const savable = rows.filter((r) => r.name.trim().length > 0)

  async function save() {
    if (busy || savable.length === 0) return
    setBusy(true) // Doppel-Tap-Schutz wie in Review.confirm
    try {
      const items: ReceiptItem[] = savable.map((r) => {
        const price = parsePositiveNumber(r.priceText)
        return {
          name: r.name.trim(),
          quantity: r.quantity,
          ...(price != null ? { price } : {}),
          ...(r.per100 ? { per100: r.per100 } : {}),
        }
      })
      const saved = await saveReceiptToPantry(items)
      clearReceiptDraft()
      showUndo(t('receipt.saved', { count: saved.length }), () => undoReceiptSave(saved))
      navigate('/pantry')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Lokaler Header mit Zurück-Pfeil (Muster Review.tsx). */}
      <header className="flex items-center gap-1">
        <button
          onClick={() => navigate(-1)}
          aria-label={t('common.back')}
          className="focus-ring -ml-2 flex h-12 w-10 items-center justify-center rounded-md text-muted-foreground"
        >
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-2xl font-bold">{t('receipt.title')}</h1>
      </header>
      <p className="text-xs text-muted-foreground">{t('receipt.estimate')}</p>

      {rows.length === 0 ? (
        /* Empty-State mit genau EINER offensichtlichen Aktion: neu fotografieren. */
        <div className="space-y-4 rounded-lg bg-muted/50 p-6 text-center">
          <p className="text-sm text-muted-foreground">{t('receipt.empty')}</p>
          <Button className="w-full" onClick={() => navigate(-1)}>
            <Camera size={20} /> {t('receipt.retake')}
          </Button>
        </div>
      ) : (
        <>
          {rows.map((row, i) => (
            <Card key={i} className="space-y-3 p-4">
              <div className="flex items-start gap-2">
                <Input
                  value={row.name}
                  onChange={(e) => patch(i, { name: e.target.value })}
                  aria-label={t('receipt.name')}
                  className="flex-1"
                />
                <button
                  aria-label={t('receipt.remove', { name: row.name })}
                  onClick={() => remove(i)}
                  className="focus-ring flex h-12 w-10 items-center justify-center rounded-md text-muted-foreground hover:text-destructive"
                >
                  <Trash2 size={18} />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3">
                {/* Stück-Stepper (Muster Vorrats-Bestand auf der Einkauf-Seite). */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => patch(i, { quantity: row.quantity - 1 })}
                    disabled={row.quantity <= 1}
                    aria-label={t('receipt.qtyDec', { name: row.name })}
                    className="focus-ring flex h-12 w-12 items-center justify-center rounded-md bg-muted text-foreground disabled:opacity-40"
                  >
                    <Minus size={18} />
                  </button>
                  <span className="min-w-[4.5rem] text-center text-sm tabular-nums text-muted-foreground">
                    {t('receipt.qty', { count: row.quantity })}
                  </span>
                  <button
                    type="button"
                    onClick={() => patch(i, { quantity: row.quantity + 1 })}
                    aria-label={t('receipt.qtyInc', { name: row.name })}
                    className="focus-ring flex h-12 w-12 items-center justify-center rounded-md bg-muted text-foreground"
                  >
                    <Plus size={18} />
                  </button>
                </div>

                <label className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t('receipt.price')}</span>
                  <Input
                    inputMode="decimal"
                    value={row.priceText}
                    onChange={(e) => patch(i, { priceText: e.target.value })}
                    placeholder="0,00"
                    aria-label={t('receipt.priceAria', { name: row.name })}
                    className="w-20 text-right tabular-nums"
                  />
                </label>
              </div>
            </Card>
          ))}

          <p className="text-xs text-muted-foreground">{t('receipt.priceHint')}</p>

          <Button className="w-full" onClick={() => void save()} disabled={busy || savable.length === 0}>
            {busy ? <Spinner size={20} /> : <ShoppingBasket size={20} />}{' '}
            {busy ? t('receipt.saving') : t('receipt.toPantry')}
          </Button>
        </>
      )}
    </div>
  )
}
