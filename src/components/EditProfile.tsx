import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db'
import { measurementsByType, updateCoachMemory, updateProfile } from '@/db/repo'
import type { Persona, Profile } from '@/db/types'
import { computeTargets, proteinPerKg, COMMON_ALLERGENS, DIET_FORMS, PERSONA_KEYS } from '@/lib/nutrition'
import { latestValue } from '@/lib/measurements'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { Chip } from '@/components/ui/Chip'

/** Editierbares Profil (H5): Werte ändern → Tagesziele werden neu berechnet. */
export function EditProfile({ onClose }: { onClose: () => void }) {
  const profile = useLiveQuery(() => db.profile.get('me'), [])
  // Aktuelles Gewicht aus dem jüngsten Messwert (fällt sonst auf Profilwert zurück).
  const lastWeight = useLiveQuery(async () => latestValue(await measurementsByType('weight'))?.value, [])
  // Allergien liegen im Coach-Gedächtnis (wie beim Onboarding erfasst) —
  // undefined = Query lädt noch, [] = keine Memory/keine Allergien.
  const allergies = useLiveQuery(async () => (await db.coachMemory.get('me'))?.allergies ?? [], [])

  if (!profile || allergies === undefined) return null
  return <EditForm profile={profile} initialWeight={lastWeight ?? profile.weightKg} initialAllergies={allergies} onClose={onClose} />
}

function EditForm({
  profile,
  initialWeight,
  initialAllergies,
  onClose,
}: {
  profile: Profile
  initialWeight: number
  initialAllergies: string[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [sex, setSex] = useState<Profile['sex']>(profile.sex)
  const [age, setAge] = useState(String(profile.age))
  const [height, setHeight] = useState(String(profile.heightCm))
  const [weight, setWeight] = useState(String(initialWeight))
  const [activity, setActivity] = useState<Profile['activity']>(profile.activity)
  const [goal, setGoal] = useState<Profile['goal']>(profile.goal)
  const [persona, setPersona] = useState<Persona>(profile.persona)
  const [diets, setDiets] = useState<string[]>(profile.dietForms)
  const [allergies, setAllergies] = useState<string[]>(initialAllergies)
  const [protein, setProtein] = useState(profile.proteinPerKgOverride ? String(profile.proteinPerKgOverride) : '')
  const [saving, setSaving] = useState(false)

  const toggleDiet = (v: string) => setDiets((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]))
  const toggleAllergy = (v: string) => setAllergies((a) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]))

  // Live-Vorschau der neuen Tagesziele.
  const draft: Profile = {
    ...profile,
    sex,
    age: Number(age) || profile.age,
    heightCm: Number(height) || profile.heightCm,
    weightKg: Number(weight) || profile.weightKg,
    activity,
    goal,
    persona,
    dietForms: diets,
    proteinPerKgOverride: protein ? Number(protein) : undefined,
  }
  const preview = computeTargets(draft)
  const effectivePerKg = proteinPerKg(draft)

  async function save() {
    setSaving(true)
    await updateProfile({
      sex,
      age: Number(age) || profile.age,
      heightCm: Number(height) || profile.heightCm,
      weightKg: Number(weight) || profile.weightKg,
      activity,
      goal,
      persona,
      dietForms: diets,
      proteinPerKgOverride: protein ? Number(protein) : undefined,
    })
    // Allergien leben im Coach-Gedächtnis (Quelle der Allergen-Warnungen).
    await updateCoachMemory({ allergies })
    onClose()
  }

  return (
    <Card className="space-y-5 p-4">
      <h2 className="font-semibold">{t('profile.edit')}</h2>

      <Segment
        label={t('onboarding.sex')}
        options={[
          { v: 'm', l: t('onboarding.male') },
          { v: 'f', l: t('onboarding.female') },
        ]}
        value={sex}
        onChange={(v) => setSex(v as Profile['sex'])}
      />

      <div className="grid grid-cols-3 gap-3">
        <Field label={t('onboarding.age')}>
          <Input type="number" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} />
        </Field>
        <Field label={t('onboarding.height')}>
          <Input type="number" inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value)} />
        </Field>
        <Field label={t('onboarding.weight')}>
          <Input type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
      </div>

      <Segment
        label={t('onboarding.activity')}
        options={[
          { v: 'low', l: t('onboarding.activityLow') },
          { v: 'medium', l: t('onboarding.activityMedium') },
          { v: 'high', l: t('onboarding.activityHigh') },
        ]}
        value={activity}
        onChange={(v) => setActivity(v as Profile['activity'])}
      />

      <Segment
        label={t('onboarding.goal')}
        options={[
          { v: 'lose', l: t('onboarding.goalLose') },
          { v: 'maintain', l: t('onboarding.goalMaintain') },
          { v: 'gain', l: t('onboarding.goalGain') },
        ]}
        value={goal}
        onChange={(v) => setGoal(v as Profile['goal'])}
      />

      <div className="space-y-2">
        <span className="text-sm font-medium text-muted-foreground">{t('onboarding.persona')}</span>
        <div className="flex flex-wrap gap-2">
          {PERSONA_KEYS.map((p) => (
            <Chip key={p} label={t(`onboarding.personas.${p}`)} selected={persona === p} onClick={() => setPersona(p)} />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium text-muted-foreground">{t('onboarding.dietForms')}</span>
        <div className="flex flex-wrap gap-2">
          {DIET_FORMS.map((d) => (
            <Chip key={d} label={t(`onboarding.diets.${d}`)} selected={diets.includes(d)} onClick={() => toggleDiet(d)} />
          ))}
        </div>
      </div>

      {/* Allergien nachträglich änderbar — gleiche Chips wie im Onboarding (Audit-Befund 2). */}
      <div className="space-y-2">
        <span className="text-sm font-medium text-muted-foreground">{t('onboarding.allergies')}</span>
        <div className="flex flex-wrap gap-2">
          {COMMON_ALLERGENS.map((a) => (
            <Chip key={a} label={t(`onboarding.allergens.${a}`)} selected={allergies.includes(a)} onClick={() => toggleAllergy(a)} />
          ))}
        </div>
      </div>

      <Field label={t('profile.proteinPerKg')}>
        <Input
          type="number"
          inputMode="decimal"
          value={protein}
          onChange={(e) => setProtein(e.target.value)}
          placeholder={effectivePerKg.toFixed(1)}
        />
        <span className="mt-1 block text-xs text-muted-foreground">{t('profile.proteinPerKgHint')}</span>
      </Field>

      {/* Live-Vorschau der neuen Ziele */}
      <div className="rounded-xl bg-muted/50 p-3">
        <p className="mb-1 text-xs font-medium text-muted-foreground">{t('profile.targetsPreview')}</p>
        <div className="grid grid-cols-4 gap-2 text-center text-sm">
          {[
            { l: 'kcal', v: preview.kcal },
            { l: t('today.macros.protein'), v: `${preview.protein} g` },
            { l: t('today.macros.carbs'), v: `${preview.carbs} g` },
            { l: t('today.macros.fat'), v: `${preview.fat} g` },
          ].map((x, i) => (
            <div key={i}>
              <span className="block text-[10px] uppercase text-muted-foreground">{x.l}</span>
              <span className="font-semibold tabular-nums">{x.v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={save} disabled={saving}>
          {t('profile.save')}
        </Button>
      </div>
    </Card>
  )
}

function Segment({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { v: string; l: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <div className="grid auto-cols-fr grid-flow-col gap-2 rounded-xl bg-muted p-1">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`min-h-[44px] rounded-lg text-sm font-medium transition-colors ${
              value === o.v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  )
}
