import { v4 as uuid } from 'uuid'
import { db } from './index'
import type { CoachMemory, FoodItem, GlucoseContext, GlucoseReading, Goal, LogEntry, Meal, Measurement, Profile, Settings, Unit } from './types'
import { computeTargets, kcalFloor } from '@/lib/nutrition'
import { todayKey } from '@/lib/utils'

const now = () => Date.now()

/**
 * CoachMemory.diet aus den Ernährungsformen des Profils ableiten (Paket 11):
 * erste/kombinierte Form als kompakter String (z. B. "vegan+glutenfree"),
 * keine Formen → undefined (Feld bleibt leer statt Leerstring).
 */
export function dietFromForms(dietForms: string[] | undefined): string | undefined {
  const forms = (dietForms ?? []).map((f) => f.trim()).filter(Boolean)
  return forms.length ? forms.join('+') : undefined
}

/** Profil aus dem Onboarding speichern und daraus die Ziele ableiten. */
export async function saveOnboarding(profile: Omit<Profile, 'id' | 'updatedAt'>, allergies: string[]) {
  const fullProfile: Profile = { ...profile, id: 'me', updatedAt: now() }
  const goals = baseGoals(fullProfile)

  await db.transaction('rw', db.profile, db.goals, db.coachMemory, db.gamification, async () => {
    await db.profile.put(fullProfile)
    await db.goals.bulkPut(goals)
    // Ton einer bestehenden Memory (z. B. „Onboarding erneut") nicht zurücksetzen.
    const prevMemory = await db.coachMemory.get('me')
    await db.coachMemory.put({
      id: 'me',
      diet: dietFromForms(fullProfile.dietForms),
      allergies,
      dislikes: [],
      likes: [],
      tone: prevMemory?.tone ?? 'motivating',
      updatedAt: now(),
    })
    const existing = await db.gamification.get('me')
    if (!existing) {
      await db.gamification.put({
        id: 'me',
        points: 0,
        level: 1,
        streaks: {},
        freezeTokens: 1,
        unlocked: [],
        updatedAt: now(),
      })
    }
  })

  return { profile: fullProfile, targets: computeTargets(fullProfile) }
}

/** Profil bearbeiten und die Basis-Ziele neu berechnen (ohne Logs/Verlauf zu verlieren). */
export async function updateProfile(patch: Partial<Omit<Profile, 'id'>>) {
  const current = await db.profile.get('me')
  if (!current) return
  const updated: Profile = { ...current, ...patch, id: 'me', updatedAt: now() }
  const goals = baseGoals(updated)
  await db.transaction('rw', db.profile, db.goals, async () => {
    await db.profile.put(updated)
    // Basis-Ziele neu berechnen — aber Coach-Anpassungen nicht überschreiben.
    // Regel (einfachste robuste): Nährstoffe, für die ein aktives Ziel mit
    // createdBy 'coach' existiert, werden ausgelassen. `createdBy` ist der einzige
    // persistierte Änderungs-Marker: applyGoalSuggestion setzt beim Anpassen immer
    // 'coach' (auch wenn es das Basis-Ziel in-place editiert), und manuelle
    // Ziel-Änderungen laufen ausschließlich über dieses updateProfile selbst,
    // das die Basis-Ziele bewusst neu ableitet.
    const coachNutrients = new Set(
      (await db.goals.filter((g) => !g.deletedAt && g.createdBy === 'coach').toArray()).map(
        (g) => g.nutrient,
      ),
    )
    await db.goals.bulkPut(goals.filter((g) => !coachNutrients.has(g.nutrient)))
  })
  // Gewichtsänderung als Messpunkt festhalten, damit der Verlauf konsistent bleibt.
  if (patch.weightKg != null && patch.weightKg !== current.weightKg) {
    await addMeasurement('weight', patch.weightKg, 'kg')
  }
  // CoachMemory.diet mit den geänderten Ernährungsformen synchron halten (Paket 11).
  if (patch.dietForms) {
    await updateCoachMemory({ diet: dietFromForms(patch.dietForms) })
  }
  return { profile: updated, targets: computeTargets(updated) }
}

