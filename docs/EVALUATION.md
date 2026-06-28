# Evaluations-Report

> Erstellt von einem Multi-Agent-Team (6 Rollen-Tester + Architektur-Agent + Synthese).
> Hinweise des Reviewers (verifiziert): Der Befund „Wasserziel-Formel falsch" ist ein **False
> Positive** — `waterGoalMl` rechnet korrekt `Math.round(kg*35/50)*50` (75 kg → 2650 ml). Die
> Persona „Abnehmen" und der „Fachexperte"-Lauf lieferten teils Platzhalter; die übrigen Befunde
> sind am Code verifiziert und gültig.

## 1. Gesamtbild

NutritionTracker ist als local-first PWA technisch solide gebaut (versioniertes Dexie-Schema,
reine/idempotente Gamification-Engine, saubere Feature-Detection bei Sprache/Barcode, serverseitiger
KI-Proxy mit Key-Versteckung und zod-Validierung). Die Kern-Loops Erfassen und Loggen (manuell,
Foto/KI, Barcode/OFF, Coach-Log) funktionieren end-to-end und sind tap-arm. Der im PLAN.md als
zentraler Differenzierer beworbene Fokus — Mikronährstoffe und eine Defizit-Ansicht — ist jedoch
faktisch nicht implementiert: `micros` existiert nur als toter Typ (types.ts) und wird nirgends
befüllt, summiert oder angezeigt. Quer durch alle Rollen ziehen sich dieselben harten Befunde:
fehlendes Mikronährstoff-Tracking, eine unzuverlässige (sicherheitskritische) Allergen-Warnung und
ein KI-Coach, der ohne API-Key ausfällt und mangels Daten nicht datenbasiert beraten kann. Daneben
gibt es mehrere datenkorrumpierende Edge-Cases (Profil-Reset, Backup-Import ohne Validierung,
negative Mengen, Tageswechsel um Mitternacht).

## 2. Top-Befunde nach Schwere (dedupliziert über Rollen)

