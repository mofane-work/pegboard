import { describe, expect, it } from 'vitest'
import {
  MARGIN_MM,
  PITCH_MM,
  type BoardSpec,
  type PegPattern,
  anchorPointForCentre,
  evaluatePlacement,
  generateHoles,
  holeId,
  indexHoles,
  nearestHole,
  rectsOverlap,
  rotatePattern,
  toBoardLocal,
} from './grid'

const BOARD_36: BoardSpec = { widthMm: 360, heightMm: 560 }
const BOARD_56: BoardSpec = { widthMm: 560, heightMm: 560 }
const BOARD_76: BoardSpec = { widthMm: 760, heightMm: 560 }

function shape(board: BoardSpec) {
  const holes = generateHoles(board)
  const a = holes.filter((h) => h.lattice === 'A')
  const b = holes.filter((h) => h.lattice === 'B')
  return {
    total: holes.length,
    aCols: new Set(a.map((h) => h.col)).size,
    aRows: new Set(a.map((h) => h.row)).size,
    bCols: new Set(b.map((h) => h.col)).size,
    bRows: new Set(b.map((h) => h.row)).size,
  }
}

/** Slots per row, counted from the top edge downwards as a user reads them. */
function rowsFromTop(board: BoardSpec): number[] {
  const holes = generateHoles(board)
  return [...new Set(holes.map((h) => h.y))]
    .sort((p, q) => q - p)
    .map((y) => holes.filter((h) => h.y === y).length)
}

describe('hole lattice', () => {
  // Counts measured off IKEA's product photography — findings.md F8. An earlier
  // revision had the vertical phase inverted, which read 9 slots on the first
  // row of a 36×56 board where the real product has 8.
  it('matches the measured 36×56 board', () => {
    expect(shape(BOARD_36)).toMatchObject({ aCols: 9, aRows: 13, bCols: 8, bRows: 14, total: 229 })
  })

  it('matches the measured 56×56 board', () => {
    expect(shape(BOARD_56)).toMatchObject({ aCols: 14, aRows: 13, bCols: 13, bRows: 14, total: 364 })
  })

  it('matches the measured 76×56 board', () => {
    expect(shape(BOARD_76)).toMatchObject({ aCols: 19, aRows: 13, bCols: 18, bRows: 14, total: 499 })
  })

  it('alternates 8 and 9 slots per row on the 36×56 board, starting at 8', () => {
    expect(rowsFromTop(BOARD_36).slice(0, 6)).toEqual([8, 9, 8, 9, 8, 9])
  })

  it('starts every board with a narrow row at the top and bottom edge', () => {
    for (const board of [BOARD_36, BOARD_56, BOARD_76]) {
      const rows = rowsFromTop(board)
      expect(rows[0]).toBeLessThan(rows[1])
      expect(rows.at(-1)).toBeLessThan(rows.at(-2)!)
    }
  })

  it('keeps a 20 mm margin on every edge of every board', () => {
    for (const board of [BOARD_36, BOARD_56, BOARD_76]) {
      const holes = generateHoles(board)
      const xs = holes.map((h) => h.x)
      const ys = holes.map((h) => h.y)
      expect(Math.min(...xs)).toBeCloseTo(MARGIN_MM)
      expect(Math.min(...ys)).toBeCloseTo(MARGIN_MM)
      expect(board.widthMm - Math.max(...xs)).toBeCloseTo(MARGIN_MM)
      expect(board.heightMm - Math.max(...ys)).toBeCloseTo(MARGIN_MM)
    }
  })

  it('offsets lattice B from A by (+20, −20), not (+20, +20)', () => {
    const holes = generateHoles(BOARD_56)
    const a = holes.find((h) => h.id === holeId('A', 0, 0))!
    const b = holes.find((h) => h.id === holeId('B', 0, 0))!
    expect(b.x - a.x).toBeCloseTo(PITCH_MM / 2)
    expect(b.y - a.y).toBeCloseTo(-PITCH_MM / 2)
  })

  it('gives every hole a unique id', () => {
    const holes = generateHoles(BOARD_76)
    expect(new Set(holes.map((h) => h.id)).size).toBe(holes.length)
  })
})

describe('nearestHole', () => {
  const holes = generateHoles(BOARD_56)

  it('respects lattice parity instead of just taking the closest hole', () => {
    const anyLattice = nearestHole(holes, 42, 42, 'either')!
    const onlyA = nearestHole(holes, 42, 42, 'A')!
    expect(onlyA.lattice).toBe('A')
    // The unconstrained pick is at least as close as the parity-constrained one.
    const d = (h: { x: number; y: number }) => (h.x - 42) ** 2 + (h.y - 42) ** 2
    expect(d(anyLattice)).toBeLessThanOrEqual(d(onlyA))
  })

  it('returns a hole for points outside the board rather than failing', () => {
    expect(nearestHole(holes, -500, -500, 'either')).not.toBeNull()
  })
})

