# NutritionTracker — Projektplan

> Mobile-first PWA zum Tracken von Kalorien, Makros & Mineralstoffen — mit KI-gestützter
> Schätzung der Nährwerte aus Fotos vom Essen oder aus abfotografierten Nährwerttabellen.

Status: **Planung** · Branch: `claude/nutrition-tracker-pwa-plan-xfeqbj` · Stand: 2026-06-27

---

## 1. Ziel & Kernidee

Eine schnelle, schön aussehende Handy-App (PWA, installierbar), mit der man Essen erfasst und
seine tägliche Nährstoffzufuhr verfolgt. Das Erfassen soll möglichst wenig Tipparbeit kosten:

1. **Foto vom Essen** → KI **erkennt** Lebensmittel + schätzt Menge.
2. **Foto der Nährwerttabelle** → KI liest die Werte aus (OCR/Vision).
3. **Menge angeben** — per Text, per Preset (¼/½/1/1,5/2 · S/M/L) oder per Foto schätzen lassen.
4. Ergebnis landet im Tracking: Kalorien, Makros (Eiweiß/Fett/Kohlenhydrate), Mineralstoffe & Vitamine.
5. **Barcode-Scan** für verpackte Produkte → exakte Daten aus Open Food Facts.

**Differenzierer:** Fokus auf **Mineralstoffe & Vitamine** mit einer Defizit-Ansicht — und konsequente
**Anpassung an die Zielgruppe** (Sportler, Bodybuilding, Ab-/Zunehmen, vegan, Low Carb/Keto, Allergien),
über die ein spezialisierter KI-Coach berät. Das bieten gängige Kalorienzähler kaum.

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
| Icons | **lucide-react** | Große, konsistente Icon-Library — trägt die icon-first UI |
| Animationen | **Framer Motion** | Mikroanimationen, Transitions, Gesten — flüssige Userführung |
| Ladezustände | **shadcn Skeleton + Framer Motion** | Skeleton-Screens statt Spinner, überall konsistent |
| Mehrsprachigkeit | **i18next + react-i18next** | i18n von Anfang an verdrahtet (Texte ausgelagert, Sprache später erweiterbar) |
| Lokale DB | **Dexie.js** (IndexedDB) | Offline-Speicher direkt im Handy, einfache API |
| Reaktive Daten | **`dexie-react-hooks` (`useLiveQuery`)** | Idiomatisch für lokale DB, weniger Abhängigkeiten als TanStack Query (das kommt erst mit der Cloud) |
| Formulare | **react-hook-form + zod** | Validierung, wenig Boilerplate |
| Charts | **Recharts** | Tagesverlauf, Fortschrittsringe |
| Feier-Effekte | **canvas-confetti** | Konfetti bei Zielerreichung/Badge-Unlock |
| Sprache (MVP) | **Web Speech API** (`SpeechRecognition` + `SpeechSynthesis`) | On-device STT/TTS fürs Coach-Gespräch, kostenlos & privat |
| Sprache (Fallback) | **Server-STT/TTS via Netlify Function** | Qualität/Browser-Kompatibilität, wenn Web Speech API fehlt |
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

// Nutzerprofil für Zielberechnung (Mifflin-St-Jeor) + Zielgruppen-Anpassung
Profile {
  id: 'me'
  sex: 'm' | 'f'; age: number; heightCm: number; weightKg: number
  activity: 'low' | 'medium' | 'high'
  goal: 'lose' | 'maintain' | 'gain'
  persona: 'strength' | 'endurance' | 'weightloss' | 'weightgain' | 'general'
  dietForms: string[]   // z.B. ['vegan','lowcarb','glutenfree'] — kombinierbar
  updatedAt: number
}
```

```ts
// Regelbasiertes Ziel (deckt kcal, Makros und jeden Mikronährstoff ab)
Goal {
  id: string                // UUID
  nutrient: string          // 'kcal' | 'protein' | 'vitaminC' | 'iron' | ...
  type: 'min' | 'max' | 'range'
  target: number; targetMax?: number   // targetMax nur bei 'range'
  unit: string              // 'kcal' | 'g' | 'mg' | 'µg' | '%RDA'
  active: boolean
  createdBy: 'user' | 'coach'
  updatedAt: number; deletedAt?: number
}

