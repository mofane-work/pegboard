/**
 * Merging a freshly fetched set of prices into the committed snapshot.
 *
 * This is the guard that stands between a robot and every visitor's prices.
 * The snapshot is now the DEFAULT source, not the fallback — nothing is fetched
 * on page load — and a scheduled workflow rewrites it and deploys the result
 * unattended. So a throttled, partial, or empty response from an undocumented
 * endpoint would otherwise replace good prices with none, for everyone, with
 * nobody watching (findings F25c).
 *
 * The rule is deliberately blunt: **a market's price list may never shrink.**
 * IKEA discontinuing a SKU is far rarer than the endpoint having a bad morning,
 * so on a shrink we keep what we have and say so. A real discontinuation is
 * then a human decision, made by re-running this by hand.
 */

import type { PriceTable } from './ikeaSearch'
import type { PriceSnapshot } from './pricing'

export interface MarketFetch {
  id: string
  currency: string
  /** Absent when the fetch failed outright. */
  prices?: PriceTable
  error?: string
}

export interface MergeResult {
  snapshot: PriceSnapshot
  /** False when nothing moved — the workflow then has nothing to commit. */
  changed: boolean
  /** One line per market, for the workflow log. */
  notes: string[]
}

/** Sorted, so an unchanged price list produces an empty diff. */
function sortPrices(prices: PriceTable): PriceTable {
  return Object.fromEntries(Object.entries(prices).sort(([a], [b]) => a.localeCompare(b)))
}

function same(a: PriceTable, b: PriceTable): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((k) => a[k] === b[k])
}

export function mergeSnapshot(
  previous: PriceSnapshot,
  fetched: readonly MarketFetch[],
  capturedAt: string,
): MergeResult {
  const markets: PriceSnapshot['markets'] = { ...previous.markets }
  const notes: string[] = []
  let changed = false

  for (const result of fetched) {
    const before = previous.markets[result.id]
    const beforeCount = before ? Object.keys(before.prices).length : 0

    if (!result.prices) {
      notes.push(`${result.id}: fetch failed (${result.error ?? 'unknown'}) — kept ${beforeCount}`)
      continue
    }

    const count = Object.keys(result.prices).length

    // Never shrink. An empty table is the same failure with a 200 on it.
    if (count < beforeCount) {
      notes.push(`${result.id}: refused ${count} prices, would shrink from ${beforeCount}`)
      continue
    }

    const prices = sortPrices(result.prices)
    if (before && same(before.prices, prices) && before.currency === result.currency) {
      notes.push(`${result.id}: ${count} prices, unchanged`)
      continue
    }

    markets[result.id] = { currency: result.currency, prices }
    changed = true
    notes.push(`${result.id}: ${count} prices, updated from ${beforeCount}`)
  }

  return {
    // The capture date is what the UI shows the user, so it may only move when
    // a price actually did. Bumping it on an unchanged run would tell them the
    // prices are fresher than they are.
    snapshot: { ...previous, capturedAt: changed ? capturedAt : previous.capturedAt, markets },
    changed,
    notes,
  }
}
