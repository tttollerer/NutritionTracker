/**
 * Zuverlässige Allergen-Erkennung (EVALUATION P0, sicherheitsrelevant).
 * Primärquelle sind die strukturierten Open-Food-Facts-Allergen-Tags
 * (en:-Taxonomie). Fällt ein Lebensmittel ohne Tags an (KI/manuell), greift
 * ein mehrsprachiger Namens-Keyword-Abgleich als Fallback.
 */

/** Nutzer-Allergiekeys (COMMON_ALLERGENS) → Open-Food-Facts-Allergen-Tags. */
const OFF_TAGS: Record<string, string[]> = {
  gluten: ['gluten'],
  lactose: ['milk'],
  nuts: ['nuts', 'tree-nuts', 'almonds', 'hazelnuts', 'walnuts', 'cashew-nuts', 'pistachios'],
  peanuts: ['peanuts'],
  soy: ['soybeans', 'soy'],
  eggs: ['eggs'],
  fish: ['fish'],
}

/** Namens-Keywords (DE + EN) je Allergiekey für den Fallback. */
const KEYWORDS: Record<string, string[]> = {
  gluten: ['gluten', 'weizen', 'wheat', 'roggen', 'rye', 'gerste', 'barley', 'dinkel', 'brot', 'bread', 'nudel', 'pasta', 'mehl', 'flour'],
  lactose: ['laktose', 'lactose', 'milch', 'milk', 'käse', 'cheese', 'joghurt', 'yogurt', 'quark', 'sahne', 'cream', 'butter'],
  nuts: ['nuss', 'nüsse', 'nut', 'mandel', 'almond', 'haselnuss', 'hazelnut', 'walnuss', 'walnut', 'cashew', 'pistazie', 'pistachio'],
  peanuts: ['erdnuss', 'erdnüsse', 'peanut'],
  soy: ['soja', 'soy', 'tofu', 'edamame', 'sojabohne'],
  eggs: ['ei', 'eier', 'egg', 'omelett', 'omelette'],
  fish: ['fisch', 'fish', 'lachs', 'salmon', 'thunfisch', 'tuna', 'hering', 'herring', 'makrele', 'mackerel'],
}

/**
 * Liefert die zutreffenden Nutzer-Allergiekeys für ein Lebensmittel.
 * @param food.allergens  OFF-Allergen-Tags (en:-Präfix optional)
 * @param food.name       Lebensmittelname (Fallback)
 * @param userAllergies   im Profil hinterlegte Allergiekeys
 */
export function matchAllergens(
  food: { allergens?: string[]; name?: string },
  userAllergies: string[],
): string[] {
  if (userAllergies.length === 0) return []
  const tags = new Set((food.allergens ?? []).map((a) => a.replace(/^en:/, '').toLowerCase()))
  const name = (food.name ?? '').toLowerCase()

  const hits: string[] = []
  for (const key of userAllergies) {
    const byTag = (OFF_TAGS[key] ?? [key]).some((tag) => tags.has(tag))
    // Namens-Keywords nur als Fallback nutzen, wenn keine strukturierten Tags vorliegen.
    const byName = tags.size === 0 && (KEYWORDS[key] ?? []).some((kw) => name.includes(kw))
    if (byTag || byName) hits.push(key)
  }
  return hits
}
