import { describe, expect, it } from 'vitest'
import { generateHoles } from '../lib/grid'
import { isCustomKey } from './customParts'
import {
  BOARD_PRESETS,
  CUSTOM_BOARD_PREFIX,
  MAX_CELLS,
  MAX_HOLES,
  MIN_CELLS,
  catalogWith,
  clampCustomBoard,
  customBoardHoles,
  customBoardToItem,
  isCustomBoardKey,
  newCustomBoardKey,
  sameGeometry,
  type CustomBoard,
} from './customBoards'

const SHARE_KEY = /^[a-z0-9-]+$/

function board(overrides: Partial<CustomBoard> = {}): CustomBoard {
  return clampCustomBoard({
    key: 'custom-board:test',
    name: 'Workshop',
    cols: 10,
    rows: 8,
    grid: {
      pitchMm: 40,
      arrangement: 'staggered',
      shape: 'slot-v',
      holeWidthMm: 5,
      holeHeightMm: 15,
      thicknessMm: 5,
    },
    ...overrides,
  })
}

describe('custom board keys', () => {
  it('cannot be mistaken for a catalog key by the share decoder', () => {
    const key = newCustomBoardKey()
    expect(key.startsWith(CUSTOM_BOARD_PREFIX)).toBe(true)
    expect(SHARE_KEY.test(key)).toBe(false)
  })

  it('does not collide with the custom PART prefix in either direction', () => {
    // Neither prefix is a prefix of the other, so the two predicates can never
    // both answer yes for one key — which is what stops a board being pruned
    // as a part, or a part being costed as a board.
    expect(isCustomKey(newCustomBoardKey())).toBe(false)
    expect(isCustomBoardKey('custom:abc')).toBe(false)
  })

  it('issues a fresh key every time', () => {
    expect(newCustomBoardKey()).not.toBe(newCustomBoardKey())
  })
})

describe('clampCustomBoard', () => {
  it('absorbs the NaN an emptied number input produces', () => {
    const clamped = board({ cols: NaN, rows: NaN, grid: { ...board().grid, pitchMm: NaN } })
    expect(clamped.cols).toBe(MIN_CELLS)
    expect(clamped.rows).toBe(MIN_CELLS)
    expect(clamped.grid.pitchMm).toBe(40)
  })

  it('holds the cell count inside its limits', () => {
    expect(board({ cols: 0 }).cols).toBe(MIN_CELLS)
    expect(board({ cols: 5000, rows: MIN_CELLS }).cols).toBe(MAX_CELLS)
  })

  it('never lets a hole grow wider than its own pitch', () => {
    // A hole as wide as the pitch touches its neighbour and the outline
    // self-intersects, which the extruder turns into a hole that does not cut.
    const wide = board({ grid: { ...board().grid, pitchMm: 20, holeWidthMm: 90 } })
    expect(wide.grid.holeWidthMm).toBeLessThan(wide.grid.pitchMm)
  })

  it('falls back on a shape or arrangement it does not recognise', () => {
    const odd = board({
      grid: {
        ...board().grid,
        // A hand-edited blob is the only way these arrive.
        shape: 'hexagon' as never,
        arrangement: 'spiral' as never,
      },
    })
    expect(odd.grid.shape).toBe('slot-v')
    expect(odd.grid.arrangement).toBe('staggered')
  })

  it('shrinks a board past the hole budget instead of accepting it', () => {
    const huge = board({ cols: MAX_CELLS, rows: MAX_CELLS })
    expect(customBoardHoles(huge)).toBeLessThanOrEqual(MAX_HOLES)
    expect(huge.cols).toBeLessThan(MAX_CELLS)
  })

  it('shrinks the longer side first, so a capped board comes back squarer', () => {
    // 20 x 60 staggered is 2320 holes; the rows are what has to give.
    const oblong = board({ cols: 20, rows: MAX_CELLS })
    expect(customBoardHoles(oblong)).toBeLessThanOrEqual(MAX_HOLES)
    expect(oblong.cols).toBe(20)
    expect(oblong.rows).toBeLessThan(MAX_CELLS)
  })

  it('leaves a long thin board alone when it is inside the budget anyway', () => {
    // 4 x 60 is only 416 holes. The cap is a hole count, not a shape rule.
    const thin = board({ cols: 4, rows: MAX_CELLS })
    expect(thin.rows).toBe(MAX_CELLS)
  })

  it('names an unnamed board rather than rendering a blank row', () => {
    expect(board({ name: '   ' }).name).toBe('Custom board')
  })
})

