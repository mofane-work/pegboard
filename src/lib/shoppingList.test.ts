import { describe, expect, it } from 'vitest'
import { BY_KEY } from '../data/catalog'
import snapshotJson from '../data/price-snapshot.json'
import {
  buildShoppingList,
  displayWidth,
  formatArticleNumber,
  padDisplay,
  type ShoppingListLabels,
  type ShoppingListOptions,
} from './shoppingList'
import { buildCostLines, type PriceContext, type PriceSnapshot } from './pricing'

const snapshot = snapshotJson as PriceSnapshot

const LABELS: ShoppingListLabels = {
  title: 'SKÅDIS shopping list',
  marketName: 'IKEA US · USD',
  total: 'Total',
  packNote: (packQty, pieces) => `${packQty}-pack · ${pieces} pieces`,
  unknownNote: 'Some items have no price and are not counted.',
  snapshotNote: 'Prices captured 2026-08-18.',
  articleNote: 'Article numbers are IKEA US.',
}

function lines(
  entries: Array<[string, number, boolean]>,
  live: Record<string, number> = {},
  market: PriceContext['market'] = 'us',
) {
  const context: PriceContext = {
    market,
    currency: market === 'jp' ? 'JPY' : 'USD',
    overrides: {},
    live,
    snapshot,
    now: 1_760_000_000_000,
  }
  return buildCostLines(
    entries.map(([key, quantity, included]) => ({ key, quantity, included })),
    BY_KEY,
    context,
  )
}

function options(over: Partial<ShoppingListOptions> = {}): ShoppingListOptions {
  return {
    format: 'text',
    market: 'us',
    currency: 'USD',
    locale: 'en-US',
    language: 'en',
    labels: LABELS,
    ...over,
  }
}

describe('formatArticleNumber', () => {
  it("matches IKEA's own displayed form", () => {
    // The product page shows itemNo 10321618 as visibleItemNo 103.216.18.
    expect(formatArticleNumber('10321618')).toBe('103.216.18')
  })

  it('keeps leading zeros, which carry meaning', () => {
    expect(formatArticleNumber('00320803')).toBe('003.208.03')
  })

  it('returns anything unexpected untouched rather than mangling it', () => {
    expect(formatArticleNumber('s09216595')).toBe('s09216595')
    expect(formatArticleNumber('123')).toBe('123')
  })
})

describe('display width', () => {
  it('counts CJK glyphs as two columns', () => {
    // .length says 5; a monospace terminal prints 9.
    expect('フック 大'.length).toBe(5)
    expect(displayWidth('フック 大')).toBe(9)
    expect(displayWidth('掛鉤 大')).toBe(7)
  })

  it('counts Latin text as one column each', () => {
    expect(displayWidth('Hook, large')).toBe(11)
  })

  it('pads to equal printed width across scripts', () => {
    const a = padDisplay('Hook, large', 14)
    const b = padDisplay('フック 大', 14)
    expect(displayWidth(a)).toBe(displayWidth(b))
  })

  it('never truncates something already too wide', () => {
    expect(padDisplay('Hook, large', 4)).toBe('Hook, large')
  })
})