| Bereich | Schwere | Befund | Empfehlung |
|---|---|---|---|
| Funktionalität | **Hoch** | Mikronährstoffe werden nirgends getrackt — `micros` existiert nur im Typ (types.ts), wird aber nicht erfasst/berechnet/summiert. createFood/logFood, sumsByDate, AiItem und OFF-Mapping kennen nur kcal/protein/carbs/fat. Der beworbene Kern-Differenzierer fehlt vollständig. | micros-Feld durch die ganze Pipeline führen: NewFoodInput, AiItem/per100, logFood.computed, OFF-Nutriments (iron_100g, calcium_100g, vitamin-b12_100g, zinc_100g), sumsByDate. |
| Funktionalität / Sicherheit | **Hoch** | Allergen-Warnung unzuverlässig: nur naiver Substring-Match deutscher Produktnamen gegen englische Keys (Review.tsx) — 'Erdnussbutter' triggert kein 'peanuts'. Gleichzeitig werden echte OFF-Allergen-Tags (openfoodfacts.ts) im Barcode-Payload verworfen. Vermittelt falsche Sicherheit. | OFF-Allergen-Tags ins ReviewPayload durchreichen und gegen CoachMemory.allergies (en:-Taxonomie) matchen; Mehrsprach-Mapping (soy↔Soja); Substring-im-Namen als alleinige Quelle entfernen; Treffer rot hervorheben. |
| Funktionalität | **Hoch** | Keine Defizit-/Nährstoff-Detail-Ansicht (PLAN §7). Today zeigt nur kcal-Ring + Makro-Balken. | Nährstoff-Detail-Screen mit hervorgehobenen Defiziten bauen, sobald micros getrackt werden. |
| Funktionalität | **Hoch** | Empfehlungen/Beratung hängen vollständig am LLM-Coach + OPENROUTER_API_KEY. Ohne Key keine Antwort; keine regelbasierten Vorschläge. Coach-Kontext enthält nur kcal/Makros — kein Rest-zum-Ziel, keine Mikros, keine Mahlzeitenverteilung → kann B12-/Eisen-/Protein-Defizite nicht erkennen. | Offline-Fallback mit kuratierter Food-Liste (gefiltert nach dietForms/Allergien); Rest-zum-Ziel je Nährstoff + Mikro-Summen + Pro-Mahlzeit-Protein in den Coach-Kontext. |
| Funktionalität | **Hoch** | Profil-Reset löscht nur `db.profile.clear()`. Logs, Coach-Ziele, Wasser, Gamification, Coach-Memory bleiben. Neuer Nutzer sieht alte Einträge/Streaks. | Vollständiges Wipe aller Tabellen (analog importBackup-Clear) oder klar als 'nur Profil' kennzeichnen; Bestätigungsdialog. |
| Funktionalität | **Hoch** | Today zeigt keine verbleibende Proteinmenge ('noch X g'). Nur kcal hat 'übrig'; Makros nur als bei 100% gedeckelte Balken. Zentrale Steuergröße für Kraftsportler fehlt. | max(0, target-value) je Makro (v.a. Protein) prominent als Zahl anzeigen; Protein als Hero-Wert. |
| Userflow | **Hoch** | Onboarding ist ein langes Scroll-Formular ohne Schritte/Validierung. Ungültige Eingaben werden still auf Defaults gemappt (age→30, height→175, weight→75) → verfälschte Zielberechnung unbemerkt. | In 3-4 validierte Schritte aufteilen; Min/Max-Inline-Validierung; berechnete Ziele vor Start anzeigen. |
| Userflow | **Hoch** | Coach-Vorschläge werden mit einem Tap destruktiv wirksam; applyGoalSuggestion überschreibt bestehendes Ziel, applyLog legt sofort Log an — kein Dialog, kein Undo. | Bestätigung vor dem Anwenden oder Undo-Toast danach; beim Überschreiben nutzergesetzter Ziele warnen. |
| Funktionalität | Mittel | Backup-Import ohne Struktur-/Versionsvalidierung: JSON.parse + bulkPut nach clear(). Fehlende `computed` crasht Today.reduce. | Mit zod gegen Schemata validieren, version prüfen, bei Fehler abbrechen *bevor* gelöscht wird; Feedback. |
| Funktionalität | Mittel | Negative/0-Mengen erzeugen negative Nährwerte. Review/Add ohne Clamp; factor wird negativ → verfälscht Summen/Streaks. | Menge >0 und per100 ≥0 clampen; Client-Antwort nach Edit erneut validieren. |
| Funktionalität | Mittel | Log-Einträge nicht editierbar — nur löschen. PLAN §7 fordert editierbare Einträge + Mengen-Slider. | Edit-Flow (Bottom-Sheet Menge/Mahlzeit, recompute) + updateLog. |
| Userflow | Mittel | Tageswechsel um Mitternacht wird in offener PWA nicht erkannt → späte Snacks landen am Vortag. | Datum reaktiv halten (visibilitychange/Interval) oder beim Loggen gegen aktuelle Uhrzeit prüfen. |
| Usability | Mittel | Proteinbalken bei 100% gedeckelt — Übererfüllung unsichtbar; kein 'Ziel erreicht'-Signal. | Über-100% visuell kennzeichnen; Protein-Übererfüllung positiv feiern. |
| Userflow | Mittel | 'Auf Kurs?'-Status nur in Awards, nicht auf Today. | Kompakten 'Heute auf Kurs'-Indikator (Protein+kcal Ampel/Haken) auf Today. |
| Usability | Mittel | Capture: kein Foto-Preview vor Senden, kein 'Erneut versuchen'-Button trotz vorhandenem i18n-Key. | Downscaled Preview mit 'Analysieren'/'Neu aufnehmen'; sichtbarer Retry-Button. |
| Usability | Mittel | Versprochene Portions-Presets (¼/½/1, S/M/L) und Slider fehlen im Review; nur Gramm-Festwerte [50,100,150,200]. | Portionsbasierte Presets + Slider; gemerkte defaultPortion als Default. |
| Usability | Mittel | Löschen ohne Undo/Rückfrage; WaterCard hat Undo, Logs nicht. | Undo-Snackbar nach Löschen (Soft-Delete erlaubt es) konsistent. |
| Usability | Mittel | Fehler-/Empty-States technisch statt nutzerfreundlich ('Ist der OPENROUTER_API_KEY gesetzt?', roher Exception-String). | Technische Fehler auf übersetzte, handlungsorientierte Hinweise mappen; navigator.onLine. |
| Userflow | Mittel | Vegane Auswahl ohne Wirkung: computeTargets wertet nur keto/lowcarb, 'vegan' ignoriert; keine Mikro-Zielvorlagen; CoachMemory.diet nie befüllt. | Bei vegan Mikro-Zielvorlagen (B12 min, Eisen ~1.8x, Calcium, Zink, ALA) anlegen; memory.diet aus dietForms ableiten. |
| Funktionalität | Mittel | KI-Mahlzeiten-Flow verletzt Kernentscheidung 'KI erkennt, DB rechnet' (PLAN §2): Modell rät Nährwerte selbst, kein USDA/OFF-Lookup im Meal-Pfad. | DB-Lookup nach Erkennung nachrüsten oder Schätzcharakter im UI deutlicher machen. |
| Usability | Niedrig | TTS an prefers-reduced-motion gekoppelt — Audio wird stummgeschaltet, obwohl reduzierte Bewegung nur Animationen betrifft. | TTS vom Motion-Flag entkoppeln; Mute-Toggle respektieren. |
| Usability | Niedrig | Mic-Button mit hartkodiertem aria-label 'Mikrofon' durchbricht i18n. | aria-label aus de.json; Mic-Zustände + Zwischen-Transkript anzeigen. |
| Funktionalität | Niedrig | Protein/kg hängt nur an Persona, nicht an goal: Cut bekommt nicht 2,2-2,4 g/kg; kein g/kg-Override. | Protein aus persona UND goal ableiten; direkten g/kg-Override im Profil. |
| Compliance | Mittel | Kein 'keine medizinische Beratung'-Disclaimer in Coach-UI und kein 'Fotos bleiben auf dem Handy'-Hinweis in Capture (nur serverseitig im Prompt). | Dezenten Dauer-Disclaimer im Coach + Datenschutz-/Upload-Hinweis im Capture. |

