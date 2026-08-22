/**
 * Price resolution and cost totalling.
 *
 * Two rules drive everything here:
 *
 *  1. Nothing may throw. A dead endpoint degrades down the chain to snapshot
 *     prices with a visible staleness notice — it never breaks the app.
 *  2. An unknown price is NEVER treated as zero. It is surfaced as unknown and
 *     excluded from the total, because silently costing a missing item at 0
 *     produces a number the user would act on and be wrong.
 */

import type { CatalogItem, MarketId } from '../data/catalog'
import type { PriceTable } from './ikeaSearch'

/** `custom` is a market with no live source — every price is user-supplied. */
export type PriceMarketId = MarketId | 'custom'

export type PriceSource = 'override' | 'live' | 'cache' | 'snapshot' | 'unknown'

export interface ResolvedPrice {
  /** Price for ONE PACK, not one unit. Null when unknown. */
  amount: number | null
  currency: string
  source: PriceSource
  /** Set when `source === 'snapshot'`, so the UI can say how stale it is. */
  capturedAt?: string
}

export interface PriceSnapshot {
  capturedAt: string
  source: string
  markets: Record<string, { currency: string; prices: PriceTable }>
}

export interface CachedPrices {
  fetchedAt: number
  prices: PriceTable
}

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export interface PriceContext {
  market: PriceMarketId
  /** Currency for the custom market; live markets take it from the snapshot. */
  currency: string
  /** User-entered prices, by catalog key. Always wins. */
  overrides: Readonly<Record<string, number>>
  /** Freshly fetched prices, by item number. */
  live?: PriceTable
  cache?: CachedPrices
  snapshot: PriceSnapshot
  now?: number
}

export function isCacheFresh(cache: CachedPrices | undefined, now: number): boolean {
  return cache !== undefined && now - cache.fetchedAt < CACHE_TTL_MS
}

/**
 * Resolve one item's pack price. Order is override → live → fresh cache →
 * snapshot → unknown; the first hit wins.
 */
export function resolvePrice(item: CatalogItem, context: PriceContext): ResolvedPrice {
  const { market, overrides, live, cache, snapshot } = context
  const now = context.now ?? Date.now()

  const override = overrides[item.key]
  if (typeof override === 'number') {
    return { amount: override, currency: context.currency, source: 'override' }
  }

  // The custom market has no upstream at all — anything not overridden is unknown.
  if (market === 'custom') {
    return { amount: null, currency: context.currency, source: 'unknown' }
  }

  const itemNo = item.itemNos[market]
  const marketSnapshot = snapshot.markets[market]
  const currency = marketSnapshot?.currency ?? context.currency

  // No item number means IKEA does not sell this product in this market.
  if (!itemNo) return { amount: null, currency, source: 'unknown' }

  if (live && typeof live[itemNo] === 'number') {
    return { amount: live[itemNo], currency, source: 'live' }
  }

  if (isCacheFresh(cache, now) && typeof cache!.prices[itemNo] === 'number') {
    return { amount: cache!.prices[itemNo], currency, source: 'cache' }
  }

  if (typeof marketSnapshot?.prices[itemNo] === 'number') {
    return {
      amount: marketSnapshot.prices[itemNo],
      currency,
      source: 'snapshot',
      capturedAt: snapshot.capturedAt,
    }
  }

  return { amount: null, currency, source: 'unknown' }
}

/**
 * Packs needed to cover a quantity. IKEA sells hooks in 2-packs and small hooks
 * in 5-packs, so costing per placed unit under-orders — see findings.md F6a.
 */
export function packsNeeded(quantity: number, packQty: number): number {
  if (quantity <= 0) return 0
  return Math.ceil(quantity / Math.max(1, packQty))
}

export interface CostLine {
  key: string
  item: CatalogItem
  /** Units the user placed or added. */
  quantity: number
  packQty: number
  /** Packs they must actually buy. */
  packs: number
  price: ResolvedPrice
  /** packs × pack price, or null when the price is unknown. */
  lineTotal: number | null
  /** Unchecked lines stay visible but drop out of the total. */
  included: boolean
}

export interface CostInput {
  key: string
  quantity: number
  included: boolean
}

export function buildCostLines(
  entries: readonly CostInput[],
  byKey: ReadonlyMap<string, CatalogItem>,
  context: PriceContext,
): CostLine[] {
  const lines: CostLine[] = []

  for (const entry of entries) {
    const item = byKey.get(entry.key)
    if (!item) continue

    const price = resolvePrice(item, context)
    const packs = packsNeeded(entry.quantity, item.packQty)

    lines.push({
      key: entry.key,
      item,
      quantity: entry.quantity,
      packQty: item.packQty,
      packs,
      price,
      lineTotal: price.amount === null ? null : round(price.amount * packs),
      included: entry.included,
    })
  }

  return lines
}

export interface CostTotal {
  total: number
  currency: string
  /** Included lines whose price we could not resolve. Never counted as zero. */
  unknownKeys: string[]
  /** True when any counted line came from the snapshot rather than live data. */
  usesStalePrices: boolean
  staleCapturedAt?: string
}

export function totalCost(lines: readonly CostLine[], currency: string): CostTotal {
  let total = 0
  const unknownKeys: string[] = []
  let usesStalePrices = false
  let staleCapturedAt: string | undefined

  for (const line of lines) {
    if (!line.included || line.packs === 0) continue

    if (line.lineTotal === null) {
      unknownKeys.push(line.key)
      continue
    }

    total += line.lineTotal
    if (line.price.source === 'snapshot') {
      usesStalePrices = true
      staleCapturedAt ??= line.price.capturedAt
    }
  }

  return { total: round(total), currency, unknownKeys, usesStalePrices, staleCapturedAt }
}

/** Money maths on floats needs rounding or 5.1 + 2.2 shows up as 7.300000001. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

export function formatPrice(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
  } catch {
    // Unknown currency code (a user-typed one in the custom market) must not crash.
    return `${amount} ${currency}`
  }
}
