import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { Camera, ScanText, ScanBarcode, Check, ImagePlus, X } from 'lucide-react'
import { createFood, deleteLog, getAllergies, logFood, quickLogCatalog, recentFoods, savePhoto } from '@/db/repo'
import { checkAllergens } from '@/lib/allergens'
import { useOverlays } from '@/lib/overlays-context'
import type { FoodItem, Meal } from '@/db/types'
import { defaultMeal, MEALS } from '@/lib/meal'
import { FOOD_CATALOG } from '@/lib/foodCatalog'
import { downscaleImage } from '@/lib/image'
import { todayKey } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { Chip } from '@/components/ui/Chip'

export function Add() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { showUndo } = useOverlays()
  const [meal, setMeal] = useState<Meal>(defaultMeal())
  const recents = useLiveQuery(() => recentFoods(), [])
  const allergies = useLiveQuery(() => getAllergies(), []) ?? []
  const [ack, setAck] = useState(false)

  // Manuelles Formular
  const [name, setName] = useState('')
  const [per, setPer] = useState<'g' | 'ml'>('g')
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [amount, setAmount] = useState('100')
  const [photo, setPhoto] = useState<string | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) setPhoto(await downscaleImage(file))
  }

  const captureOptions = [
    { icon: Camera, key: 'photo', to: `/capture?mode=meal&meal=${meal}` },
    { icon: ScanText, key: 'label', to: `/capture?mode=label&meal=${meal}` },
    { icon: ScanBarcode, key: 'barcode', to: `/barcode?meal=${meal}` },
  ] as const

  async function logCatalog(id: string) {
    const c = FOOD_CATALOG.find((f) => f.id === id)
    if (!c) return
    const entry = await quickLogCatalog(c, meal)
    showUndo(t('capture.added', { name: c.name }), () => deleteLog(entry.id))
    navigate('/')
  }

  async function quickLog(food: FoodItem) {
    const entry = await logFood({
      food,
      date: todayKey(),
      meal,
      amount: food.defaultPortion?.amount ?? 100,
      unit: food.defaultPortion?.unit ?? (food.per as 'g' | 'ml'),
    })
    showUndo(t('capture.added', { name: food.name }), () => deleteLog(entry.id))
    navigate('/')
  }

  // Namens-basierte Allergen-Warnung für manuell erfasste Lebensmittel.
  const manualHits = checkAllergens({ name }, allergies).contains
  const allergenNames = (keys: string[]) =>
    keys.map((h) => t(`onboarding.allergens.${h}`, { defaultValue: h })).join(', ')

  async function saveManual() {
    if (!name.trim() || !kcal) return
    if (manualHits.length > 0 && !ack) return
    const food = await createFood({
      name,
      per,
      kcal: Number(kcal) || 0,
      protein: Number(protein) || 0,
      carbs: Number(carbs) || 0,
      fat: Number(fat) || 0,
    })
    const photoBlobId = photo ? await savePhoto(photo) : undefined
    await logFood({ food, date: todayKey(), meal, amount: Number(amount) || 100, unit: per, photoBlobId })
    navigate('/')
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('add.title')} />

      {/* Mahlzeit-Auswahl */}
      <div className="flex flex-wrap gap-2">
        {MEALS.map((m) => (
          <Chip key={m} label={t(`today.meals.${m}`)} selected={meal === m} onClick={() => setMeal(m)} />
        ))}
      </div>

      {/* Zuletzt benutzt */}
      {recents && recents.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t('entry.recent')}</h2>
          <div className="space-y-2">
            {recents.map((f) => (
              <motion.button
                key={f.id}
                whileTap={{ scale: 0.98 }}
                onClick={() => quickLog(f)}
                className="focus-ring flex w-full items-center justify-between rounded-lg border border-border bg-card p-3 text-left"
              >
                <span>
                  <span className="font-medium">{f.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {f.kcal} kcal / 100 {f.per}
                  </span>
                </span>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <Check size={18} />
                </span>
              </motion.button>
            ))}
          </div>
        </section>
      )}

      {/* Katalog-Schnellzugriff: häufige Lebensmittel + Laster */}
      <CatalogQuickAdd
        title={t('catalog.common')}
        foods={FOOD_CATALOG.filter((f) => !f.vice)}
        onPick={(id) => void logCatalog(id)}
      />
      <CatalogQuickAdd
        title={t('catalog.vices')}
        foods={FOOD_CATALOG.filter((f) => f.vice)}
        onPick={(id) => void logCatalog(id)}
      />

      {/* Manuelles Erfassen */}
      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{t('entry.title')}</h2>
        <Field label={t('entry.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('entry.namePh')} />
        </Field>
        {manualHits.length > 0 && (
          <div className="space-y-2">
            <p className="rounded-lg border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs font-medium text-destructive">
              ⚠️ {t('review.allergyWarn', { list: allergenNames(manualHits) })}
            </p>
            <label className="flex items-start gap-2 text-xs text-destructive">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[hsl(var(--destructive))]"
              />
              <span>{t('review.allergyAck')}</span>
            </label>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('entry.per')}>
            <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-1">
              {(['g', 'ml'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setPer(u)}
                  className={`focus-ring min-h-[44px] rounded-sm text-sm font-medium ${
                    per === u ? 'bg-card shadow-sm' : 'text-muted-foreground'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('entry.kcal')}>
            <Input type="number" inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('entry.protein')}>
            <Input type="number" inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} />
          </Field>
          <Field label={t('entry.carbs')}>
            <Input type="number" inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
          </Field>
          <Field label={t('entry.fat')}>
            <Input type="number" inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} />
          </Field>
        </div>
        <Field label={`${t('entry.amount')} (${per})`}>
          <Input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>

        {/* Optionales Mahlzeitenfoto */}
        {photo ? (
          <div className="relative w-fit">
            <img src={photo} alt="" className="h-20 w-20 rounded-md object-cover" />
            <button
              onClick={() => setPhoto(null)}
              aria-label={t('common.delete')}
              className="focus-ring absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => photoRef.current?.click()}
            className="focus-ring flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-input py-2.5 text-sm text-muted-foreground"
          >
            <ImagePlus size={18} /> {t('entry.photo')}
          </button>
        )}
        <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />

        <Button className="w-full" onClick={saveManual} disabled={!name.trim() || !kcal || (manualHits.length > 0 && !ack)}>
          {t('entry.save')}
        </Button>
      </Card>

      {/* KI- & Barcode-Erfassung */}
      <div className="grid grid-cols-3 gap-3">
        {captureOptions.map(({ icon: Icon, key, to }) => (
          <motion.button
            key={key}
            whileTap={{ scale: 0.96 }}
            onClick={() => navigate(to)}
            className="focus-ring flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-4"
          >
            <Icon size={26} className="text-primary" />
            <span className="text-xs">{t(`add.${key}`)}</span>
          </motion.button>
        ))}
      </div>
    </div>
  )
}

function CatalogQuickAdd({
  title,
  foods,
  onPick,
}: {
  title: string
  foods: { id: string; name: string }[]
  onPick: (id: string) => void
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="flex flex-wrap gap-2">
        {foods.map((f) => (
          <Chip key={f.id} label={f.name} selected={false} onClick={() => onPick(f.id)} />
        ))}
      </div>
    </section>
  )
}
