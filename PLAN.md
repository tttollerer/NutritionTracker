# NutritionTracker — Projektplan

> Mobile-first PWA zum Tracken von Kalorien, Makros & Mineralstoffen — mit KI-gestützter
> Schätzung der Nährwerte aus Fotos/Videos vom Essen oder aus abfotografierten Nährwerttabellen.

Status: **Planung** · Branch: `claude/nutrition-tracker-pwa-plan-xfeqbj` · Stand: 2026-06-27

---

## 1. Ziel & Kernidee

Eine schnelle, schön aussehende Handy-App (PWA, installierbar), mit der man Essen erfasst und
seine tägliche Nährstoffzufuhr verfolgt. Das Erfassen soll möglichst wenig Tipparbeit kosten:

1. **Foto/Video vom Essen** → KI **erkennt** Lebensmittel + schätzt Menge.
2. **Foto der Nährwerttabelle** → KI liest die Werte aus (OCR/Vision).
3. **Menge angeben** — per Text, per Preset (¼/½/1/1,5/2 · S/M/L) oder per Foto schätzen lassen.
4. Ergebnis landet im Tracking: Kalorien, Makros (Eiweiß/Fett/Kohlenhydrate), Mineralstoffe & Vitamine.
5. **Barcode-Scan** für verpackte Produkte → exakte Daten aus Open Food Facts.

**Differenzierer:** Fokus auf **Mineralstoffe & Vitamine** mit einer Defizit-Ansicht — das bieten
gängige Kalorienzähler kaum.

## 2. Leitentscheidungen

| Thema | Entscheidung | Konsequenz |
|---|---|---|
| Daten | **Local-first**, Cloud-Sync später | MVP läuft offline im Handy (IndexedDB). Sync/Login als spätere Phase — Modell aber **von Anfang an sync-fähig** (UUIDs, `updatedAt`, `deletedAt`). |
| KI-Rolle | **KI erkennt, Datenbank rechnet** | Sprachmodelle raten Mikronährstoffe unzuverlässig. KI macht nur Erkennung + Mengenschätzung; echte Nährwerte kommen aus einer vertrauenswürdigen DB (USDA / Open Food Facts). Ausnahme: Foto der Nährwerttabelle (OCR liefert Zahlen direkt). |
| KI-Gateway | **OpenRouter** | Modell-agnostisch (Claude/GPT/Gemini-Vision austauschbar über eine API). |
| Datensicherheit | **Export/Import + persistenter Speicher ab Phase 1** | IndexedDB kann (v. a. iOS) gelöscht werden → Backup-Netz schon vor Cloud-Sync. |

## 3. Tech-Stack

| Bereich | Wahl | Begründung |
|---|---|---|
| Sprache | **TypeScript** | Typsicherheit, weniger Bugs |
| Build/Framework | **React + Vite** | Schnellste Dev-Erfahrung, riesiges Ökosystem |
| PWA | **`vite-plugin-pwa`** (Workbox) | Installierbar, Offline-fähig, „Add to Home Screen", Update-Prompt |
| UI / Styling | **Tailwind CSS + shadcn/ui** | Schnell moderne, mobile UIs; sieht gut aus |
| Icons | **lucide-react** | Passt zu shadcn, leichtgewichtig |
| Lokale DB | **Dexie.js** (IndexedDB) | Offline-Speicher direkt im Handy, einfache API |
| Reaktive Daten | **`dexie-react-hooks` (`useLiveQuery`)** | Idiomatisch für lokale DB, weniger Abhängigkeiten als TanStack Query (das kommt erst mit der Cloud) |
| Formulare | **react-hook-form + zod** | Validierung, wenig Boilerplate |
| Charts | **Recharts** | Tagesverlauf, Fortschrittsringe |
| Bild-Verkleinerung | **Canvas (client-seitig)** | Fotos vor KI-Upload auf ~1024 px / JPEG q0.7 → schneller, billiger, weniger Datenvolumen |
| Barcode-Scan | **`@zxing/browser`** | Barcode → Produktsuche, on-device |
| KI-Proxy | **Netlify Function** | Versteckt den OpenRouter-API-Key (nie im Client!), mit Rate-Limit & Tagesbudget |
| Hosting | **Netlify** | PWA in Minuten deployen, Functions inklusive |
| Nährwert-DB | **USDA FoodData Central** + **Open Food Facts** | Vertrauenswürdige Zahlen, gut bei Mikronährstoffen, kostenlos |
| Sync (später) | **Supabase** (Postgres + Auth) | DB, Login, Geräte-Sync (Last-Write-Wins) |

### Warum eine Server-Funktion trotz „local-first"?
Der OpenRouter-API-Key darf **niemals** in die App eingebettet werden — sonst kann ihn jeder
auslesen und auf unsere Kosten nutzen. Deshalb läuft genau **ein** kleiner serverloser Endpunkt
(`/.netlify/functions/analyze`), der das Bild entgegennimmt, an OpenRouter weiterreicht und das
strukturierte Ergebnis (JSON) zurückgibt. Alle Nutzdaten bleiben lokal im Handy.

