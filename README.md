# NutritionTracker

Mobile-first PWA zum Tracken von Kalorien, Makros, Mineralstoffen & Vitaminen — mit
KI-gestützter Schätzung aus Fotos, einem KI-Ernährungscoach und Gamification.

> Detaillierter Projektplan: siehe [PLAN.md](./PLAN.md).
> Agent-Team für den Projektabschluss: siehe [docs/AGENT_TEAM.md](./docs/AGENT_TEAM.md).

## Tech-Stack

React + Vite + TypeScript · Tailwind CSS (Design-Tokens, Dark Mode) · vite-plugin-pwa ·
Dexie.js (IndexedDB, local-first) · Framer Motion · i18next · React Router · lucide-react.

## Entwicklung

```bash
npm install      # Abhängigkeiten installieren
npm run dev      # Dev-Server (http://localhost:5173)
npm run build    # Type-Check + Production-Build
npm run preview  # Production-Build lokal ansehen
npm run test     # Vitest
npm run lint     # ESLint
```

## Projektstruktur

```
src/
  components/    UI-Bausteine (Tab-Bar, Layout, ProgressRing, UpdatePrompt, ui/*)
  db/            Dexie-Schema (index.ts, versionierte Migrationen) + Typen (types.ts)
  i18n/          i18next-Setup + Sprachdateien (locales/de.json, Single-Locale DE)
  lib/           Domänenlogik (Nutrition, Gamification, Coach, Backup, API-Vertrag …)
  pages/         Today, Add, Capture, Review, Barcode, Trends, Coach, Awards, Profile, Onboarding
netlify/
  functions/     analyze.mts, coach.mts (OpenRouter-Proxy) + lib/ (guard, Verträge, Tests)
```

## Status

Roadmap-Phasen 0–4 aus [PLAN.md](./PLAN.md) sind umgesetzt (Phase 5 Cloud-Sync folgt später):

- **Erfassung:** Foto (Essen & Nährwert-Tabelle), Barcode-Scan mit Open-Food-Facts-Lookup,
  manuelles Loggen mit Katalog, Favoriten & „Gestern kopieren"
- **Review mit Lernschleife:** Prüf-Screen für KI-Ergebnisse, Mengen-Presets (inkl. Portionen),
  Katalog-Matching und Korrektur-Lernen
- **Verlauf & Insights:** Tages-/Wochen-Historie, Trends, Nährstoff-Defizit-Ansicht, Wasser-Tracking
- **Gamification:** Streaks mit Streak-Freeze, Badges, Punkte/Level, Challenges, Feier-Animationen,
  freischaltbare Themes
- **KI-Coach:** Chat mit Streaming, wählbarer Ton, Foto-Feedback, Ziel-/Challenge-/Log-Vorschläge
  mit Bestätigung, Sprach-Ein-/Ausgabe (Web Speech API)
- **PWA:** offline-first (Dexie/IndexedDB), Update-Prompt, Offline-UX, Backup-Export/-Import
- **Functions gehärtet:** Origin-Check, Body-Limit, Rate-Limit, Tagesbudget, stabiler Fehler-Vertrag
  (gemeinsame zod-Schemata Client/Server)

Bewusst zurückgestellte Punkte: siehe PLAN.md §12 und [docs/ABSCHLUSSPLAN.md](./docs/ABSCHLUSSPLAN.md)
(Restliste).
