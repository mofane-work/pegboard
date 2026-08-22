import { beforeEach, describe, expect, it } from 'vitest'
import { BY_KEY, isPlaceable } from '../data/catalog'
import {
  BOARD_GAP_MM,
  MAX_BOARDS,
  boardSpec,
  buildWall,
  canRotateBoard,
  connectorsNeeded,
  layoutBoards,
  occupiedRects,
  snapOnWall,
  wallSize,
  worldToWall,
} from './wall'
import { useConfig, type PlacedBoard } from '../state/store'

const one: PlacedBoard[] = [{ boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false }]
const two: PlacedBoard[] = [
  { boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false },
  { boardKey: 'board-36x56-white', offsetX: 0, offsetY: 0, rotated: false },
]

const shelf = BY_KEY.get('shelf')!
if (!isPlaceable(shelf)) throw new Error('shelf should be placeable')

describe('layout', () => {
  it('places boards left to right with a gap', () => {
    const laid = layoutBoards(two)
    expect(laid[0].offsetX).toBe(0)
    expect(laid[1].offsetX).toBe(560 + BOARD_GAP_MM)
  })

  it('vertically centres shorter boards against the tallest', () => {
    const mixed = layoutBoards([
      { boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false },
      { boardKey: 'board-56x37-freestanding', offsetX: 0, offsetY: 0, rotated: false },
    ])
    expect(mixed[0].offsetY).toBe(0)
    expect(mixed[1].offsetY).toBe((560 - 370) / 2)
  })

  it('derives positions rather than trusting stored ones, so boards cannot overlap', () => {
    const corrupt: PlacedBoard[] = [
      { boardKey: 'board-56x56-white', offsetX: 999, offsetY: 999, rotated: false },
      { boardKey: 'board-36x56-white', offsetX: 999, offsetY: 999, rotated: false },
    ]
    const laid = layoutBoards(corrupt)
    expect(laid[0].offsetX).toBe(0)
    expect(laid[1].offsetX).toBeGreaterThan(560)
  })

  it('measures the whole wall including the gaps', () => {
    expect(wallSize(one)).toEqual({ widthMm: 560, heightMm: 560 })
    expect(wallSize(two)).toEqual({ widthMm: 560 + BOARD_GAP_MM + 360, heightMm: 560 })
  })
})

describe('world → wall conversion', () => {
  const three: PlacedBoard[] = Array.from({ length: 3 }, () => ({
    boardKey: 'board-56x56-white',
    offsetX: 0,
    offsetY: 0,
    rotated: false,
  }))
  const size = wallSize(three)

  it('depends only on the wall, never on which board was hit', () => {
    // The shipped bug added the hit board's own half-width plus its offset,
    // which is right for exactly one board and wrong by ±568 mm for the others.
    const wall = buildWall(layoutBoards(three))
    for (const board of wall) {
      const centreWorld = board.offsetX + board.spec.widthMm / 2 - size.widthMm / 2
      const [wallX] = worldToWall(centreWorld, 0, size)
      expect(wallX, `board ${board.index}`).toBeCloseTo(board.offsetX + board.spec.widthMm / 2)
    }
  })

  it('maps the wall corners to 0 and full width', () => {
    expect(worldToWall(-size.widthMm / 2, -size.heightMm / 2, size)).toEqual([0, 0])
    expect(worldToWall(size.widthMm / 2, size.heightMm / 2, size)).toEqual([
      size.widthMm,
      size.heightMm,
    ])
  })

  it('drops a component on the board the cursor is actually over', () => {
    // The end-to-end version of the bug: aiming at board 2 landed on board 0's
    // far edge, because the cursor arrived 568 mm out of position.
    const wall = buildWall(layoutBoards(three))
    const shelfPattern = shelf.pattern

    for (const board of wall) {
      const centreWorld = board.offsetX + board.spec.widthMm / 2 - size.widthMm / 2
      const [wallX, wallY] = worldToWall(centreWorld, 0, size)
      const snap = snapOnWall(wall, shelfPattern, wallX, wallY, [])
      expect(snap?.boardIndex, `aimed at board ${board.index}`).toBe(board.index)
      expect(snap?.result.ok).toBe(true)
    }
  })
})

