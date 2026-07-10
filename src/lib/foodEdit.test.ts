import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { createFood } from '@/db/repo'
import { addFoodPhoto, getFoodPhotos, removeFoodPhoto, updateFoodValues } from './foodEdit'

const base = { per: 'g' as const, kcal: 100, protein: 5, carbs: 10, fat: 2 }

describe('foodEdit (Produkt-Editor, Paket B)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  describe('updateFoodValues', () => {
    it('Nährwert-Änderung setzt source auf manual und bumpt updatedAt', async () => {
      const food = await createFood({ name: 'Skyr', ...base, source: 'ai' })
      const before = (await db.foods.get(food.id))!.updatedAt

      const updated = await updateFoodValues(food.id, { kcal: 63, protein: 11 })

      expect(updated.kcal).toBe(63)
      expect(updated.protein).toBe(11)
      expect(updated.source).toBe('manual')
      expect(updated.updatedAt).toBeGreaterThanOrEqual(before)
      expect((await db.foods.get(food.id))!.source).toBe('manual')
    })

    it('reine Namens-/Portions-/Preisänderung lässt die Quelle unangetastet', async () => {
      const food = await createFood({ name: 'Skyr', ...base, source: 'openfoodfacts' })

      const updated = await updateFoodValues(food.id, {
        name: 'Skyr Natur',
        defaultPortion: { amount: 150, unit: 'g', label: 'Becher' },
        price: { amount: 1.19, per: 500 },
      })

      expect(updated.name).toBe('Skyr Natur')
      expect(updated.source).toBe('openfoodfacts')
      expect(updated.defaultPortion).toEqual({ amount: 150, unit: 'g', label: 'Becher' })
      expect(updated.price).toEqual({ amount: 1.19, per: 500 })
    })

    it('identische Nährwerte im Patch (No-Op) markieren NICHT als manual', async () => {
      const food = await createFood({ name: 'Skyr', ...base, source: 'ai' })
      const updated = await updateFoodValues(food.id, { kcal: base.kcal, fat: base.fat })
      expect(updated.source).toBe('ai')
    })

    it('micros-Änderung markiert als manual; null entfernt Portion/Preis', async () => {
      const food = await createFood({ name: 'Müsli', ...base, source: 'ai' })
      await updateFoodValues(food.id, {
        defaultPortion: { amount: 50, unit: 'g' },
        price: { amount: 3.49, per: 750 },
      })

      const updated = await updateFoodValues(food.id, {
        micros: { sugar: 12, fiber: 8 },
        defaultPortion: null,
        price: null,
      })

      expect(updated.source).toBe('manual')
      expect(updated.micros).toEqual({ sugar: 12, fiber: 8 })
      const stored = (await db.foods.get(food.id))!
      expect('defaultPortion' in stored).toBe(false)
      expect('price' in stored).toBe(false)
    })

    it('Beschreibung & Tags: setzen, normalisieren, entfernen — Quelle bleibt', async () => {
      const food = await createFood({ name: 'Skyr', ...base, source: 'ai' })

      const updated = await updateFoodValues(food.id, {
        description: '  Fettarmer isländischer Skyr. ',
        tags: [' Milchprodukt', 'Protein', 'Protein', ' '],
      })

      expect(updated.description).toBe('Fettarmer isländischer Skyr.')
      expect(updated.tags).toEqual(['Milchprodukt', 'Protein'])
      expect(updated.source).toBe('ai') // rein beschreibend → keine manual-Markierung

      const cleared = await updateFoodValues(food.id, { description: '', tags: [] })
      const stored = (await db.foods.get(food.id))!
      expect('description' in stored).toBe(false)
      expect('tags' in stored).toBe(false)
      expect(cleared.source).toBe('ai')
    })

    it('wirft für unbekannte/gelöschte Produkte', async () => {
      await expect(updateFoodValues('nope', { kcal: 1 })).rejects.toThrow()
      const food = await createFood({ name: 'Weg', ...base })
      await db.foods.update(food.id, { deletedAt: Date.now() })
      await expect(updateFoodValues(food.id, { kcal: 1 })).rejects.toThrow()
    })
  })

  describe('Produktfotos (photoIds-Konsistenz)', () => {
    it('addFoodPhoto legt die Photo-Zeile an und hängt die ID in Reihenfolge an', async () => {
      const food = await createFood({ name: 'Riegel', ...base })
      const a = await addFoodPhoto(food.id, 'data:image/jpeg;base64,AAA')
      const b = await addFoodPhoto(food.id, 'data:image/jpeg;base64,BBB')

      const stored = (await db.foods.get(food.id))!
      expect(stored.photoIds).toEqual([a, b])
      expect((await db.photos.get(a))!.dataUrl).toBe('data:image/jpeg;base64,AAA')

      const photos = await getFoodPhotos(food.id)
      expect(photos.map((p) => p.id)).toEqual([a, b])
    })

    it('removeFoodPhoto: Tombstone auf der Zeile + Referenz raus; letzte Referenz entfernt das Feld', async () => {
      const food = await createFood({ name: 'Riegel', ...base })
      const a = await addFoodPhoto(food.id, 'data:AAA')
      const b = await addFoodPhoto(food.id, 'data:BBB')

      await removeFoodPhoto(food.id, a)
      expect((await db.foods.get(food.id))!.photoIds).toEqual([b])
      // Tombstone statt harter Löschung (sync-sauber wie überall im Modell)
      expect((await db.photos.get(a))!.deletedAt).toBeTypeOf('number')
      expect((await getFoodPhotos(food.id)).map((p) => p.id)).toEqual([b])

      await removeFoodPhoto(food.id, b)
      const stored = (await db.foods.get(food.id))!
      expect('photoIds' in stored).toBe(false)
      expect(await getFoodPhotos(food.id)).toEqual([])
    })

    it('getFoodPhotos übersteht verwaiste IDs (Zeile fehlt)', async () => {
      const food = await createFood({ name: 'Riegel', ...base })
      const a = await addFoodPhoto(food.id, 'data:AAA')
      await db.foods.update(food.id, { photoIds: [a, 'geister-id'] })
      expect((await getFoodPhotos(food.id)).map((p) => p.id)).toEqual([a])
    })

    it('addFoodPhoto wirft für unbekannte Produkte', async () => {
      await expect(addFoodPhoto('nope', 'data:AAA')).rejects.toThrow()
    })
  })
})
