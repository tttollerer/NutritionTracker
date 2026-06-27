# NutritionTracker — Projektplan

> Mobile-first PWA zum Tracken von Kalorien, Makros & Mineralstoffen — mit KI-gestützter
> Schätzung der Nährwerte aus Fotos/Videos vom Essen oder aus abfotografierten Nährwerttabellen.

Status: **Planung** · Branch: `claude/nutrition-tracker-pwa-plan-xfeqbj` · Stand: 2026-06-27

---

## 1. Ziel & Kernidee

Eine schnelle, schön aussehende Handy-App (PWA, installierbar), mit der man Essen erfasst und
seine tägliche Nährstoffzufuhr verfolgt. Das Erfassen soll möglichst wenig Tipparbeit kosten:

1. **Foto/Video vom Essen** → KI schätzt Lebensmittel + Nährstoffe.
2. **Foto der Nährwerttabelle** → KI liest die Werte aus (OCR/Vision).
3. **Menge angeben** — per Text („halbe Portion", „200 g") oder per Foto schätzen lassen.
4. Ergebnis landet im Tracking: Kalorien, Makros (Eiweiß/Fett/Kohlenhydrate), Mineralstoffe & Vitamine.
5. **Barcode-Scan** (optional, Bonus) → Produktdaten aus Open Food Facts.

## 2. Leitentscheidungen (bereits getroffen)

| Thema | Entscheidung | Konsequenz |
|---|---|---|
| Daten | **Local-first**, Cloud-Sync später | MVP läuft offline im Handy (IndexedDB). Sync/Login als spätere Phase. |
| KI | **OpenRouter** als Gateway | Modell-agnostisch (Claude/GPT/Gemini-Vision austauschbar über eine API). |
| Plan-Tiefe | Detaillierter Plan im Repo, noch kein App-Code | Dieses Dokument. |

## 3. Tech-Stack

| Bereich | Wahl | Begründung |
|---|---|---|
| Sprache | **TypeScript** | Typsicherheit, weniger Bugs |
| Build/Framework | **React + Vite** | Schnellste Dev-Erfahrung, riesiges Ökosystem |
| PWA | **`vite-plugin-pwa`** (Workbox) | Installierbar, Offline-fähig, „Add to Home Screen" |
| UI / Styling | **Tailwind CSS + shadcn/ui** | Schnell moderne, mobile UIs; sieht gut aus |
| Icons | **lucide-react** | Passt zu shadcn, leichtgewichtig |
| Lokale DB | **Dexie.js** (IndexedDB) | Offline-Speicher direkt im Handy, einfache API |
| State/Data | **TanStack Query** + Dexie live queries | Caching, reaktive Listen |
| Formulare | **react-hook-form + zod** | Validierung, wenig Boilerplate |
| Charts | **Recharts** | Tagesverlauf, Fortschrittsringe |
| KI-Proxy | **Netlify Function** | Versteckt den OpenRouter-API-Key (nie im Client!) |
| Hosting | **Netlify** | PWA in Minuten deployen, Functions inklusive |
| Produktdaten | **Open Food Facts API** | Barcode → Nährwerte, kostenlos |
| Sync (später) | **Supabase** (Postgres + Auth) | DB, Login, Geräte-Sync |

### Warum eine Server-Funktion trotz „local-first"?
Der OpenRouter-API-Key darf **niemals** in die App eingebettet werden — sonst kann ihn jeder
auslesen und auf unsere Kosten nutzen. Deshalb läuft genau **ein** kleiner serverloser Endpunkt
(`/.netlify/functions/analyze`), der das Bild entgegennimmt, an OpenRouter weiterreicht und das
strukturierte Ergebnis (JSON) zurückgibt. Alle Nutzdaten bleiben lokal im Handy.

## 4. Architektur (MVP)

```
┌──────────────────────── Handy (PWA, installiert) ────────────────────────┐
│  React + Vite UI (Tailwind/shadcn)                                        │
│    │                                                                      │
│    ├── Dexie.js  ──►  IndexedDB   (Mahlzeiten, Tageswerte, Lebensmittel)  │
│    │                                                                      │
│    └── fetch ─────────────────────────────┐                              │
└───────────────────────────────────────────┼──────────────────────────────┘
                                             ▼
                         Netlify Function  /analyze   (Key sicher serverseitig)
                                             │
                                             ▼
                                   OpenRouter  (Vision-Modell)
                                             │
                                  ◄── strukturiertes JSON ──
                                  { items:[{name, menge, kcal, protein, ... }] }
```

Optional parallel: Client → **Open Food Facts** (Barcode-Lookup, kein Key nötig, direkt aus dem Client möglich).

## 5. Datenmodell (lokal, Dexie/IndexedDB)

