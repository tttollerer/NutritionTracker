# NutriScan API-Vertrag v1.1

Vertrag zwischen Client (`src/`) und Netlify Functions (`netlify/functions/analyze.mts`,
`netlify/functions/coach.mts`). Bezug: [PLAN.md](../PLAN.md) §6/§9.3,
[ABSCHLUSSPLAN.md](./ABSCHLUSSPLAN.md) Paket 1.

**Maschinenlesbare Quelle:** [`src/lib/apiContract.ts`](../src/lib/apiContract.ts) —
geteilte zod-Schemata. Functions (Paket 2/3) und Client (Paket 7) importieren künftig von
dort; bis dahin gilt: bei Abweichung zwischen Code und diesem Dokument ist **dieses
Dokument + apiContract.ts der Soll-Zustand**, der Code der Ist-Zustand.

| Version | Status |
|---|---|
| v1.0 | Ist-Stand im Code (Stand Audit 2026-07-05) |
| v1.1 | Dieser Vertrag — Error-Envelope, `memory` nullish, Stream-Fehler-Event, serverseitig validierte Suggestions, optionales Coach-Foto |

---

## 1) Fehler-Envelope (v1.1, beide Endpunkte)

**Jede** Nicht-200-Antwort ist JSON in genau dieser Form (`ApiErrorSchema`):

```json
{ "error": "Deutscher Nutzertext-Fallback", "code": "RATE_LIMITED" }
```

- `error`: i18n-tauglicher deutscher Fallback-Text, direkt anzeigbar.
- `code`: stabiler Maschinencode — **der Client mappt über `code` auf i18n-Texte**,
  niemals über den HTTP-Status oder den `error`-Text.
- **Upstream-Rohtexte (OpenRouter-Fehlermeldungen, Stacktraces, `String(e)`) gehören NIE
  in eine Antwort.** Sie werden serverseitig geloggt, nach außen geht nur der Envelope.

| `code` | HTTP | Bedeutung |
|---|---|---|
| `INVALID_REQUEST` | 400 | Body kein JSON / Schema-Verstoß / falsche Methode¹ |
| `BUDGET_EXCEEDED` | 402 | Hartes Tagesbudget der KI-Aufrufe erschöpft (Paket 3) |
| `PAYLOAD_TOO_LARGE` | 413 | Body über Limit (analyze ≤ 8 MB, coach ≤ 256 KB; Paket 3 senkt analyze auf ≤ 6 MB) |
| `RATE_LIMITED` | 429 | Rate-Limit pro Client/IP gegriffen (Paket 3) |
| `UPSTREAM_ERROR` | 502 | OpenRouter-Fehler, Netzfehler zum Upstream, dauerhaft kaputtes JSON trotz Retry, fehlende Server-Konfiguration² |
| `UPSTREAM_TIMEOUT` | 504 | AbortController-Timeout gegen OpenRouter (Paket 3) |

¹ 405 (Method not allowed) trägt denselben Envelope mit `code: "INVALID_REQUEST"`; der
Status bleibt 405. Die Tabelle nennt den kanonischen Status je Code — weitere Status sind
zulässig, der Envelope ist es immer.
² Fehlender `OPENROUTER_API_KEY` bleibt HTTP 500, Envelope mit `code: "UPSTREAM_ERROR"`
und generischem Text (keine ENV-Namen im Body).

**Kein `OFFLINE`-Code:** Offline ist kein Serverzustand — der Client (Paket 7) erkennt
fehlgeschlagene `fetch`es/`navigator.onLine` selbst und zeigt eigene Texte. Abweichung
zum Codewort „OFFLINE" in ABSCHLUSSPLAN §2/Paket 1 ist beabsichtigt.

**Retry-Empfehlung Client:** `RATE_LIMITED`/`UPSTREAM_TIMEOUT`/`UPSTREAM_ERROR` → „später
erneut versuchen"-UX; `BUDGET_EXCEEDED` → heute nicht mehr anbieten; `PAYLOAD_TOO_LARGE`
→ Bild stärker verkleinern; `INVALID_REQUEST` → Programmierfehler, nicht retryen.