describe('rotation', () => {
  const shelf: PegPattern = {
    lattice: 'A',
    offsets: [[6, 0]],
    bodyOffset: [-20, -30],
    bodySize: [280, 30],
  }

  it('is a no-op at 0°', () => {
    expect(rotatePattern(shelf, 0)).toBe(shelf)
  })

  it('turns a horizontal peg span into a vertical one at 90°', () => {
    const turned = rotatePattern(shelf, 90)
    expect(turned.offsets).toEqual([[0, 6]])
    expect(turned.bodySize).toEqual([30, 280])
  })

  it('composes: two 90° turns equal one 180° turn', () => {
    const twice = rotatePattern(rotatePattern(shelf, 90), 90)
    const once = rotatePattern(shelf, 180)
    expect(twice.offsets).toEqual(once.offsets)
    expect(twice.bodyOffset).toEqual(once.bodyOffset)
    expect(twice.bodySize).toEqual(once.bodySize)
  })

  it('returns to the original after a full turn', () => {
    const full = rotatePattern(rotatePattern(shelf, 180), 180)
    expect(full.offsets).toEqual(shelf.offsets)
    expect(full.bodyOffset).toEqual(shelf.bodyOffset)
    expect(full.bodySize).toEqual(shelf.bodySize)
  })

  it('keeps the body centred on the same point through every rotation', () => {
    // Rotating about the peg must not translate the body's centre distance.
    const radius = ([x, y]: readonly [number, number]) => Math.hypot(x, y)
    const base = anchorPointForCentre(shelf, 0, 0)
    for (const r of [90, 180, 270] as const) {
      const turned = anchorPointForCentre(rotatePattern(shelf, r), 0, 0)
      expect(radius(turned)).toBeCloseTo(radius(base))
    }
  })
})

describe('evaluatePlacement', () => {
  const holes = generateHoles(BOARD_56)
  const byId = indexHoles(holes)

  const hook: PegPattern = {
    lattice: 'either',
    offsets: [],
    bodyOffset: [-20, -60],
    bodySize: [40, 60],
  }

  const shelf: PegPattern = {
    lattice: 'A',
    offsets: [[6, 0]],
    bodyOffset: [-20, -30],
    bodySize: [280, 30],
  }

  it('accepts a well-placed accessory', () => {
    const anchor = byId.get(holeId('A', 5, 5))!
    expect(evaluatePlacement(BOARD_56, anchor, hook, byId).ok).toBe(true)
  })

  it('rejects a placement whose second peg falls off the board', () => {
    const anchor = byId.get(holeId('A', 13, 5))! // last column
    const result = evaluatePlacement(BOARD_56, anchor, shelf, byId)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('peg-off-board')
  })

  it('allows a body to overhang the board edge, and says so', () => {
    // A hook on the bottom row hangs below the panel — legitimate (findings F10).
    const anchor = byId.get(holeId('B', 0, 0))!
    const result = evaluatePlacement(BOARD_56, anchor, hook, byId)
    expect(result.ok).toBe(true)
    expect(result.overhangs).toBe(true)
  })

  it('rejects a placement that collides with an existing item', () => {
    const anchor = byId.get(holeId('A', 5, 5))!
    const existing = evaluatePlacement(BOARD_56, anchor, hook, byId)
    const neighbour = byId.get(holeId('B', 5, 5))!
    const result = evaluatePlacement(BOARD_56, neighbour, hook, byId, [existing.rect])
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('overlap')
  })

  it('allows two items on different holes whose bodies do not touch', () => {
    const first = evaluatePlacement(BOARD_56, byId.get(holeId('A', 2, 5))!, hook, byId)
    const second = evaluatePlacement(BOARD_56, byId.get(holeId('A', 8, 5))!, hook, byId, [first.rect])
    expect(second.ok).toBe(true)
  })
})

describe('centre-based anchoring', () => {
  const holes = generateHoles(BOARD_36)
  const byId = indexHoles(holes)

  // The hook rack: 280 mm wide with a 240 mm peg span, on a 360 mm board.
  const rack: PegPattern = {
    lattice: 'either',
    offsets: [[6, 0]],
    bodyOffset: [-20, -30],
    bodySize: [280, 30],
  }

  it('places a wide rack when aimed at the middle of the board', () => {
    // Aiming at the board centre used to fail: anchoring on the left peg pushed
    // the body 260 mm to the right, off the edge (findings.md F9).
    const [x, y] = anchorPointForCentre(rack, 180, 300)
    const anchor = nearestHole(holes, x, y, rack.lattice)!
    expect(evaluatePlacement(BOARD_36, anchor, rack, byId).ok).toBe(true)
  })

  it('would have failed when anchoring on the first peg', () => {
    const anchor = nearestHole(holes, 180, 300, rack.lattice)!
    expect(evaluatePlacement(BOARD_36, anchor, rack, byId).ok).toBe(false)
  })
})