```ts
// Ein Lebensmittel-Eintrag im persönlichen „Katalog" (wiederverwendbar)
FoodItem {
  id: string
  name: string
  source: 'ai' | 'openfoodfacts' | 'manual'
  barcode?: string
  // Nährwerte je 100 g / 100 ml (Referenzbasis)
  per: 'g' | 'ml'
  kcal: number
  protein: number; carbs: number; fat: number; fiber?: number; sugar?: number
  // Mineralstoffe & Vitamine (mg/µg je 100 g), optional & erweiterbar
  micros?: Record<string, number>   // z.B. { sodium: 0.4, calcium: 120, iron: 2.1, vitaminC: 30 }
  createdAt: number
}

// Eine konkret gegessene Portion (Logbuch-Eintrag)
LogEntry {
  id: string
  foodId: string            // Referenz auf FoodItem
  date: string              // 'YYYY-MM-DD' (lokaler Tag)
  loggedAt: number
  amount: number            // tatsächlich gegessene Menge
  unit: 'g' | 'ml' | 'portion'
  // Snapshot der berechneten Werte für diesen Eintrag (damit Historie stabil bleibt)
  computed: { kcal, protein, carbs, fat, micros }
  photoBlobId?: string      // optional: Original-Foto lokal gespeichert
  aiRaw?: object            // optional: Roh-Antwort der KI zur Nachvollziehbarkeit
}

// Tagesziele des Nutzers
Goals {
  id: 'default'
  kcal: number; protein: number; carbs: number; fat: number
  micros?: Record<string, number>
}
```

## 6. KI-Flow (OpenRouter via Netlify Function)

**Endpoint:** `POST /.netlify/functions/analyze`

**Modi:**
- `mode: 'meal'` — Foto/Video-Frame vom Essen → Liste erkannter Lebensmittel + geschätzte Mengen + Nährwerte.
- `mode: 'label'` — Foto einer Nährwerttabelle → exakte Werte auslesen (per 100 g + Portionsgröße).
- `mode: 'portion'` — Foto zur reinen Mengenschätzung eines bekannten Lebensmittels.

**Request:** `{ mode, imageBase64, hint?: string }`
**Response:** strukturiertes, mit zod validiertes JSON:
```json
{
  "items": [
    { "name": "Haferflocken", "amount": 60, "unit": "g", "confidence": 0.7,
      "per100": { "kcal": 370, "protein": 13, "carbs": 60, "fat": 7 } }
  ],
  "notes": "Menge anhand Schüsselgröße geschätzt"
}
```

Wichtig: Wir zwingen das Modell per **Structured Output / JSON-Schema** zu sauberem JSON und
validieren serverseitig mit `zod`, bevor es zum Client geht. Das Modell ist über eine ENV-Variable
(`OPENROUTER_MODEL`) austauschbar.

**Secrets (nur in Netlify-Env, nie im Repo):** `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`.

## 7. Screens / UX (mobile-first)

1. **Heute (Dashboard)** — Kalorien-Ring + Makro-Balken, Liste der heutigen Einträge, großer „+"-Button.
2. **Erfassen** — Auswahl: 📷 Essen fotografieren · 🏷️ Tabelle scannen · ⌨️ manuell · 📦 Barcode.
3. **KI-Ergebnis prüfen** — erkannte Items editierbar (Name/Menge korrigieren), dann „Übernehmen".
4. **Verlauf** — Tage/Wochen, Trends (Recharts).
5. **Ziele & Einstellungen** — Tagesziele, Einheiten, (später) Login/Sync.

Navigation: untere Tab-Bar (Daumen-freundlich), große Touch-Targets, Bottom-Sheets statt Modals.

## 8. Roadmap (Phasen)

**Phase 0 — Setup**
- Vite + React + TS, Tailwind + shadcn/ui, ESLint/Prettier
- `vite-plugin-pwa` (Manifest, Icons, Offline-Cache)
- Dexie-Schema + Seed-Daten

**Phase 1 — Manuelles Tracking (ohne KI)**
- Dashboard „Heute", manuelles Erfassen, Tagesziele, Verlauf
- Komplett offline nutzbar → erster echter Mehrwert

**Phase 2 — KI-Erfassung**
- Netlify Function `analyze` + OpenRouter-Anbindung (zod-Schema)
- Kamera-Capture im Client, Modus „Essen" & „Tabelle scannen"
- Ergebnis-Prüf-Screen

**Phase 3 — Komfort**
- Barcode-Scan (Open Food Facts), Mengenschätzung per Foto
- Favoriten / häufige Lebensmittel, schnelles Wiederholen

**Phase 4 — Cloud-Sync (später)**
- Supabase (Auth + Postgres), Sync-Layer über Dexie, Multi-Device, Backup

## 9. Offene Punkte / später zu entscheiden

- Genauer Umfang der Mineralstoff-/Vitaminliste (Start: gängige ~10, erweiterbar).
- Video-Handling: vorerst Einzelframe extrahieren (einfacher & billiger als ganzes Video).
- Kosten-/Rate-Limit-Schutz der KI-Funktion (z. B. simple Begrenzung pro Tag).
- Datenschutz: Fotos bleiben standardmäßig lokal; KI-Aufruf nur auf Knopfdruck.

## 10. Nächste Schritte

1. Diesen Plan abnehmen.
2. Phase 0 umsetzen (Projekt-Grundgerüst + PWA + Dexie).
3. Phase 1: Manuelles Tracking lauffähig machen → früh auf dem Handy testen.