// ---- Coach-Gedächtnis (CoachMemory, PLAN.md §9.3) ----

export async function getCoachMemory(): Promise<CoachMemory | undefined> {
  return db.coachMemory.get('me')
}

/**
 * Felder des Coach-Gedächtnisses ändern (legt bei Bedarf einen Default-Datensatz
 * an, falls die Memory z. B. nach einem Alt-Import fehlt).
 */
export async function updateCoachMemory(patch: Partial<Omit<CoachMemory, 'id' | 'updatedAt'>>) {
  const cur = await db.coachMemory.get('me')
  const base: CoachMemory =
    cur ?? { id: 'me', allergies: [], dislikes: [], likes: [], tone: 'motivating', updatedAt: 0 }
  await db.coachMemory.put({ ...base, ...patch, id: 'me', updatedAt: now() })
}

/** Ton-Auswahl des Coachs (Profil-Screen, Paket 11). */
export async function setCoachTone(tone: CoachMemory['tone']) {
  await updateCoachMemory({ tone })
}

/** Die vier vom System abgeleiteten Basis-Ziele (deterministische IDs). */
function baseGoals(p: Profile): Goal[] {
  const t = computeTargets(p)
  return [
    mkGoal('kcal', p.goal === 'lose' ? 'max' : p.goal === 'gain' ? 'min' : 'range', t.kcal, 'kcal'),
    mkGoal('protein', 'min', t.protein, 'g'),
    mkGoal('carbs', 'range', t.carbs, 'g'),
    mkGoal('fat', 'range', t.fat, 'g'),
  ]
}

function mkGoal(nutrient: string, type: Goal['type'], target: number, unit: string): Goal {
  return {
    // Deterministische ID pro Nährstoff → Neuberechnung überschreibt,
    // statt doppelte aktive Ziele anzulegen.
    id: `base-${nutrient}`,
    nutrient,
    type,
    target,
    unit,
    active: true,
    createdBy: 'user',
    updatedAt: now(),
  }
}

export async function getProfile() {
  return db.profile.get('me')
}

/** Aktive Ziele als nutrient→Goal Map. */
export async function getActiveGoalsMap() {
  const goals = await db.goals.filter((g) => g.active && !g.deletedAt).toArray()
  return Object.fromEntries(goals.map((g) => [g.nutrient, g]))
}

export interface NewFoodInput {
  name: string
  per: 'g' | 'ml'
  kcal: number
  protein: number
  carbs: number
  fat: number
  micros?: Record<string, number>
  allergens?: string[]
  traces?: string[]
  source?: FoodItem['source']
  barcode?: string
}

/**
 * Lebensmittel im Katalog anlegen — mit Dedupe: existiert bereits ein Eintrag mit
 * gleichem Barcode (oder ersatzweise gleichem Namen), wird dieser aktualisiert
 * (Upsert) statt ein Duplikat zu erzeugen. defaultPortion des Treffers bleibt erhalten.
 *
 * `opts.dedupe = false` erzwingt einen neuen Eintrag auch bei Namens-/Barcode-Treffer —
 * für Fälle, in denen der Nutzer einen vorgeschlagenen Treffer explizit abgelehnt hat
 * (Review-Screen "schon gespeichert?"-Hinweis) und ein automatisches Überschreiben
 * der bestehenden Werte deshalb nicht gewünscht ist.
 */