describe('snapping across a wall', () => {
  const wall = buildWall(layoutBoards(two))

  it('lands on the first board when the cursor is over it', () => {
    const snap = snapOnWall(wall, shelf.pattern, 280, 300, [])
    expect(snap?.boardIndex).toBe(0)
    expect(snap?.result.ok).toBe(true)
  })

  it('hops to the second board rather than refusing near the seam', () => {
    // Without cross-board snapping this position would simply reject.
    const snap = snapOnWall(wall, shelf.pattern, 560 + BOARD_GAP_MM + 180, 300, [])
    expect(snap?.boardIndex).toBe(1)
    expect(snap?.result.ok).toBe(true)
  })

  it('reports positions in each board’s own coordinates', () => {
    const snap = snapOnWall(wall, shelf.pattern, 560 + BOARD_GAP_MM + 180, 300, [])!
    // The anchor is board-relative, so it must sit inside the 360 mm board.
    expect(snap.result.anchor.x).toBeLessThanOrEqual(360)
  })

  it('respects items already placed on the other board', () => {
    const first = snapOnWall(wall, shelf.pattern, 280, 300, [])!
    const occupied = [
      { ...first.result.rect, x: first.result.rect.x + wall[0].offsetX, y: first.result.rect.y },
    ]
    const again = snapOnWall(wall, shelf.pattern, 280, 300, occupied)!
    // It must move somewhere else rather than stack on top.
    expect(again.result.ok && again.result.anchor.id !== first.result.anchor.id).toBe(true)
  })
})

describe('occupied rects', () => {
  it('translates each placement into wall space', () => {
    const wall = buildWall(layoutBoards(two))
    const rects = occupiedRects(wall, [
      { id: 'a', itemKey: 'shelf', holeId: 'A:1,1', rotation: 0, boardIndex: 0 },
      { id: 'b', itemKey: 'shelf', holeId: 'A:1,1', rotation: 0, boardIndex: 1 },
    ])
    expect(rects).toHaveLength(2)
    // Same hole on the second board must land a full board-width to the right.
    expect(rects[1].x - rects[0].x).toBeCloseTo(560 + BOARD_GAP_MM)
  })

  it('skips the placement being moved', () => {
    const wall = buildWall(layoutBoards(one))
    const rects = occupiedRects(
      wall,
      [{ id: 'a', itemKey: 'shelf', holeId: 'A:1,1', rotation: 0, boardIndex: 0 }],
      'a',
    )
    expect(rects).toEqual([])
  })

  it('ignores a placement pointing at a board that has left the wall', () => {
    const wall = buildWall(layoutBoards(one))
    const rects = occupiedRects(wall, [
      { id: 'a', itemKey: 'shelf', holeId: 'A:1,1', rotation: 0, boardIndex: 5 },
    ])
    expect(rects).toEqual([])
  })
})

describe('board cap', () => {
  it('stops at three boards', () => {
    expect(MAX_BOARDS).toBe(3)
  })
})

describe('connectors', () => {
  it('needs one per seam, and none for a single board', () => {
    expect(connectorsNeeded(1)).toBe(0)
    expect(connectorsNeeded(2)).toBe(1)
    expect(connectorsNeeded(4)).toBe(3)
  })
})