// Freigeschalteter Erfolg / Badge
Achievement {
  id: string                // UUID
  key: string               // 'protein_7d' | 'vitaminC_week' | 'logged_30d' | 'first_ai_scan' ...
  unlockedAt: number
}

// Challenge (oft vom Coach vorgeschlagen, vom Nutzer bestätigt)
Challenge {
  id: string                // UUID
  title: string             // i18n-Key
  rule: object              // wie Goal, plus Zeitraum
  period: 'day' | 'week'
  status: 'suggested' | 'active' | 'done' | 'failed'
  createdBy: 'user' | 'coach'
  updatedAt: number
}

// Spielstand: Punkte, Level, Streaks, Belohnungen, Begleiter
GamificationState {
  id: 'me'
  points: number; level: number
  streaks: Record<string, number>   // pro Ziel + 'overall'
  freezeTokens: number              // Streak-Joker
  unlocked: string[]                // freigeschaltete Themes/Stimmen/Icons/Badge-Designs
  companion?: { type: string; stage: number; mood: 'happy'|'ok'|'sad' }  // virtueller Begleiter
  updatedAt: number
}

// Langzeit-Gedächtnis des Coaches (Personalisierung)
CoachMemory {
  id: 'me'
  diet?: string                     // 'vegan' | 'keto' | 'vegetarian' | ...
  allergies: string[]; dislikes: string[]; likes: string[]
  tone: 'motivating' | 'casual' | 'strict'
  notes?: string                    // freie, vom Coach gepflegte Merkpunkte
  updatedAt: number
}
```

Dexie-Schemata werden **versioniert** (Migrationen von Anfang an mitgeplant). Wasser-Tracking
kommt als eigene kleine Tabelle (`WaterLog`) dazu.

## 6. KI-Flow (OpenRouter via Netlify Function)

**Endpoint:** `POST /.netlify/functions/analyze`

**Modi:**
- `mode: 'meal'` — Foto vom Essen → **erkannte Lebensmittel + geschätzte Mengen** (keine Nährwerte aus der KI; die kommen aus der DB).
- `mode: 'label'` — Foto einer Nährwerttabelle → Werte auslesen (per 100 g + Portionsgröße). Hier liefert die KI Zahlen direkt (OCR).
- `mode: 'portion'` — Foto zur reinen Mengenschätzung eines bekannten Lebensmittels.
- `mode: 'coach'` — Dialog mit Kontext (aggregierte Zusammenfassung + Gesprächsverlauf + `CoachMemory`).
  **Optional mit Bild(ern)** (geloggtes/aufgenommenes Foto) für Foto-Feedback. Gibt Beratung sowie
  Ziel-/Challenge-/Log-Vorschläge als strukturiertes JSON zurück (brauchen Nutzer-Bestätigung).

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
6. **Erfolge & Coach** — Badges/Level/Streaks, **virtueller Begleiter**, aktive Quests/Challenges,
   freischaltbare Belohnungen; **KI-Coach** als Chat **und Sprachgespräch**, mit Foto-Feedback
   (Ziel-/Challenge-/Log-Vorschläge mit Bestätigung).
7. **Profil & Ziele** — Onboarding mit **Persona-, Ernährungsform- & Allergie-Auswahl**, daraus
   **Ziel-Vorlagen** + **automatische Zielberechnung** (Mifflin-St-Jeor), regelbasierte Ziele
   (min/max/Korridor pro Nährstoff), Einheiten, **Backup-Export/Import**, Dark Mode, (später) Login/Sync.

**Bedienprinzipien:** untere Tab-Bar (daumenfreundlich), große Touch-Targets, Bottom-Sheets statt
Modals, Dark Mode, klare Empty States, schnelle manuelle Suche als Fallback, jeder Eintrag leicht
editier-/löschbar. **Datenschutz sichtbar:** „Deine Fotos bleiben auf dem Handy — KI-Upload nur auf Knopfdruck."

## 8. Design-Prinzipien & Interaktion

Leitbild: **modern, poppig, sofort vertraut.** Der Nutzer findet sich ohne Erklärung zurecht, weil
wir bekannte Best-Practice-Patterns nutzen — und weil die App über Icons und Bewegung führt statt über Text.

**Icon-first & textarm (mehrsprachig-ready)**
- Vorrang für **aussagekräftige Icons** (lucide), Text nur als knappe Ergänzung/Label.
- Alle Texte über **i18next** ausgelagert (keine hartkodierten Strings) → spätere Sprachen ohne Umbau.
- Wo Text nötig ist: kurz, eindeutig; wichtige Aktionen zusätzlich farb-/icon-codiert.

**Große, touch-freundliche Bedienung**
- Touch-Targets **≥ 48 px**, großzügige Abstände, primäre Aktionen im **Daumenbereich** (unten).
- Untere Tab-Bar + großer Floating-„+"-Button als zentrale Aktion; **Bottom-Sheets** statt Modals.
- Einhand-Bedienung als Grundannahme.

**Mikroanimationen zur Userführung** (Framer Motion)
- Jede Aktion gibt **sofortiges Feedback**: Button-Press (Scale/Tap), Haken-Animation bei Erfolg,
  sanftes Shake bei Fehler.
- **Sinnstiftende Transitions**: Screens gleiten/faden so, dass die Navigationsrichtung klar ist;
  Bottom-Sheets sliden hoch; Listen-Items animieren beim Hinzufügen/Löschen.
- Fortschritts-Ringe & Balken **füllen sich animiert** → Veränderung wird spürbar.
- Animationen kurz (~150–300 ms), nie blockierend; `prefers-reduced-motion` respektieren.

**Immer klare Ladezustände**
- **Skeleton-Screens** statt leerer Bildschirme/Spinner, überall konsistent.
- KI-Analyse zeigt einen eigenen „Analysiere…"-Zustand mit Animation (kann mehrere Sekunden dauern).
- Optimistische UI wo möglich (Eintrag erscheint sofort, Berechnung läuft im Hintergrund).

**Modern & poppig**
- Kräftige Akzentfarbe + freundliche Sekundärfarben, sauberes Farbsystem über Design-Tokens.
- Abgerundete Ecken, weiche Schatten, großzügige Typografie-Hierarchie.
- **Dark Mode** gleichwertig gestaltet (nicht nur invertiert).

**Sofort vertraut (bekannte Patterns)**
- Tab-Bar-Navigation, Pull-to-refresh, Swipe-to-delete, Bottom-Sheet-Auswahl, FAB zum Hinzufügen.
- Konsistente Platzierung: primäre Aktion immer am selben Ort, „Zurück"/„Schließen" vorhersehbar.
- Klare Empty States mit einer einzigen, offensichtlichen nächsten Aktion.

**Barrierefreiheit:** ausreichender Kontrast (WCAG AA), skalierbare Schrift, Icons mit
`aria-label`, fokussierbare Touch-Elemente — kostet wenig, hilft allen.

## 9. Gamification, Belohnungen & KI-Coach

Ziel: Motivation und Dranbleiben. Erfolge werden **sichtbar gefeiert**, Ziele lassen sich mit Hilfe
eines **KI-Ernährungscoaches** definieren und anpassen.

### 9.1 Zielarten (flexibel & nährstoffbasiert)
Ziele sind als kleine Regeln modelliert, damit beliebige Nährstoffe abgedeckt sind:
- **Mindestziel** — z. B. „≥ 130 g Protein", „≥ 100 % Tagesbedarf Vitamin C", „≥ 30 g Ballaststoffe".
- **Höchstziel / Limit** — z. B. „≤ 2000 kcal", „≤ 50 g Zucker", „≤ 6 g Salz".
- **Korridor** — z. B. „2200–2600 kcal" (Aufbau-Phase).
- Gilt für **kcal, Makros und jeden Mikronährstoff** (Vitamine/Mineralstoffe), Tagesbedarf aus
  hinterlegten Referenzwerten (RDA/DGE), ableitbar aus dem Profil.

### 9.2 Belohnungssystem
- **Streaks** — aufeinanderfolgende Tage mit erreichtem Ziel (pro Ziel eigene Streak + Gesamt-Streak).
- **Streak-Freeze / Joker** — ein verpasster Tag zerstört nicht alles (Duolingo-Prinzip). Verdiente
  oder begrenzte „Freeze"-Token; sanft motivieren statt bestrafen, **„Comeback"-Bonus** nach Pausen.
- **Badges / Erfolge** — z. B. „7-Tage-Protein", „Vitamin-C-Woche", „30 Tage geloggt", „Erster KI-Scan".
- **Punkte & Level** — pro erreichtem Tagesziel/Logging gibt es Punkte → Level-Aufstieg.
- **Freischaltbare Belohnungen (kosmetisch, kein Pay)** — mit Level/XP neue **Themes, App-Icons,
  Coach-Stimmen, Badge-Designs**. Gibt Punkten echten Wert.
- **Virtueller Begleiter** — Pflanze/Avatar, die mit gesunder Ernährung **mitwächst** (Tamagotchi-
  Prinzip); emotionaler Anker, reagiert auf Streaks & erreichte Ziele.
- **Quests / Missionen** — mehrtägige Reihen mit „Story" (z. B. „7-Tage-Eisen-Boost"), statt nur
  einzelner Tages-Challenges.
- **„Perfekter Tag" & persönliche Meilensteine** — alle Makros im Ziel an einem Tag, 100 Mahlzeiten
  geloggt, erste 7-Tage-Protein-Streak …
- **Tages-/Wochen-Challenges** — kleine, erreichbare Aufgaben (vom Coach vorschlagbar), z. B.
  „Heute 3 Gemüseportionen".
- **Gegen die eigene Vorwoche** (lokal, ohne Cloud) + überraschende **Mystery-Badges**
  (variable Belohnung hält Motivation hoch).
- **„Wrapped" / Monats- & Jahresrückblick** — „diesen Monat 18× Protein-Ziel getroffen", teilbar.
- **Reale Belohnungen koppeln** — selbst gesetzt („bei 30-Tage-Streak gönn ich mir X"), App trackt's.
- **Feier-Momente** — beim Zielerreichen Konfetti/Erfolgs-Animation (Framer Motion), Badge-Unlock-Sheet.
  Dezent, nie nervig; respektiert `prefers-reduced-motion`.
- Fortschritt jederzeit sichtbar: Ringe/Balken füllen sich animiert Richtung Ziel.

### 9.3 KI-Ernährungscoach
Ein **multimodaler Coach** über dasselbe OpenRouter-Gateway (`mode: 'coach'`). Er bekommt als
Kontext eine **aggregierte Zusammenfassung** (Profil, Ziele, Tages-/Wochenwerte, Defizite) und kann
**auf Wunsch auch Fotos sehen** (geloggte Mahlzeiten-Bilder oder ein frisch aufgenommenes Foto).

**Kernfähigkeiten:**
- **Ziele vorschlagen/definieren** passend zum Profil & Wunsch („abnehmen", „Muskelaufbau",
  „mehr Eisen") und sie auf Bestätigung als `Goal` anlegen.
- **Beraten & erklären**: „Dir fehlt diese Woche Magnesium — z. B. Haferflocken, Nüsse, Hülsenfrüchte."
- **Challenges vorschlagen**, die zu den Zielen passen.
- **Wochen-Review** geben (was lief gut, woran arbeiten).

**Zusätzliche Optimierungen:**
- **Per Sprache/Text loggen:** „Ich hatte zwei Eier und einen Kaffee" → Coach erzeugt direkt
  `LogEntry`s (mit Bestätigung). Schnellste Erfassungsart, nutzt die Sprachfunktion (9.4).
- **Proaktiver Coach:** Nudges anhand des Resttagesbudgets („19 Uhr, dir fehlen 40 g Protein —
  Vorschlag: …") als sanfte Hinweise/Notifications.
- **Langzeit-Gedächtnis / Personalisierung:** merkt sich Diätform (vegan/keto…),
  Allergien/Unverträglichkeiten, Vorlieben & Abneigungen → alle Vorschläge passen dazu (`CoachMemory`).
- **Konkrete Mahlzeiten- & Rezeptvorschläge:** „Was ess ich, um heute noch Eisen + Protein zu
  treffen?" → konkrete Gerichte, optional Einkaufsliste.
- **Foto-Feedback:** zu einem geloggten/aufgenommenen Essensfoto direkt kurzes Coaching
  („gute Wahl, viel Eisen — etwas mehr Gemüse dazu").
- **Wählbarer Ton / Persönlichkeit:** motivierend, locker oder streng (zugleich freischaltbares
  Belohnungs-Item, s. 9.2).
- **Adaptive Ziele:** justiert Ziele bei Plateau/Fortschritt nach (z. B. kcal beim Abnehmen).
- **Erklärbarkeit + verantwortungsvolle Leitplanken:** begründet mit DGE/RDA statt Fantasiewerten;
  klarer Hinweis „keine medizinische Beratung"; bei extrem niedrigen Kalorien / Anzeichen von
  gestörtem Essverhalten vorsichtig & unterstützend reagieren, ggf. auf Fachstellen verweisen.

**Datenschutz:** Der Coach läuft nur auf Knopfdruck. Aggregierte Zahlen standardmäßig; Fotos nur,
wenn der Nutzer sie aktiv teilt/aufnimmt. Vorgeschlagene Ziele/Challenges/Log-Einträge werden zur
**Bestätigung** angezeigt, bevor sie aktiv werden.

### 9.4 Echtes Sprachgespräch mit dem Coach
Der Coach soll sich wie ein **echtes Gespräch** anfühlen: man **spricht** mit ihm und er **antwortet
hörbar**. Ablauf:

```
🎙️ Sprechen → Speech-to-Text → Coach-LLM (mit Gesprächsverlauf) → Antworttext → Text-to-Speech → 🔊 Antwort
```

- **Dialog statt Einzelfragen:** Der Gesprächsverlauf wird als Kontext mitgegeben (mehrere Turns),
  damit Rückfragen und Bezug auf vorher Gesagtes funktionieren. Optional **Freihand-Modus**: nach der
  Antwort hört die App automatisch wieder zu (Gespräch ohne Tippen/Tappen).
- **Niedrige Latenz:** Coach-Antwort wird **gestreamt** (Token-Streaming) und satzweise vorgelesen,
  damit es sich flüssig anfühlt statt „warten bis fertig".
- **Eingabe & Ausgabe gleichwertig auch als Text** — man kann jederzeit tippen/lesen statt sprechen
  (laute Umgebung, Barrierefreiheit, `prefers-reduced-motion`/stumm).
- **Technik (zweistufig):**
  - *MVP, on-device & kostenlos:* **Web Speech API** — `SpeechRecognition` (STT) + `SpeechSynthesis`
    (TTS). Schnell, privat, keine Server-Kosten. Einschränkung: Browser-Support variiert (Chrome gut,
    iOS/Safari & Firefox eingeschränkt).
  - *Fallback/Qualität:* serverseitige **STT/TTS** über einen Netlify-Function-Proxy (z. B. Whisper-
    kompatibles STT + Cloud-TTS), wenn die Web Speech API fehlt oder bessere Stimmen gewünscht sind.
    Audio geht dann verschlüsselt über die Function, Key bleibt serverseitig.
- **UI:** großer Mikrofon-Button mit Live-Pegel/Animation, sichtbares Transkript des Gesagten,
  Sprechblasen-Verlauf, Stopp-/Unterbrechen-Taste, Stimme/Sprache in den Einstellungen.
- **Datenschutz:** Mikrofon nur auf aktiven Tap; bei Server-STT klar kommuniziert, dass Audio
  kurzzeitig verarbeitet wird; on-device-Modus als datensparsame Voreinstellung wo verfügbar.

> **Hinweis:** Ein Live-Kamera-/Videomodus ist bewusst **nicht** vorgesehen. KI-Bilderkennung
> läuft ausschließlich über **Fotos** (Foto/Tabelle/Barcode, §6). Das spart Kosten/Komplexität;
> das Sprachgespräch mit dem Coach (§9.4) bleibt davon unberührt.

## 10. Zielgruppen & Ernährungsprofile

Die App passt sich an **Ziel, Lebensstil und Ernährungsform** an — beim Onboarding gewählt, jederzeit
änderbar. Aus dem Profil leiten sich **Ziel-Vorlagen** (Makro-/Mikro-Vorgaben) ab; der KI-Coach ist
auf jede Gruppe spezialisiert und berät entsprechend.

### 10.1 Zielgruppen (Personas) mit Standard-Schwerpunkten
| Persona / Ziel | Schwerpunkte (Ziel-Vorlage) |
|---|---|
| **Kraftsport / Bodybuilding / Muskelaufbau** | Hohes Protein (≈ 1,6–2,2 g/kg), leichter kcal-Überschuss, Verteilung über den Tag |
| **Ausdauersport** | Mehr Kohlenhydrate, Flüssigkeit/Elektrolyte, Timing um Training |
| **Abnehmen / Übergewicht** | kcal-Defizit, hoher Protein-/Ballaststoffanteil (Sättigung), Zucker-/Salz-Limits |
| **Zunehmen / Untergewicht** | kcal-Überschuss, nährstoffdichte Lebensmittel, regelmäßige Mahlzeiten |
| **Gesund halten / Allgemein** | Ausgewogene Makros, RDA-Abdeckung bei Vitaminen/Mineralstoffen |

### 10.2 Ernährungsformen
- **Vegan / Vegetarisch** — besonderes Augenmerk auf **B12, Eisen, Omega-3, Protein, Calcium, Zink**;
  Coach schlägt nur passende Lebensmittel vor.
- **Low Carb / Keto / „No Carb"** — Kohlenhydrat-Limit als `max`-Ziel, angepasste Makro-Verteilung
  (mehr Fett/Protein).
- **High Protein**, **Mediterran**, weitere — als erweiterbare Profile.
- Mehrere Eigenschaften kombinierbar (z. B. „vegan + Muskelaufbau + glutenfrei").

### 10.3 Allergien & Unverträglichkeiten (Sicherheit)
- Im Profil hinterlegt (`CoachMemory.allergies`), z. B. Gluten, Laktose, Nüsse, Soja …
- **Warnung beim Loggen**, wenn ein Lebensmittel ein hinterlegtes Allergen enthält (Datenquelle:
  Open Food Facts liefert Allergen-/Zutateninfos).
- Coach **schließt Allergene grundsätzlich aus** Vorschlägen/Rezepten aus.
- Klar als Hilfestellung gekennzeichnet, **kein Ersatz für medizinische Beratung**.

### 10.4 Optionale Gesundheits-Module (aktivierbar)
Nicht jeder braucht alles — wie Allergien sind manche Funktionen **opt-in** über die Einstellungen:
- **Blutzucker-Tracking (Diabetes):** manuelle Messwerte (mg/dl oder mmol/l) mit Kontext
  (nüchtern/vor/nach Mahlzeit), farbcodierter Verlauf, **Warner** bei Über-/Unterzucker.
  Orientierende Richtwerte, **keine medizinische Beratung**.
- **Zucker-Warner:** strengeres Tages-Zuckerlimit (25 g) für zuckerbewusste/diabetische Nutzer.
- **Verlaufswerte (Körper/Labor/Vitalwerte/Insulin):** generische `measurements`-Tabelle + Katalog
  (`lib/measurements.ts`). Körperwerte (Gewicht, Körperfett, Umfänge) immer aktiv; Laborwerte
  (Ferritin, Vitamin D, B12, HbA1c, Blutfette) und Vitalwerte (Blutdruck, Ruhepuls) als opt-in
  Module; Insulin an das Diabetes-Modul gekoppelt. Pro Wert ein empfohlener Rhythmus → dezente
  **Fälligkeits-Karte** auf „Heute" (kein Push, einklappbar). Verlauf-Screen mit Sparkline +
  Wochen-Rate; jüngstes Gewicht + Wochenrate fließen in den Coach-Kontext (adaptive Steuerung
  statt reiner Formel). Orientierung, **keine medizinische Beratung**.
- Weitere Module später ergänzbar, ohne die App für alle zu überfrachten.

### 10.5 Auswirkung im System
- **Onboarding** fragt Persona, Ernährungsform(en), Allergien & Ziel ab → setzt sinnvolle
  Start-Ziele (editierbar).
- **Ziel-Vorlagen** füllen `Goal`-Regeln vor (min/max/Korridor je Nährstoff).
- **Coach-Kontext** enthält Persona + Ernährungsform + Allergien (`CoachMemory`), damit Beratung,
  Rezepte und Challenges passgenau sind.
- Alles **flexibel & erweiterbar** — neue Personas/Ernährungsformen ohne Umbau ergänzbar.

## 11. Roadmap (Phasen)

**Phase 0 — Setup**
- Vite + React + TS, Tailwind + shadcn/ui, ESLint/Prettier, Vitest
- **Design-System: Tokens (Farben/Spacing/Radius), Dark Mode, Framer Motion, Skeleton-Komponenten**
- **i18next verdrahten** (Texte ausgelagert, DE als Startsprache)
- `vite-plugin-pwa` (Manifest, Icons, Offline-Cache, Update-Prompt)
- Dexie-Schema (versioniert) + Seed-Daten + `navigator.storage.persist()`

**Phase 1 — Manuelles Tracking (ohne KI), voll offline**
- Dashboard „Heute" (Mahlzeiten-Gruppen, Ringe), manuelles Erfassen
- Onboarding: Persona, Ernährungsform(en), Allergien → Ziel-Vorlagen + Zielberechnung
- Allergen-Warnung beim Loggen (Open Food Facts)
- Persönlicher Katalog, Favoriten/„zuletzt", Verlauf
- **Backup-Export/Import (JSON)** — erstes Sicherheitsnetz

**Phase 2 — Erfassung beschleunigen**
- Netlify Function `analyze` + OpenRouter (zod-Schema, Retry, Budget-/Rate-Limit)
- Kamera-Capture + Bild-Verkleinerung, Modi „Essen" & „Tabelle scannen"
- **Barcode-Scan** (ZXing + Open Food Facts) — für verpackte Produkte vorgezogen
- Nährwert-Lookup (USDA/Open Food Facts), Ergebnis-Prüf-Screen, Lernschleife

**Phase 3 — Komfort & Motivation**
- Mengenschätzung per Foto, Mengen-Presets/Slider
- Nährstoff-Defizit-Ansicht, Wasser-Tracking
- **Gamification:** regelbasierte Ziele, Streaks, **Streak-Freeze**, Badges, Punkte/Level,
  **freischaltbare Belohnungen**, **virtueller Begleiter**, Quests, Meilensteine, Challenges,
  Vorwochen-Vergleich, „Wrapped"-Rückblick, Feier-Animationen (Konfetti/Badge-Unlock)

**Phase 4 — KI-Ernährungscoach (Chat, Sprache, Foto)**
- `mode: 'coach'`: Kontext + `CoachMemory` (Personalisierung), Beratung im Chat
- **Sprach-/Text-Logging**, **proaktive Nudges**, Rezept-/Mahlzeitvorschläge, adaptive Ziele,
  wählbarer Ton, verantwortungsvolle Leitplanken
- **Foto-Feedback:** Coach kommentiert geloggte/aufgenommene Essensfotos
- Ziel-/Challenge-/Log-Vorschläge mit Nutzer-Bestätigung, Wochen-Review
- **Sprachgespräch:** Web Speech API (STT/TTS), gestreamte Antworten, optional Freihand-Modus;
  Server-STT/TTS als Fallback

**Phase 5 — Cloud-Sync (später)**
- Supabase (Auth + Postgres), Last-Write-Wins-Sync über `updatedAt`/`deletedAt`, Multi-Device, Backup

## 12. Offene Punkte / später zu entscheiden

*Stand 2026-07-05 (Projektabschluss Phasen 0–4): erledigte Punkte markiert, Rest bleibt ehrliche
Schuldenliste. Detaillierte Restliste: [docs/ABSCHLUSSPLAN.md](./docs/ABSCHLUSSPLAN.md).*

- ~~Genauer Umfang der Mineralstoff-/Vitaminliste~~ — Start-Set umgesetzt (`src/lib/nutrients.ts`);
  Erweiterung bleibt jederzeit möglich, kein offener Beschluss mehr.
- **Offen:** USDA vs. Open Food Facts als Primärquelle pro Lebensmittelart (Markenprodukte → OFF,
  Rohzutaten → USDA). Ein serverseitiger Nährwert-Resolver existiert noch nicht.
- iOS-PWA-Grenzen: eingeschränkte Push-Notifications/Background-Sync, HTTPS-Pflicht für Kamera
  (Plattform-Fakt, bleibt bestehen).
- **Offen:** Barcode-Scan nutzt die native `BarcodeDetector`-API (+ manuelle Eingabe als Fallback);
  für iOS/Safari ggf. ZXing nachrüsten, da `BarcodeDetector` dort fehlt.
- **Offen:** KI-Nährwerte für Fotos kommen weiterhin direkt vom Modell (Schätzung); Umstellung auf
  vertrauenswürdige DB-Werte (USDA/OFF) wie in §2 vorgesehen folgt — hängt am Resolver-Punkt oben.
- **Offen (bewusst verschoben, Abschluss-Audit):** Server-STT/TTS-Fallback (§11 Phase 4),
  Freihand-Sprachmodus (§9.4, optional), en.json-Vollausbau (App ist bewusst Single-Locale DE),
  Gamification-Ausbau Paket 16 (Quests, „Wrapped", Vorwochen-Vergleich, Mystery-Badges,
  Level-Gating, Per-Ziel-Streaks).
- **Erledigt im Abschluss:** Endpunkt-Härtung aus §4 (Origin-Check, Body-Limit, Rate-Limit,
  Tagesbudget) zentral in `netlify/functions/lib/guard.ts`; Backup deckt alle Stores inkl.
  `measurements` ab; PWA-Update-Prompt verdrahtet; API-Fehler-Vertrag mit geteilten zod-Schemata.

## 13. Nächste Schritte

1. Diesen Plan abnehmen.
2. Phase 0 umsetzen (Projekt-Grundgerüst + PWA + versioniertes Dexie-Schema).
3. Phase 1: Manuelles Tracking + Backup lauffähig machen → früh auf dem Handy testen.