---

## 2) POST `/api/analyze`

Bildanalyse in drei Modi (PLAN.md §6). Serverseitige zod-Validierung der Modellantwort,
1 Retry bei kaputtem JSON (Ist-Stand `analyze.mts:117–127`, bleibt in v1.1).

### Request (`AnalyzeRequestSchema`)

```jsonc
{
  "mode": "meal" | "label" | "portion",
  "imageBase64": "<Data-URL oder rohes Base64, JPEG angenommen>",
  "hint": "optional, max. 280 Zeichen"
}
```

### Response 200 (`AnalyzeResultSchema`)

```jsonc
{
  "items": [
    {
      "name": "Haferflocken",
      "amount": 60,
      "unit": "g" | "ml" | "portion",
      "confidence": 0.8,            // optional, 0..1
      "per100": {
        "kcal": 370, "protein": 13, "carbs": 59, "fat": 7,
        "micros": { "fiber": 10, "iron": 4.3 }   // optional; Schlüssel = src/lib/nutrients.ts
      }
    }
  ],
  "notes": "optional"
}
```

### Fehler

v1.0-Ist-Stand: `{ error: string }` ohne Code, teils mit Upstream-Rohtext
(`analyze.mts:78` reicht `OpenRouter <status>: <text>` durch, `:128/:130` senden
`String(e)`). **v1.1: Envelope aus §1, keine Rohtexte** (Umsetzung Paket 2/3).

---

## 3) POST `/api/coach`

Coach-Chat mit Token-Streaming (PLAN.md §9.3).

### Request (`CoachRequestSchema`, v1.1)

```jsonc
{
  "messages": [ { "role": "user" | "assistant", "content": "1..4000 Zeichen" } ], // 1..40
  "context": { /* aggregierte Zusammenfassung, siehe buildCoachContext() */ } | null,  // nullish
  "memory": { "diet": "...", "allergies": [], "likes": [], "dislikes": [], "tone": "..." } | null, // nullish
  "imageBase64": "optional — Foto-Feedback (neu in v1.1, Umsetzung Paket 2)"
}
```

