import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { createFood } from '@/db/repo'
import {
  FOOD_PHOTO_LIMIT,
  addFoodPhoto,
  addFoodServing,
  applyScanServings,
  attachScanPhoto,
  getFoodPhotos,
  newScanServings,
  removeFoodPhoto,
  updateFoodValues,
} from './foodEdit'

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

    it('Preisänderung/-entfernung archiviert den alten Preis in priceHistory (wie setFoodPrice)', async () => {
      const food = await createFood({ name: 'Reis', ...base })
      await updateFoodValues(food.id, { price: { amount: 2.49, per: 500 } })
      // Erstes Setzen und identisches Wieder-Setzen erzeugen keinen Verlauf.
      await updateFoodValues(food.id, { price: { amount: 2.49, per: 500 } })
      expect((await db.foods.get(food.id))!.priceHistory).toBeUndefined()

      await updateFoodValues(food.id, { price: { amount: 2.99, per: 500 } })
      let stored = (await db.foods.get(food.id))!
      expect(stored.price).toEqual({ amount: 2.99, per: 500 })
      expect(stored.priceHistory![0]).toMatchObject({ amount: 2.49, per: 500 })
      expect(stored.priceHistory![0].at).toBeGreaterThan(0)

      // Entfernen (null) archiviert ebenfalls — neueste Ablösung zuerst.
      await updateFoodValues(food.id, { price: null })
      stored = (await db.foods.get(food.id))!
      expect('price' in stored).toBe(false)
      expect(stored.priceHistory!.map((p) => p.amount)).toEqual([2.99, 2.49])
    })

    it('Portionseinheiten: normalisieren, deduplizieren, entfernen — Quelle bleibt', async () => {
      const food = await createFood({ name: 'Cookies', ...base, source: 'ai' })

      const updated = await updateFoodValues(food.id, {
        servings: [
          { label: ' Stück ', amount: 22 },
          { label: 'stück', amount: 30 }, // Duplikat (case-insensitiv) → verworfen
          { label: 'Cup', amount: 0 }, // keine positive Menge → verworfen
          { label: 'Packung', amount: 225 },
        ],
      })
      expect(updated.servings).toEqual([
        { label: 'Stück', amount: 22 },
        { label: 'Packung', amount: 225 },
      ])
      expect(updated.source).toBe('ai') // rein beschreibend

      const cleared = await updateFoodValues(food.id, { servings: [] })
      expect('servings' in (await db.foods.get(food.id))!).toBe(false)
      expect(cleared.source).toBe('ai')
    })

    it('wirft für unbekannte/gelöschte Produkte', async () => {
      await expect(updateFoodValues('nope', { kcal: 1 })).rejects.toThrow()
      const food = await createFood({ name: 'Weg', ...base })
      await db.foods.update(food.id, { deletedAt: Date.now() })
      await expect(updateFoodValues(food.id, { kcal: 1 })).rejects.toThrow()
    })
  })

  describe('addFoodServing („+ Einheit" im Verzehr-Moment)', () => {
    it('ergänzt additiv — bestehende Einheiten bleiben erhalten', async () => {
      const food = await createFood({ name: 'Whey', ...base })
      await updateFoodValues(food.id, { servings: [{ label: 'EL', amount: 15 }] })

      const updated = await addFoodServing(food.id, { label: 'Kappe', amount: 30 })
      expect(updated.servings).toEqual([
        { label: 'EL', amount: 15 },
        { label: 'Kappe', amount: 30 },
      ])
    })

    it('ersetzt eine gleichnamige Einheit (case-insensitiv) statt zu duplizieren', async () => {
      const food = await createFood({ name: 'Whey', ...base })
      await addFoodServing(food.id, { label: 'Kappe', amount: 30 })
      const updated = await addFoodServing(food.id, { label: 'kappe ', amount: 32 })
      expect(updated.servings).toEqual([{ label: 'kappe', amount: 32 }])
    })

    it('wirft für unbekannte Produkte', async () => {
      await expect(addFoodServing('nope', { label: 'Kappe', amount: 30 })).rejects.toThrow()
    })
  })

  describe('newScanServings (Merge-Regel Etikett-Einheiten, Vertrag v1.7)', () => {
    it('vorhandenes Label gewinnt IMMER gegen den Scan (case-insensitiv, getrimmt)', () => {
      expect(
        newScanServings([{ label: 'Messlöffel' }], [
          { label: ' messlöffel ', amount: 50 }, // existiert bereits → skip
          { label: 'Portion', amount: 100 },
        ]),
      ).toEqual([{ label: 'Portion', amount: 100 }])
    })

    it('dedupliziert innerhalb des Scans und wirft leere Labels/amount ≤ 0 raus', () => {
      expect(
        newScanServings(undefined, [
          { label: 'Messlöffel', amount: 50 },
          { label: 'MESSLÖFFEL ', amount: 60 }, // Scan-Duplikat → skip
          { label: '', amount: 30 },
          { label: 'Scoop', amount: 0 },
        ]),
      ).toEqual([{ label: 'Messlöffel', amount: 50 }])
    })

    it('leerer/fehlender Scan → nichts zu ergänzen', () => {
      expect(newScanServings([{ label: 'EL' }], undefined)).toEqual([])
      expect(newScanServings(undefined, [])).toEqual([])
    })
  })

  describe('applyScanServings (Etikett-Einheiten ans Produkt, Review-Flow)', () => {
    it('ergänzt neue Einheiten, lässt bestehende gleichnamige unangetastet', async () => {
      const food = await createFood({ name: 'Huel', ...base })
      // Nutzer hat „Messlöffel" bereits manuell mit 45 g gepflegt.
      await addFoodServing(food.id, { label: 'Messlöffel', amount: 45 })

      const added = await applyScanServings(food.id, [
        { label: 'Messlöffel', amount: 50 }, // Scan-Wert verliert
        { label: 'Portion', amount: 100 },
      ])

      expect(added).toEqual([{ label: 'Portion', amount: 100 }])
      expect((await db.foods.get(food.id))!.servings).toEqual([
        { label: 'Messlöffel', amount: 45 },
        { label: 'Portion', amount: 100 },
      ])
    })

    it('ohne Scan-Einheiten oder für unbekannte/gelöschte Produkte: No-Op statt Fehler', async () => {
      const food = await createFood({ name: 'Riegel', ...base })
      expect(await applyScanServings(food.id, undefined)).toEqual([])
      expect((await db.foods.get(food.id))!.servings).toBeUndefined()
      expect(await applyScanServings('nope', [{ label: 'Stück', amount: 25 }])).toEqual([])
    })
  })

  describe('attachScanPhoto (Scan-Fotos ans Produkt, Dedupe + Limit)', () => {
    it('hängt neue Fotos an, überspringt identische Data-URLs', async () => {
      const food = await createFood({ name: 'Riegel', ...base })
      const id = await attachScanPhoto(food.id, 'data:A')
      expect(id).toBeTypeOf('string')

      // Wiederholter Scan desselben Bilds (z. B. Scan-Loop) → kein Duplikat.
      expect(await attachScanPhoto(food.id, 'data:A')).toBeNull()
      expect((await getFoodPhotos(food.id)).map((p) => p.dataUrl)).toEqual(['data:A'])
    })

    it(`hängt ab ${FOOD_PHOTO_LIMIT} Fotos schlicht nicht mehr an (kein stilles Löschen)`, async () => {
      const food = await createFood({ name: 'Riegel', ...base })
      for (let i = 0; i < FOOD_PHOTO_LIMIT; i++) await attachScanPhoto(food.id, `data:${i}`)
      expect((await getFoodPhotos(food.id)).length).toBe(FOOD_PHOTO_LIMIT)

      expect(await attachScanPhoto(food.id, 'data:neu')).toBeNull()
      const photos = await getFoodPhotos(food.id)
      expect(photos.length).toBe(FOOD_PHOTO_LIMIT)
      expect(photos.some((p) => p.dataUrl === 'data:neu')).toBe(false)
    })

    it('gelöschte Fotos zählen nicht gegen das Limit', async () => {
      const food = await createFood({ name: 'Riegel', ...base })
      const ids: string[] = []
      for (let i = 0; i < FOOD_PHOTO_LIMIT; i++) ids.push((await attachScanPhoto(food.id, `data:${i}`))!)
      await removeFoodPhoto(food.id, ids[0])

      expect(await attachScanPhoto(food.id, 'data:neu')).toBeTypeOf('string')
      expect((await getFoodPhotos(food.id)).length).toBe(FOOD_PHOTO_LIMIT)
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
