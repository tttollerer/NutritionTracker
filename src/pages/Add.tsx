import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { Camera, ScanText, Barcode, Check } from 'lucide-react'
import { createFood, logFood, recentFoods } from '@/db/repo'
import type { FoodItem, Meal } from '@/db/types'
import { defaultMeal, MEALS } from '@/lib/meal'
import { todayKey } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { Chip } from '@/components/ui/Chip'

export function Add() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [meal, setMeal] = useState<Meal>(defaultMeal())
  const recents = useLiveQuery(() => recentFoods(), [])

  // Manuelles Formular
  const [name, setName] = useState('')
  const [per, setPer] = useState<'g' | 'ml'>('g')
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [amount, setAmount] = useState('100')

  const captureOptions = [
    { icon: Camera, key: 'photo', to: `/capture?mode=meal&meal=${meal}` },
    { icon: ScanText, key: 'label', to: `/capture?mode=label&meal=${meal}` },
    { icon: Barcode, key: 'barcode', to: `/barcode?meal=${meal}` },
  ] as const

  async function quickLog(food: FoodItem) {
    await logFood({
      food,
      date: todayKey(),
      meal,
      amount: food.defaultPortion?.amount ?? 100,
      unit: food.defaultPortion?.unit ?? (food.per as 'g' | 'ml'),
    })
    navigate('/')
  }

  async function saveManual() {
    if (!name.trim() || !kcal) return
    const food = await createFood({
      name,
      per,
      kcal: Number(kcal) || 0,
      protein: Number(protein) || 0,
      carbs: Number(carbs) || 0,
      fat: Number(fat) || 0,
    })
    await logFood({ food, date: todayKey(), meal, amount: Number(amount) || 100, unit: per })
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
                className="flex w-full items-center justify-between rounded-xl border border-border bg-card p-3 text-left"
              >
                <span>
                  <span className="font-medium">{f.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {f.kcal} kcal / 100 {f.per}
                  </span>
                </span>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Check size={18} />
                </span>
              </motion.button>
            ))}
          </div>
        </section>
      )}

      {/* Manuelles Erfassen */}
      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{t('entry.title')}</h2>
        <Field label={t('entry.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('entry.namePh')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('entry.per')}>
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
              {(['g', 'ml'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setPer(u)}
                  className={`min-h-[44px] rounded-lg text-sm font-medium ${
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
        <Button className="w-full" onClick={saveManual} disabled={!name.trim() || !kcal}>
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
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card p-4"
          >
            <Icon size={26} className="text-primary" />
            <span className="text-xs">{t(`add.${key}`)}</span>
          </motion.button>
        ))}
      </div>
    </div>
  )
}