describe('text export', () => {
  it('is empty when nothing is checked', () => {
    expect(buildShoppingList(lines([['shelf', 1, false]]), options())).toBe('')
  })

  it('lists only checked items', () => {
    const out = buildShoppingList(
      lines([['shelf', 1, true], ['clip', 1, false]]),
      options(),
    )
    expect(out).toContain('Shelf')
    expect(out).not.toContain('Clip')
  })

  it('shows packs to buy, not pieces, and spells out the difference', () => {
    // 6 hooks in 2-packs is 3 packs. A shopper reading "6" would over-order.
    const out = buildShoppingList(lines([['hook-large', 6, true]]), options())
    expect(out).toMatch(/^\s+3 ×/m)
    expect(out).toContain('└ 2-pack · 6 pieces')
  })

  it('omits the pack sub-line for single items', () => {
    const out = buildShoppingList(lines([['shelf', 1, true]]), options())
    expect(out).not.toContain('└')
  })

  it('includes dotted article numbers', () => {
    const out = buildShoppingList(lines([['board-56x56-white', 1, true]]), options())
    expect(out).toContain('003.208.03')
  })

  it('carries no generated-on date', () => {
    const out = buildShoppingList(lines([['shelf', 1, true]]), options())
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('renders an unknown price as a dash and notes it, never as zero', () => {
    // The 7-piece set is not sold in Japan, so it has no resolvable price there.
    const out = buildShoppingList(
      lines([['accessory-set-7', 1, true]], {}, 'jp'),
      options({ market: 'jp', currency: 'JPY', unknownKeys: ['accessory-set-7'] }),
    )
    const itemRow = out.split('\n').find((l) => l.includes('×'))!
    expect(itemRow).toContain('—')
    // The item itself must never be priced at zero; the total legitimately
    // reads 0 here because nothing countable was left, and the note says so.
    expect(itemRow).not.toMatch(/[$¥]0/)
    expect(out).toContain(LABELS.unknownNote)
  })

  it('adds the snapshot note only when prices came from the snapshot', () => {
    const withNote = buildShoppingList(
      lines([['shelf', 1, true]]),
      options({ snapshotDate: '2026-08-18' }),
    )
    expect(withNote).toContain(LABELS.snapshotNote)
    expect(buildShoppingList(lines([['shelf', 1, true]]), options())).not.toContain(
      LABELS.snapshotNote,
    )
  })

  it('totals only the checked lines', () => {
    const out = buildShoppingList(
      lines([['board-56x56-white', 1, true], ['shelf', 1, false]], {
        '00320803': 24.99,
        '00320799': 5,
      }),
      options(),
    )
    expect(out).toContain('$24.99')
    expect(out).not.toContain('$29.99')
  })
})

describe('custom market', () => {
  it('omits article numbers entirely rather than implying a wrong one', () => {
    const out = buildShoppingList(
      lines([['board-56x56-white', 1, true]]),
      options({ market: 'custom', currency: 'TWD' }),
    )
    expect(out).not.toContain('003.208.03')
    expect(out).not.toContain(LABELS.articleNote)
  })

  it('omits the article column from CSV too', () => {
    const out = buildShoppingList(
      lines([['shelf', 1, true]]),
      options({ format: 'csv', market: 'custom', currency: 'TWD' }),
    )
    expect(out.split('\n')[0]).toBe('name,packs,pack_size,pieces,line_total,currency')
  })
})

describe('localisation', () => {
  it('translates names but keeps every number identical', () => {
    const entries: Array<[string, number, boolean]> = [
      ['board-56x56-white', 1, true],
      ['hook-large', 6, true],
    ]
    const digits = (s: string) => s.replace(/[^\d]/g, '')

    const en = buildShoppingList(lines(entries), options({ language: 'en' }))
    const ja = buildShoppingList(lines(entries), options({ language: 'ja', locale: 'ja-JP' }))

    expect(en).toContain('Pegboard 56×56')
    expect(ja).toContain('有孔ボード 56×56')
    expect(digits(ja)).toBe(digits(en))
  })

  it('keeps columns aligned when names are double-width', () => {
    const out = buildShoppingList(
      lines([['board-56x56-white', 1, true], ['hook-large', 2, true]]),
      options({ language: 'ja', locale: 'ja-JP' }),
    )
    // Every item row must print to the same width, or the column is ragged.
    const rows = out.split('\n').filter((l) => l.includes('×'))
    const widths = new Set(rows.map((r) => displayWidth(r)))
    expect(widths.size).toBe(1)
  })
})

/** Minimal RFC-4180 field reader, enough to assert our own quoting is correct. */
function parseCsvRow(row: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < row.length; i += 1) {
    const char = row[i]
    if (quoted) {
      if (char === '"' && row[i + 1] === '"') { field += '"'; i += 1 }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') { out.push(field); field = '' }
    else field += char
  }
  out.push(field)
  return out
}

describe('csv export', () => {
  it('uses stable English headers so an importer mapping survives a language switch', () => {
    const en = buildShoppingList(lines([['shelf', 1, true]]), options({ format: 'csv' }))
    const zh = buildShoppingList(
      lines([['shelf', 1, true]]),
      options({ format: 'csv', language: 'zh-Hant' }),
    )
    expect(en.split('\n')[0]).toBe(zh.split('\n')[0])
    expect(en.split('\n')[0]).toBe(
      'article,name,packs,pack_size,pieces,line_total,currency',
    )
  })

  it('emits one row per checked line', () => {
    const out = buildShoppingList(
      lines([['shelf', 1, true], ['clip', 2, true], ['basket', 1, false]]),
      options({ format: 'csv' }),
    )
    expect(out.split('\n')).toHaveLength(3) // header + 2
  })

  it('reports packs and pieces separately', () => {
    const out = buildShoppingList(lines([['hook-large', 6, true]]), options({ format: 'csv' }))
    // "Hook, large" is quoted because it contains a comma, so split naively at
    // your peril — parse the quoted field properly.
    const row = parseCsvRow(out.split('\n')[1])
    expect(row[0]).toBe('503.356.18') // article
    expect(row[1]).toBe('Hook, large') // name, comma intact
    expect(row[2]).toBe('3') // packs
    expect(row[3]).toBe('2') // pack_size
    expect(row[4]).toBe('6') // pieces
  })

  it('quotes values containing a comma', () => {
    const out = buildShoppingList(lines([['hook-large', 1, true]]), options({ format: 'csv' }))
    expect(out).toContain('"Hook, large"')
  })
})
