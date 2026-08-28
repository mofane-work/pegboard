import { describe, expect, it } from 'vitest'
import { BY_KEY, isPlaceable } from '../data/catalog'
import { catalogWithCustom, newCustomKey, type CustomPart } from '../data/customParts'
import { catalogWith, type CustomBoard } from '../data/customBoards'
import { PITCH_MM, SKADIS_GRID, SKADIS_PEGS, holeId } from './grid'
import { nudgePlacement, type NudgeDirection } from './nudge'
import { buildWall, layoutBoards, type WallBoard } from './wall'
import type { PlacedBoard, Placement } from '../state/store'

const ONE: PlacedBoard[] = [
  { boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false },
]
const TWO: PlacedBoard[] = [
  { boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false },
  { boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false },
]

function wallOf(boards: PlacedBoard[], byKey = BY_KEY): WallBoard[] {
  return buildWall(layoutBoards(boards, byKey), byKey)
}

let seq = 0
function placed(itemKey: string, hole: string, boardIndex = 0, rotation = 0): Placement {
  seq += 1
  return { id: `p${seq}`, itemKey, holeId: hole, rotation: rotation as 0, boardIndex }
}

/** Board-space position of a placement's anchor, for asserting real distances. */
function anchorOf(wall: WallBoard[], placement: Placement) {
  const hole = wall[placement.boardIndex].byId.get(placement.holeId)
  if (!hole) throw new Error(`no such hole: ${placement.holeId}`)
  return hole
}

const hook = BY_KEY.get('hook-large')!
if (!isPlaceable(hook)) throw new Error('hook-large should be placeable')
const shelf = BY_KEY.get('shelf')!
if (!isPlaceable(shelf)) throw new Error('shelf should be placeable')

describe('nudging within one board', () => {
  const wall = wallOf(ONE)
  // Well inside the board, so no direction is blocked by an edge.
  const middle = holeId('A', 5, 5)

  it.each([
    ['right', 1, 0],
    ['left', -1, 0],
    ['up', 0, 1],
    ['down', 0, -1],
  ] as const)('moves exactly one pitch %s', (direction, dCol, dRow) => {
    const item = placed('hook-large', middle)
    const target = nudgePlacement(wall, [item], item.id, direction)

    expect(target).not.toBeNull()
    const from = anchorOf(wall, item)
    const to = wall[target!.boardIndex].byId.get(target!.holeId)!
    expect(to.x - from.x).toBe(dCol * PITCH_MM)
    expect(to.y - from.y).toBe(dRow * PITCH_MM)
  })

  it('stays on its own lattice, which is what multi-peg parity depends on', () => {
    const item = placed('shelf', middle)
    for (const direction of ['left', 'right', 'up', 'down'] as NudgeDirection[]) {
      const target = nudgePlacement(wall, [item], item.id, direction)
      expect(target?.holeId.startsWith('A:')).toBe(true)
    }
  })

  it('carries the rotation across unchanged', () => {
    const item = placed('hook-large', middle, 0, 90)
    expect(nudgePlacement(wall, [item], item.id, 'right')?.rotation).toBe(90)
  })

  it('returns null for an id that is not on the wall', () => {
    expect(nudgePlacement(wall, [], 'nope', 'right')).toBeNull()
  })
})

describe('what stops a nudge', () => {
  const wall = wallOf(ONE)

  it('refuses rather than sliding sideways when the neighbour is taken', () => {
    // The whole reason this is an exact lookup and not a re-snap (F33b): a
    // re-snap would find some other hole the same distance from the target and
    // move the item there, so pressing Right would move it Up.
    const mover = placed('hook-large', holeId('A', 5, 5))
    const blocker = placed('hook-large', holeId('A', 6, 5))

    expect(nudgePlacement(wall, [mover, blocker], mover.id, 'right')).toBeNull()
    // ...and the other three directions still work, so it is the neighbour
    // that is refused and not the item that is stuck.
    expect(nudgePlacement(wall, [mover, blocker], mover.id, 'left')).not.toBeNull()
    expect(nudgePlacement(wall, [mover, blocker], mover.id, 'up')).not.toBeNull()
  })

  it('does not collide with the box the mover is standing in', () => {
    // Without the skipId in occupiedRects every nudge fails (F33g).
    const item = placed('shelf', holeId('A', 3, 5))
    expect(nudgePlacement(wall, [item], item.id, 'right')).not.toBeNull()
  })

  it('stops at the board edge on a single-board wall', () => {
    const holes = wall[0].holes.filter((h) => h.lattice === 'A')
    const maxCol = Math.max(...holes.map((h) => h.col))
    const maxRow = Math.max(...holes.map((h) => h.row))

    const right = placed('hook-large', holeId('A', maxCol, 5))
    expect(nudgePlacement(wall, [right], right.id, 'right')).toBeNull()

    const top = placed('hook-large', holeId('A', 5, maxRow))
    expect(nudgePlacement(wall, [top], top.id, 'up')).toBeNull()

    const left = placed('hook-large', holeId('A', 0, 5))
    expect(nudgePlacement(wall, [left], left.id, 'left')).toBeNull()

    const bottom = placed('hook-large', holeId('A', 5, 0))
    expect(nudgePlacement(wall, [bottom], bottom.id, 'down')).toBeNull()
  })

  it('refuses to move a wide item off the edge, because a peg would miss', () => {
    // The shelf spans 6 pitches, so its right-hand peg runs out of board well
    // before its anchor does. The hard rule is every peg on a real slot (F10).
    const holes = wall[0].holes.filter((h) => h.lattice === 'A')
    const maxCol = Math.max(...holes.map((h) => h.col))
    const item = placed('shelf', holeId('A', maxCol - 6, 5))
    expect(nudgePlacement(wall, [item], item.id, 'right')).toBeNull()
  })
})