**Schutz des Endpunkts (ohne Login):** Request-Größenlimit, einfaches Rate-Limit, harte
**Tagesbudget-Grenze** bei OpenRouter, Origin-Check.

## 4. Architektur (MVP)

```
┌──────────────────────── Handy (PWA, installiert) ────────────────────────┐
│  React + Vite UI (Tailwind/shadcn)                                        │
│    │                                                                      │
│    ├── Dexie.js  ──►  IndexedDB   (Mahlzeiten, Tageswerte, Lebensmittel)  │
│    │        ▲                                                             │
│    │        └── Export/Import (JSON-Backup) · navigator.storage.persist() │
│    │                                                                      │
│    ├── Bild verkleinern (Canvas) ─► fetch ──┐                            │
│    └── Barcode (ZXing) ─► Open Food Facts    │ (direkt, kein Key nötig)  │
└──────────────────────────────────────────────┼───────────────────────────┘
                                                ▼
                          Netlify Function  /analyze   (Key + Budget serverseitig)
                                                │
                                                ▼
                                      OpenRouter  (Vision-Modell)
                                                │
                                     ◄── JSON: Erkennung + Mengen ──
                                                │
                          Nährwerte-Lookup (USDA / Open Food Facts) ──► berechnete Werte
```

## 5. Datenmodell (lokal, Dexie/IndexedDB)

> **Sync-fähig von Anfang an:** alle IDs sind client-generierte **UUIDs**; jeder Datensatz hat
> `updatedAt` und optional `deletedAt` (Soft-Delete) für späteren Last-Write-Wins-Sync.

```ts
// Ein Lebensmittel-Eintrag im persönlichen „Katalog" (wiederverwendbar)
FoodItem {
  id: string                // UUID
  name: string
  source: 'ai' | 'openfoodfacts' | 'usda' | 'manual'
  barcode?: string
  per: 'g' | 'ml'           // Referenzbasis: Nährwerte je 100 g / 100 ml
  kcal: number
  protein: number; carbs: number; fat: number; fiber?: number; sugar?: number
  micros?: Record<string, number>   // z.B. { sodium, calcium, iron, magnesium, vitaminC, vitaminD }
  defaultPortion?: { amount: number; unit: 'g'|'ml'|'portion' }  // gemerkte übliche Menge
  createdAt: number; updatedAt: number; deletedAt?: number
}

// Eine konkret gegessene Portion (Logbuch-Eintrag)
LogEntry {
  id: string                // UUID
  foodId: string
  date: string              // 'YYYY-MM-DD' (lokaler Tag)
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  loggedAt: number
  amount: number; unit: 'g' | 'ml' | 'portion'
  computed: { kcal, protein, carbs, fat, micros }   // Snapshot → stabile Historie
  photoBlobId?: string      // optional: Original-Foto lokal
  aiRaw?: object            // optional: Roh-Antwort zur Nachvollziehbarkeit
  updatedAt: number; deletedAt?: number
}

// Tagesziele (berechnet aus Profil oder manuell)
Goals {
  id: 'default'
  kcal: number; protein: number; carbs: number; fat: number
  micros?: Record<string, number>
  updatedAt: number
}

// Nutzerprofil für die Zielberechnung (Mifflin-St-Jeor)
Profile {
  id: 'me'
  sex: 'm' | 'f'; age: number; heightCm: number; weightKg: number
  activity: 'low' | 'medium' | 'high'
  goal: 'lose' | 'maintain' | 'gain'
  updatedAt: number
}
```

Dexie-Schemata werden **versioniert** (Migrationen von Anfang an mitgeplant). Wasser-Tracking
kommt als eigene kleine Tabelle (`WaterLog`) dazu.

## 6. KI-Flow (OpenRouter via Netlify Function)

**Endpoint:** `POST /.netlify/functions/analyze`

**Modi:**
- `mode: 'meal'` — Foto/Video-Frame vom Essen → **erkannte Lebensmittel + geschätzte Mengen** (keine Nährwerte aus der KI; die kommen aus der DB).
- `mode: 'label'` — Foto einer Nährwerttabelle → Werte auslesen (per 100 g + Portionsgröße). Hier liefert die KI Zahlen direkt (OCR).
- `mode: 'portion'` — Foto zur reinen Mengenschätzung eines bekannten Lebensmittels.

**Client-Vorverarbeitung:** Bild auf ~1024 px / JPEG q0.7 verkleinern, dann als Base64 senden.

**Request:** `{ mode, imageBase64, hint?: string }`
**Response (meal):** strukturiertes, mit `zod` validiertes JSON:
```json
{
  "items": [
    { "name": "Haferflocken", "amount": 60, "unit": "g", "confidence": 0.7 }
  ],
  "notes": "Menge anhand Schüsselgröße geschätzt"
}
```
Danach **Nährwert-Lookup** (USDA/Open Food Facts) pro Item → berechnete Werte.

