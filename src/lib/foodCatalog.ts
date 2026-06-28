/**
 * Kuratierter Lebensmittel-Katalog: dient (a) als Schnell-Erfassung häufiger
 * Lebensmittel inkl. "Laster" (Kaffee, Bier, Wein …) und (b) als Datenquelle
 * für die deterministische Empfehlungs-Engine ("was noch essen", offline,
 * ohne LLM). Werte je 100 g/ml; `serving` = übliche Portion.
 */
export interface CatalogFood {
  id: string
  name: string
  per: 'g' | 'ml'
  kcal: number
  protein: number
  carbs: number
  fat: number
  micros: Record<string, number>
  serving: number
  vegan: boolean
  allergens: string[]
  vice?: boolean
}

export const FOOD_CATALOG: CatalogFood[] = [
  // Protein / nährstoffdicht
  { id: 'quark', name: 'Magerquark', per: 'g', kcal: 67, protein: 12, carbs: 4, fat: 0.3, micros: { calcium: 120, vitaminB12: 0.7 }, serving: 250, vegan: false, allergens: ['lactose', 'milk'] },
  { id: 'chicken', name: 'Hähnchenbrust', per: 'g', kcal: 165, protein: 31, carbs: 0, fat: 3.6, micros: { zinc: 1, vitaminB12: 0.3, potassium: 256 }, serving: 150, vegan: false, allergens: [] },
  { id: 'salmon', name: 'Lachs', per: 'g', kcal: 208, protein: 20, carbs: 0, fat: 13, micros: { omega3: 2.3, vitaminD: 11, vitaminB12: 3 }, serving: 150, vegan: false, allergens: ['fish'] },
  { id: 'eggs', name: 'Eier', per: 'g', kcal: 155, protein: 13, carbs: 1.1, fat: 11, micros: { vitaminD: 2, vitaminB12: 1.1, zinc: 1.3 }, serving: 120, vegan: false, allergens: ['eggs'] },
  { id: 'yogurt', name: 'Naturjoghurt', per: 'g', kcal: 61, protein: 3.5, carbs: 4.7, fat: 3.3, micros: { calcium: 121, vitaminB12: 0.5 }, serving: 200, vegan: false, allergens: ['lactose', 'milk'] },
  { id: 'tofu', name: 'Tofu', per: 'g', kcal: 144, protein: 15, carbs: 3, fat: 9, micros: { calcium: 350, iron: 2.7, magnesium: 58, zinc: 1.6 }, serving: 150, vegan: true, allergens: ['soy'] },
  { id: 'lentils', name: 'Linsen (gekocht)', per: 'g', kcal: 116, protein: 9, carbs: 20, fat: 0.4, micros: { iron: 3.3, fiber: 8, magnesium: 36, zinc: 1.3, potassium: 369 }, serving: 200, vegan: true, allergens: [] },
  { id: 'chickpeas', name: 'Kichererbsen', per: 'g', kcal: 164, protein: 9, carbs: 27, fat: 2.6, micros: { iron: 2.9, fiber: 8, magnesium: 48 }, serving: 200, vegan: true, allergens: [] },
  { id: 'oats', name: 'Haferflocken', per: 'g', kcal: 370, protein: 13, carbs: 60, fat: 7, micros: { iron: 4.7, magnesium: 140, zinc: 4, fiber: 10 }, serving: 60, vegan: true, allergens: ['gluten'] },
  { id: 'spinach', name: 'Spinat', per: 'g', kcal: 23, protein: 2.9, carbs: 1.4, fat: 0.4, micros: { iron: 2.7, calcium: 99, magnesium: 79, vitaminC: 28, potassium: 558 }, serving: 100, vegan: true, allergens: [] },
  { id: 'broccoli', name: 'Brokkoli', per: 'g', kcal: 34, protein: 2.8, carbs: 7, fat: 0.4, micros: { vitaminC: 89, calcium: 47, fiber: 2.6, potassium: 316 }, serving: 150, vegan: true, allergens: [] },
  { id: 'orange', name: 'Orange', per: 'g', kcal: 47, protein: 0.9, carbs: 12, fat: 0.1, micros: { vitaminC: 53, fiber: 2.4, calcium: 40 }, serving: 130, vegan: true, allergens: [] },
  { id: 'banana', name: 'Banane', per: 'g', kcal: 89, protein: 1.1, carbs: 23, fat: 0.3, micros: { potassium: 358, magnesium: 27, fiber: 2.6, vitaminC: 9 }, serving: 120, vegan: true, allergens: [] },
  { id: 'almonds', name: 'Mandeln', per: 'g', kcal: 579, protein: 21, carbs: 22, fat: 50, micros: { calcium: 269, magnesium: 270, fiber: 12, zinc: 3 }, serving: 30, vegan: true, allergens: ['nuts'] },
  { id: 'walnuts', name: 'Walnüsse', per: 'g', kcal: 654, protein: 15, carbs: 14, fat: 65, micros: { omega3: 9, magnesium: 158, fiber: 6.7 }, serving: 30, vegan: true, allergens: ['nuts'] },
  { id: 'chia', name: 'Chiasamen', per: 'g', kcal: 486, protein: 17, carbs: 42, fat: 31, micros: { omega3: 17, calcium: 631, fiber: 34, iron: 7.7, magnesium: 335 }, serving: 20, vegan: true, allergens: [] },
  { id: 'wholegrain', name: 'Vollkornbrot', per: 'g', kcal: 247, protein: 9, carbs: 41, fat: 3.3, micros: { fiber: 7, iron: 2.5, magnesium: 76 }, serving: 80, vegan: true, allergens: ['gluten'] },

  // "Laster" — Limit-Nährstoffe (Koffein, Alkohol, Zucker)
  { id: 'coffee', name: 'Kaffee', per: 'ml', kcal: 2, protein: 0.1, carbs: 0, fat: 0, micros: { caffeine: 40 }, serving: 200, vegan: true, allergens: [], vice: true },
  { id: 'espresso', name: 'Espresso', per: 'ml', kcal: 2, protein: 0.1, carbs: 0, fat: 0, micros: { caffeine: 212 }, serving: 30, vegan: true, allergens: [], vice: true },
  { id: 'beer', name: 'Bier', per: 'ml', kcal: 43, protein: 0.5, carbs: 3.6, fat: 0, micros: { alcohol: 3.9 }, serving: 500, vegan: true, allergens: ['gluten'], vice: true },
  { id: 'wine', name: 'Rotwein', per: 'ml', kcal: 85, protein: 0.1, carbs: 2.6, fat: 0, micros: { alcohol: 10.6 }, serving: 150, vegan: true, allergens: [], vice: true },
  { id: 'cola', name: 'Cola', per: 'ml', kcal: 42, protein: 0, carbs: 10.6, fat: 0, micros: { sugar: 10.6, caffeine: 10 }, serving: 330, vegan: true, allergens: [], vice: true },
  { id: 'energy', name: 'Energydrink', per: 'ml', kcal: 45, protein: 0, carbs: 11, fat: 0, micros: { sugar: 11, caffeine: 32 }, serving: 250, vegan: true, allergens: [], vice: true },
]

export const CATALOG_BY_ID: Record<string, CatalogFood> = Object.fromEntries(
  FOOD_CATALOG.map((f) => [f.id, f]),
)
