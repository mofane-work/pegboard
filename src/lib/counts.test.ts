import { describe, expect, it } from 'vitest'
import { BY_KEY } from '../data/catalog'
import { countBreakdown } from './counts'
import { catalogWithCustom } from '../data/customParts'
import type { PlacedBoard, Placement } from '../state/store'

const BOARD: PlacedBoard = {
  boardKey: 'board-56x56-white',
  offsetX: 0,
  offsetY: 0,
  rotated: false,
}

function board(over: Partial<PlacedBoard> = {}): PlacedBoard {
  return { ...BOARD, ...over }
}

/** Distinct holes on lattice A, so nothing collides and everything resolves. */
function hooks(count: number, itemKey = 'hook-large'): Placement[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    itemKey,
    holeId: `A:${i},5` as Placement['holeId'],
    rotation: 0 as const,
    boardIndex: 0,
  }))
}

function run(
  boards: PlacedBoard[],
  placements: Placement[],
  extras: Record<string, number> = {},
  byKey = BY_KEY,
) {
  return countBreakdown(boards, placements, extras, byKey)
}

describe('base — what the wall itself needs', () => {
  it('counts the boards and everything resolved onto them', () => {
    const { base } = run([board()], hooks(3))
    expect(base.get('board-56x56-white')).toBe(1)
    expect(base.get('hook-large')).toBe(3)
  })

  it('adds the connectors a multi-board wall cannot be assembled without', () => {
    // One pack per seam, so two boards is one pack, not two.
    const { base } = run([board(), board({ offsetX: 560 })], [])
    expect(base.get('board-56x56-white')).toBe(2)
    expect(base.get('connector-board')).toBe(1)
  })

  it('leaves the adjustments out — that is the whole point of it', () => {
    const { base, final } = run([board()], hooks(2), { 'hook-large': 5 })
    expect(base.get('hook-large')).toBe(2)
    expect(final.get('hook-large')).toBe(7)
  })

  it('never counts a placement that does not resolve onto the wall', () => {
    // A:0,13 belonged to the pre-correction lattice; it is not a hole today.
    const stranded = [{ ...hooks(1)[0], holeId: 'A:0,13' as Placement['holeId'] }]
    expect(run([board()], stranded).base.has('hook-large')).toBe(false)
  })

  it('never counts a custom part, which has no article number to buy', () => {
    const parts = [{ key: 'custom:1', name: 'Router', cols: 2, rows: 2, depthMm: 60, lattice: 'A' as const }]
    const placed = hooks(1, 'custom:1')
    const { base } = run([board()], placed, {}, catalogWithCustom(parts))
    expect(base.has('custom:1')).toBe(false)
    expect(base.get('board-56x56-white')).toBe(1)
  })
})

describe('final — what the user actually buys', () => {
  it('adds hardware that was never placed on a board', () => {
    expect(run([board()], [], { 'connector-wall': 4 }).final.get('connector-wall')).toBe(4)
  })

  it('subtracts what the user already owns, leaving the wall alone', () => {
    const { base, final } = run([board()], hooks(6), { 'hook-large': -2 })
    expect(base.get('hook-large')).toBe(6)
    expect(final.get('hook-large')).toBe(4)
  })

  it('floors at zero rather than letting a negative quantity into the cost model', () => {
    // A crafted link or a hand-edited blob is the only way to get here.
    const { final } = run([board()], hooks(2), { 'hook-large': -99 })
    expect(final.get('hook-large')).toBe(0)
  })

  it('leaves a zeroed line present, or there is no way to put it back', () => {
    expect(run([board()], hooks(2), { 'hook-large': -2 }).final.has('hook-large')).toBe(true)
  })
})

describe('kits', () => {
  const baskets = [
    { ...hooks(1, 'basket-set-large')[0], id: 'b1', holeId: 'A:1,1' as Placement['holeId'] },
    { ...hooks(1, 'basket-set-medium')[0], id: 'b2', holeId: 'A:5,1' as Placement['holeId'] },
    { ...hooks(1, 'basket-set-small')[0], id: 'b3', holeId: 'A:9,1' as Placement['holeId'] },
  ]

  it('collapses one of each size into a single set, not three', () => {
    const { base } = run([board()], baskets)
    expect(base.get('basket-set-3')).toBe(1)
    expect(base.has('basket-set-large')).toBe(false)
  })

  it('reports the folded units as kitSets, so the footnote matches the line', () => {
    expect(run([board()], baskets).kitSets).toBe(1)
    expect(run([board()], []).kitSets).toBe(0)
  })

  it('adds sets the user asked for by hand on top of what the wall needs', () => {
    const { final } = run([board()], baskets, { 'basket-set-3': 2 })
    expect(final.get('basket-set-3')).toBe(3)
  })

  it('lets an adjustment on the pack take the wall’s own sets back off', () => {
    const { base, final } = run([board()], baskets, { 'basket-set-3': -1 })
    expect(base.get('basket-set-3')).toBe(1)
    expect(final.get('basket-set-3')).toBe(0)
  })
})
