# NutriScan Agent-Team — Orchestrierung zum Projektabschluss

Orchestriertes Team aus **5 Hauptagents mit je 3 Subagents** (definiert in `.claude/agents/`),
mit dem Ziel, das Projekt **technisch abzuschließen**: Roadmap-Phasen 0–4 aus
[PLAN.md](../PLAN.md) vollständig oder bewusst verschoben (§12), Build/Lint/Tests grün,
Doku aktuell.

## Organigramm

```
                      Claude (Hauptsession) = Orchestrator
                                     │
   ┌──────────────┬─────────────────┼──────────────────┬───────────────┐
   ▼              ▼                 ▼                  ▼               ▼
architect      frontend          backend            designer        usability
(Tech-Lead)    (React/TS/UI)     (Netlify Fns)      (Look & Feel)   (UX & QS)
   │              │                 │                  │               │
   ├ code-auditor ├ components      ├ ai-gateway       ├ tokens        ├ a11y
   ├ api-contracts├ data-dexie      ├ nutrition-data   ├ motion        ├ mobile-flows
   └ release-     └ pwa             └ security         └ icons         └ i18n
     planner
```

| Hauptagent | Verantwortung | Subagents |
|---|---|---|
| **architect** | Architektur, Soll-Ist gegen PLAN.md, Schnittstellen, Abnahme | `architect-code-auditor` (Read-only-Audit), `architect-api-contracts` (Client↔Function-Verträge), `architect-release-planner` (Arbeitspakete, Read-only) |
| **frontend** | Pages, Components, Dexie-Anbindung, Routing | `frontend-components` (UI-Bausteine + Tests), `frontend-data-dexie` (Schema/Migrationen — einziger Schema-Owner), `frontend-pwa` (Offline/Manifest/SW) |
| **backend** | Netlify Functions, OpenRouter-Proxy | `backend-ai-gateway` (Modi/Prompts/zod), `backend-nutrition-data` (USDA/OFF-Lookup & Mapping), `backend-security` (Rate-Limit/Budget/Origin) |
| **designer** | Design-System, Themes, Dark Mode | `designer-tokens` (Token-/Theme-System), `designer-motion` (Framer Motion), `designer-icons` (Icon-Sprache) |
| **usability** | Nutzerführung, Zustände, QS aus Nutzersicht | `usability-a11y` (WCAG AA), `usability-mobile-flows` (Daumenzonen/Tap-Ökonomie), `usability-i18n` (Texte & i18n-Hygiene) |

## Orchestrierung

Die **Hauptsession ist der Orchestrator**: Sie delegiert Aufgaben per Agent-Tool an die
passenden Agents und führt die Ergebnisse zusammen (Subagents können selbst keine weiteren
Agents starten — die Hierarchie oben ist eine fachliche Zuständigkeits-, keine technische
Aufruf-Hierarchie).

### Ablauf zum Projektabschluss

1. **Audit (parallel):** Workflow `nutriscan-abschluss-audit` starten — die fünf Fachbereiche
   prüfen parallel read-only, der Release-Planer verdichtet zu priorisierten Arbeitspaketen
   (P0 = blockiert Abschluss, P1 = sollte rein, P2 = verschiebbar nach PLAN.md §12).
2. **Umsetzung (Wellen):** Pakete pro Welle parallel an die zuständigen Hauptagents bzw.
   direkt an den passenden Subagent geben. Abhängigkeiten beachten
   (z. B. `architect-api-contracts` vor Frontend-Anbindung, `frontend-data-dexie` vor
   Features auf neuem Schema).
3. **Review-Kreuzcheck:** Nach jeder Welle prüft `usability` (plus bei Bedarf
   `usability-a11y`) die betroffenen Flows; `architect` prüft Architektur-Konformität.
4. **Abnahme:** `architect` bestätigt die Abschluss-Definition — Phasen abgedeckt,
   `npm run build` / `lint` / `test` grün, README + PLAN.md aktuell.

### Spielregeln

- **Ein Schema-Owner:** Dexie-Änderungen laufen ausschließlich über `frontend-data-dexie`
  (versionierte Migration, nie Datenverlust).
- **Verträge beidseitig:** Änderungen an Function-Schnittstellen nie einseitig —
  `architect-api-contracts` gleicht Client und Function ab.
- **Grün oder nicht fertig:** Jeder implementierende Agent zieht `npm run build`,
  `npm run lint`, `npm run test` grün, bevor er fertig meldet.
- **i18n & Tokens:** Keine hartkodierten UI-Strings, keine Ad-hoc-Farben — Verstöße gehen
  an `usability-i18n` bzw. `designer-tokens`.
- **Read-only bleibt read-only:** Auditoren (`architect-code-auditor`,
  `architect-release-planner`) ändern keinen Code.

### Nutzung

```text
# Komplettes Team-Audit + Abschlussplan (Workflow):
Workflow "nutriscan-abschluss-audit" ausführen

# Einzelnen Agent gezielt einsetzen (Beispiele):
"Nutze den Agent backend-security und härte die analyze-Function."
"Nutze den Agent usability-mobile-flows und straffe den Barcode-Logging-Flow."
```
