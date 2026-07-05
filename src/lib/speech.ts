import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Sprachausgabe (TTS) & -eingabe (STT) über die Web Speech API (PLAN.md §9.4).
 * On-device, kostenlos. Browser-Support variiert (Chrome gut, iOS/Safari
 * eingeschränkt) — daher überall mit Feature-Detection + Text-Fallback.
 */

/** Einmalige Sprachausgabe (bricht Laufendes ab). */
export function speak(text: string, lang = 'de-DE') {
  if (!('speechSynthesis' in window) || !text.trim()) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(u)
}

/** Satz an die laufende Ausgabe anhängen (für gestreamte Antworten). */
export function speakQueue(text: string, lang = 'de-DE') {
  if (!('speechSynthesis' in window) || !text.trim()) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang
  window.speechSynthesis.speak(u) // kein cancel → wird eingereiht
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}

/** Vollständige Sätze ab `from` extrahieren (Satzende . ! ? : ; \n). */
export function completeSentences(text: string, from: number): { sentences: string[]; consumed: number } {
  const pending = text.slice(from)
  const re = /[^.!?:;\n]+[.!?:;\n]+/g
  const sentences: string[] = []
  let consumed = from
  let m: RegExpExecArray | null
  while ((m = re.exec(pending))) {
    sentences.push(m[0].trim())
    consumed = from + re.lastIndex
  }
  return { sentences, consumed }
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Spracherkennung: liefert das erkannte Transkript an `onResult`. */
export function useSpeechRecognition(onResult: (text: string) => void, lang = 'de-DE') {
  const [listening, setListening] = useState(false)
  const [available] = useState(() => !!getRecognitionCtor())
  const recRef = useRef<SpeechRecognitionLike | null>(null)

  const stop = useCallback(() => {
    recRef.current?.stop()
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) return
    // Eventuell laufende Instanz stoppen und Handler lösen, damit kein
    // verwaister Erkenner mehr `listening` umschaltet.
    if (recRef.current) {
      recRef.current.onresult = null
      recRef.current.onend = null
      recRef.current.onerror = null
      recRef.current.stop()
    }
    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = false
    rec.interimResults = false
    rec.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript ?? ''
      if (text) onResult(text)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recRef.current = rec
    setListening(true)
    rec.start()
  }, [lang, onResult])

  useEffect(() => () => recRef.current?.stop(), [])

  return { listening, available, start, stop }
}
