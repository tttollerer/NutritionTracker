import type { AutoScanKind } from './apiContract'

/**
 * Pure Routing-Logik des Unified Scan (Vertrag v1.6): Was die KI erkannt hat
 * (`kind`) × was der Nutzer wollte (Intent „Gegessen"/„Eingekauft") → welcher
 * Prüf-Screen mit welcher Primäraktion. Hier statt in Capture.tsx, damit die
 * Matrix ohne React-Baum testbar ist (Muster reviewStore.ts).
 */

/** Die EINE Unterscheidung im Quick-Sheet: nur gekauft oder auch konsumiert? */
export type ScanIntent = 'eat' | 'buy'

/** URL-Parameter tolerant lesen — alles außer 'buy' ist der Default 'eat'. */
export function parseScanIntent(raw: string | null | undefined): ScanIntent {
  return raw === 'buy' ? 'buy' : 'eat'
}

export interface AutoScanRoute {
  /** Ziel-Screen: Review (Items) oder ReceiptReview (Bon-Positionen). */
  screen: 'review' | 'receipt'
  /** Primäraktion im Review: loggen (Übernehmen) oder „Nur in den Vorrat". */
  primary: 'log' | 'pantry'
  /** Foto als Mahlzeitenfoto behalten — nur beim Gericht (Muster Capture.tsx). */
  keepPhoto: boolean
  /** Kassenbon trotz Intent „Gegessen" → dezenter Hinweis in ReceiptReview. */
  receiptNotice: boolean
}

/** Routing-Matrix kind × intent → Ziel. Ein Kassenbon ist IMMER ein Einkauf. */
export function routeAutoScan(kind: AutoScanKind, intent: ScanIntent): AutoScanRoute {
  if (kind === 'receipt') {
    return { screen: 'receipt', primary: 'pantry', keepPhoto: false, receiptNotice: intent === 'eat' }
  }
  return {
    screen: 'review',
    primary: intent === 'buy' ? 'pantry' : 'log',
    keepPhoto: kind === 'meal',
    receiptNotice: false,
  }
}

/** Navigationsziel nach der Auto-Analyse — kapselt die Query-Konventionen. */
export function autoScanPath(kind: AutoScanKind, intent: ScanIntent): string {
  const route = routeAutoScan(kind, intent)
  if (route.screen === 'receipt') return route.receiptNotice ? '/receipt?from=eat' : '/receipt'
  return route.primary === 'pantry' ? '/review?primary=pantry' : '/review'
}