## 3. Persona-Sicht

**Kraftsportler / Bodybuilder**
- Stark: Proteinziel fachlich korrekt (strength = 2,0 g/kg), als 'min' modelliert; Tageserfolg an kcal UND Protein gekoppelt; schnelles Wiederholen via 'zuletzt benutzt'.
- Fehlt: numerische 'noch X g Protein bis Ziel'-Anzeige; 'auf Kurs?'-Status auf Today; Pro-Mahlzeit-Proteinverteilung; Protein-Übererfüllung sichtbar.

**Veganer / Mikronährstoff-Fokus**
- Stark: vegane Ernährungsform auswählbar/persistiert; Coach-Prompt nennt vegan; OFF wird nach Allergen-Tags geparst.
- Fehlt: jegliches Tracking von B12/Eisen/Omega-3/Calcium/Zink; Defizit-Erkennung; Mikros im Coach-Kontext; vegan-spezifische Ziele. Veganer bekommen exakt dieselbe App wie Omnivoren.

**UX-/Usability**
- Stark: Mobile-first sauber (Bottom-Tab + FAB, große Touch-Targets, Safe-Area, Skeletons, i18n, Dark Mode); tap-armes Quick-Log; gute Feature-Detection mit Text-Fallbacks; sinnvolle Empty States.
- Fehlt: geführtes Onboarding; Foto-Preview/Retry; Bestätigung/Undo; Portions-Presets/Slider; UI-Disclaimer; Defizit-/Verlauf-Ansicht.

**QA / Edge-Cases**
- Stark: RootGate trennt lädt/kein Profil sauber; Gamification rein/idempotent; Server-Proxy mit JSON-Mode, zod, Retry.
- Risiko: Profil-Reset hinterlässt Altdaten; Backup-Import ohne Validierung; negative Mengen; Mitternachts-Tageswechsel; kein Edit-Flow; kein Rate-Limit/Budget in den Functions.

> Die Läufe „Abnehmen" und „Fachexperte" lieferten nur Platzhalter und sollten bei Bedarf wiederholt werden.

## 4. KI-Agenten-Architektur: Single vs. Multi

**Empfehlung: Hybrid.** Ein konversationeller Haupt-Coach (Single-Agent-Erlebnis im UI) bleibt der
Einstieg, wird aber durch spezialisierte, **deterministische** Sub-Komponenten (teils regelbasiert,
kein LLM) ergänzt. Begründung: Die heute kritischsten Lücken (Mikro-Defizit-Erkennung,
Allergen-Match, Rest-zum-Ziel) sind *Daten-/Rechen*-Probleme, keine Sprachprobleme — sie gehören in
deterministische Engines, nicht ins LLM. Das LLM übernimmt nur Erkennung (Foto/Text→Items) und
Erklärung/Dialog. So wird die App auch **ohne API-Key** nutzbar (heute ein Single-Point-of-Failure).

### Vorgeschlagene Agenten / Komponenten

| Agent | Verantwortung | Inputs | Outputs | Wann |
|---|---|---|---|---|
| Recognition (LLM) | Foto/Sprache/Text → strukturierte Items erkennen (nur Erkennung, keine Nährwerte) | Bild/Transkript, dietForms | Item-Namen + Menge + confidence | Capture, Coach-Log, Sprach-Erfassung |
| Nutrition-Resolver (deterministisch) | Erkannte Items gegen DB/OFF/USDA auflösen, Makros+Mikros je 100 g | Item-Name/Barcode | vollständige FoodItem inkl. micros | nach Recognition, Barcode, manuell |
| Deficit-Engine (regelbasiert) | Tages-/Wochen-Summen vs. Ziele (Makro+Mikro), Defizite ranken | Logs, Goals, dietForms | Rest-zum-Ziel je Nährstoff, Defizit-Liste | Today-Render, Coach-Kontext |
| Allergen/Diet-Checker (regelbasiert) | OFF-Tags/Zutaten gegen Allergien + Vegan-Konformität | OFF-allergens/ingredients, allergies | Warnungen, Vegan-Flag | Review, Barcode |
| Recommendation-Engine (hybrid) | 'Was noch essen' aus offenen Defiziten + Präferenzen | Defizit-Liste, dietForms/Allergien, Food-Katalog | rankte Food-Vorschläge | Today-Karte, Coach-Antwort |
| Coach (LLM-Dialog) | Erklären, motivieren, Nudges — auf Basis der Engine-Outputs | Engine-Outputs als Kontext | Chat, bestätigungspflichtige Suggestions | Coach-Screen, proaktive Nudges |

