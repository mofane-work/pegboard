import { describe, expect, it } from 'vitest'
import raw from '../../data-raw/skadis-raw.json'
import {
  ACCESSORIES,
  BOARDS,
  BY_KEY,
  CATALOG,
  isKitMember,
  isPlaceable,
  itemNumbersFor,
} from './catalog'
import {
  anchorPointForCentre,
  evaluatePlacement,
  generateHoles,
  indexHoles,
  nearestHole,
  rotatePattern,
} from '../lib/grid'

const LANGUAGES = ['en', 'ja', 'zh-Hant'] as const

describe('catalog integrity', () => {
  it('gives every item a unique key', () => {
    expect(new Set(CATALOG.map((i) => i.key)).size).toBe(CATALOG.length)
  })

  it('names every item in every supported language', () => {
    for (const item of CATALOG) {
      for (const lang of LANGUAGES) {
        expect(item.names[lang], `${item.key}.${lang}`).toBeTruthy()
      }
    }
  })

  it('never uses an item number for two different products in one market', () => {
    for (const market of ['us', 'jp'] as const) {
      const numbers = CATALOG.map((i) => i.itemNos[market]).filter(Boolean)
      expect(new Set(numbers).size).toBe(numbers.length)
    }
  })

  it('requires a pack quantity of at least 1 so cost maths cannot divide by zero', () => {
    for (const item of CATALOG) {
      expect(item.packQty, item.key).toBeGreaterThanOrEqual(1)
    }
  })

  it('gives every placeable accessory a peg pattern, and no cost-only item one', () => {
    for (const item of ACCESSORIES) {
      if (item.placeable) expect(item.pattern, item.key).toBeDefined()
      else expect(item.pattern, item.key).toBeUndefined()
    }
  })

  it('points every kit member at a real pack and gives it no article number', () => {
    const members = CATALOG.filter(isKitMember)
    expect(members.map((i) => i.key)).toEqual([
      'basket-set-large',
      'basket-set-medium',
      'basket-set-small',
    ])

    for (const member of members) {
      // No number anywhere: a member that carried one would be costed twice,
      // once on its own line and once inside the pack.
      expect(Object.keys(member.itemNos), member.key).toEqual([])

      const kit = BY_KEY.get(member.kitKey)
      expect(kit, member.key).toBeDefined()
      expect(kit!.itemNos.us, member.kitKey).toBeTruthy()
      expect(isKitMember(kit!), 'a kit cannot itself be a member').toBe(false)
    }
  })
})

describe('catalog agrees with the extracted IKEA data', () => {
  const usIds = new Set(raw.markets.us.skus.map((s) => s.id))
  const jpIds = new Set(raw.markets.jp.skus.map((s) => s.id))

  it('references only item numbers that actually exist in each market', () => {
    const byMarket = {
      us: usIds,
      gb: new Set(raw.markets.gb.skus.map((s) => s.id)),
      de: new Set(raw.markets.de.skus.map((s) => s.id)),
      fr: new Set(raw.markets.fr.skus.map((s) => s.id)),
      jp: jpIds,
    } as const

    for (const item of CATALOG) {
      for (const [market, ids] of Object.entries(byMarket)) {
        const no = item.itemNos[market as keyof typeof byMarket]
        if (no) expect(ids, `${item.key} ${market}`).toContain(no)
      }
    }
  })

  it('uses the US article number for GB, DE and FR, as verified against live data', () => {
    // Not an assumption: every US number we carry was confirmed present in all
    // three European catalogues (findings.md F18). If IKEA ever diverges, the
    // test above fails first and names the item.
    for (const item of CATALOG) {
      if (!item.itemNos.us) continue
      for (const market of ['gb', 'de', 'fr'] as const) {
        expect(item.itemNos[market], `${item.key} ${market}`).toBe(item.itemNos.us)
      }
    }
  })

  it('carries a number for every item in every Western market', () => {
    // Kit members are excluded on purpose: IKEA gives the three baskets in the
    // set of 3 no article number, so a number here would be invented.
    const sold = CATALOG.filter((i) => !isKitMember(i))
    for (const market of ['us', 'gb', 'de', 'fr'] as const) {
      const missing = sold.filter((i) => !i.itemNos[market]).map((i) => i.key)
      expect(missing, `${market}`).toEqual([])
    }
  })

  it('names exactly the items Japan does not sell, rather than a coverage floor', () => {
    // A percentage threshold silently absorbs a real regression; naming the
    // gaps means adding or losing one fails loudly (findings F18).
    const missing = CATALOG.filter((i) => !isKitMember(i) && !i.itemNos.jp)
      .map((i) => i.key)
      .sort()
    expect(missing).toEqual(['accessory-set-7', 'connector-board'])
  })

  it('matches the pack quantity IKEA publishes', () => {
    const dims = raw.dimensions as Record<string, { measures: Array<{ name: string; measure: string }> }>
    for (const item of CATALOG) {
      const id = item.itemNos.us
      if (!id) continue
      const packMeasure = dims[id]?.measures.find((m) => m.name === 'Package quantity')
      const expected = packMeasure ? Number.parseInt(packMeasure.measure, 10) : 1
      expect(item.packQty, `${item.key} (${id})`).toBe(expected)
    }
  })

  it('pairs each US item number with the JP equivalent the matcher found', () => {
    const jpByUs = new Map(raw.jpMatches.map((m) => [m.usId, m.jpId]))
    for (const item of CATALOG) {
      if (!item.itemNos.us || !item.itemNos.jp) continue
      expect(jpByUs.get(item.itemNos.us), item.key).toBe(item.itemNos.jp)
    }
  })
})

