import { describe, expect, it } from 'vitest'
import snapshotJson from '../data/price-snapshot.json'
import { BY_KEY } from '../data/catalog'
import {
  CACHE_TTL_MS,
  type PriceContext,
  type PriceSnapshot,
  buildCostLines,
  formatPrice,
  packsNeeded,
  resolvePrice,
  totalCost,
} from './pricing'

const snapshot = snapshotJson as PriceSnapshot
const NOW = 1_760_000_000_000

const hook = BY_KEY.get('hook-large')!       // us 50335618, 2-pack
const board = BY_KEY.get('board-56x56-white')! // us 00320803
const setOf7 = BY_KEY.get('accessory-set-7')!  // US only, no JP item number

function context(overrides: Partial<PriceContext> = {}): PriceContext {
  return {
    market: 'us',
    currency: 'USD',
    overrides: {},
    snapshot,
    now: NOW,
    ...overrides,
  }
}

describe('resolution chain order', () => {
  it('prefers a user override over every upstream source', () => {
    const result = resolvePrice(
      hook,
      context({ overrides: { 'hook-large': 2.5 }, live: { '50335618': 99 } }),
    )
    expect(result).toMatchObject({ amount: 2.5, source: 'override' })
  })

  it('prefers live prices over cache and snapshot', () => {
    const result = resolvePrice(
      hook,
      context({
        live: { '50335618': 4.5 },
        cache: { fetchedAt: NOW, prices: { '50335618': 3 } },
      }),
    )
    expect(result).toMatchObject({ amount: 4.5, source: 'live' })
  })

  it('falls back to a fresh cache when there is no live data', () => {
    const result = resolvePrice(
      hook,
      context({ cache: { fetchedAt: NOW - 1000, prices: { '50335618': 3 } } }),
    )
    expect(result).toMatchObject({ amount: 3, source: 'cache' })
  })

  it('ignores an expired cache and uses the snapshot instead', () => {
    const result = resolvePrice(
      hook,
      context({ cache: { fetchedAt: NOW - CACHE_TTL_MS - 1, prices: { '50335618': 3 } } }),
    )
    expect(result.source).toBe('snapshot')
    expect(result.capturedAt).toBe(snapshot.capturedAt)
  })

  it('reports unknown rather than guessing when the market does not sell the item', () => {
    expect(resolvePrice(setOf7, context({ market: 'jp', currency: 'JPY' }))).toMatchObject({
      amount: null,
      source: 'unknown',
    })
  })
})

describe('custom market', () => {
  it('ignores fetched prices entirely and uses only what the user typed', () => {
    const ctx = context({
      market: 'custom',
      currency: 'TWD',
      live: { '50335618': 4 },
      overrides: { 'hook-large': 120 },
    })
    expect(resolvePrice(hook, ctx)).toMatchObject({ amount: 120, currency: 'TWD', source: 'override' })
    expect(resolvePrice(board, ctx)).toMatchObject({ amount: null, source: 'unknown' })
  })
})

describe('pack maths', () => {
  it('rounds up to whole packs', () => {
    expect(packsNeeded(1, 2)).toBe(1)
    expect(packsNeeded(2, 2)).toBe(1)
    expect(packsNeeded(3, 2)).toBe(2)
    expect(packsNeeded(6, 2)).toBe(3)
    expect(packsNeeded(0, 2)).toBe(0)
  })

  it('treats a pack size of zero as one instead of dividing by zero', () => {
    expect(packsNeeded(3, 0)).toBe(3)
  })

  it('costs 6 hooks as 3 two-packs, not 6 units', () => {
    const [line] = buildCostLines(
      [{ key: 'hook-large', quantity: 6, included: true }],
      BY_KEY,
      context({ live: { '50335618': 4 } }),
    )
    expect(line.packs).toBe(3)
    expect(line.lineTotal).toBe(12)
  })
})

describe('totals', () => {
  const ctx = context({ live: { '50335618': 4, '00320803': 24.99 } })

  it('sums only the included lines', () => {
    const lines = buildCostLines(
      [
        { key: 'board-56x56-white', quantity: 1, included: true },
        { key: 'hook-large', quantity: 2, included: true },
      ],
      BY_KEY,
      ctx,
    )
    expect(totalCost(lines, 'USD').total).toBe(28.99)
  })

  it('drops the board from the total when the user already owns it', () => {
    const lines = buildCostLines(
      [
        { key: 'board-56x56-white', quantity: 1, included: false },
        { key: 'hook-large', quantity: 2, included: true },
      ],
      BY_KEY,
      ctx,
    )
    expect(totalCost(lines, 'USD').total).toBe(4)
  })

  it('never counts an unknown price as zero — it reports it instead', () => {
    const lines = buildCostLines(
      [
        { key: 'hook-large', quantity: 2, included: true },
        { key: 'accessory-set-7', quantity: 1, included: true },
      ],
      BY_KEY,
      context({ market: 'jp', currency: 'JPY', live: {} }),
    )
    const total = totalCost(lines, 'JPY')
    expect(total.unknownKeys).toEqual(['accessory-set-7'])
    // The hook still counts; the unknown item is excluded, not zeroed.
    expect(total.total).toBeGreaterThan(0)
  })

  it('flags when the total is built on stale snapshot prices', () => {
    const lines = buildCostLines(
      [{ key: 'hook-large', quantity: 1, included: true }],
      BY_KEY,
      context(),
    )
    const total = totalCost(lines, 'USD')
    expect(total.usesStalePrices).toBe(true)
    expect(total.staleCapturedAt).toBe(snapshot.capturedAt)
  })

  it('avoids floating point noise in the total', () => {
    const lines = buildCostLines(
      [
        { key: 'hook-large', quantity: 1, included: true },
        { key: 'shelf', quantity: 1, included: true },
      ],
      BY_KEY,
      context({ live: { '50335618': 5.1, '00320799': 2.2 } }),
    )
    expect(totalCost(lines, 'USD').total).toBe(7.3)
  })
})

describe('formatting', () => {
  it('formats known currencies per locale', () => {
    expect(formatPrice(24.99, 'USD', 'en-US')).toBe('$24.99')
  })

  it('degrades gracefully for a currency code Intl does not know', () => {
    expect(formatPrice(120, 'NOTACURRENCY', 'en-US')).toBe('120 NOTACURRENCY')
  })
})