export async function createFood(input: NewFoodInput, opts?: { dedupe?: boolean }): Promise<FoodItem> {
  const dedupe = opts?.dedupe ?? true
  const name = input.name.trim()
  const values = {
    per: input.per,
    kcal: input.kcal,
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
    micros: input.micros && Object.keys(input.micros).length ? input.micros : undefined,
    allergens: input.allergens?.length ? input.allergens : undefined,
    traces: input.traces?.length ? input.traces : undefined,
  }

  let existing: FoodItem | undefined
  if (dedupe) {
    if (input.barcode) {
      existing = await db.foods.where('barcode').equals(input.barcode).filter((f) => !f.deletedAt).first()
    }
    if (!existing) {
      const lower = name.toLowerCase()
      existing = await db.foods.filter((f) => !f.deletedAt && f.name.toLowerCase() === lower).first()
    }
  }

  if (existing) {
    const updated: FoodItem = {
      ...existing,
      ...values,
      name,
      barcode: input.barcode ?? existing.barcode,
      source: input.source ?? existing.source,
      updatedAt: now(),
    }
    await db.foods.put(updated)
    return updated
  }

  const food: FoodItem = {
    id: uuid(),
    name,
    source: input.source ?? 'manual',
    barcode: input.barcode,
    ...values,
    createdAt: now(),
    updatedAt: now(),
  }
  await db.foods.put(food)
  return food
}

/**
 * Katalog-Treffer per Namens-Match (case-insensitiv, getrimmt) — Lernschleife
 * im Prüf-Screen: bekannte Lebensmittel liefern ihre gemerkte defaultPortion
 * als Vorbelegung. Gleiche Match-Regel wie der createFood-Namens-Dedupe.
 */
export async function findFoodByName(name: string): Promise<FoodItem | undefined> {
  const lower = name.trim().toLowerCase()
  if (!lower) return undefined
  return db.foods.filter((f) => !f.deletedAt && f.name.toLowerCase() === lower).first()
}

/**
 * Vorschau auf den createFood-Dedupe-Treffer (Barcode zuerst, sonst Name) —
 * Grundlage für den "schon gespeichert?"-Hinweis im Review-Screen: der Nutzer
 * entscheidet bewusst, ob die gespeicherten Werte übernommen werden, statt dass
 * createFood sie automatisch überschreibt.
 */
export async function findFoodMatch(args: { name: string; barcode?: string }): Promise<FoodItem | undefined> {
  if (args.barcode) {
    const byBarcode = await db.foods.where('barcode').equals(args.barcode).filter((f) => !f.deletedAt).first()
    if (byBarcode) return byBarcode
  }
  return findFoodByName(args.name)
}

/** Hinterlegte Allergene des Nutzers (für Warnungen beim Erfassen). */
export async function getAllergies(): Promise<string[]> {
  const mem = await db.coachMemory.get('me')
  return mem?.allergies ?? []
}

// ---- Einstellungen / optionale Gesundheits-Module ----

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  bloodSugar: false,
  sugarWarner: false,
  glucoseUnit: 'mg/dl',
  photoConsent: false,
  updatedAt: 0,
}

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('app')) ?? DEFAULT_SETTINGS
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>) {
  const cur = await getSettings()
  await db.settings.put({ ...cur, ...patch, id: 'app', updatedAt: now() })
}

// ---- Blutzucker (Diabetes-Modul) ----

export async function addGlucose(mgdl: number, context: GlucoseContext, note?: string, date = todayKey()) {
  const reading: GlucoseReading = {
    id: uuid(),
    date,
    mgdl: Math.round(mgdl),
    context,
    note,
    loggedAt: now(),
    updatedAt: now(),
  }
  await db.glucose.put(reading)
}

export async function deleteGlucose(id: string) {
  await db.glucose.update(id, { deletedAt: now(), updatedAt: now() })
}

// ---- Verlaufswerte (Körper/Labor/Vitalwerte/Insulin) ----

export async function addMeasurement(type: string, value: number, unit: string, date = todayKey(), note?: string) {
  const m: Measurement = {
    id: uuid(),
    type,
    value,
    unit,
    date,
    note,
    loggedAt: now(),
    updatedAt: now(),
  }
  await db.measurements.put(m)
}

export async function deleteMeasurement(id: string) {
  await db.measurements.update(id, { deletedAt: now(), updatedAt: now() })
}

/** Alle (nicht gelöschten) Messwerte eines Typs, aufsteigend nach Datum. */
export async function measurementsByType(type: string): Promise<Measurement[]> {
  const all = await db.measurements.where('type').equals(type).filter((m) => !m.deletedAt).toArray()
  return all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.loggedAt - b.loggedAt))
}

