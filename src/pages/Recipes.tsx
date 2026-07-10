import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import { CookingPot, Pencil, Plus, Search, Trash2, Utensils, X } from 'lucide-react'
import type { FoodItem, Meal, Recipe, Unit } from '@/db/types'
import { db } from '@/db'
import { deleteLog, searchFoods } from '@/db/repo'
import {
  createRecipe,
  deleteRecipe,
  listRecipes,
  logRecipe,
  recipeCostPerPortion,
  recipeKcalPerPortion,
  restoreRecipe,
  updateRecipe,
  type LogRecipeResult,
} from '@/lib/recipes'
import { incrementPantry } from '@/lib/pantryStock'
import { formatEuro, parsePositiveNumber } from '@/lib/money'
import { defaultMeal, MEALS } from '@/lib/meal'
import { useOverlays } from '@/lib/overlays-context'
import { todayKey } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { Field, Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'

/**
 * Eigene Rezepte: Liste mit Kosten/kcal je Portion, Anlegen/Bearbeiten mit
 * Zutaten-Picker über die eigene Katalog-Suche, Loggen über ein Bottom-Sheet
 * (Mahlzeit + gegessene Portionen → logRecipe), Löschen als Tombstone + Undo.
 */
export function Recipes() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { showUndo } = useOverlays()
  const recipes = useLiveQuery(() => listRecipes(), [])
  // Katalog-Map für Kosten-/kcal-Anzeige je Portion (eine Abfrage für alle Zeilen).
  const foodsMap = useLiveQuery(
    async () => new Map((await db.foods.filter((f) => !f.deletedAt).toArray()).map((f) => [f.id, f] as const)),
    [],
  )
  const [editing, setEditing] = useState<Recipe | 'new' | null>(null)
  const [logging, setLogging] = useState<Recipe | null>(null)

  async function remove(recipe: Recipe) {
    await deleteRecipe(recipe.id)
    showUndo(t('recipes.deleted'), () => restoreRecipe(recipe.id))
  }

  if (editing) {
    return (
      <RecipeForm
        recipe={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
      />
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('recipes.title')}>
        <ProfileAvatar />
      </PageHeader>

      <Button className="w-full" onClick={() => setEditing('new')}>
        <Plus size={18} /> {t('recipes.new')}
      </Button>

      {recipes === undefined || foodsMap === undefined ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : recipes.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          <CookingPot size={28} aria-hidden="true" className="mx-auto mb-2 text-primary" />
          {t('recipes.empty')}
        </Card>
      ) : (
        <div className="space-y-2">
          {recipes.map((r) => (
            <RecipeRow
              key={r.id}
              recipe={r}
              foodsMap={foodsMap}
              onLog={() => setLogging(r)}
              onEdit={() => setEditing(r)}
              onDelete={() => void remove(r)}
            />
          ))}
        </div>
      )}

      {/* Loggen: Mahlzeit + gegessene Portionen → ein LogEntry je Zutat + Undo. */}
      <RecipeLogSheet
        recipe={logging}
        foodsMap={foodsMap ?? new Map()}
        onClose={() => setLogging(null)}
        onLogged={({ entries, pantryTook }) => {
          showUndo(t('recipes.logged', { count: entries.length }), async () => {
            await Promise.all(entries.map((e) => deleteLog(e.id)))
            // Nur zurücklegen, was beim Loggen wirklich abging (Muster Add/Pantry).
            await Promise.all(pantryTook.map((id) => incrementPantry(id)))
          })
          navigate('/')
        }}
      />
    </div>
  )
}