describe('customBoardToItem', () => {
  it('produces a board the wall builder can use with no special case', () => {
    const item = customBoardToItem(board())
    expect(item.kind).toBe('board')
    expect(item.widthMm).toBe(400)
    expect(item.heightMm).toBe(320)
    expect(item.grid?.pitchMm).toBe(40)
  })

  it('carries no article number, in any market', () => {
    // This is what keeps it out of the shopping list honestly: an item with no
    // number resolves to source 'unknown' and is rendered "—", never zero.
    expect(customBoardToItem(board()).itemNos).toEqual({})
  })

  it('names itself in every language, or the row renders blank', () => {
    const names = customBoardToItem(board({ name: 'Garage' })).names
    expect(names).toEqual({ en: 'Garage', ja: 'Garage', 'zh-Hant': 'Garage' })
  })

  it('generates the holes its own count promised', () => {
    const item = customBoardToItem(board())
    expect(generateHoles(item)).toHaveLength(customBoardHoles(board()))
  })
})

describe('catalogWith', () => {
  it('merges boards in without disturbing the catalog', () => {
    const merged = catalogWith([], [board()])
    expect(merged.get('custom-board:test')?.kind).toBe('board')
    expect(merged.get('board-56x56-white')?.kind).toBe('board')
  })

  it('returns the shared map untouched when there is nothing to merge', () => {
    expect(catalogWith([], [])).toBe(catalogWith([], []))
  })
})

describe('sameGeometry', () => {
  it('ignores the name and the key, which are not geometry', () => {
    expect(sameGeometry(board({ name: 'A' }), board({ name: 'B' }))).toBe(true)
  })

  it('separates boards that differ in any single dimension', () => {
    expect(sameGeometry(board(), board({ rows: 7 }))).toBe(false)
    expect(sameGeometry(board(), board({ grid: { ...board().grid, thicknessMm: 6 } }))).toBe(false)
  })
})

describe('presets', () => {
  it('are all inside the limits they would be clamped to', () => {
    for (const preset of BOARD_PRESETS) {
      const clamped = clampCustomBoard({ key: 'k', name: preset.id, ...preset })
      expect(clamped.cols, preset.id).toBe(preset.cols)
      expect(clamped.rows, preset.id).toBe(preset.rows)
      expect(clamped.grid, preset.id).toEqual(preset.grid)
    }
  })

  it('all fit the hole budget', () => {
    for (const preset of BOARD_PRESETS) {
      const holes = customBoardHoles({ key: 'k', name: preset.id, ...preset })
      expect(holes, preset.id).toBeLessThanOrEqual(MAX_HOLES)
    }
  })

  it('give the SKÅDIS clone the geometry of a real 56×56 panel', () => {
    const clone = BOARD_PRESETS.find((p) => p.id === 'skadis-clone')!
    expect(customBoardHoles({ key: 'k', name: 'c', ...clone })).toBe(364)
  })

  it('have unique ids and labels', () => {
    expect(new Set(BOARD_PRESETS.map((p) => p.id)).size).toBe(BOARD_PRESETS.length)
    expect(new Set(BOARD_PRESETS.map((p) => p.labelKey)).size).toBe(BOARD_PRESETS.length)
  })
})
