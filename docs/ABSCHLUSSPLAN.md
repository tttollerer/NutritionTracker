# NutriScan — Abschlussplan (Team-Audit vom 2026-07-05)

Ergebnis des orchestrierten Team-Audits (5 Fach-Audits parallel: Code-Gesamt, Frontend,
Backend, Design, Usability → verdichtet vom Release-Planer). Basis: [PLAN.md](../PLAN.md)
§11–13. Vorgehen und Team: [AGENT_TEAM.md](./AGENT_TEAM.md).

**Status bei Audit:** Build PASS · Test PASS (60 Tests) · Lint PASS (P0 `.claude`-Ignore
bereits behoben). ~70 Befunde, davon 1 × P0, 18 × P1, Rest P2.

---

## 1) Nicht Teil des Abschlusses (verschoben)

| Punkt | Begründung |
|---|---|
| Cloud-Sync (Supabase, Multi-Device) | PLAN §11 Phase 5 explizit „(später)" |
| Server-STT/TTS-Fallback | §11 Phase 4 nur „als Fallback"; Web Speech API vorhanden |
| USDA/OFF-Nährwert-Resolver serverseitig | §12: Modell-Schätzung in Phase 2 bewusst akzeptiert, „Umstellung … folgt" |
| iOS-ZXing-Nachrüstung Barcode | §12: „ggf. ZXing nachrüsten"; manuelle Eingabe als Fallback existiert. **Achtung:** Scanner-Stopp-Bug nach „nicht gefunden" ist davon getrennt → Paket 7 |
| Freihand-Sprachmodus | §9.4/§11 explizit „optional" |
| en.json-Vollausbau | Stattdessen Single-Locale DE festschreiben (Paket 15) — planlkonform (§11 Phase 0: „DE als Startsprache") |

**Prioritätskorrekturen:** Backup ohne `measurements` bleibt **P0** (Datenverlust).
„Barcode iOS funktionslos" und USDA-Resolver laut §12 verschoben. Review-Preset-Fehlbuchung
(100 → 10.000 g) effektiv P0-nah: aktive Falschdaten in der DB.

---

## 2) Arbeitspakete

| Nr. | Agent | Titel | Umfang (gebündelte Befunde) | Abh. | Fertig-wenn |
|---|---|---|---|---|---|
| 1 | architect-api-contracts | API-Vertrag v1.1 fixieren | `memory:null`-Drift (coach.mts:20 vs src/lib/coach.ts:164); stabile Fehlercodes/Error-Envelope (RATE_LIMITED, PAYLOAD_TOO_LARGE, UPSTREAM_TIMEOUT, BUDGET_EXCEEDED, OFFLINE); SSE-Fehler als eigenes Event statt „[Fehler: …]"-Text; Suggestions-Schema; sessionStorage-Entscheidung dokumentieren | — | Vertragsdoku + geteilte zod-Schemas; Repro „memory:null → 400" als Test; Build/Test grün |
| 2 | backend-ai-gateway | Vertrag & Validierung umsetzen | memory nullable; serverseitige zod-Validierung der Coach-Suggestions; SSE-Fehler-Event; Coach-Foto-Feedback (`imageBase64` im Coach-Request) | 1 | memory:null → 200; kaputtes Suggestion-JSON abgefangen; Foto-Request liefert Bild-Antwort; Tests grün |
| 3 | backend-security | Function-Härtung & Tests | Rate-Limit/Tagesbudget/Origin-Check; Body-Limit ≤ 6 MB vor Einlesen; AbortController-Timeout; keine Upstream-Rohtexte, Fehlercodes aus Paket 1; Tests für extractJson/Retry/SSE | 2 | Testfälle 429/413/Timeout greifen; kein Upstream-Text im Body; Function-Tests grün |
| 4 | frontend-data-dexie | **P0** Backup & Datenintegrität | `measurements` in Export/Import; Import mit Validierung + Bestätigung + Feedback, kein clear() vor Prüfung; „Zurücksetzen" löscht alle Stores; updatedAt/deletedAt für WaterLog/Photo (Dexie v5); createFood-Dedupe per Barcode/Name | — | Roundtrip erhält alle Stores (Test); defekte Datei bricht ohne Datenverlust ab; Migration idempotent |
| 5 | frontend-pwa | PWA-Update & Performance | onNeedRefresh-Update-Prompt; runtimeCaching für OFF; theme-color/Manifest ans vital-Theme; Legacy-Theme-Zeile (Dark-Flash) raus; Code-Splitting (702-kB-Chunk); tote Exporte entfernen | — | Update-Banner + Reload aktiviert neue SW; kein Chunk > 350 kB; kein Dark-Flash |
| 6 | designer | Design-Pass: Tokens, Kontrast, Icons, Motion | AA-Fixes (destructive/text-white dark, warning/success light, Streak-Flamme, Toggle); 12 unverdrahtete Tokens anschließen oder streichen; FAB-Glow, Radius-Skala, Schatten; einheitlicher focus-visible; Icon-Dedupe (Barcode, Droplet/Droplets); ein Spinner-Baustein; `MotionConfig reducedMotion="user"`; toter Ternary GlucoseCard | — | Alle Paare ≥ 4.5:1 (bzw. ≥ 3:1 Grafik); reduced-motion wirkt; genau eine Spinner-Komponente |
| 7 | frontend | Fehler- & Offline-UX + Barcode-Bugs | Offline-Erkennung + i18n-Texte; Fehlercode-Mapping auf Nutzertexte; Timeout + Response-Validierung in ai.ts; coach.error-Dev-Text ersetzen; Capture-Skeleton bei consent undefined; Barcode: Ladezustand + Weiter-Scannen nach Fehltreffer | 1, ideal nach 3 | Flugmodus zeigt verständliche Meldung; 429/413 zeigen deutschen Text; Barcode scannt weiter |
| 8 | frontend | Heute: Bearbeiten, Undo, Ziele, Performance | updateLog + Edit-UI; Löschen mit Undo; Coach-Ziele überleben updateProfile; gezielte Queries statt toArray() | 4 | Eintrag editier-/wiederherstellbar; Coach-Ziele überleben Profil-Speichern (Test) |
| 9 | frontend | Review: Portion, Presets, Lernschleife | unit='portion' darstellbar; Preset-Fehlbuchung beheben; Busy-State gegen Doppel-Tap; Empty-State mit Aktion + Zurück; KI-notes anzeigen; Katalog-Matching/Vorausfüllen; Spaltenlabels i18n | 4 | Portion korrekt gebucht (Test); Doppel-Tap = 1 Log; bekanntes Produkt vorausgefüllt |
| 10 | frontend | Gamification-Reparatur | Challenges anzeigen + auswerten, rule befüllen; Streak-Freeze konsumiert Tokens bei Lückentagen | 4 | Challenge sichtbar mit Fortschritt; Lückentag verbraucht Token, Streak bleibt (Test) |
| 11 | frontend | Coach-UX, Memory & Foto-Feedback | CoachMemory pflegen (diet ableiten, Ton wählbar); „Übernommen"-Status persistieren; „Eintragen" mit Mahlzeit-Wahl + Undo; Foto-Feedback-UI; aria-live für Chat; sessionStorage-Entscheidung umsetzen | 1, 2 | Vorschlag nach Reload „übernommen"; Coach kommentiert Foto; Ton wirkt |
| 12 | frontend | Erfassungs-Komfort & Onboarding | „Gestern kopieren", Favoriten, Katalog-Suche; UI-Einstieg mode:'portion'; Add-Undo; Capture-Kacheln über dem Formular; Onboarding-Validierung | 4 | Gestern-Kopie korrekt; Favorit in ≤ 2 Taps; ungültige Eingabe zeigt Fehler |
| 13 | frontend | Verlauf-Screen & Trends | Verlauf (§7.5): kcal/Makro-Historie + Wochen-Insights aus sumsByDate; Trends-Skeleton statt null; #f59e0b durch Token | 6 | Verlauf zeigt Tages-/Wochenwerte; kein Blank beim Laden; kein Hex im Chart |
| 14 | usability-a11y | A11y-Pass | aria-pressed auf g/ml-Toggles; CaptureSheet Fokus-Trap + Esc; maximum-scale entfernen | 6 | Sheet per Esc schließbar, Fokus gefangen; Pinch-Zoom möglich |
| 15 | usability-i18n | i18n-Konsolidierung | Hartkodierte Strings (Unbekanntes Produkt, ai/coach-Fallbacks, Kalorien, Theme-Labels, Katalognamen); add.soon entfernen; „Single-Locale DE" dokumentieren | nach 7–13 | Grep auf Literale außerhalb de.json leer; keine verwaisten Keys |
| 16 | frontend | Gamification-Ausbau (kürzbar) | Vorwochen-Vergleich, Quests, Per-Ziel-Streaks; Wrapped/Mystery/Level-Gating nur bei Budget — Umfang vorher mit Architekt trimmen | 10 | Abgestimmter Teilumfang sichtbar; Rest als dokumentierte Restliste |

> **Hotspot `repo.ts`:** Pakete 4, 8, 9, 10, 12 fassen `src/db/repo.ts` an — auf
> verschiedene Wellen verteilt; innerhalb einer Welle nie zwei davon parallel.

---

## 3) Wellenplan

- **Welle 1 (parallel):** 1 · **4 (P0)** · 5 · 6 — datei-disjunkt; P0 zuerst; Vertrag (1)
  ist Blocker für Backend + Fehler-UX; Design-Pass vor allen Screen-Paketen.
- **Welle 2 (parallel):** 2 · 7 · 8 · 14 — 2 und 7 setzen auf dem Vertrag auf; 8 braucht
  Migration aus 4; 14 nach dem Design-Pass.
- **Welle 3 (parallel):** 3 · 9 · 11 · 13 — Backend-Kette sequenziell (2 → 3); 9/11/13
  datei-disjunkt; repo.ts nur von 9 berührt.
- **Welle 4 (parallel):** 10 · 12 · 15 (zuletzt, querschnittlich) · optional 16.
- **Abnahme (architect):** Build + Lint + alle Tests grün (inkl. neuer Function- und
  Backup-Roundtrip-Tests), Geräte-Smoke-Test (Offline, SW-Update, Barcode-Fehltreffer),
  README/PLAN.md aktualisiert.
