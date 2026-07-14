import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { Camera, Image as ImageIcon, ImagePlus, Mic, RotateCcw, Send, ShieldCheck, Trash2, Volume2, VolumeX, Target, Trophy, Plus, X } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Chip } from '@/components/ui/Chip'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/utils'
import { sendCoachStream, type ChatMessage, type CoachSuggestions } from '@/lib/coach'
import type { CoachChallengeSuggestion } from '@/lib/apiContract'
import { toApiError } from '@/lib/apiError'
import { clearChat, loadChat, saveChat } from '@/lib/chatStore'
import { downscaleImage } from '@/lib/image'
import { useOverlays } from '@/lib/overlays-context'
import { completeSentences, speakQueue, stopSpeaking, useSpeechRecognition } from '@/lib/speech'
import { applyChallengeSuggestion, applyGoalSuggestion, createFood, deleteLog, getSettings, logFood, updateSettings } from '@/db/repo'
import type { Meal } from '@/db/types'
import { defaultMeal, MEALS } from '@/lib/meal'
import { todayKey } from '@/lib/utils'

/**
 * Foto fürs Coach-Feedback DEUTLICH stärker komprimieren als beim analyze-Pfad
 * (1024 px / q0.7): Das Coach-Body-Limit liegt bei 256 KB inkl. Kontext +
 * Verlauf, das Bild muss also ≤ ~190 KB binär bleiben. 512 px / q0.5 liefert
 * typischerweise 20–60 KB; falls ein Motiv doch größer gerät, wird einmal auf
 * 384 px / q0.4 nachverdichtet.
 */
const COACH_IMAGE_MAX_BYTES = 190 * 1024

function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return Math.floor((b64.length * 3) / 4)
}

async function compressForCoach(file: Blob): Promise<string> {
  const first = await downscaleImage(file, 512, 0.5)
  if (dataUrlBytes(first) <= COACH_IMAGE_MAX_BYTES) return first
  return downscaleImage(file, 384, 0.4)
}

