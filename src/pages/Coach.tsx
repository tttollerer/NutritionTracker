import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Mic, Send, Volume2, VolumeX, Loader2, Target, Trophy, Plus } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Chip } from '@/components/ui/Chip'
import { cn } from '@/lib/utils'
import { sendCoach, type ChatMessage, type CoachSuggestions } from '@/lib/coach'
import { loadChat, saveChat } from '@/lib/chatStore'
import { speak, useSpeechRecognition } from '@/lib/speech'
import { applyChallengeSuggestion, applyGoalSuggestion, createFood, logFood } from '@/db/repo'
import { defaultMeal } from '@/lib/meal'
import { todayKey } from '@/lib/utils'

export function Coach() {
  const { t } = useTranslation()
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChat())
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [muted, setMuted] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  // Ref auf den aktuellen Verlauf: verhindert, dass eine späte Spracherkennung
  // oder ein schnelles zweites Senden gegen einen veralteten Stand schreibt.
  const messagesRef = useRef(messages)
  const busyRef = useRef(false)

  const recog = useSpeechRecognition((text) => void send(text))

  useEffect(() => {
    messagesRef.current = messages
    saveChat(messages)
  }, [messages])
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, busy])

  async function send(text: string) {
    const content = text.trim()
    if (!content || busyRef.current) return
    busyRef.current = true
    setInput('')
    setError(false)
    const next: ChatMessage[] = [...messagesRef.current, { role: 'user', content }]
    messagesRef.current = next
    setMessages(next)
    setBusy(true)
    try {
      // Verlauf zum Server begrenzen (Kosten/Größe).
      const res = await sendCoach(next.slice(-20))
      const withReply: ChatMessage[] = [...next, { role: 'assistant', content: res.reply, suggestions: res.suggestions }]
      messagesRef.current = withReply
      setMessages(withReply)
      if (!muted) speak(res.reply)
    } catch {
      setError(true)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const starters = ['today', 'protein', 'week'] as const

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <PageHeader title={t('coach.title')}>
        <button
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? t('coach.speak') : t('coach.mute')}
          className="text-muted-foreground"
        >
          {muted ? <VolumeX size={22} /> : <Volume2 size={22} />}
        </button>
      </PageHeader>

      <div className="flex-1 space-y-3 overflow-y-auto pb-2">
        {messages.length === 0 && (
          <div className="space-y-4 pt-6 text-center">
            <p className="mx-auto max-w-xs text-sm text-muted-foreground">{t('coach.empty')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {starters.map((s) => (
                <Chip key={s} label={t(`coach.starters.${s}`)} selected={false} onClick={() => void send(t(`coach.starters.${s}`))} />
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className="max-w-[85%] space-y-2">
              <div
                className={cn(
                  'rounded-2xl px-4 py-2.5 text-sm',
                  m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-card border border-border',
                )}
              >
                {m.content}
              </div>
              {m.suggestions && <Suggestions s={m.suggestions} />}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> {t('coach.thinking')}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{t('coach.error')}</p>}
        <div ref={endRef} />
      </div>

      {/* Eingabe */}
      <div className="flex items-center gap-2 pt-2">
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
            aria-label="Mikrofon"
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
              recog.listening ? 'bg-destructive text-white' : 'bg-secondary text-foreground',
            )}
          >
            <Mic size={20} />
          </motion.button>
        )}
        <Button className="h-12 w-12 shrink-0 px-0" onClick={() => void send(input)} disabled={busy} aria-label={t('coach.send')}>
          <Send size={18} />
        </Button>
      </div>
    </div>
  )
}

function Suggestions({ s }: { s: CoachSuggestions }) {
  const { t } = useTranslation()
  const [done, setDone] = useState<Set<string>>(new Set())
  const mark = (k: string) => setDone((d) => new Set(d).add(k))

  async function applyLog(i: number) {
    const l = s.logs![i]
    const per: 'g' | 'ml' = l.unit === 'ml' ? 'ml' : 'g'
    const food = await createFood({ name: l.name, per, ...l.per100, source: 'ai' })
    await logFood({ food, date: todayKey(), meal: defaultMeal(), amount: l.amount, unit: l.unit })
    mark(`log${i}`)
  }

  return (
    <Card className="space-y-2 p-3">
      <p className="text-xs font-medium text-muted-foreground">{t('coach.suggestTitle')}</p>
      {s.goals?.map((g, i) => (
        <SuggestionRow
          key={`g${i}`}
          icon={<Target size={16} />}
          label={`${g.nutrient}: ${g.type} ${g.target}${g.targetMax ? `–${g.targetMax}` : ''} ${g.unit}`}
          action={t('coach.applyGoal')}
          done={done.has(`g${i}`)}
          onClick={async () => {
            await applyGoalSuggestion(g)
            mark(`g${i}`)
          }}
        />
      ))}
      {s.challenges?.map((c, i) => (
        <SuggestionRow
          key={`c${i}`}
          icon={<Trophy size={16} />}
          label={c.title}
          action={t('coach.applyChallenge')}
          done={done.has(`c${i}`)}
          onClick={async () => {
            await applyChallengeSuggestion(c)
            mark(`c${i}`)
          }}
        />
      ))}
      {s.logs?.map((l, i) => (
        <SuggestionRow
          key={`l${i}`}
          icon={<Plus size={16} />}
          label={`${l.name} · ${l.amount}${l.unit} · ${l.per100.kcal} kcal/100`}
          action={t('coach.applyLog')}
          done={done.has(`log${i}`)}
          onClick={() => applyLog(i)}
        />
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
        className={cn('shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium', done ? 'text-success' : 'bg-primary text-primary-foreground')}
      >
        {done ? t('coach.applied') : action}
      </button>
    </div>
  )
}
