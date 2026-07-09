export const meta = {
  name: 'nutriscan-abschluss-audit',
  description: 'Orchestriertes Team-Audit: 5 Fachagents pruefen NutriScan parallel auf Abschluss-Luecken, der Architekt verdichtet zu einem priorisierten Abschlussplan',
  whenToUse: 'Vor dem technischen Projektabschluss oder nach groesseren Feature-Wellen, um offene Luecken pro Fachbereich zu finden und in Arbeitspakete zu uebersetzen.',
  phases: [
    { title: 'Fach-Audits', detail: 'Frontend, Backend, Design, Usability + Code-Audit parallel' },
    { title: 'Abschlussplan', detail: 'Architekt/Release-Planer verdichtet zu Arbeitspaketen' },
  ],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['bereich', 'befunde'],
  properties: {
    bereich: { type: 'string' },
    buildStatus: { type: 'string', description: 'Ergebnis von build/lint/test, falls ausgefuehrt' },
    befunde: {
      type: 'array',
      items: {
        type: 'object',
        required: ['prio', 'titel', 'beleg', 'massnahme'],
        properties: {
          prio: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          titel: { type: 'string' },
          beleg: { type: 'string', description: 'datei:zeile oder Beobachtung' },
          massnahme: { type: 'string' },
          agent: { type: 'string', description: 'Empfohlener Hauptagent: frontend|backend|designer|usability|architect' },
        },
      },
    },
  },
}

const AUDITS = [
  {
    key: 'code-gesamt',
    agentType: 'architect-code-auditor',
    prompt:
      'Auditiere das Repo gegen PLAN.md (Roadmap Phase 0-4): Was fehlt, was ist halbfertig, was verstoesst gegen die Leitentscheidungen? Fuehre npm run build, lint und test aus und nimm die Ergebnisse in buildStatus auf. NUR lesen und berichten, nichts aendern.',
  },
  {
    key: 'frontend',
    agentType: 'frontend',
    prompt:
      'Pruefe den Frontend-Stand (src/) READ-ONLY auf Abschluss-Luecken: unfertige Pages/Flows, fehlende Lade-/Fehler-/Empty-Zustaende, Dexie-Anbindungsprobleme, PWA-/Offline-Luecken. Nichts aendern, nur Befunde liefern.',
  },
  {
    key: 'backend',
    agentType: 'backend',
    prompt:
      'Pruefe die Netlify Functions (analyze.mts, coach.mts) READ-ONLY auf Abschluss-Luecken: Vertrags-Drift zum Client, fehlende zod-Validierung/Retry, fehlende Schutzmassnahmen (Rate-Limit, Budget, Origin-Check, Groessenlimit), Nährwert-Lookup-Schulden laut PLAN.md Paragraph 12. Nichts aendern, nur Befunde liefern.',
  },
  {
    key: 'design',
    agentType: 'designer',
    prompt:
      'Pruefe das visuelle System READ-ONLY auf Abschluss-Luecken: Token-Verstoesse (Ad-hoc-Farben), Dark-Mode-Luecken, inkonsistente Abstaende/Radien, Kontrastprobleme, uneinheitliche Icons und Animationen ohne reduced-motion-Pfad. Nichts aendern, nur Befunde liefern.',
  },
  {
    key: 'usability',
    agentType: 'usability',
    prompt:
      'Pruefe die Kernflows READ-ONLY auf Abschluss-Luecken: Essen loggen (Foto/Barcode/manuell), KI-Ergebnis pruefen, Tagesueberblick, Coach. Fehlende Zustaende, unklare Fehlermeldungen, hartkodierte Strings, A11y-Probleme, unnoetige Taps. Nichts aendern, nur Befunde liefern.',
  },
]

phase('Fach-Audits')
log('Starte 5 parallele Fach-Audits (Architekt-Auditor, Frontend, Backend, Design, Usability) …')

const results = await parallel(
  AUDITS.map((a) => () =>
    agent(a.prompt + ' Antworte als strukturierte Befundliste.', {
      label: `audit:${a.key}`,
      phase: 'Fach-Audits',
      agentType: a.agentType,
      schema: FINDINGS_SCHEMA,
    })
  )
)

const ok = results.filter(Boolean)
const alle = ok.flatMap((r) => r.befunde.map((b) => ({ ...b, bereich: r.bereich })))
log(`${alle.length} Befunde aus ${ok.length}/5 Audits gesammelt — Architekt erstellt Abschlussplan …`)

phase('Abschlussplan')
const plan = await agent(
  'Hier sind die Audit-Befunde des Teams als JSON:\n' +
    JSON.stringify(alle, null, 2) +
    '\n\nBuild-Status: ' + (ok.map((r) => r.buildStatus).filter(Boolean).join(' | ') || 'nicht erhoben') +
    '\n\nVerdichte das zu einem Abschlussplan: Duplikate zusammenfuehren, P0/P1/P2 pruefen und ggf. korrigieren, Arbeitspakete pro Hauptagent (frontend/backend/designer/usability) schneiden mit Fertig-wenn-Kriterium, Wellen fuer parallele Abarbeitung vorschlagen. Alles laut PLAN.md Paragraph 12 Verschiebbare explizit ausklammern.',
  { label: 'abschlussplan', phase: 'Abschlussplan', agentType: 'architect-release-planner' }
)

return { befunde: alle, abschlussplan: plan }
