import { Box3, Mesh, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { BOARDS } from './catalog'
import {
  catalogWithCustom,
  clampCustomPart,
  customPattern,
  customToItem,
  isCustomKey,
  MAX_CELLS,
  MAX_DEPTH_MM,
  MAX_NAME_LENGTH,
  MIN_CELLS,
  MIN_DEPTH_MM,
  newCustomKey,
  type CustomPart,
} from './customParts'
import { buildAccessoryParts } from '../lib/geometry/archetypes'
import {
  bodyOriginOffset,
  generateHoles,
  indexHoles,
  rotatePattern,
  snapPlacement,
  ROTATIONS,
} from '../lib/grid'

function part(over: Partial<CustomPart> = {}): CustomPart {
  return { key: 'custom:test', name: 'Router', cols: 3, rows: 2, depthMm: 60, lattice: 'A', ...over }
}

describe('custom part keys', () => {
  it('marks custom keys and leaves catalog keys alone', () => {
    expect(isCustomKey('custom:abc')).toBe(true)
    expect(isCustomKey('hook-large')).toBe(false)
  })

  // The colon is what keeps a custom key from ever passing the share-link key
  // regex, so a leak fails loudly instead of reaching a recipient (F23).
  it('generates keys the share-link key regex rejects', () => {
    const key = newCustomKey()
    expect(key.startsWith('custom:')).toBe(true)
    expect(/^[a-z0-9-]+$/.test(key)).toBe(false)
  })

  it('does not hand out the same key twice', () => {
    expect(newCustomKey()).not.toBe(newCustomKey())
  })
})

describe('clampCustomPart', () => {
  it('holds cells, depth and name inside the supported range', () => {
    const clamped = clampCustomPart(
      part({ name: 'x'.repeat(80), cols: 99, rows: -4, depthMm: 9999 }),
    )
    expect(clamped.cols).toBe(MAX_CELLS)
    expect(clamped.rows).toBe(MIN_CELLS)
    expect(clamped.depthMm).toBe(MAX_DEPTH_MM)
    expect(clamped.name).toHaveLength(MAX_NAME_LENGTH)
  })

  it('survives NaN from an emptied number input', () => {
    const clamped = clampCustomPart(part({ cols: Number.NaN, depthMm: Number.NaN }))
    expect(clamped.cols).toBe(MIN_CELLS)
    expect(clamped.depthMm).toBe(MIN_DEPTH_MM)
  })

  it('names an unnamed part rather than rendering a blank palette row', () => {
    expect(clampCustomPart(part({ name: '   ' })).name).toBe('Custom part')
  })

  it('rejects a lattice that is neither A nor B', () => {
    expect(clampCustomPart(part({ lattice: 'C' as 'A' })).lattice).toBe('A')
  })
})

describe('customPattern', () => {
  it('spans pegs from the first cell to the last', () => {
    expect(customPattern(part({ cols: 3 })).offsets).toEqual([[2, 0]])
  })

  it('gives a one-cell part a single peg', () => {
    expect(customPattern(part({ cols: 1 })).offsets).toEqual([])
  })

  it('sizes the body in whole 40 mm cells', () => {
    expect(customPattern(part({ cols: 3, rows: 2 })).bodySize).toEqual([120, 80])
  })

  it('locks to the chosen lattice', () => {
    expect(customPattern(part({ lattice: 'B' })).lattice).toBe('B')
  })

  // Same rule as the catalog's `hanging()` helper: the body is centred on its
  // peg span, which for a cell-aligned part means half a pitch either side.
  it('centres the body over its peg span', () => {
    expect(bodyOriginOffset(customPattern(part({ cols: 3 })))[0]).toBe(40)
    expect(bodyOriginOffset(customPattern(part({ cols: 1 })))[0]).toBe(0)
  })
})

describe('customToItem', () => {
  it('produces a placeable accessory the rest of the app can consume', () => {
    const item = customToItem(part())
    expect(item.kind).toBe('accessory')
    expect(item.placeable).toBe(true)
    expect(item.archetype).toBe('customBox')
    expect(item.dims).toEqual({ w: 120, d: 60, h: 80 })
  })

  // `item.names[language]` renders blank for a missing locale, so every
  // language gets the one name the user typed.
  it('names the part in every language', () => {
    const item = customToItem(part({ name: 'Router' }))
    expect(item.names).toEqual({ en: 'Router', ja: 'Router', 'zh-Hant': 'Router' })
  })

  it('has no article number in any market, so it can never be priced', () => {
    expect(customToItem(part()).itemNos).toEqual({})
  })
})

describe('catalogWithCustom', () => {
  it('resolves both catalog and custom keys', () => {
    const merged = catalogWithCustom([part({ key: 'custom:a' })])
    expect(merged.get('hook-large')).toBeTruthy()
    expect(merged.get('custom:a')?.names.en).toBe('Router')
  })

  it('returns the catalog untouched when there are no custom parts', () => {
    expect(catalogWithCustom([]).has('custom:a')).toBe(false)
  })
})

describe('custom box geometry', () => {
  function bounds(p: CustomPart) {
    const box = new Box3()
    for (const built of buildAccessoryParts(customToItem(p))) {
      const mesh = new Mesh(built.geometry)
      mesh.position.fromArray(built.position)
      mesh.updateMatrixWorld()
      box.expandByObject(mesh)
    }
    return box
  }

  // The same frame contract frame.test.ts enforces for the catalog: mesh and
  // collision rect are two views of one object (findings F11).
  it('is drawn centred on x=0, hanging from y=0, never behind the board', () => {
    const box = bounds(part({ cols: 3, rows: 2, depthMm: 60 }))
    expect(Math.abs(box.getCenter(new Vector3()).x)).toBeLessThan(1)
    expect(box.max.y).toBeLessThanOrEqual(1)
    expect(box.min.y).toBeLessThan(0)
    expect(box.min.z).toBeGreaterThanOrEqual(-1)
  })

  it('fills its declared footprint', () => {
    const box = bounds(part({ cols: 3, rows: 2, depthMm: 60 }))
    expect(box.max.x - box.min.x).toBeCloseTo(120, 1)
    expect(box.max.y - box.min.y).toBeCloseTo(80, 1)
    expect(box.max.z - box.min.z).toBeCloseTo(60, 1)
  })

  it('draws the smallest and largest allowed part without collapsing', () => {
    for (const p of [
      part({ cols: MIN_CELLS, rows: MIN_CELLS, depthMm: MIN_DEPTH_MM }),
      part({ cols: MAX_CELLS, rows: MAX_CELLS, depthMm: MAX_DEPTH_MM }),
    ]) {
      const box = bounds(p)
      expect(box.max.x - box.min.x).toBeGreaterThan(0)
      expect(box.min.y).toBeLessThan(0)
    }
  })
})

describe('custom parts obey the peg rules', () => {
  const board = BOARDS.find((b) => b.key === 'board-56x56-white')!
  const holes = generateHoles(board)
  const byId = indexHoles(holes)

  it('lands every peg on a real slot of the chosen lattice', () => {
    const pattern = customPattern(part({ cols: 3, lattice: 'A' }))
    const result = snapPlacement(board, holes, pattern, 280, 280, byId)
    expect(result?.ok).toBe(true)
    for (const hole of result!.holes) expect(hole.lattice).toBe('A')
  })

  it('never mixes lattices for one part', () => {
    const pattern = customPattern(part({ cols: 4, lattice: 'B' }))
    const result = snapPlacement(board, holes, pattern, 280, 280, byId)
    expect(result?.ok).toBe(true)
    expect(new Set(result!.holes.map((h) => h.lattice))).toEqual(new Set(['B']))
  })

  it('stays placeable at every rotation', () => {
    const base = customPattern(part({ cols: 3, rows: 2 }))
    for (const rotation of ROTATIONS) {
      const result = snapPlacement(
        board,
        holes,
        rotatePattern(base, rotation),
        280,
        280,
        byId,
      )
      expect(result?.ok, `rotation ${rotation}`).toBe(true)
    }
  })

  it('refuses to overlap something already on the board', () => {
    const pattern = customPattern(part({ cols: 3, rows: 2 }))
    const wall = { x: -1000, y: -1000, w: 4000, h: 4000 }
    const result = snapPlacement(board, holes, pattern, 280, 280, byId, [wall])
    expect(result?.ok).toBe(false)
  })
})