export function Coach() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { showUndo } = useOverlays()
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChat())
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // i18n-Key des gemappten Fehlers (errors.*), nie ein roher Fehlertext.
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [streamText, setStreamText] = useState<string | null>(null) // live wachsende Antwort
  // Foto-Anhang: erst nach explizitem Tap auf Senden geht das Bild raus.
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const [attachOpen, setAttachOpen] = useState(false) // Kamera/Galerie-Wahl
  const [consentOpen, setConsentOpen] = useState(false) // Datenschutz-Einwilligung
  const consent = useLiveQuery(async () => (await getSettings()).photoConsent ?? false, [])
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  // Ref auf den aktuellen Verlauf: verhindert, dass eine späte Spracherkennung
  // oder ein schnelles zweites Senden gegen einen veralteten Stand schreibt.
  const messagesRef = useRef(messages)
  const busyRef = useRef(false)
  const mutedRef = useRef(muted)

  const recog = useSpeechRecognition((text) => void send(text))

  useEffect(() => {
    messagesRef.current = messages
    saveChat(messages)
  }, [messages])
  useEffect(() => {
    mutedRef.current = muted
  }, [muted])
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, busy, streamText])

  async function send(text: string) {
    // Foto ohne Text: sinnvolle Standardfrage, damit der Vertrag (content ≥ 1) hält.
    const content = text.trim() || (pendingImage ? t('coach.photoDefaultMsg') : '')
    if (!content || busyRef.current) return
    const image = pendingImage ?? undefined
    setPendingImage(null)
    setAttachOpen(false)
    setInput('')
    await run([...messagesRef.current, { role: 'user', content, image }])
  }

  /** Letzte Nutzer-Nachricht erneut senden (eine evtl. Teil-Antwort wird verworfen). */
  async function retry() {
    if (busyRef.current) return
    const msgs = messagesRef.current
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') return run(msgs.slice(0, i + 1))
    }
  }

  async function run(next: ChatMessage[]) {
    busyRef.current = true
    setErrorKey(null)
    stopSpeaking()
    messagesRef.current = next
    setMessages(next)
    setBusy(true)
    setStreamText('')

    // Satzweise Sprachausgabe während des Streamens.
    let spokenLen = 0
    const onReply = (replySoFar: string) => {
      setStreamText(replySoFar)
      if (mutedRef.current) {
        spokenLen = replySoFar.length // nichts vorlesen, aber Stand mitführen
        return
      }
      const { sentences, consumed } = completeSentences(replySoFar, spokenLen)
      sentences.forEach((s) => speakQueue(s))
      spokenLen = consumed
    }

    try {
      const res = await sendCoachStream(next.slice(-20), onReply)
      // verbleibenden Satzrest vorlesen
      if (!mutedRef.current && res.reply.length > spokenLen) speakQueue(res.reply.slice(spokenLen))
      const withReply: ChatMessage[] = [...next, { role: 'assistant', content: res.reply, suggestions: res.suggestions }]
      messagesRef.current = withReply
      setMessages(withReply)
    } catch (e) {
      const err = toApiError(e)
      // Stream-Abbruch (SSE error-Event): bereits gestreamten Text behalten.
      if (err.partialReply) {
        const withPartial: ChatMessage[] = [...next, { role: 'assistant', content: err.partialReply }]
        messagesRef.current = withPartial
        setMessages(withPartial)
      }
      setErrorKey(err.i18nKey)
    } finally {
      setStreamText(null)
      busyRef.current = false
      setBusy(false)
    }
  }

  /**
   * Verlauf löschen — Undo statt Bestätigungsdialog (App-Muster, UndoToast).
   * Löscht NUR den Chat-Verlauf; das Coach-Gedächtnis (CoachMemory in Dexie)
   * mit Zielen & Vorlieben bleibt unberührt.
   */
  function clearHistory() {
    if (busyRef.current || messagesRef.current.length === 0) return
    const backup = messagesRef.current
    stopSpeaking()
    setErrorKey(null)
    messagesRef.current = []
    setMessages([])
    clearChat()
    showUndo(t('coach.historyCleared'), () => {
      messagesRef.current = backup
      setMessages(backup) // Effekt speichert den Verlauf wieder (saveChat)
    })
  }

  /** Übernommenen Vorschlag an der Nachricht persistieren (localStorage). */
  function markApplied(msgIndex: number, key: string, on: boolean) {
    setMessages((msgs) =>
      msgs.map((m, i) => {
        if (i !== msgIndex) return m
        const cur = m.applied ?? []
        const applied = on ? (cur.includes(key) ? cur : [...cur, key]) : cur.filter((k) => k !== key)
        return { ...m, applied }
      }),
    )
  }

  function openAttach() {
    if (busy) return
    if (consent === false) {
      setConsentOpen(true)
      return
    }
    if (consent === true) setAttachOpen((o) => !o)
    // consent === undefined: Einstellung lädt noch — Tap ignorieren statt raten.
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    setAttachOpen(false)
    if (!file) return
    try {
      setPendingImage(await compressForCoach(file))
    } catch (err) {
      setErrorKey(toApiError(err).i18nKey)
    }
  }

  const starters = ['today', 'protein', 'week'] as const

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <PageHeader title={t('coach.title')} subtitle={t('coach.subtitle')}>
        {/* Dezenter Verlauf-Löscher — nur sichtbar, wenn es Verlauf gibt (44-px-Target). */}
        {messages.length > 0 && (
          <button
            onClick={clearHistory}
            disabled={busy}
            aria-label={t('coach.clearHistory')}
            className="focus-ring flex h-11 w-11 items-center justify-center rounded-md border border-border bg-card text-muted-foreground disabled:opacity-50"
          >
            <Trash2 size={20} />
          </button>
        )}
        <button
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? t('coach.speak') : t('coach.mute')}
          className="focus-ring flex h-11 w-11 items-center justify-center rounded-md border border-border bg-card text-muted-foreground"
        >
          {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
        <ProfileAvatar />
      </PageHeader>

      {/* role="log" + aria-live: gestreamte Coach-Antworten erreichen Screenreader. */}
      <div role="log" aria-live="polite" className="flex-1 space-y-3 overflow-y-auto pb-2">
        {messages.length === 0 && (
          <div className="space-y-4 pt-6 text-center">
            <p className="mx-auto max-w-xs text-sm text-muted-foreground">{t('coach.empty')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {starters.map((s) => (
                <Chip key={s} label={t(`coach.starters.${s}`)} selected={false} onClick={() => void send(t(`coach.starters.${s}`))} />
              ))}
            </div>
            {/* Auch nach „Verlauf löschen" klar: Ziele & Vorlieben bleiben erhalten. */}
            <p className="mx-auto max-w-xs text-xs text-muted-foreground/80">{t('coach.emptyMemory')}</p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className="max-w-[85%] space-y-2">
              <div
                className={cn(
                  'rounded-lg px-4 py-2.5 text-sm',
                  m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-card border border-border',
                )}
              >
                {m.image && (
                  <img src={m.image} alt={t('coach.photoAlt')} className="mb-2 h-28 w-28 rounded-md object-cover" />
                )}
                {m.content}
              </div>
              {m.suggestions && (
                <Suggestions
                  s={m.suggestions}
                  applied={m.applied ?? []}
                  onApplied={(key, on) => markApplied(i, key, on)}
                />
              )}
            </div>
          </div>
        ))}

        {/* Live gestreamte Antwort */}
        {streamText !== null && streamText.length > 0 && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg border border-border bg-card px-4 py-2.5 text-sm">
              {streamText}
              <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-primary align-middle" />
            </div>
          </div>
        )}
        {busy && (streamText === null || streamText.length === 0) && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner size={16} /> {t('coach.thinking')}
          </div>
        )}
        {errorKey && (
          <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="text-destructive">{t(errorKey)}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void retry()} disabled={busy}>
                <RotateCcw size={16} /> {t('coach.retry')}
              </Button>
              {(errorKey === 'errors.offline' || errorKey === 'errors.budgetExceeded') && (
                <Button variant="secondary" onClick={() => navigate('/add')}>
                  {t('errors.manualFallback')}
                </Button>
              )}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Datenschutz: Foto geht erst nach expliziter Einwilligung an die KI (wie Capture). */}
      {consentOpen && consent === false && (
        <div className="mt-2 space-y-3 rounded-lg border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck size={18} className="text-primary" /> {t('capture.consentTitle')}
          </p>
          <p className="text-sm text-muted-foreground">{t('capture.consentBody')}</p>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => setConsentOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                void updateSettings({ photoConsent: true })
                setConsentOpen(false)
                setAttachOpen(true)
              }}
            >
              {t('capture.consentAccept')}
            </Button>
          </div>
        </div>
      )}

      {/* Kamera/Galerie-Wahl für den Foto-Anhang */}
      {attachOpen && !pendingImage && (
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => cameraRef.current?.click()}>
            <Camera size={18} /> {t('capture.take')}
          </Button>
          <Button variant="secondary" onClick={() => galleryRef.current?.click()}>
            <ImageIcon size={18} /> {t('capture.choose')}
          </Button>
        </div>
      )}

      {/* Vorschau des Anhangs — Senden schickt Text + Foto zusammen. */}
      {pendingImage && (
        <div className="relative mt-2 w-fit">
          <img src={pendingImage} alt={t('coach.photoAlt')} className="h-16 w-16 rounded-md object-cover" />
          <button
            onClick={() => setPendingImage(null)}
            aria-label={t('common.delete')}
            className="focus-ring absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Eingabe */}
      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={openAttach}
          aria-label={t('coach.attach')}
          aria-expanded={attachOpen}
          className={cn(
            'focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
            pendingImage ? 'bg-primary-soft text-primary' : 'bg-secondary text-foreground',
          )}
        >
          <ImagePlus size={20} />
        </button>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void send(input)}
          placeholder={recog.listening ? t('coach.listening') : t('coach.inputPh')}
        />
        {recog.available && (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => (recog.listening ? recog.stop() : recog.start())}
            aria-label={t('coach.mic')}
            className={cn(
              'focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
              recog.listening ? 'bg-destructive text-destructive-foreground' : 'bg-secondary text-foreground',
            )}
          >
            <Mic size={20} />
          </motion.button>
        )}
        <Button
          className="h-12 w-12 shrink-0 px-0"
          onClick={() => void send(input)}
          disabled={busy || (!input.trim() && !pendingImage)}
          aria-label={t('coach.send')}
        >
          <Send size={18} />
        </Button>
      </div>
      <p className="pt-1.5 text-center text-[10px] text-muted-foreground">{t('coach.disclaimer')}</p>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={onFile} />
    </div>
  )
}