### Empfehlungs-Engine („was noch essen")

Hybrid, deterministisch zuerst, LLM nur für die Formulierung:
1. Deficit-Engine bildet pro Nährstoff `remaining = max(0, target - today)` für kcal, Protein und
   Mikros (B12, Eisen, Calcium, Zink, Omega-3, Ballaststoffe) — setzt voraus, dass micros durch die
   Pipeline summiert werden (heute der Blocker).
2. Offene Defizite werden gewichtet/gerankt (größtes relatives Defizit zuerst; Sicherheits-/Min-Ziele
   wie B12 priorisiert).
3. Recommendation-Engine filtert einen kuratierten Food-Katalog nach dietForms + Allergien und scort
   Kandidaten danach, wie gut sie die Top-Defizite schließen, ohne kcal/Fett-Budget zu sprengen.
4. Ausgabe als Karte ('Dir fehlen noch 40 g Protein + Eisen → Vorschläge: …'), offline ohne LLM; der
   Coach formuliert daraus optional einen natürlichsprachlichen Nudge.

Benötigte Daten (heute fehlend):
- Mikronährstoff-Werte je Food (OFF-Nutriments) durch NewFoodInput/AiItem/computed/sumsByDate geführt.
- Mikro-Zielvorlagen pro dietForm/Persona (z. B. vegan: Eisen ~1.8x RDA, B12 min) als Goal-Regeln.
- Kuratierter Food-Katalog mit Tags (vegan, Allergene, nährstoffdicht) für den Offline-Fallback.
- Rest-zum-Ziel und Pro-Mahlzeit-Verteilung im Coach-Kontext (heute nur kcal/Makros).

## 5. Priorisierte Roadmap

**P0 — Daten-Fundament & Sicherheit (blockiert den USP, sicherheitsrelevant)**
1. Mikronährstoff-Pipeline end-to-end: micros in NewFoodInput, AiItem/per100, logFood.computed,
   OFF-mapProduct (iron/calcium/b12/zinc/fiber_100g), sumsByDate. Ohne dies ist der Differenzierer
   unsichtbar und die Recommendation-Engine unmöglich.
2. Allergen-Warnung reparieren: OFF-Allergen-Tags ins ReviewPayload durchreichen, gegen
   CoachMemory.allergies (en:-Taxonomie) matchen, Substring-im-Namen entfernen, Treffer rot +
   bewusste Bestätigung.
3. Datenintegritäts-Bugs: Profil-Reset → vollständiges Wipe + Bestätigung; Backup-Import mit
   zod-Validierung + version-Check *vor* clear(); Mengen/per100 auf ≥0 clampen.

**P1 — Kern-Mehrwert sichtbar machen**
4. Today: 'noch X g'-Restwert je Makro (v.a. Protein als Hero), Über-100%-Anzeige, kompakter
   'auf Kurs?'-Indikator.
5. Nährstoff-Detail-/Defizit-Screen auf Basis der neuen micros-Summen.
6. Deficit-Engine + Coach-Kontext erweitern: Rest-zum-Ziel je Nährstoff + Mikro-Summen +
   Pro-Mahlzeit-Protein in buildCoachContext.
7. Offline-Recommendation-Karte ('was noch essen') unabhängig vom LLM, gefiltert nach
   dietForms/Allergien.
8. Vegane Ziele wirksam machen (Mikro-Zielvorlagen in saveOnboarding; CoachMemory.diet befüllen).

**P2 — Flow- & UX-Politur**
9. Onboarding in validierten Mehrschritt-Flow umbauen; berechnete Ziele vor Start anzeigen.
10. Bestätigung/Undo für destruktive Aktionen (Log-Delete, Coach-Goal-Overwrite, Coach-Log).
11. Log-Edit-Flow + updateLog; Mitternachts-Tageswechsel reaktiv.
12. Capture-Preview + Retry-Button; Portions-Presets/Slider im Review.
13. UI-Disclaimer (keine medizinische Beratung) + Datenschutz-Hinweis; nutzerfreundliche Fehlertexte.
14. Kleinbugs: TTS von prefers-reduced-motion entkoppeln; Mic-aria-label i18n; Protein/kg aus
    persona+goal + g/kg-Override.