function RecipeRow({
  recipe,
  foodsMap,
  onLog,
  onEdit,
  onDelete,
}: {
  recipe: Recipe
  foodsMap: Map<string, FoodItem>
  onLog: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const cost = recipeCostPerPortion(recipe, foodsMap)
  const kcal = recipeKcalPerPortion(recipe, foodsMap)
  const meta = [
    t('recipes.portionCount', { count: recipe.portions }),
    kcal != null ? t('recipes.kcalPerPortion', { kcal }) : null,
    cost != null ? t('recipes.costPerPortion', { amount: formatEuro(cost) }) : null,
    t('recipes.ingredientCount', { count: recipe.ingredients.length }),
  ].filter(Boolean)

  return (
    <Card className="space-y-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{recipe.name}</p>
          <p className="text-xs text-muted-foreground">{meta.join(' · ')}</p>
          {recipe.description && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{recipe.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={onEdit}
            aria-label={t('recipes.editAria', { name: recipe.name })}
            className="focus-ring flex h-12 w-12 items-center justify-center rounded-md text-muted-foreground"
          >
            <Pencil size={20} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={t('recipes.deleteAria', { name: recipe.name })}
            className="focus-ring flex h-12 w-12 items-center justify-center rounded-md text-muted-foreground"
          >
            <Trash2 size={20} />
          </button>
        </div>
      </div>
      <Button
        variant="secondary"
        className="w-full"
        onClick={onLog}
        aria-label={t('recipes.logAria', { name: recipe.name })}
      >
        <Utensils size={18} /> {t('recipes.log')}
      </Button>
    </Card>
  )
}

/** Zutat im Formular: Menge als Text (Komma erlaubt), Einheit wie PortionSheet. */
interface DraftIngredient {
  food: FoodItem
  amountText: string
  unit: Unit
}

function toDraft(ing: { foodId: string; amount: number; unit: Unit }, foodsMap: Map<string, FoodItem>): DraftIngredient | null {
  const food = foodsMap.get(ing.foodId)
  if (!food) return null
  return { food, amountText: String(ing.amount).replace('.', ','), unit: ing.unit }
}

/** Anlegen/Bearbeiten eines Rezepts inkl. Zutaten-Picker über searchFoods. */
function RecipeForm({ recipe, onClose }: { recipe: Recipe | null; onClose: () => void }) {
  const { t } = useTranslation()
  const { showUndo } = useOverlays()
  const [name, setName] = useState(recipe?.name ?? '')
  const [portionsText, setPortionsText] = useState(String(recipe?.portions ?? 4))
  const [description, setDescription] = useState(recipe?.description ?? '')
  const [ingredients, setIngredients] = useState<DraftIngredient[] | null>(null)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const results = useLiveQuery(() => searchFoods(query, 8), [query])

  // Bestehende Zutaten einmalig zu Entwürfen auflösen (Foods nachladen).
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!recipe) {
        setIngredients([])
        return
      }
      const foods = await db.foods.bulkGet(recipe.ingredients.map((i) => i.foodId))
      const map = new Map(foods.filter((f): f is FoodItem => !!f).map((f) => [f.id, f] as const))
      if (!cancelled) {
        setIngredients(recipe.ingredients.map((i) => toDraft(i, map)).filter((d): d is DraftIngredient => !!d))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [recipe])

  const portions = parsePositiveNumber(portionsText)
  const parsed = useMemo(
    () =>
      (ingredients ?? []).map((d) => ({
        draft: d,
        amount: parsePositiveNumber(d.amountText),
      })),
    [ingredients],
  )
  const valid =
    name.trim().length > 0 &&
    portions != null &&
    parsed.length > 0 &&
    parsed.every((p) => p.amount != null)

  function addIngredient(food: FoodItem) {
    setQuery('')
    setIngredients((list) => {
      if (!list || list.some((d) => d.food.id === food.id)) return list
      const dp = food.defaultPortion
      return [
        ...list,
        { food, amountText: String(dp?.amount ?? 100), unit: dp?.unit ?? food.per },
      ]
    })
  }

  function patchIngredient(foodId: string, patch: Partial<Pick<DraftIngredient, 'amountText' | 'unit'>>) {
    setIngredients((list) => (list ?? []).map((d) => (d.food.id === foodId ? { ...d, ...patch } : d)))
  }

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    try {
      const input = {
        name: name.trim(),
        portions: Math.round(portions!),
        description: description.trim() || undefined,
        ingredients: parsed.map((p) => ({ foodId: p.draft.food.id, amount: p.amount!, unit: p.draft.unit })),
      }
      if (recipe) await updateRecipe(recipe.id, input)
      else {
        const created = await createRecipe(input)
        // Undo für versehentliches Anlegen — konsistent zum Löschen.
        showUndo(t('recipes.saved'), () => deleteRecipe(created.id))
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={recipe ? t('recipes.edit') : t('recipes.new')} />

      <Card className="space-y-3 p-4">
        <Field label={t('recipes.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('recipes.namePh')} />
        </Field>
        <Field label={t('recipes.portions')}>
          <Input
            type="text"
            inputMode="numeric"
            value={portionsText}
            onChange={(e) => setPortionsText(e.target.value)}
            aria-invalid={portions == null}
          />
        </Field>
        <Field label={t('recipes.description')}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('recipes.descriptionPh')}
            rows={3}
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-base outline-none ring-ring focus:ring-2"
          />
        </Field>
      </Card>

      {/* Zutaten: Mengen gelten für das GANZE Rezept (alle Portionen). */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t('recipes.ingredients')}</h2>
        {(ingredients ?? []).map((d) => {
          const amount = parsePositiveNumber(d.amountText)
          const units: Unit[] = d.food.defaultPortion ? [d.food.per, 'portion'] : [d.food.per]
          return (
            <Card key={d.food.id} className="space-y-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate font-medium">{d.food.name}</p>
                <button
                  type="button"
                  onClick={() => setIngredients((list) => (list ?? []).filter((x) => x.food.id !== d.food.id))}
                  aria-label={t('recipes.removeIngredient', { name: d.food.name })}
                  className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-muted-foreground"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={d.amountText}
                  onChange={(e) => patchIngredient(d.food.id, { amountText: e.target.value })}
                  aria-label={t('today.edit.amount')}
                  aria-invalid={amount == null}
                  className="flex-1"
                />
                {units.length > 1 ? (
                  <div className="flex shrink-0 gap-1" role="group" aria-label={t('today.edit.unit')}>
                    {units.map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => patchIngredient(d.food.id, { unit: u })}
                        aria-pressed={d.unit === u}
                        className={`focus-ring min-h-[48px] rounded-xl border px-3 text-sm font-medium transition-colors ${
                          d.unit === u
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input bg-background text-foreground'
                        }`}
                      >
                        {u === 'portion' ? d.food.defaultPortion?.label ?? t('today.edit.unitPortion') : u}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="flex min-h-[48px] shrink-0 items-center px-2 text-sm text-muted-foreground">
                    {d.unit === 'portion' ? t('today.edit.unitPortion') : d.unit}
                  </span>
                )}
              </div>
            </Card>
          )
        })}

        {/* Zutaten-Picker über die eigene Katalog-Suche */}
        <div className="relative">
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('add.searchPh')}
            aria-label={t('recipes.addIngredient')}
            className="pl-10"
          />
        </div>
        {query.trim().length > 0 && results && (
          results.length > 0 ? (
            <div className="space-y-1">
              {results.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => addIngredient(f)}
                  className="focus-ring flex min-h-[48px] w-full items-center gap-2 rounded-lg border border-border bg-card px-3 text-left"
                >
                  <Plus size={18} aria-hidden="true" className="shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{f.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {f.kcal} kcal / 100 {f.per}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('add.searchNone')}</p>
          )
        )}
      </section>

      <div className="flex gap-3">
        <Button variant="ghost" className="flex-1 border border-input" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button className="flex-1" onClick={() => void save()} disabled={!valid || saving}>
          {t('recipes.save')}
        </Button>
      </div>
    </div>
  )
}

/** Bottom-Sheet zum Loggen: Mahlzeit + gegessene Portionen (Muster PortionSheet). */
function RecipeLogSheet({
  recipe,
  foodsMap,
  onClose,
  onLogged,
}: {
  recipe: Recipe | null
  foodsMap: Map<string, FoodItem>
  onClose: () => void
  onLogged: (result: LogRecipeResult) => void
}) {
  const { t } = useTranslation()

  return (
    <AnimatePresence>
      {recipe && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-3xl bg-card p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-lg"
            role="dialog"
            aria-label={t('recipes.logAria', { name: recipe.name })}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted" />
            <RecipeLogForm key={recipe.id} recipe={recipe} foodsMap={foodsMap} onClose={onClose} onLogged={onLogged} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function RecipeLogForm({
  recipe,
  foodsMap,
  onClose,
  onLogged,
}: {
  recipe: Recipe
  foodsMap: Map<string, FoodItem>
  onClose: () => void
  onLogged: (result: LogRecipeResult) => void
}) {
  const { t } = useTranslation()
  const [meal, setMeal] = useState<Meal>(defaultMeal())
  const [portionsText, setPortionsText] = useState('1')
  const [saving, setSaving] = useState(false)

  const portionsEaten = parsePositiveNumber(portionsText)
  const kcalPerPortion = recipeKcalPerPortion(recipe, foodsMap)
  const costPerPortion = recipeCostPerPortion(recipe, foodsMap)
  const preview = [
    kcalPerPortion != null && portionsEaten != null ? `${Math.round(kcalPerPortion * portionsEaten)} kcal` : null,
    costPerPortion != null && portionsEaten != null ? formatEuro(Math.round(costPerPortion * portionsEaten * 100) / 100) : null,
  ].filter(Boolean)

  // Schnellwahl üblicher Portionsgrößen — freie Eingabe bleibt möglich.
  const presets = [
    { label: '½', value: 0.5 },
    { label: '1', value: 1 },
    { label: '1½', value: 1.5 },
    { label: '2', value: 2 },
  ]

  async function save() {
    if (portionsEaten == null || saving) return
    setSaving(true)
    try {
      const result = await logRecipe(recipe.id, { date: todayKey(), meal, portionsEaten })
      onClose()
      if (result.entries.length > 0) onLogged(result)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{recipe.name}</h2>

      <div>
        <p className="mb-1.5 text-sm font-medium text-muted-foreground">{t('today.edit.meal')}</p>
        <div className="flex flex-wrap gap-2">
          {MEALS.map((m) => (
            <Chip key={m} label={t(`today.meals.${m}`)} selected={meal === m} onClick={() => setMeal(m)} />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Field label={t('recipes.portionsEaten')}>
          <Input
            type="text"
            inputMode="decimal"
            value={portionsText}
            onChange={(e) => setPortionsText(e.target.value)}
            aria-invalid={portionsEaten == null}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <Chip
              key={p.label}
              label={p.label}
              selected={portionsEaten === p.value}
              onClick={() => setPortionsText(String(p.value).replace('.', ','))}
            />
          ))}
        </div>
        {preview.length > 0 && (
          <p className="text-xs text-muted-foreground">{preview.join(' · ')}</p>
        )}
      </div>

      <div className="flex gap-3 pt-1">
        <Button variant="ghost" className="flex-1 border border-input" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button className="flex-1" onClick={() => void save()} disabled={portionsEaten == null || saving}>
          {t('recipes.log')}
        </Button>
      </div>
    </div>
  )
}
