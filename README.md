# NutritionTracker

Mobile-first PWA zum Tracken von Kalorien, Makros, Mineralstoffen & Vitaminen — mit
KI-gestützter Schätzung aus Fotos, einem KI-Ernährungscoach und Gamification.

> Detaillierter Projektplan: siehe [PLAN.md](./PLAN.md).

## Tech-Stack (Phase 0)

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
  components/    UI-Bausteine (Tab-Bar, Layout, ProgressRing, ui/*)
  db/            Dexie-Schema (index.ts) + Typen (types.ts)
  i18n/          i18next-Setup + Sprachdateien (locales/de.json)
  lib/           Helfer (utils, storage)
  pages/         Today, Add, Coach, Awards, Profile
```

## Status

Phase 0 (Grundgerüst) steht: App-Shell mit Tab-Bar & Seiten-Animationen, Design-System,
PWA-Setup, versioniertes Dexie-Schema, i18n. Die Inhalte der einzelnen Phasen folgen
gemäß Roadmap in [PLAN.md](./PLAN.md).
