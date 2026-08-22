import { describe, expect, it } from 'vitest'
import { mergeSnapshot, type MarketFetch } from './priceSnapshot'
import type { PriceSnapshot } from './pricing'

const previous: PriceSnapshot = {
  capturedAt: '2026-08-18',
  source: 'sik.search.blue.cdtapps.com',
  markets: {
    us: { currency: 'USD', prices: { '10321618': 29.99, '20320798': 5, '40321631': 3 } },
    jp: { currency: 'JPY', prices: { '90321619': 3999, '30321617': 599 } },
  },
}

const ok = (id: string, currency: string, prices: Record<string, number>): MarketFetch => ({
  id,
  currency,
  prices,
})

describe('mergeSnapshot', () => {
  it('takes an updated price list and moves the capture date with it', () => {
    const result = mergeSnapshot(
      previous,
      [ok('us', 'USD', { '10321618': 34.99, '20320798': 5, '40321631': 3 })],
      '2026-08-22',
    )

    expect(result.changed).toBe(true)
    expect(result.snapshot.markets.us.prices['10321618']).toBe(34.99)
    expect(result.snapshot.capturedAt).toBe('2026-08-22')
  })

  it('refuses a shrunk price list and keeps what it has', () => {
    // The failure this whole module exists for: a throttled response returns
    // fewer rows with a 200 on it, a robot commits it, and every visitor's
    // prices quietly become "unknown" (findings F25c).
    const result = mergeSnapshot(previous, [ok('us', 'USD', { '10321618': 29.99 })], '2026-08-22')

    expect(result.changed).toBe(false)
    expect(Object.keys(result.snapshot.markets.us.prices)).toHaveLength(3)
    expect(result.notes[0]).toContain('would shrink from 3')
  })

  it('refuses an empty price list, which is the same failure with a 200 on it', () => {
    const result = mergeSnapshot(previous, [ok('us', 'USD', {})], '2026-08-22')
    expect(result.changed).toBe(false)
    expect(Object.keys(result.snapshot.markets.us.prices)).toHaveLength(3)
  })

  it('keeps a market whose fetch failed outright', () => {
    const result = mergeSnapshot(
      previous,
      [{ id: 'us', currency: 'USD', error: 'HTTP 503' }],
      '2026-08-22',
    )

    expect(result.changed).toBe(false)
    expect(result.snapshot.markets.us).toEqual(previous.markets.us)
    expect(result.notes[0]).toContain('HTTP 503')
  })

  it('lets one market fail without costing the others their update', () => {
    const result = mergeSnapshot(
      previous,
      [
        { id: 'us', currency: 'USD', error: 'HTTP 503' },
        ok('jp', 'JPY', { '90321619': 4299, '30321617': 599 }),
      ],
      '2026-08-22',
    )

    expect(result.changed).toBe(true)
    expect(result.snapshot.markets.us).toEqual(previous.markets.us)
    expect(result.snapshot.markets.jp.prices['90321619']).toBe(4299)
  })

  it('reports no change when every price is identical', () => {
    const result = mergeSnapshot(
      previous,
      [ok('us', 'USD', { '10321618': 29.99, '20320798': 5, '40321631': 3 })],
      '2026-08-22',
    )

    expect(result.changed).toBe(false)
    // The capture date is what the UI shows the user. Bumping it on a run that
    // changed nothing would claim the prices are fresher than they are.
    expect(result.snapshot.capturedAt).toBe('2026-08-18')
    expect(result.notes[0]).toContain('unchanged')
  })

  it('adopts a market it has never seen before', () => {
    const result = mergeSnapshot(previous, [ok('gb', 'GBP', { '10321618': 25 })], '2026-08-22')
    expect(result.changed).toBe(true)
    expect(result.snapshot.markets.gb.currency).toBe('GBP')
  })

  it('sorts article numbers so an unchanged list produces an empty diff', () => {
    const result = mergeSnapshot(
      previous,
      [ok('us', 'USD', { '40321631': 3, '10321618': 31, '20320798': 5 })],
      '2026-08-22',
    )
    expect(Object.keys(result.snapshot.markets.us.prices)).toEqual([
      '10321618',
      '20320798',
      '40321631',
    ])
  })

  it('picks up a currency change even when every number is the same', () => {
    const result = mergeSnapshot(
      previous,
      [ok('us', 'EUR', { '10321618': 29.99, '20320798': 5, '40321631': 3 })],
      '2026-08-22',
    )
    expect(result.changed).toBe(true)
    expect(result.snapshot.markets.us.currency).toBe('EUR')
  })
})