describe('board management', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useConfig.setState({ boards: [...one], placements: [], selectedId: null, past: [], future: [] })
  })

  it('refuses to add beyond the cap', () => {
    for (let i = 0; i < 6; i += 1) useConfig.getState().addBoard('board-56x56-white')
    expect(useConfig.getState().boards).toHaveLength(MAX_BOARDS)
  })

  it('adds and removes boards, keeping at least one', () => {
    useConfig.getState().addBoard('board-36x56-white')
    expect(useConfig.getState().boards).toHaveLength(2)

    useConfig.getState().removeBoard(1)
    expect(useConfig.getState().boards).toHaveLength(1)

    useConfig.getState().removeBoard(0)
    expect(useConfig.getState().boards).toHaveLength(1)
  })

  it('removes that board’s placements and reindexes the rest', () => {
    useConfig.getState().addBoard('board-36x56-white')
    useConfig.setState({
      placements: [
        { id: 'a', itemKey: 'shelf', holeId: 'A:1,1', rotation: 0, boardIndex: 0 },
        { id: 'b', itemKey: 'clip', holeId: 'A:2,2', rotation: 0, boardIndex: 1 },
      ],
    })

    useConfig.getState().removeBoard(0)

    const placements = useConfig.getState().placements
    expect(placements).toHaveLength(1)
    // The survivor must follow its board down to index 0, not dangle at 1.
    expect(placements[0]).toMatchObject({ id: 'b', boardIndex: 0 })
  })

  it('clears only the resized board when one board changes size', () => {
    useConfig.getState().addBoard('board-36x56-white')
    useConfig.setState({
      placements: [
        { id: 'a', itemKey: 'shelf', holeId: 'A:1,1', rotation: 0, boardIndex: 0 },
        { id: 'b', itemKey: 'clip', holeId: 'A:2,2', rotation: 0, boardIndex: 1 },
      ],
    })

    useConfig.getState().setBoard('board-76x56-white', 0)

    expect(useConfig.getState().placements.map((p) => p.id)).toEqual(['b'])
  })

  it('undoes adding a board', () => {
    useConfig.getState().addBoard('board-36x56-white')
    useConfig.getState().undo()
    expect(useConfig.getState().boards).toHaveLength(1)
  })
})

describe('board orientation on the wall', () => {
  const upright: PlacedBoard = { boardKey: 'board-36x56-white', offsetX: 0, offsetY: 0, rotated: false }
  const turned: PlacedBoard = { ...upright, rotated: true }

  it('reports the dimensions a turned panel actually hangs at', () => {
    expect(boardSpec(upright)).toMatchObject({ widthMm: 360, heightMm: 560, rotated: false })
    expect(boardSpec(turned)).toMatchObject({ widthMm: 560, heightMm: 360, rotated: true })
  })

  it('keeps the catalog identity so costing and naming are untouched', () => {
    expect(boardSpec(turned).key).toBe('board-36x56-white')
    expect(boardSpec(turned).itemNos).toEqual(boardSpec(upright).itemNos)
  })

  it('sizes and lays out the wall from the turned dimensions', () => {
    expect(wallSize([turned])).toEqual({ widthMm: 560, heightMm: 360 })
    const laid = layoutBoards([turned, { boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false }])
    // Second board starts past the turned panel's 560 mm width, not its 360 mm.
    expect(laid[1].offsetX).toBe(560 + BOARD_GAP_MM)
    // Vertically centred on the taller neighbour.
    expect(laid[0].offsetY).toBe((560 - 360) / 2)
  })

  it('generates the turned hole field, not the upright one', () => {
    const [board] = buildWall([turned])
    expect(board.holes).toHaveLength(229)
    expect(Math.max(...board.holes.map((h) => h.x))).toBeCloseTo(540)
  })

  it('refuses an orientation the free-standing board cannot hold', () => {
    expect(canRotateBoard('board-36x56-white')).toBe(true)
    expect(canRotateBoard('board-56x37-freestanding')).toBe(false)
    // A stale saved wall or share link can still name one; the catalog wins.
    const stand: PlacedBoard = { boardKey: 'board-56x37-freestanding', offsetX: 0, offsetY: 0, rotated: true }
    expect(boardSpec(stand)).toMatchObject({ widthMm: 560, heightMm: 370, rotated: false })
  })
})
