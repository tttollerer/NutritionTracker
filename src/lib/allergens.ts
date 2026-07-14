/**
 * Zuverlässige Allergen-Erkennung (sicherheitsrelevant, P0).
 * Primärquelle sind die strukturierten Open-Food-Facts-Allergen-Tags
 * (en:-Taxonomie). Fällt ein Lebensmittel ohne Tags an (KI/manuell), greift
 * ein mehrsprachiger Namens-Keyword-Abgleich als Fallback.
 *
 * Es wird zwischen `contains` (enthält das Allergen — harte Warnung) und
 * `traces` (Spuren / „kann Spuren enthalten" — eigene, mildere Warnklasse)
 * unterschieden. Beides deckt die 14 EU-kennzeichnungspflichtigen Allergene ab.
 */

/** Nutzer-Allergiekeys (COMMON_ALLERGENS) → Open-Food-Facts-Allergen-Tags. */
const OFF_TAGS: Record<string, string[]> = {
  gluten: ['gluten'],
  crustaceans: ['crustaceans'],
  eggs: ['eggs'],
  fish: ['fish'],
  peanuts: ['peanuts'],
  soy: ['soybeans', 'soy'],
  lactose: ['milk'],
  nuts: [
    'nuts',
    'tree-nuts',
    'almonds',
    'hazelnuts',
    'walnuts',
    'cashew-nuts',
    'pistachios',
    'pecan-nuts',
    'brazil-nuts',
    'macadamia-nuts',
    'queensland-nuts',
  ],
  celery: ['celery'],
  mustard: ['mustard'],
  sesame: ['sesame-seeds', 'sesame'],
  sulphites: ['sulphur-dioxide-and-sulphites', 'sulphur-dioxide', 'sulphites'],
  lupin: ['lupin'],
  molluscs: ['molluscs'],
}

/** Namens-Keywords (DE + EN) je Allergiekey für den Fallback. */
const KEYWORDS: Record<string, string[]> = {
  gluten: ['gluten', 'weizen', 'wheat', 'roggen', 'rye', 'gerste', 'barley', 'dinkel', 'brot', 'bread', 'nudel', 'pasta', 'mehl', 'flour'],
  crustaceans: ['krebs', 'garnele', 'shrimp', 'prawn', 'krabbe', 'crab', 'hummer', 'lobster', 'languste', 'scampi', 'krill'],
  eggs: ['ei', 'eier', 'egg', 'eggs', 'rührei', 'spiegelei', 'omelett', 'omelette', 'mayonnaise'],
  fish: ['fisch', 'fish', 'lachs', 'salmon', 'thunfisch', 'tuna', 'hering', 'herring', 'makrele', 'mackerel', 'anchovis', 'anchovy'],
  peanuts: ['erdnuss', 'erdnüsse', 'peanut'],
  soy: ['soja', 'soy', 'tofu', 'edamame', 'sojabohne', 'tempeh'],
  lactose: ['laktose', 'lactose', 'milch', 'milk', 'käse', 'cheese', 'joghurt', 'yogurt', 'quark', 'sahne', 'cream', 'butter', 'molke', 'whey'],
  nuts: ['nuss', 'nüsse', 'nut', 'mandel', 'almond', 'haselnuss', 'hazelnut', 'walnuss', 'walnut', 'cashew', 'pistazie', 'pistachio', 'pekan', 'pecan', 'macadamia'],
  celery: ['sellerie', 'celery'],
  mustard: ['senf', 'mustard'],
  sesame: ['sesam', 'sesame', 'tahin', 'tahini'],
  sulphites: ['sulfit', 'sulphite', 'schwefel', 'sulfur', 'sulphur'],
  lupin: ['lupine', 'lupin'],
  molluscs: ['muschel', 'mussel', 'auster', 'oyster', 'tintenfisch', 'squid', 'calamari', 'octopus', 'schnecke', 'snail', 'weichtier'],
}

/**
 * Kurze, hochgradig mehrdeutige Keywords zählen nur als eigenständiges Wort —
 * als Substring stecken sie in harmlosen Namen ('ei' in Reis/Wein/Fleisch,
 * 'egg' in Veggie, 'nut' in Minute/Donut).
 */
const WHOLE_WORD_ONLY = new Set(['ei', 'egg', 'eggs', 'nut', 'nuts'])

/** Nur am Wortanfang matchen: „Eiersalat" ja, „Feierabend" nein. */
const WORD_PREFIX_ONLY = new Set(['eier'])

/** „glutenfrei"/„laktosefrei" im Namen hebt den Keyword-Fallback auf. */
const NEGATIONS: Record<string, string[]> = {
  gluten: ['glutenfrei', 'gluten-free', 'gluten free'],
  lactose: ['laktosefrei', 'lactose-free', 'lactose free', 'milchfrei'],
  eggs: ['eifrei', 'egg-free', 'egg free'],
}

function nameMatchesKeyword(name: string, words: string[], kw: string): boolean {
  if (WHOLE_WORD_ONLY.has(kw)) return words.includes(kw)
  if (WORD_PREFIX_ONLY.has(kw)) return words.some((w) => w.startsWith(kw))
  // Substring deckt deutsche Komposita ab (Vollmilchschokolade, Dinkelbrot).
  return name.includes(kw)
}

function normTags(tags?: string[]): Set<string> {
  return new Set((tags ?? []).map((a) => a.replace(/^en:/, '').toLowerCase()))
}

/**
 * Vollständiger Allergen-Abgleich für ein Lebensmittel.
 * @returns `contains` (enthält das Allergen) und `traces` (kann Spuren enthalten),
 *          jeweils als Liste der zutreffenden Nutzer-Allergiekeys (überschneidungsfrei).
 */
export function checkAllergens(
  food: { allergens?: string[]; traces?: string[]; name?: string },
  userAllergies: string[],
): { contains: string[]; traces: string[] } {
  if (userAllergies.length === 0) return { contains: [], traces: [] }
  const allergenTags = normTags(food.allergens)
  const traceTags = normTags(food.traces)
  const name = (food.name ?? '').toLowerCase()
  const words = name.split(/[^a-zäöüßà-ÿ]+/).filter(Boolean)
  const hasStructured = allergenTags.size > 0 || traceTags.size > 0

  const contains: string[] = []
  const traces: string[] = []
  for (const key of userAllergies) {
    const tagList = OFF_TAGS[key] ?? [key]
    if (tagList.some((tag) => allergenTags.has(tag))) {
      contains.push(key)
      continue
    }
    // Spuren-Tags sind eine eigene, mildere Warnklasse.
    if (tagList.some((tag) => traceTags.has(tag))) {
      traces.push(key)
      continue
    }
    // Namens-Keywords nur als Fallback nutzen, wenn keine strukturierten Tags vorliegen.
    if (
      !hasStructured &&
      !(NEGATIONS[key] ?? []).some((neg) => name.includes(neg)) &&
      (KEYWORDS[key] ?? []).some((kw) => nameMatchesKeyword(name, words, kw))
    ) {
      contains.push(key)
    }
  }
  return { contains, traces }
}

/**
 * Liefert die enthaltenen Nutzer-Allergiekeys (harte Treffer ohne Spuren).
 * Rückwärtskompatibel zur früheren Signatur.
 */
export function matchAllergens(
  food: { allergens?: string[]; traces?: string[]; name?: string },
  userAllergies: string[],
): string[] {
  return checkAllergens(food, userAllergies).contains
}