**Robustheit:** günstiges vision-fähiges Modell mit JSON-Mode (z. B. Gemini Flash / Claude Haiku),
**Structured Output / JSON-Schema**, Retry bei kaputtem JSON, serverseitige `zod`-Validierung.
Modell per ENV austauschbar.

**Lernschleife:** Korrigiert der Nutzer eine KI-Schätzung, wird das Ergebnis im persönlichen
Katalog gespeichert (inkl. üblicher Portion) → beim nächsten Mal vorausgefüllt.

**Secrets (nur in Netlify-Env, nie im Repo):** `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`,
`USDA_API_KEY`.

## 7. Screens / UX (mobile-first)

1. **Heute (Dashboard)** — Kalorien-Ring + Makro-Balken, Einträge nach **Mahlzeit gruppiert**
   (Frühstück/Mittag/Abend/Snack), großer „+"-Button. Wasser-Tracker. Streak-Anzeige.
2. **Erfassen** — 📷 Essen fotografieren · 🏷️ Tabelle scannen · 📦 **Barcode** · ⌨️ manuell.
   Oben **Favoriten / „zuletzt gegessen"** für 1-Tap-Wiederholung, „Gestern kopieren".
3. **KI-Ergebnis prüfen** — erkannte Items einzeln editierbar (Name/Menge), **Confidence sichtbar**,
   Mengen-**Presets + Slider**, dann „Übernehmen".
4. **Nährstoff-Detail** — Mikronährstoffe des Tages, **Defizite hervorgehoben** („zu wenig: Eisen, Vit. D").
5. **Verlauf** — Tage/Wochen, Trends (Recharts), Wochen-Insights („Protein-Ziel 5/7 Tagen").
6. **Profil & Ziele** — Onboarding mit **automatischer Zielberechnung** (Mifflin-St-Jeor),
   Einheiten, **Backup-Export/Import**, Dark Mode, (später) Login/Sync.

**Bedienprinzipien:** untere Tab-Bar (daumenfreundlich), große Touch-Targets, Bottom-Sheets statt
Modals, Dark Mode, klare Empty States, schnelle manuelle Suche als Fallback, jeder Eintrag leicht
editier-/löschbar. **Datenschutz sichtbar:** „Deine Fotos bleiben auf dem Handy — KI-Upload nur auf Knopfdruck."

## 8. Roadmap (Phasen)

**Phase 0 — Setup**
- Vite + React + TS, Tailwind + shadcn/ui, ESLint/Prettier, Vitest
- `vite-plugin-pwa` (Manifest, Icons, Offline-Cache, Update-Prompt)
- Dexie-Schema (versioniert) + Seed-Daten + `navigator.storage.persist()`

**Phase 1 — Manuelles Tracking (ohne KI), voll offline**
- Dashboard „Heute" (Mahlzeiten-Gruppen, Ringe), manuelles Erfassen, Profil + Zielberechnung
- Persönlicher Katalog, Favoriten/„zuletzt", Verlauf
- **Backup-Export/Import (JSON)** — erstes Sicherheitsnetz

**Phase 2 — Erfassung beschleunigen**
- Netlify Function `analyze` + OpenRouter (zod-Schema, Retry, Budget-/Rate-Limit)
- Kamera-Capture + Bild-Verkleinerung, Modi „Essen" & „Tabelle scannen"
- **Barcode-Scan** (ZXing + Open Food Facts) — für verpackte Produkte vorgezogen
- Nährwert-Lookup (USDA/Open Food Facts), Ergebnis-Prüf-Screen, Lernschleife

**Phase 3 — Komfort & Motivation**
- Mengenschätzung per Foto, Mengen-Presets/Slider
- Nährstoff-Defizit-Ansicht, Wasser-Tracking, Streaks & Wochen-Insights

**Phase 4 — Cloud-Sync (später)**
- Supabase (Auth + Postgres), Last-Write-Wins-Sync über `updatedAt`/`deletedAt`, Multi-Device, Backup

## 9. Offene Punkte / später zu entscheiden

- Genauer Umfang der Mineralstoff-/Vitaminliste (Start: gängige ~10, erweiterbar).
- Video-Handling: vorerst Einzelframe extrahieren (einfacher & billiger als ganzes Video).
- USDA vs. Open Food Facts als Primärquelle pro Lebensmittelart (Markenprodukte → OFF, Rohzutaten → USDA).
- iOS-PWA-Grenzen: eingeschränkte Push-Notifications/Background-Sync, HTTPS-Pflicht für Kamera.

## 10. Nächste Schritte

1. Diesen Plan abnehmen.
2. Phase 0 umsetzen (Projekt-Grundgerüst + PWA + versioniertes Dexie-Schema).
3. Phase 1: Manuelles Tracking + Backup lauffähig machen → früh auf dem Handy testen.