/** Letztes Erfassungsdatum je Typ (für die Fälligkeits-Engine). */
export async function lastMeasurementDates(): Promise<Record<string, string>> {
  const all = await db.measurements.filter((m) => !m.deletedAt).toArray()
  const out: Record<string, string> = {}
  for (const m of all) {
    if (!out[m.type] || m.date > out[m.type]) out[m.type] = m.date
  }
  return out
}

/** Vom Coach vorgeschlagenes Ziel übernehmen (ersetzt ein vorhandenes pro Nährstoff). */
export async function applyGoalSuggestion(s: {
  nutrient: string
  type: Goal['type']
  target: number
  targetMax?: number
  unit: string
}) {
  // Sicherheit: ein vom Coach vorgeschlagenes kcal-Ziel darf nie unter den
  // physiologischen Floor fallen (Schutz vor gefährlich niedrigen Zielen).
  if (s.nutrient === 'kcal') {
    const profile = await db.profile.get('me')
    if (profile) {
      const floor = kcalFloor(profile)
      if (s.target < floor) s = { ...s, target: floor }
      if (s.targetMax != null && s.targetMax < floor) s = { ...s, targetMax: floor }
    }
  }
  const existing = await db.goals.filter((g) => g.nutrient === s.nutrient && !g.deletedAt).first()
  if (existing) {
    await db.goals.update(existing.id, { ...s, active: true, createdBy: 'coach', updatedAt: now() })
  } else {
    await db.goals.put({ id: uuid(), ...s, active: true, createdBy: 'coach', updatedAt: now() })
  }
}

/** Vom Coach vorgeschlagene Challenge als aktiv anlegen. */
export async function applyChallengeSuggestion(s: { title: string; period: 'day' | 'week' }) {
  await db.challenges.put({
    id: uuid(),
    title: s.title,
    rule: {},
    period: s.period,
    status: 'active',
    createdBy: 'coach',
    updatedAt: now(),
  })
}

/** Ein Lebensmittel aus dem kuratierten Katalog mit üblicher Portion loggen. */
export async function quickLogCatalog(
  c: {
    name: string
    per: 'g' | 'ml'
    kcal: number
    protein: number
    carbs: number
    fat: number
    micros: Record<string, number>
    serving: number
  },
  meal: Meal,
  date = todayKey(),
) {
  const food = await createFood({
    name: c.name,
    per: c.per,
    kcal: c.kcal,
    protein: c.protein,
    carbs: c.carbs,
    fat: c.fat,
    micros: c.micros,
  })
  return logFood({ food, date, meal, amount: c.serving, unit: c.per })
}

/** Verkleinertes Foto lokal speichern, gibt die Foto-ID zurück. */
export async function savePhoto(dataUrl: string): Promise<string> {
  const id = uuid()
  await db.photos.put({ id, dataUrl, createdAt: now(), updatedAt: now() })
  return id
}

/** Eine Portion eines Lebensmittels für einen Tag/Mahlzeit loggen. */
export async function logFood(args: {
  food: FoodItem
  date: string
  meal: Meal
  amount: number
  unit: Unit
  photoBlobId?: string
}): Promise<LogEntry> {
  const { food, date, meal, amount, unit, photoBlobId } = args

  const entry: LogEntry = {
    id: uuid(),
    foodId: food.id,
    date,
    meal,
    loggedAt: now(),
    amount,
    unit,
    computed: computeLogValues(food, amount, unit),
    photoBlobId,
    updatedAt: now(),
  }
  await db.logs.put(entry)
  // Übliche Portion nur für konkrete Mengen (g/ml) merken — eine 'portion'-Menge
  // würde sonst beim nächsten Loggen erneut mit der Portionsgröße multipliziert.
  if (unit !== 'portion') {
    await db.foods.update(food.id, { defaultPortion: { amount, unit }, updatedAt: now() })
  }
  return entry
}