describe('crossing the seam between boards', () => {
  const wall = wallOf(TWO)
  const rightEdgeCol = Math.max(
    ...wall[0].holes.filter((h) => h.lattice === 'A').map((h) => h.col),
  )

  it('steps onto the next board rather than dead-ending', () => {
    const item = placed('hook-large', holeId('A', rightEdgeCol, 5))
    const target = nudgePlacement(wall, [item], item.id, 'right')

    expect(target).not.toBeNull()
    expect(target!.boardIndex).toBe(1)
  })

  it('always moves in the direction asked for, never back across the seam', () => {
    // Distance alone would accept a hole one pitch *back* over the gap, which
    // is a nudge that moves the item the wrong way (F33d).
    const item = placed('hook-large', holeId('A', rightEdgeCol, 5))
    const target = nudgePlacement(wall, [item], item.id, 'right')!

    const from = anchorOf(wall, item)
    const to = wall[target.boardIndex].byId.get(target.holeId)!
    const fromWallX = from.x + wall[0].offsetX
    const toWallX = to.x + wall[target.boardIndex].offsetX
    expect(toWallX).toBeGreaterThan(fromWallX)
  })

  it('comes back the other way, so the crossing is not one-directional', () => {
    const item = placed('hook-large', holeId('A', 0, 5), 1)
    const target = nudgePlacement(wall, [item], item.id, 'left')

    expect(target).not.toBeNull()
    expect(target!.boardIndex).toBe(0)
  })

  it('does not cross when the far board has no room there', () => {
    const item = placed('hook-large', holeId('A', rightEdgeCol, 5))
    // Fill the landing site on board 1 and every hole it could reasonably slide
    // to, so the crossing has nowhere legitimate to go.
    const blockers = wall[1].holes
      .filter((h) => h.col <= 1)
      .map((h) => placed('hook-large', h.id, 1))

    expect(nudgePlacement(wall, [item, ...blockers], item.id, 'right')).toBeNull()
  })

  it('does not cross on a lattice whose next hole is past the far board', () => {
    // Found by probing, not by reasoning: board 0's rightmost B hole sits 40 mm
    // from the edge, so aiming one pitch right lands nearer board 0's own A
    // column than anything on board 1. snapOnWall picks board 0, the crossing
    // is rejected as "same board", and the item stops. That is the right
    // answer — the alternative is a 20 mm sideways lattice swap, which is not a
    // step and would be invalid for anything with more than one peg.
    const maxBCol = Math.max(
      ...wall[0].holes.filter((h) => h.lattice === 'B').map((h) => h.col),
    )
    const item = placed('hook-large', holeId('B', maxBCol, 5))
    expect(nudgePlacement(wall, [item], item.id, 'right')).toBeNull()
  })

  it('still refuses vertically at the top of a two-board wall', () => {
    const maxRow = Math.max(...wall[0].holes.filter((h) => h.lattice === 'A').map((h) => h.row))
    const item = placed('hook-large', holeId('A', 5, maxRow))
    expect(nudgePlacement(wall, [item], item.id, 'up')).toBeNull()
  })
})

describe('custom parts', () => {
  const wall = wallOf(ONE)
  const part: CustomPart = {
    key: newCustomKey(),
    name: 'Router',
    cols: 2,
    rows: 2,
    depthMm: 60,
    lattice: 'A',
    pegs: { ...SKADIS_PEGS },
  }
  const byKey = catalogWithCustom([part])

  it('nudges like any other accessory, with no special case', () => {
    const item = placed(part.key, holeId('A', 5, 5))
    const target = nudgePlacement(wall, [item], item.id, 'right', byKey)

    expect(target).not.toBeNull()
    const from = anchorOf(wall, item)
    const to = wall[target!.boardIndex].byId.get(target!.holeId)!
    expect(to.x - from.x).toBe(PITCH_MM)
  })

  it('is unresolvable without its catalog, and refuses instead of throwing', () => {
    const item = placed(part.key, holeId('A', 5, 5))
    expect(nudgePlacement(wall, [item], item.id, 'right')).toBeNull()
  })
})

describe('a turned board', () => {
  // Rotation exchanges the two lattice origins (F24). A nudge must keep working
  // and must still stay on one lattice.
  //
  // A USER-DEFINED panel, of exactly SKÅDIS 36x56 geometry. No SKÅDIS board
  // turns any more (F42), and `buildWall` honours the catalog over a stored
  // flag — so naming a real 36×56 here would quietly build an upright board and
  // this block would pass while testing nothing.
  const turnable: CustomBoard = {
    key: 'custom-board:turned',
    name: 'Turned panel',
    cols: 9,
    rows: 14,
    grid: SKADIS_GRID,
  }
  const byKey = catalogWith([], [turnable])
  const wall = wallOf(
    [{ boardKey: turnable.key, offsetX: 0, offsetY: 0, rotated: true }],
    byKey,
  )

  it('really is turned, or the cases below prove nothing', () => {
    expect(wall[0].spec.rotated).toBe(true)
    expect(wall[0].spec.widthMm).toBe(560)
  })

  it('moves one pitch in every direction on a rotated panel', () => {
    const item = placed('hook-large', holeId('B', 4, 4))
    for (const direction of ['left', 'right', 'up', 'down'] as NudgeDirection[]) {
      const target = nudgePlacement(wall, [item], item.id, direction)
      expect(target, direction).not.toBeNull()
      expect(target!.holeId.startsWith('B:')).toBe(true)
    }
  })
})