function Suggestions({
  s,
  applied,
  onApplied,
}: {
  s: CoachSuggestions
  /** Persistierte Keys bereits übernommener Vorschläge (aus der ChatMessage). */
  applied: string[]
  onApplied: (key: string, on: boolean) => void
}) {
  const { t } = useTranslation()
  const { showUndo } = useOverlays()
  // Welcher Log-Vorschlag zeigt gerade den Mahlzeit-Picker?
  const [pickingLog, setPickingLog] = useState<number | null>(null)
  const done = (k: string) => applied.includes(k)

  // Ziel-Vorschläge lesbar machen (Audit-Befund 12): Nutrient über vorhandene
  // Keys übersetzen, min/max/range als deutsche Kurzform ("Eiweiß: mind. 120 g").
  const nutrientLabel = (k: string) =>
    ['kcal', 'protein', 'carbs', 'fat'].includes(k)
      ? t(`today.macros.${k}`)
      : t(`nutrients.names.${k}`, { defaultValue: k })
  const goalLabel = (g: NonNullable<CoachSuggestions['goals']>[number]) => {
    const detail =
      g.type === 'range'
        ? t('coach.goalRange', { min: g.target, max: g.targetMax ?? g.target, unit: g.unit })
        : g.type === 'max'
          ? t('coach.goalMax', { value: g.target, unit: g.unit })
          : t('coach.goalMin', { value: g.target, unit: g.unit })
    return `${nutrientLabel(g.nutrient)}: ${detail}`
  }

  /**
   * Challenge-Vorschlag inkl. `rule` (Vertrag v1.2) übernehmen — die Regel
   * macht die Challenge automatisch auswertbar (parseChallengeRule).
   */
  async function applyChallenge(i: number, c: CoachChallengeSuggestion) {
    await applyChallengeSuggestion(c)
    onApplied(`c${i}`, true)
  }

  async function applyLog(i: number, meal: Meal) {
    const l = s.logs![i]
    const per: 'g' | 'ml' = l.unit === 'ml' ? 'ml' : 'g'
    const food = await createFood({ name: l.name, per, ...l.per100, source: 'ai' })
    const entry = await logFood({ food, date: todayKey(), meal, amount: l.amount, unit: l.unit })
    setPickingLog(null)
    onApplied(`log${i}`, true)
    // Sichtbares Feedback wohin es ging + Undo (wie in Add.tsx).
    showUndo(t('coach.loggedTo', { name: l.name, meal: t(`today.meals.${meal}`) }), async () => {
      await deleteLog(entry.id)
      onApplied(`log${i}`, false)
    })
  }

  return (
    <Card className="space-y-2 p-3">
      <p className="text-xs font-medium text-muted-foreground">{t('coach.suggestTitle')}</p>
      {s.goals?.map((g, i) => (
        <SuggestionRow
          key={`g${i}`}
          icon={<Target size={16} />}
          label={goalLabel(g)}
          action={t('coach.applyGoal')}
          done={done(`g${i}`)}
          onClick={async () => {
            await applyGoalSuggestion(g)
            onApplied(`g${i}`, true)
          }}
        />
      ))}
      {s.challenges?.map((c, i) => (
        <SuggestionRow
          key={`c${i}`}
          icon={<Trophy size={16} />}
          label={c.title}
          action={t('coach.applyChallenge')}
          done={done(`c${i}`)}
          onClick={() => applyChallenge(i, c)}
        />
      ))}
      {s.logs?.map((l, i) => (
        <div key={`l${i}`} className="space-y-2">
          <SuggestionRow
            icon={<Plus size={16} />}
            label={`${l.name} · ${l.amount}${l.unit} · ${l.per100.kcal} kcal/100`}
            action={t('coach.applyLog')}
            done={done(`log${i}`)}
            onClick={() => setPickingLog((p) => (p === i ? null : i))}
          />
          {/* Mahlzeit-Picker im Bestätigungs-Moment: Nutzer sieht, wohin geloggt wird. */}
          {pickingLog === i && !done(`log${i}`) && (
            <div className="space-y-1.5 rounded-lg bg-muted/50 p-2">
              <p className="px-1 text-xs text-muted-foreground">{t('coach.pickMeal')}</p>
              <div className="flex flex-wrap gap-2">
                {MEALS.map((m) => (
                  <Chip
                    key={m}
                    label={t(`today.meals.${m}`)}
                    selected={m === defaultMeal()}
                    onClick={() => void applyLog(i, m)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </Card>
  )
}

function SuggestionRow({
  icon,
  label,
  action,
  done,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  action: string
  done: boolean
  onClick: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2">
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <span className="text-primary">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <button
        disabled={done}
        onClick={onClick}
        className={cn('focus-ring shrink-0 rounded-sm px-2.5 py-1 text-xs font-medium', done ? 'text-success-text' : 'bg-primary text-primary-foreground')}
      >
        {done ? t('coach.applied') : action}
      </button>
    </div>
  )
}
