import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Download, Upload, RefreshCw, Activity, Bot, Candy, FlaskConical, HeartPulse, LineChart, ChevronRight, Pencil, AlertTriangle } from 'lucide-react'
import { getActiveGoalsMap, getCoachMemory, getSettings, resetAllData, setCoachTone, updateSettings } from '@/db/repo'
import type { CoachMemory } from '@/db/types'
import { exportBackup, downloadBackup, importBackup } from '@/lib/backup'
import { DIABETES_SUGAR_LIMIT_G } from '@/lib/glucose'
import { ThemeSettings } from '@/components/ThemeSettings'
import { EditProfile } from '@/components/EditProfile'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Toggle } from '@/components/ui/Toggle'

const COACH_TONES: CoachMemory['tone'][] = ['motivating', 'casual', 'strict']

type PendingAction = { kind: 'import'; json: string } | { kind: 'reset' }
type Feedback = { kind: 'success' | 'error'; text: string }

export function Profile({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation()
  const goals = useLiveQuery(() => getActiveGoalsMap(), [])
  const settings = useLiveQuery(() => getSettings(), [])
  const coachMemory = useLiveQuery(() => getCoachMemory(), [])
  const fileRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busy, setBusy] = useState(false)

  // Feedback-Snackbar automatisch ausblenden (gleiches Muster wie UndoToast).
  useEffect(() => {
    if (!feedback) return
    const timer = setTimeout(() => setFeedback(null), 5000)
    return () => clearTimeout(timer)
  }, [feedback])

  async function onExport() {
    downloadBackup(await exportBackup())
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    // Erst bestätigen lassen — importiert wird in confirmPending().
    setPending({ kind: 'import', json: await file.text() })
  }

  async function confirmPending() {
    if (!pending || busy) return
    setBusy(true)
    try {
      if (pending.kind === 'import') {
        await importBackup(pending.json)
        setFeedback({ kind: 'success', text: t('profile.importSuccess') })
      } else {
        await resetAllData()
        onReset()
      }
      setPending(null)
    } catch {
      // Validierung schlägt VOR jedem clear() fehl — Daten sind unverändert.
      setPending(null)
      setFeedback({ kind: 'error', text: t('profile.importError') })
    } finally {
      setBusy(false)
    }
  }

  const order = ['kcal', 'protein', 'carbs', 'fat']

  return (
    <div className="space-y-6">
      <PageHeader title={t('profile.title')} />

      {goals && (
        <Card className="space-y-2 p-4">
          <h2 className="font-semibold">{t('profile.yourGoals')}</h2>
          <ul className="divide-y divide-border">
            {order
              .filter((k) => goals[k])
              .map((k) => (
                <li key={k} className="flex justify-between py-2 text-sm">
                  <span className="text-muted-foreground">{t(`today.macros.${k}`)}</span>
                  <span className="font-medium tabular-nums">
                    {goals[k].target}
                    {goals[k].targetMax ? `–${goals[k].targetMax}` : ''} {goals[k].unit}
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      )}

      {editing ? (
        <EditProfile onClose={() => setEditing(false)} />
      ) : (
        <Button variant="secondary" className="w-full" onClick={() => setEditing(true)}>
          <Pencil size={18} /> {t('profile.edit')}
        </Button>
      )}

      <Card className="divide-y divide-border">
        <Link to="/trends" className="flex w-full items-center justify-between p-4 text-left">
          <span className="flex items-center gap-3">
            <LineChart size={20} className="text-muted-foreground" />
            {t('profile.trends')}
          </span>
          <ChevronRight size={18} className="text-muted-foreground" />
        </Link>
      </Card>

      <ThemeSettings />

      {/* Coach-Ton: fließt als CoachMemory.tone in jeden Coach-Request ein. */}
      <Card className="space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Bot size={20} className="text-muted-foreground" aria-hidden="true" />
          {t('profile.coachTone')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('profile.coachToneHint')}</p>
        <div className="flex flex-wrap gap-2">
          {COACH_TONES.map((tone) => (
            <Chip
              key={tone}
              label={t(`profile.tones.${tone}`)}
              selected={(coachMemory?.tone ?? 'motivating') === tone}
              onClick={() => void setCoachTone(tone)}
            />
          ))}
        </div>
      </Card>

      {/* Optionale Gesundheits-Module */}
      <Card className="divide-y divide-border">
        <h2 className="px-4 pt-4 text-sm font-semibold">{t('profile.health')}</h2>
        <Toggle
          icon={<Activity size={20} />}
          label={t('profile.bloodSugar')}
          hint={t('profile.bloodSugarHint')}
          checked={!!settings?.bloodSugar}
          onChange={(v) => updateSettings({ bloodSugar: v })}
        />
        <Toggle
          icon={<Candy size={20} />}
          label={t('profile.sugarWarner')}
          hint={t('profile.sugarWarnerHint', { limit: DIABETES_SUGAR_LIMIT_G })}
          checked={!!settings?.sugarWarner}
          onChange={(v) => updateSettings({ sugarWarner: v })}
        />
        <Toggle
          icon={<FlaskConical size={20} />}
          label={t('profile.labValues')}
          hint={t('profile.labValuesHint')}
          checked={!!settings?.labValues}
          onChange={(v) => updateSettings({ labValues: v })}
        />
        <Toggle
          icon={<HeartPulse size={20} />}
          label={t('profile.vitals')}
          hint={t('profile.vitalsHint')}
          checked={!!settings?.vitals}
          onChange={(v) => updateSettings({ vitals: v })}
        />
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{t('profile.backup')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onExport}>
            <Download size={18} /> {t('profile.export')}
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={18} /> {t('profile.import')}
          </Button>
        </div>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImportFile} />
      </Card>

      <Button
        variant="ghost"
        className="w-full text-muted-foreground"
        onClick={() => setPending({ kind: 'reset' })}
      >
        <RefreshCw size={18} /> {t('profile.reset')}
      </Button>

      {/* Bestätigungsdialog für destruktive Aktionen (Import überschreibt / Reset löscht alles). */}
      <AnimatePresence>
        {pending && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:items-center"
            onClick={() => !busy && setPending(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-title"
              className="w-full max-w-md space-y-3 rounded-2xl bg-card p-5 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="confirm-title" className="flex items-center gap-2 font-semibold">
                <AlertTriangle size={20} className="text-destructive" />
                {t(pending.kind === 'import' ? 'profile.importConfirmTitle' : 'profile.resetConfirmTitle')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t(pending.kind === 'import' ? 'profile.importConfirmBody' : 'profile.resetConfirmBody')}
              </p>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <Button variant="secondary" disabled={busy} onClick={() => setPending(null)}>
                  {t('common.cancel')}
                </Button>
                <Button variant="destructive" disabled={busy} onClick={confirmPending}>
                  {t(pending.kind === 'import' ? 'profile.importConfirmCta' : 'profile.resetConfirmCta')}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Erfolgs-/Fehler-Snackbar im UndoToast-Stil. */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ${
              feedback.kind === 'error' ? 'bg-destructive text-destructive-foreground' : 'bg-foreground text-background'
            }`}
            style={{ width: 'calc(100% - 2rem)' }}
            role="status"
          >
            <span className="min-w-0">{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
