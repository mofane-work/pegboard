import { Box3, Group, Mesh, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { BOARDS } from './catalog'
import {
  catalogWithCustom,
  clampCustomPart,
  clampPegSpec,
  customHeightMm,
  customPattern,
  customToItem,
  customWidthMm,
  isCustomKey,
  PEG_LAYOUTS,
  pegFitsHole,
  pegFitWarnings,
  pegOffsets,
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
  holeId,
  indexHoles,
  pegHoles,
  rotatePattern,
  snapPlacement,
  ROTATIONS,
  SKADIS_GRID,
  SKADIS_PEGS,
  type Hole,
  type HoleGrid,
  type PegLayout,
  type Rotation,
} from '../lib/grid'

function part(over: Partial<CustomPart> = {}): CustomPart {
  return {
    key: 'custom:test',
    name: 'Router',
    cols: 3,
    rows: 2,
    depthMm: 60,
    lattice: 'A',
    pegs: { ...SKADIS_PEGS },
    ...over,
  }
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

describe('peg specs', () => {
  it('defaults to SKÅDIS, so a part made before pegs existed is unchanged', () => {
    expect(clampPegSpec(undefined)).toEqual(SKADIS_PEGS)
  })

  it('will not let a peg grow wider than the pitch it sits on', () => {
    // A peg wider than its own spacing could not be threaded between its
    // neighbours — the same derived ceiling clampCustomBoard puts on a hole.
    const pegs = clampPegSpec({ ...SKADIS_PEGS, pitchMm: 20, widthMm: 40 })
    expect(pegs.widthMm).toBe(18)
  })

  it('falls back to the width when no height is given', () => {
    const pegs = clampPegSpec({ ...SKADIS_PEGS, widthMm: 7, heightMm: NaN })
    expect(pegs.heightMm).toBe(7)
  })

  it('rejects a layout or shape it does not know', () => {
    const pegs = clampPegSpec({
      ...SKADIS_PEGS,
      layout: 'diagonal' as never,
      shape: 'hex' as never,
    })
    expect(pegs.layout).toBe('ends')
    expect(pegs.shape).toBe('slot-v')
  })
})

describe('peg layouts', () => {
  const layout = (l: PegLayout, over: Partial<CustomPart> = {}) =>
    pegOffsets(part({ cols: 3, rows: 2, pegs: { ...SKADIS_PEGS, layout: l }, ...over }))

  it('puts a peg at each end by default', () => {
    expect(layout('ends')).toEqual([[2, 0]])
  })

  it('fills every cell of the peg row', () => {
    expect(layout('every')).toEqual([
      [1, 0],
      [2, 0],
    ])
  })

  it('hangs from one peg', () => {
    expect(layout('single')).toEqual([])
  })

  it('adds a second row at the body bottom, rows below the first', () => {
    expect(layout('corners')).toEqual([
      [2, 0],
      [0, -2],
      [2, -2],
    ])
  })

  it('never leaves a duplicate peg on a one-cell part', () => {
    for (const l of PEG_LAYOUTS) {
      const offsets = layout(l, { cols: 1, rows: 1 })
      const ids = offsets.map((o) => o.join(','))
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids).not.toContain('0,0')
    }
  })

  it('keeps every peg on one lattice, whatever the layout', () => {
    // Offsets are integer lattice steps, so a part can never straddle A and B.
    for (const l of PEG_LAYOUTS) {
      for (const [col, row] of layout(l)) {
        expect(Number.isInteger(col)).toBe(true)
        expect(Number.isInteger(row)).toBe(true)
      }
    }
  })

  it('centres the body on one peg when there is only one', () => {
    const single = customPattern(part({ cols: 3, pegs: { ...SKADIS_PEGS, layout: 'single' } }))
    expect(single.bodyOffset[0]).toBeCloseTo(-60, 5)
    const ends = customPattern(part({ cols: 3 }))
    expect(ends.bodyOffset[0]).toBeCloseTo(-20, 5)
  })
})

describe('a part on a pitch of its own', () => {
  it('sizes the body from the part pitch, not the SKÅDIS constant', () => {
    const imperial = part({ cols: 4, rows: 2, pegs: { ...SKADIS_PEGS, pitchMm: 25.4 } })
    expect(customWidthMm(imperial)).toBeCloseTo(101.6, 5)
    expect(customHeightMm(imperial)).toBeCloseTo(50.8, 5)
  })

  it('still lands every peg on a real hole of a board with that pitch', () => {
    // Offsets are lattice STEPS, so the pitch never affects where pegs land —
    // it decides how big the body is drawn. This is the whole reason a
    // mismatched part looks wrong instead of silently rescaling (F40).
    const imperial = part({ cols: 3, pegs: { ...SKADIS_PEGS, pitchMm: 25.4 } })
    expect(customPattern(imperial).offsets).toEqual([[2, 0]])
  })
})

describe('peg fit warnings', () => {
  const grid = (over: Partial<HoleGrid> = {}): HoleGrid => ({ ...SKADIS_GRID, ...over })

  it('says nothing when there are no boards to compare against', () => {
    expect(pegFitWarnings(part(), [])).toEqual([])
  })

  it('says nothing about a SKÅDIS part on a SKÅDIS wall', () => {
    expect(pegFitWarnings(part(), [grid()])).toEqual([])
  })

  it('flags a pitch no board on the wall uses', () => {
    const imperial = part({ pegs: { ...SKADIS_PEGS, pitchMm: 25.4 } })
    expect(pegFitWarnings(imperial, [grid()])).toContain('pitch')
  })

  it('stays quiet when ANY board on the wall matches', () => {
    // A wall may legitimately mix a SKÅDIS panel with a hardboard sheet.
    const imperial = part({ pegs: { ...SKADIS_PEGS, pitchMm: 25.4 } })
    expect(pegFitWarnings(imperial, [grid(), grid({ pitchMm: 25.4 })])).toEqual([])
  })

  it('flags a peg too big for the holes', () => {
    const fat = part({ pegs: { ...SKADIS_PEGS, widthMm: 12 } })
    expect(pegFitWarnings(fat, [grid()])).toContain('size')
  })

  it('flags a peg too short to reach through the panel', () => {
    const stub = part({ pegs: { ...SKADIS_PEGS, lengthMm: 2 } })
    expect(pegFitWarnings(stub, [grid({ thicknessMm: 6.35 })])).toContain('length')
  })

  it('compares a peg and a hole through the same shape rule', () => {
    // A 5 x 15 slot peg fits a 5 x 15 slot, and a round hole of 15 mm, but not
    // a round hole of 5 mm — where only the width is the size.
    const pegs = SKADIS_PEGS
    expect(pegFitsHole(pegs, grid())).toBe(true)
    expect(pegFitsHole(pegs, grid({ shape: 'round', holeWidthMm: 15 }))).toBe(true)
    expect(pegFitsHole(pegs, grid({ shape: 'round', holeWidthMm: 5 }))).toBe(false)
    // A vertical slot peg does not fit a horizontal slot of the same numbers.
    expect(pegFitsHole(pegs, grid({ shape: 'slot-h' }))).toBe(false)
  })
})

describe('custom box geometry', () => {
  function boxOf(built: ReturnType<typeof buildAccessoryParts>) {
    const box = new Box3()
    for (const b of built) {
      const mesh = new Mesh(b.geometry)
      mesh.position.fromArray(b.position)
      if (b.rotation) mesh.rotation.fromArray(b.rotation)
      mesh.updateMatrixWorld()
      box.expandByObject(mesh)
    }
    return box
  }

  function bounds(p: CustomPart) {
    return boxOf(buildAccessoryParts(customToItem(p)))
  }

  /**
   * The body alone. `customBoxParts` contributes exactly one part and pegs come
   * after it, so the first is the body — the thing the collision rect describes
   * and the only thing the frame contract below is about.
   */
  function bodyBounds(p: CustomPart) {
    return boxOf(buildAccessoryParts(customToItem(p)).slice(0, 1))
  }

  // The same frame contract frame.test.ts enforces for the catalog: mesh and
  // collision rect are two views of one object (findings F11).
  it('is drawn centred on x=0, hanging from y=0, never behind the board', () => {
    const box = bodyBounds(part({ cols: 3, rows: 2, depthMm: 60 }))
    expect(Math.abs(box.getCenter(new Vector3()).x)).toBeLessThan(1)
    expect(box.max.y).toBeLessThanOrEqual(1)
    expect(box.min.y).toBeLessThan(0)
    expect(box.min.z).toBeGreaterThanOrEqual(-1)
  })

  it('fills its declared footprint', () => {
    const box = bodyBounds(part({ cols: 3, rows: 2, depthMm: 60 }))
    expect(box.max.x - box.min.x).toBeCloseTo(120, 1)
    expect(box.max.y - box.min.y).toBeCloseTo(80, 1)
    expect(box.max.z - box.min.z).toBeCloseTo(60, 1)
  })

  it('draws one peg per peg hole, reaching back exactly its own length', () => {
    const p = part({ cols: 3, rows: 2 })
    const built = buildAccessoryParts(customToItem(p))
    // One body, plus the anchor peg and every offset.
    expect(built).toHaveLength(1 + 1 + customPattern(p).offsets.length)

    const pegs = boxOf(built.slice(1))
    expect(pegs.min.z).toBeCloseTo(-p.pegs.lengthMm, 1)
    // The pegs are the ONLY thing behind the face, and they stop at it.
    expect(pegs.max.z).toBeCloseTo(0, 1)
    // Spanning the peg row: two pegs one pitch apart, each 5 mm wide.
    expect(pegs.max.x - pegs.min.x).toBeCloseTo(p.pegs.pitchMm * 2 + p.pegs.widthMm, 1)
  })

  it('puts the corners layout on two rows and a single peg on one', () => {
    const corners = boxOf(
      buildAccessoryParts(
        customToItem(part({ cols: 3, rows: 2, pegs: { ...SKADIS_PEGS, layout: 'corners' } })),
      ).slice(1),
    )
    // Top row at y=0, bottom row at the body's bottom edge, 2 cells down.
    expect(corners.min.y).toBeCloseTo(-80 - SKADIS_PEGS.heightMm / 2, 1)

    const single = buildAccessoryParts(
      customToItem(part({ cols: 3, rows: 2, pegs: { ...SKADIS_PEGS, layout: 'single' } })),
    )
    expect(single).toHaveLength(2)
  })

  it('draws no peg behind the board when the peg has no length', () => {
    const built = buildAccessoryParts(
      customToItem(part({ pegs: { ...SKADIS_PEGS, lengthMm: 0 } })),
    )
    expect(built).toHaveLength(1)
    expect(boxOf(built).min.z).toBeGreaterThanOrEqual(-1)
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

describe('peg meshes land on the holes they claim', () => {
  const board = BOARDS.find((b) => b.key === 'board-56x56-white')!
  const spec = { widthMm: board.widthMm, heightMm: board.heightMm }
  const holes = generateHoles(spec)
  const byId = indexHoles(holes)

  /**
   * Rebuild the scene graph exactly as Scene + AccessoryMesh compose it:
   * an outer group at the anchor hole carrying the placement's rotation, an
   * inner group at `bodyOriginOffset` of the UNROTATED pattern, and the
   * builder's parts inside that. Returns the world position of each peg mesh.
   *
   * This is the composition the mesh actually performs; asserting against the
   * builder's local coordinates instead would prove nothing about rotation.
   */
  function pegWorldPositions(p: CustomPart, anchor: Hole, rotation: Rotation) {
    const item = customToItem(p)
    const outer = new Group()
    outer.position.set(anchor.x, anchor.y, 0)
    outer.rotation.z = (rotation * Math.PI) / 180

    const [dx, dy] = bodyOriginOffset(item.pattern!)
    const inner = new Group()
    inner.position.set(dx, dy, 0)
    outer.add(inner)

    // Part 0 is the body; the pegs follow it.
    for (const built of buildAccessoryParts(item).slice(1)) {
      const mesh = new Mesh(built.geometry)
      mesh.position.fromArray(built.position)
      if (built.rotation) mesh.rotation.fromArray(built.rotation)
      inner.add(mesh)
    }

    outer.updateMatrixWorld(true)
    return inner.children.map((child) => child.getWorldPosition(new Vector3()))
  }

  for (const layout of PEG_LAYOUTS) {
    it(`puts every ${layout} peg on its own hole at all four rotations`, () => {
      const p = part({ cols: 3, rows: 2, pegs: { ...SKADIS_PEGS, layout } })

      for (const rotation of ROTATIONS) {
        const rotated = rotatePattern(customPattern(p), rotation)
        // Anchor near the middle so no peg of any layout falls off the edge.
        const anchor = byId.get(holeId('A', 6, 6))!
        const expected = pegHoles(anchor, rotated, byId)
        expect(expected, `${layout} @ ${rotation}`).not.toBeNull()

        const actual = pegWorldPositions(p, anchor, rotation)
        expect(actual, `${layout} @ ${rotation}`).toHaveLength(expected!.length)

        // Same set of points, order-independent.
        for (const hole of expected!) {
          const match = actual.find(
            (v) => Math.abs(v.x - hole.x) < 0.01 && Math.abs(v.y - hole.y) < 0.01,
          )
          expect(
            match,
            `${layout} @ ${rotation}: no peg at ${hole.x},${hole.y} — got ${actual
              .map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`)
              .join(' | ')}`,
          ).toBeTruthy()
          // And it reaches back into the panel, not out of it.
          expect(match!.z).toBeCloseTo(-p.pegs.lengthMm / 2, 5)
        }
      }
    })
  }

  it('draws pegs off the holes when the part is built for another pitch', () => {
    // The visible consequence of drawing a mismatch rather than rescaling it
    // (F40b): the pegs are one pitch of the PART apart, not one of the board's.
    const imperial = part({ cols: 2, rows: 1, pegs: { ...SKADIS_PEGS, pitchMm: 25.4 } })
    const anchor = byId.get(holeId('A', 6, 6))!
    const [, second] = pegWorldPositions(imperial, anchor, 0)

    expect(second.x - anchor.x).toBeCloseTo(25.4, 5)
    expect(byId.get(holeId('A', 7, 6))!.x - anchor.x).toBeCloseTo(40, 5)
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