describe('every placeable accessory can actually be placed', () => {
  // The widest accessory must fit the narrowest board, or the catalog contains
  // something no user could ever use.
  const board = BOARDS.find((b) => b.key === 'board-36x56-white')!
  const wide = BOARDS.find((b) => b.key === 'board-76x56-white')!

  for (const item of ACCESSORIES.filter(isPlaceable)) {
    it(`${item.key} fits somewhere on the 76×56 board`, () => {
      const holes = generateHoles(wide)
      const byId = indexHoles(holes)
      const ok = holes.some((h) => evaluatePlacement(wide, h, item.pattern, byId).ok)
      expect(ok).toBe(true)
    })
  }

  it('places every accessory when the user aims at the middle of the small board', () => {
    // The realistic test, not "does some anchor exist". Anchoring on the first
    // peg made the 280 mm hook rack unplaceable anywhere a user would aim
    // (findings.md F9); centre-anchoring is what makes this pass.
    const holes = generateHoles(board)
    const byId = indexHoles(holes)

    const unplaceable = ACCESSORIES.filter(isPlaceable)
      .filter((item) => {
        const [x, y] = anchorPointForCentre(item.pattern, board.widthMm / 2, board.heightMm / 2)
        const anchor = nearestHole(holes, x, y, item.pattern.lattice)
        return !anchor || !evaluatePlacement(board, anchor, item.pattern, byId).ok
      })
      .map((i) => i.key)

    expect(unplaceable).toEqual([])
  })

  it('places every accessory at every rotation on the 76×56 board', () => {
    const holes = generateHoles(wide)
    const byId = indexHoles(holes)

    for (const item of ACCESSORIES.filter(isPlaceable)) {
      for (const rotation of [0, 90, 180, 270] as const) {
        const pattern = rotatePattern(item.pattern, rotation)
        const [x, y] = anchorPointForCentre(pattern, wide.widthMm / 2, wide.heightMm / 2)
        const anchor = nearestHole(holes, x, y, pattern.lattice)!
        expect(
          evaluatePlacement(wide, anchor, pattern, byId).ok,
          `${item.key} @ ${rotation}°`,
        ).toBe(true)
      }
    }
  })
})

describe('placement round-trip', () => {
  it('snaps a dropped shelf to a hole and accepts it', () => {
    const board = BOARDS.find((b) => b.key === 'board-56x56-white')!
    const shelf = BY_KEY.get('shelf')!
    if (!isPlaceable(shelf)) throw new Error('shelf should be placeable')

    const holes = generateHoles(board)
    const byId = indexHoles(holes)
    const anchor = nearestHole(holes, 150, 300, shelf.pattern.lattice)!
    const result = evaluatePlacement(board, anchor, shelf.pattern, byId)

    expect(result.ok).toBe(true)
    expect(result.holes).toHaveLength(2)
    expect(result.rect.w).toBe(280)
  })
})

describe('peg spans measured off IKEA photography', () => {
  const placeable = (key: string) => {
    const item = BY_KEY.get(key)!
    if (!isPlaceable(item)) throw new Error(`${key} should be placeable`)
    return item
  }
  const span = (key: string) => Math.max(0, ...placeable(key).pattern.offsets.map(([c]) => c))

  it('runs the display shelf hook to hook, over nine holes', () => {
    // 320 mm is exactly eight pitches and the brackets sit at the tray's ends,
    // so the body neither overhangs nor stops short (findings.md F35). Seven
    // pitches — the earlier guess — left it half a hole shy at each end.
    expect(span('display-shelf')).toBe(8)
    expect(BY_KEY.get('display-shelf')).toMatchObject({ dims: { w: 320, d: 110 } })

    expect(placeable('display-shelf').pattern.bodyOffset[0]).toBe(0)
  })

  it('models all three sizes in the basket set of 3', () => {
    expect(span('basket-set-large')).toBe(6)
    expect(span('basket-set-medium')).toBe(3)
    expect(span('basket-set-small')).toBe(3)

    // IKEA publishes these as "24x8x21 cm, 12x7x13 cm and 12x6x5 cm".
    expect(BY_KEY.get('basket-set-large')).toMatchObject({ dims: { w: 240, d: 80, h: 210 } })
    expect(BY_KEY.get('basket-set-medium')).toMatchObject({ dims: { w: 120, d: 70, h: 130 } })
    expect(BY_KEY.get('basket-set-small')).toMatchObject({ dims: { w: 120, d: 60, h: 50 } })
  })
})

describe('market resolution', () => {
  it('maps item numbers back to catalog keys for price matching', () => {
    const us = itemNumbersFor('us')
    expect(us.get('50335618')).toBe('hook-large')
    expect(us.size).toBe(CATALOG.filter((i) => i.itemNos.us).length)
  })

  it('omits items IKEA does not sell in Japan rather than inventing a number', () => {
    const jp = itemNumbersFor('jp')
    expect([...jp.values()]).not.toContain('accessory-set-7')
    expect([...jp.values()]).not.toContain('connector-board')
  })
})
