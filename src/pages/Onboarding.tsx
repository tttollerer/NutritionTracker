import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { Persona, Profile } from '@/db/types'
import { saveOnboarding } from '@/db/repo'
import { COMMON_ALLERGENS, DIET_FORMS, PERSONA_KEYS } from '@/lib/nutrition'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Field, Input } from '@/components/ui/Input'

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [sex, setSex] = useState<Profile['sex']>('m')
  const [age, setAge] = useState('30')
  const [height, setHeight] = useState('178')
  const [weight, setWeight] = useState('75')
  const [activity, setActivity] = useState<Profile['activity']>('medium')
  const [goal, setGoal] = useState<Profile['goal']>('maintain')
  const [persona, setPersona] = useState<Persona>('general')
  const [diets, setDiets] = useState<string[]>([])
  const [allergies, setAllergies] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const toggle = (list: string[], v: string, set: (l: string[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  async function submit() {
    setSaving(true)
    await saveOnboarding(
      {
        sex,
        age: Number(age) || 30,
        heightCm: Number(height) || 175,
        weightKg: Number(weight) || 75,
        activity,
        goal,
        persona,
        dietForms: diets,
      },
      allergies,
    )
    onDone()
    navigate('/')
  }

  return (
    <div className="space-y-6 pb-8">
      <header>
        <h1 className="text-2xl font-bold">{t('onboarding.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('onboarding.subtitle')}</p>
      </header>

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
          <Input type="number" inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} />
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
            <Chip key={d} label={t(`onboarding.diets.${d}`)} selected={diets.includes(d)} onClick={() => toggle(diets, d, setDiets)} />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium text-muted-foreground">{t('onboarding.allergies')}</span>
        <div className="flex flex-wrap gap-2">
          {COMMON_ALLERGENS.map((a) => (
            <Chip key={a} label={t(`onboarding.allergens.${a}`)} selected={allergies.includes(a)} onClick={() => toggle(allergies, a, setAllergies)} />
          ))}
        </div>
      </div>

      <Button className="w-full" onClick={submit} disabled={saving}>
        {t('onboarding.submit')}
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">{t('onboarding.disclaimer')}</p>
    </div>
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
