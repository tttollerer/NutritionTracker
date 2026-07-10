import { useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Check, ChevronDown, ListChecks, PackagePlus, Plus, Trash2 } from 'lucide-react'
import type { ShoppingItem } from '@/db/types'
import { lowPantryFoods } from '@/lib/pantryStock'
import {
  addShoppingItem,
  checkOffToPantry,
  clearCheckedShoppingItems,
  suggestFromLowPantry,
  undoCheckOff,
  visibleShoppingItems,
} from '@/lib/shopping'
import { useOverlays } from '@/lib/overlays-context'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'

/**
 * Einkaufsliste als einklappbarer Abschnitt oben auf der Einkauf-Seite
 * (Badge = offene Punkte). Abhaken legt verknüpfte Foods in den Vorrat
 * (checkOffToPantry) — der Undo-Toast nimmt beides zurück (undoCheckOff).
 */
export function ShoppingList() {
  const { t } = useTranslation()
  const { showUndo } = useOverlays()
  const items = useLiveQuery(() => visibleShoppingItems(), [])
  const low = useLiveQuery(() => lowPantryFoods(), [])
  const [expanded, setExpanded] = useState(true)
  const [draft, setDraft] = useState('')

  // Erstlade-Moment ist minimal — die Seite zeigt darunter eigene Skeletons.
  if (items === undefined) return null

  const open = items.filter((i) => !i.checked)
  const done = items.filter((i) => i.checked)
  // „Bald leer"-Kandidaten, die noch nicht offen auf der Liste stehen.
  const listed = new Set(open.flatMap((i) => (i.foodId ? [i.foodId] : [])))
  const suggestable = (low ?? []).filter((f) => !listed.has(f.id)).length

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const name = draft.trim()
    if (!name) return
    void addShoppingItem({ name })
    setDraft('')
  }

  const toggle = (item: ShoppingItem) => {
    void (async () => {
      if (item.checked) {
        await undoCheckOff(item.id)
      } else {
        await checkOffToPantry(item.id)
        // Nur mit Katalog-Verknüpfung wandert die Packung in den Vorrat.
        const key = item.foodId ? 'shopping.checkedToPantry' : 'shopping.checked'
        showUndo(t(key, { name: item.name }), () => undoCheckOff(item.id))
      }
    })()
  }

  return (
    <section aria-label={t('shopping.title')}>
      <Card className="overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="focus-ring flex min-h-[48px] w-full items-center gap-3 px-3 py-2 text-left"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
            <ListChecks size={18} />
          </span>
          <span className="min-w-0 flex-1 truncate font-semibold">{t('shopping.title')}</span>
          {open.length > 0 && (
            <span
              aria-label={t('shopping.open', { count: open.length })}
              className="shrink-0 rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold tabular-nums text-primary-foreground"
            >
              {open.length}
            </span>
          )}
          <ChevronDown
            size={18}
            aria-hidden="true"
            className={cn('shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')}
          />
        </button>

        {expanded && (
          <div className="space-y-3 border-t border-border p-3">
            {/* Manuell hinzufügen: Input + Plus. */}
            <form onSubmit={submit} className="flex gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t('shopping.addPh')}
                aria-label={t('shopping.addPh')}
                className="flex-1"
              />
              <motion.button
                whileTap={{ scale: 0.94 }}
                type="submit"
                disabled={!draft.trim()}
                aria-label={t('shopping.add')}
                className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
              >
                <Plus size={20} />
              </motion.button>
            </form>

            {/* Nachschub aus dem zur Neige gehenden Vorrat übernehmen. */}
            {suggestable > 0 && (
              <motion.button
                whileTap={{ scale: 0.97 }}
                type="button"
                onClick={() => void suggestFromLowPantry()}
                className="focus-ring flex min-h-[48px] w-full items-center justify-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-4 text-sm font-semibold text-warning-text"
              >
                <PackagePlus size={18} aria-hidden="true" />
                {t('shopping.suggest')}
              </motion.button>
            )}

            {items.length === 0 ? (
              <p className="rounded-md bg-muted/50 p-4 text-center text-sm text-muted-foreground">
                {t('shopping.empty')}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {open.map((i) => (
                  <ShoppingRow key={i.id} item={i} onToggle={() => toggle(i)} />
                ))}
                {done.map((i) => (
                  <ShoppingRow key={i.id} item={i} onToggle={() => toggle(i)} />
                ))}
              </ul>
            )}

            {done.length > 0 && (
              <button
                type="button"
                onClick={() => void clearCheckedShoppingItems()}
                className="focus-ring flex min-h-[48px] w-full items-center justify-center gap-2 rounded-md text-sm font-medium text-muted-foreground"
              >
                <Trash2 size={16} aria-hidden="true" />
                {t('shopping.clearChecked')}
              </button>
            )}
          </div>
        )}
      </Card>
    </section>
  )
}

function ShoppingRow({ item, onToggle }: { item: ShoppingItem; onToggle: () => void }) {
  const { t } = useTranslation()
  // Sekundärzeile: Menge (nur > 1 Packung) · Notiz.
  const meta = [item.qty && item.qty > 1 ? `${item.qty}×` : null, item.note].filter(Boolean).join(' · ')
  return (
    <li className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-label={
          item.checked
            ? t('shopping.uncheck', { name: item.name })
            : t('shopping.checkOff', { name: item.name })
        }
        className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-md"
      >
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full border-2',
            item.checked
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-muted-foreground/50',
          )}
        >
          {item.checked && <Check size={14} strokeWidth={3} />}
        </span>
      </button>
      <div className="min-w-0 flex-1 py-1">
        <p
          className={cn(
            'truncate text-sm font-medium',
            item.checked && 'text-muted-foreground line-through',
          )}
        >
          {item.name}
        </p>
        {meta && (
          <p
            className={cn(
              'truncate text-xs tabular-nums text-muted-foreground',
              item.checked && 'line-through',
            )}
          >
            {meta}
          </p>
        )}
      </div>
    </li>
  )
}