describe('geometry helpers', () => {
  it('detects overlap but treats edge-touching rects as clear', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 }
    expect(rectsOverlap(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true)
    expect(rectsOverlap(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(false)
  })

  it('recentres board coordinates for the mesh', () => {
    expect(toBoardLocal(BOARD_56, 280, 280)).toEqual([0, 0])
    expect(toBoardLocal(BOARD_56, 0, 0)).toEqual([-280, -280])
  })
})

describe('board orientation', () => {
  /**
   * The claim this feature rests on. Turning a panel maps every hole through
   * `(x, y) → (H − y, x)`; the rotated generator must reproduce that exactly,
   * tags included, so a regression in `latticeOrigin` cannot pass by merely
   * keeping the counts plausible.
   */
  function rotatedImage(board: BoardSpec): Set<string> {
    return new Set(
      generateHoles(board).map((h) => `${h.lattice}:${board.heightMm - h.y},${h.x}`),
    )
  }

  function tagged(board: BoardSpec): Set<string> {
    return new Set(generateHoles(board).map((h) => `${h.lattice}:${h.x},${h.y}`))
  }

  function positions(board: BoardSpec): Set<string> {
    return new Set(generateHoles(board).map((h) => `${h.x},${h.y}`))
  }

  const CASES = [
    ['36×56', BOARD_36],
    ['56×56', BOARD_56],
    ['76×56', BOARD_76],
  ] as const

  function turn(board: BoardSpec): BoardSpec {
    return { widthMm: board.heightMm, heightMm: board.widthMm, rotated: true }
  }

  for (const [name, board] of CASES) {
    it(`the turned ${name} board is the upright one, rotated hole for hole`, () => {
      expect(tagged(turn(board))).toEqual(rotatedImage(board))
    })

    it(`turning the ${name} board preserves every hole`, () => {
      const upright = shape(board)
      const turned = shape(turn(board))
      expect(turned.total).toBe(upright.total)
      // Columns and rows trade places; each lattice keeps its own hole count.
      expect(turned.aCols * turned.aRows).toBe(upright.aCols * upright.aRows)
      expect(turned.bCols * turned.bRows).toBe(upright.bCols * upright.bRows)
    })

    it(`turning the ${name} board moves no hole, only its lattice tag`, () => {
      // Surprising but true, and worth pinning: the union of the two lattices
      // is symmetric under exchanging their origins, so a turned panel presents
      // slots in exactly the positions a board of those dimensions would. What
      // rotation actually changes is WHICH holes share a lattice — findings F24.
      const naive: BoardSpec = { widthMm: board.heightMm, heightMm: board.widthMm }
      expect(positions(turn(board))).toEqual(positions(naive))
      if (board.widthMm !== board.heightMm) {
        expect(tagged(turn(board))).not.toEqual(tagged(naive))
      }
    })
  }

  it('regroups the lattices rather than the slots, which is what pegs care about', () => {
    // A 36×56 panel turned sideways. Its lattice A was 9 columns × 13 rows and
    // must stay that same physical set of holes — now 13 columns × 9 rows.
    // The naive dimension swap would tag a different 14 × 8 set as A, letting a
    // multi-peg accessory span holes that are not on one lattice in reality.
    const turned = shape(turn(BOARD_36))
    expect([turned.aCols, turned.aRows]).toEqual([13, 9])
    expect([turned.bCols, turned.bRows]).toEqual([14, 8])

    const naive = shape({ widthMm: 560, heightMm: 360 })
    expect([naive.aCols, naive.aRows]).toEqual([14, 8])
  })

  it('leaves the square board looking identical while swapping its tags', () => {
    expect(positions(turn(BOARD_56))).toEqual(positions(BOARD_56))
    expect(rowsFromTop(turn(BOARD_56))).toEqual(rowsFromTop(BOARD_56))
    // The top row is a B row upright and an A row turned — same holes, other tag.
    const topTag = (b: BoardSpec) => {
      const holes = generateHoles(b)
      const top = Math.max(...holes.map((h) => h.y))
      return holes.find((h) => h.y === top)!.lattice
    }
    expect(topTag(BOARD_56)).toBe('B')
    expect(topTag(turn(BOARD_56))).toBe('A')
  })

  it('keeps the same margin on all four edges when turned', () => {
    const board = turn(BOARD_36)
    const holes = generateHoles(board)
    const xs = holes.map((h) => h.x)
    const ys = holes.map((h) => h.y)
    expect(Math.min(...xs)).toBeCloseTo(MARGIN_MM)
    expect(Math.min(...ys)).toBeCloseTo(MARGIN_MM)
    expect(board.widthMm - Math.max(...xs)).toBeCloseTo(MARGIN_MM)
    expect(board.heightMm - Math.max(...ys)).toBeCloseTo(MARGIN_MM)
  })
})