**Bekannter v1.0-Bug (Grund für „nullish"):** Der Client sendet für Nutzer ohne
CoachMemory explizit `memory: null` (`src/lib/coach.ts:164`), das Server-Schema erlaubt
aber nur `z.record(z.unknown()).optional()` (`netlify/functions/coach.mts:20`) — `null`
ist dort **kein** gültiger Wert → HTTP 400 „Ungültige Anfrage" für genau die Nutzer, die
den Coach zum ersten Mal verwenden. v1.1 legt fest: `memory` und `context` sind
**nullish** (`null` ODER weggelassen, beides gültig und bedeutungsgleich). Repro als
Schema-Test: `src/lib/apiContract.test.ts`.

### Response 200 — Token-Stream

`Content-Type: text/plain; charset=utf-8`, gestreamte Text-Tokens (kein SSE-Framing für
normale Tokens). Aufbau des Gesamttexts:

```
<Beratungstext, gut vorlesbar, kein Markdown>
###SUGGESTIONS###
{"goals":[…],"challenges":[…],"logs":[…]}
```

- Trenner `###SUGGESTIONS###` (`COACH_SENTINEL`) und die **eine** JSON-Zeile sind
  optional (nur wenn der Coach Vorschläge hat).
- **v1.1: Die Suggestions-Zeile wird SERVERSEITIG gegen `CoachSuggestionsSchema`
  validiert** (Paket 2). Ungültiges/kaputtes JSON wird verworfen — der Client erhält dann
  nur den Beratungstext, nie eine kaputte Suggestions-Zeile. (v1.0: Validierung nur im
  Client, `src/lib/coach.ts:139–146`.)

### Fehler VOR Streambeginn

HTTP-Fehler mit Envelope aus §1 (v1.0-Ist-Stand: `{ error }` teils mit Upstream-Rohtext,
`coach.mts:78/:81` — entfällt).

### Fehler WÄHREND des Streams (v1.1)

v1.0 hängt bei Abbruch `\n[Fehler: …]` inkl. `String(e)` an den 200er-Body an
(`coach.mts:116`) — das landet als Text in der Chat-Blase und in der Sprachausgabe.

v1.1: Der Server sendet stattdessen einen eigenen Event-Block als eigene Zeilen im
Stream und schließt danach:

```
event: error
data: {"error":"Der Coach ist gerade nicht erreichbar. Bitte versuch es später erneut.","code":"UPSTREAM_ERROR"}
```

- `data` ist immer ein vollständiger Envelope (§1); im Stream sind nur
  `UPSTREAM_ERROR`/`UPSTREAM_TIMEOUT` sinnvoll.
- Der Client filtert den Block aus dem angezeigten Text und behandelt den Envelope wie
  einen HTTP-Fehler (Paket 7). Referenz-Implementierung beider Seiten:
  `encodeCoachStreamError()` / `extractCoachStreamError()` in `src/lib/apiContract.ts`.
- Bereits gestreamter Beratungstext vor dem Event darf angezeigt bleiben.

---

## 4) Entscheidung: sessionStorage für Coach-Verlauf & Review-Payload

**Beschluss (bleibt in v1.1):** Der Coach-Chatverlauf (`src/lib/chatStore.ts`) und die
Analyse-Zwischenergebnisse für den Prüf-Screen (`src/lib/reviewStore.ts`) bleiben bewusst
in `sessionStorage` — **nicht** in Dexie/IndexedDB und ohne Sync-Anspruch.

Begründung:

- **Datensparsamkeit:** Chatverläufe können sensible Angaben (Gesundheit, Essverhalten)
  und die Review-Payload Base64-Fotos enthalten. Beides ist flüchtiger Arbeitszustand,
  kein Langzeitdatenbestand; es soll einen Reload überleben, aber nicht dauerhaft auf dem
  Gerät liegen oder je in einen späteren Cloud-Sync (PLAN.md §11 Phase 5) geraten.
- **Kein Sync-Anspruch:** Persistente Ergebnisse entstehen erst durch bestätigte Aktionen
  (Log-Eintrag, übernommenes Ziel) und landen dann regulär in Dexie.

**Bekannte iOS-Einschränkung (akzeptiert):** In der als PWA installierten App
(Standalone-Modus) sowie in Safari auf iOS wird `sessionStorage` beim Beenden/Verdrängen
der App aus dem Speicher geleert — jeder Kaltstart ist eine neue Session. Praktisch:
Chatverlauf und ein nicht abgeschlossener Prüf-Screen können nach App-Wechsel mit knappem
Speicher oder Neustart weg sein. Das ist der bewusst in Kauf genommene Preis der
Datensparsamkeit; die UX muss damit umgehen (leerer Chat ist ein gültiger Startzustand,
Review-Flow bricht sauber zur Erfassung zurück — vgl. Paket 9/11).

---

## 5) Umsetzungsfahrplan

| Paket | Pflicht aus diesem Vertrag |
|---|---|
| 2 (backend-ai-gateway) | `memory`/`context` nullish; Suggestions serverseitig validieren; Stream-Fehler-Event statt `[Fehler: …]`; `imageBase64` im Coach-Request; Envelope statt `String(e)` |
| 3 (backend-security) | `RATE_LIMITED`/`BUDGET_EXCEEDED`/`UPSTREAM_TIMEOUT`/`PAYLOAD_TOO_LARGE` mit Envelope + kanonischem Status; keine Upstream-Rohtexte; Body-Limit vor Einlesen |
| 7 (frontend) | `code` → i18n-Mapping; `extractCoachStreamError` im Stream-Reader; Offline-Erkennung clientseitig; ai.ts/coach.ts auf apiContract.ts-Schemata umstellen |