/**
 * computed-Snapshot eines Log-Eintrags aus den Referenzwerten (je 100 g/ml)
 * des Lebensmittels berechnen; 'portion' nutzt defaultPortion oder 100er-Basis.
 * Gemeinsame Basis für logFood und updateLog.
 */
function computeLogValues(food: FoodItem, amount: number, unit: Unit): LogEntry['computed'] {
  const grams = unit === 'portion' ? (food.defaultPortion?.amount ?? 100) * amount : amount
  const factor = grams / 100
  return {
    kcal: Math.round(food.kcal * factor),
    protein: round1(food.protein * factor),
    carbs: round1(food.carbs * factor),
    fat: round1(food.fat * factor),
    micros: scaleMicros(food.micros, factor),
  }
}

/**
 * Menge und/oder Mahlzeit eines Log-Eintrags ändern; der computed-Snapshot wird
 * aus dem zugehörigen FoodItem neu berechnet. Gibt den aktualisierten Eintrag
 * zurück (undefined, wenn der Eintrag fehlt oder gelöscht ist).
 */
export async function updateLog(
  id: string,
  patch: { amount?: number; unit?: Unit; meal?: Meal },
): Promise<LogEntry | undefined> {
  return db.transaction('rw', db.logs, db.foods, async () => {
    const entry = await db.logs.get(id)
    if (!entry || entry.deletedAt) return undefined
    const food = await db.foods.get(entry.foodId)
    const amount = patch.amount ?? entry.amount
    const unit = patch.unit ?? entry.unit
    const updated: LogEntry = {
      ...entry,
      amount,
      unit,
      meal: patch.meal ?? entry.meal,
      // Ohne Food (sollte nicht vorkommen) bleibt der alte Snapshot stehen,
      // statt Werte aus der Luft zu greifen.
      computed: food ? computeLogValues(food, amount, unit) : entry.computed,
      updatedAt: now(),
    }
    await db.logs.put(updated)
    return updated
  })
}

/** Soft-Delete eines Log-Eintrags (sync-freundlich). */
export async function deleteLog(id: string) {
  await db.logs.update(id, { deletedAt: now(), updatedAt: now() })
}

/** Soft-Delete rückgängig machen (Undo-Snackbar). */
export async function restoreLog(id: string) {
  // Dexie entfernt Properties, die im update() auf undefined gesetzt werden.
  await db.logs.update(id, { deletedAt: undefined, updatedAt: now() })
}

/** Zuletzt benutzte Lebensmittel (für Schnell-Wiederholung). */
export async function recentFoods(limit = 8): Promise<FoodItem[]> {
  const foods = await db.foods.filter((f) => !f.deletedAt).toArray()
  return foods.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
}

// ---- Favoriten, Katalog-Suche & „Gestern kopieren" (Paket 12, PLAN §7.2) ----

/**
 * Favoriten-Stern eines Lebensmittels umschalten. `favorite` ist bewusst nicht
 * indiziert (siehe FoodItem) — kein Dexie-Versionssprung nötig. Beim Entfernen
 * wird das Feld ganz gelöscht (Dexie entfernt undefined-Properties), damit die
 * Datensätze sync-sauber bleiben. Gibt den neuen Zustand zurück.
 */
export async function toggleFavorite(foodId: string): Promise<boolean> {
  const food = await db.foods.get(foodId)
  if (!food || food.deletedAt) return false
  const next = !food.favorite
  await db.foods.update(foodId, { favorite: next || undefined, updatedAt: now() })
  return next
}

/** Alle favorisierten Lebensmittel, alphabetisch (stabile 1-Tap-Liste). */
export async function favoriteFoods(): Promise<FoodItem[]> {
  const foods = await db.foods.filter((f) => !f.deletedAt && !!f.favorite).toArray()
  return foods.sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

/**
 * Match-Regel der Katalog-Suche: case-insensitives „Name enthält Suchbegriff"
 * (getrimmt). Als pure Funktion exportiert, damit sie direkt testbar ist.
 */
export function foodNameMatches(name: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  return q.length > 0 && name.toLowerCase().includes(q)
}

/**
 * Eigenen Lebensmittel-Katalog (db.foods) durchsuchen — ohne Soft-Deleted,
 * Favoriten zuerst, danach zuletzt benutzte; max. `limit` Treffer.
 */
export async function searchFoods(query: string, limit = 20): Promise<FoodItem[]> {
  if (!query.trim()) return []
  const hits = await db.foods.filter((f) => !f.deletedAt && foodNameMatches(f.name, query)).toArray()
  return hits
    .sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || b.updatedAt - a.updatedAt)
    .slice(0, limit)
}

/** Vortag eines 'YYYY-MM-DD'-Schlüssels (lokal, DST-sicher über setDate). */
function previousDayKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() - 1)
  return todayKey(dt)
}

/** Anzahl gestriger (nicht gelöschter) Einträge — steuert den „Gestern kopieren"-Button. */
export async function yesterdayLogCount(targetDate = todayKey()): Promise<number> {
  return db.logs
    .where('date')
    .equals(previousDayKey(targetDate))
    .filter((l) => !l.deletedAt)
    .count()
}

/**
 * Alle gestrigen Logs (optional nur eine Mahlzeit) auf heute kopieren:
 * neue UUIDs, loggedAt jetzt, computed-Snapshot wird ÜBERNOMMEN (nicht neu
 * berechnet — auch wenn sich das Lebensmittel inzwischen geändert hat, bleibt
 * die Kopie identisch zu dem, was gestern gegessen wurde). Foto und aiRaw
 * werden bewusst nicht mitkopiert (sie gehören zur gestrigen Aufnahme).
 * Gibt die Kopien zurück (Undo: alle wieder löschen).
 */
export async function copyYesterday(meal?: Meal, targetDate = todayKey()): Promise<LogEntry[]> {
  const source = await db.logs
    .where('date')
    .equals(previousDayKey(targetDate))
    .filter((l) => !l.deletedAt && (!meal || l.meal === meal))
    .toArray()
  const copies: LogEntry[] = source.map((l) => ({
    id: uuid(),
    foodId: l.foodId,
    date: targetDate,
    meal: l.meal,
    loggedAt: now(),
    amount: l.amount,
    unit: l.unit,
    computed: structuredClone(l.computed),
    updatedAt: now(),
  }))
  if (copies.length) await db.logs.bulkPut(copies)
  return copies
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}

/** Mikronährstoffe (je 100 g) auf die gegessene Menge skalieren. */
function scaleMicros(
  micros: Record<string, number> | undefined,
  factor: number,
): Record<string, number> | undefined {
  if (!micros) return undefined
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(micros)) out[k] = Math.round(v * factor * 100) / 100
  return out
}

// ---- Wasser-Tracking (PLAN.md §9 Komfort) ----

/** Empfohlene Tagesmenge Wasser (ml): ~35 ml/kg, sonst 2000 ml. */
export function waterGoalMl(weightKg?: number): number {
  return weightKg ? Math.round((weightKg * 35) / 50) * 50 : 2000
}

export async function addWater(ml: number, date = todayKey()) {
  await db.water.put({ id: uuid(), date, ml, loggedAt: now(), updatedAt: now() })
}

/**
 * Letzten Wasser-Eintrag des Tages zurücknehmen (Undo).
 * Bewusst harter Delete: Das Undo entfernt einen soeben lokal angelegten Eintrag,
 * und die Wasser-Anzeige summiert ohne deletedAt-Filter. Beim Cloud-Sync (Phase 5)
 * auf Soft-Delete (deletedAt-Tombstone, Feld existiert seit Schema v5) umstellen.
 */
export async function undoLastWater(date = todayKey()) {
  const entries = await db.water.where('date').equals(date).filter((w) => !w.deletedAt).toArray()
  const last = entries.sort((a, b) => b.loggedAt - a.loggedAt)[0]
  if (last) await db.water.delete(last.id)
}

/** ALLE Stores leeren (kompletter Reset, z. B. „Onboarding erneut"). */
export async function resetAllData() {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })
}
