import { beforeEach, describe, expect, it } from 'vitest'
import { rotatePattern } from './grid'
import { resolvePlacements, unresolvablePlacementIds } from './placements'
import { buildWall, layoutBoards } from './wall'
import { useConfig, type Placement } from '../state/store'

const wall = buildWall(layoutBoards([{ boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false }]))
const byId = wall[0].byId

function placement(over: Partial<Placement> = {}): Placement {
  return { id: 'p1', itemKey: 'hook-large', holeId: 'A:5,5', rotation: 0, boardIndex: 0, ...over }
}

describe('resolvePlacements', () => {
  it('resolves a well-formed placement', () => {
    const [resolved] = resolvePlacements([placement()], wall)
    expect(resolved.item.key).toBe('hook-large')
    expect(resolved.hole.id).toBe('A:5,5')
  })

  it('applies the placement rotation to the pattern, keeping the base intact', () => {
    const shelf = placement({ itemKey: 'shelf', rotation: 90 })
    const [resolved] = resolvePlacements([shelf], wall)
    expect(resolved.pattern).toEqual(rotatePattern(resolved.basePattern, 90))
    expect(resolved.basePattern.offsets).toEqual([[6, 0]])
  })

  it('drops a placement whose hole no longer exists on this board', () => {
    // A:0,13 existed under the pre-correction lattice; lattice A now has 13 rows.
    expect(byId.has('A:0,13')).toBe(false)
    expect(resolvePlacements([placement({ holeId: 'A:0,13' })], wall)).toEqual([])
  })

  it('drops a placement referencing an item that left the catalog', () => {
    expect(resolvePlacements([placement({ itemKey: 'nonexistent' })], wall)).toEqual([])
  })

  it('drops a placement for a cost-only item that cannot sit on a board', () => {
    expect(resolvePlacements([placement({ itemKey: 'connector-wall' })], wall)).toEqual([])
  })

  it('reports exactly the ids it could not resolve', () => {
    const items = [
      placement({ id: 'good' }),
      placement({ id: 'stale-hole', holeId: 'A:0,13' }),
      placement({ id: 'gone', itemKey: 'nonexistent' }),
    ]
    expect(unresolvablePlacementIds(items, wall).sort()).toEqual(['gone', 'stale-hole'])
  })
})

describe('store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useConfig.setState({
      placements: [],
      selectedId: null,
      boards: [{ boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false }],
    })
  })

  it('records rotation when placing', () => {
    useConfig.getState().place('hook-large', 'A:5,5', 90, 0)
    expect(useConfig.getState().placements[0]).toMatchObject({ holeId: 'A:5,5', rotation: 90 })
  })

  it('cycles rotation in quarter turns and wraps back to upright', () => {
    useConfig.getState().place('hook-large', 'A:5,5', 0, 0)
    const id = useConfig.getState().placements[0].id
    const angles = [90, 180, 270, 0]
    for (const expected of angles) {
      useConfig.getState().rotate(id)
      expect(useConfig.getState().placements[0].rotation).toBe(expected)
    }
  })

  it('keeps rotation when an item is moved', () => {
    useConfig.getState().place('shelf', 'A:2,2', 180, 0)
    const id = useConfig.getState().placements[0].id
    useConfig.getState().move(id, 'A:4,4', 180, 0)
    expect(useConfig.getState().placements[0]).toMatchObject({ holeId: 'A:4,4', rotation: 180 })
  })

  it('prunes unresolvable placements and clears a selection pointing at one', () => {
    useConfig.setState({
      placements: [placement({ id: 'keep' }), placement({ id: 'drop', holeId: 'A:0,13' })],
      selectedId: 'drop',
    })
    useConfig.getState().pruneUnresolvable(['drop'])
    expect(useConfig.getState().placements.map((p) => p.id)).toEqual(['keep'])
    expect(useConfig.getState().selectedId).toBeNull()
  })

  it('leaves state untouched when there is nothing to prune', () => {
    const before = useConfig.getState().placements
    useConfig.getState().pruneUnresolvable([])
    expect(useConfig.getState().placements).toBe(before)
  })

  it('clears the board when the board size changes, since holes differ', () => {
    useConfig.getState().place('hook-large', 'A:5,5', 0, 0)
    useConfig.getState().setBoard('board-36x56-white')
    expect(useConfig.getState().placements).toEqual([])
  })

  it('undoes and redoes a placement', () => {
    useConfig.getState().place('hook-large', 'A:5,5', 0, 0)
    expect(useConfig.getState().placements).toHaveLength(1)

    useConfig.getState().undo()
    expect(useConfig.getState().placements).toHaveLength(0)

    useConfig.getState().redo()
    expect(useConfig.getState().placements).toHaveLength(1)
  })

  it('undoes a removal, a rotation and a board clear', () => {
    useConfig.getState().place('hook-large', 'A:5,5', 0, 0)
    const id = useConfig.getState().placements[0].id

    useConfig.getState().rotate(id)
    useConfig.getState().undo()
    expect(useConfig.getState().placements[0].rotation).toBe(0)

    useConfig.getState().remove(id)
    useConfig.getState().undo()
    expect(useConfig.getState().placements).toHaveLength(1)

    useConfig.getState().clearBoard()
    useConfig.getState().undo()
    expect(useConfig.getState().placements).toHaveLength(1)
  })

  it('restores the board itself when undoing a board change', () => {
    useConfig.getState().place('hook-large', 'A:5,5', 0, 0)
    useConfig.getState().setBoard('board-36x56-white')
    expect(useConfig.getState().placements).toHaveLength(0)

    useConfig.getState().undo()
    expect(useConfig.getState().boards[0].boardKey).toBe('board-56x56-white')
    expect(useConfig.getState().placements).toHaveLength(1)
  })

  it('discards the redo branch once you edit after undoing', () => {
    useConfig.getState().place('hook-large', 'A:5,5', 0, 0)
    useConfig.getState().undo()
    useConfig.getState().place('shelf', 'A:2,2', 0, 0)

    expect(useConfig.getState().future).toHaveLength(0)
    useConfig.getState().redo()
    expect(useConfig.getState().placements.map((p) => p.itemKey)).toEqual(['shelf'])
  })

  it('does nothing when there is nothing to undo or redo', () => {
    expect(() => useConfig.getState().undo()).not.toThrow()
    expect(() => useConfig.getState().redo()).not.toThrow()
    expect(useConfig.getState().placements).toEqual([])
  })

  it('bounds the history rather than growing forever', () => {
    for (let i = 0; i < 80; i += 1) useConfig.getState().place('hook-large', 'A:5,5', 0, 0)
    expect(useConfig.getState().past.length).toBeLessThanOrEqual(50)
  })

  it('applying a shared configuration is not undoable past its own start', () => {
    useConfig.getState().place('hook-large', 'A:5,5', 0, 0)
    useConfig.getState().applyShared({
      boards: [{ boardKey: 'board-36x56-white', offsetX: 0, offsetY: 0, rotated: false }],
      market: 'de',
      currency: 'EUR',
      placements: [{ itemKey: 'shelf', holeId: 'A:1,1', rotation: 90, boardIndex: 0 }],
      excluded: ['shelf'],
      overrides: { shelf: 4 },
      extras: {},
    })

    const state = useConfig.getState()
    expect(state.boards[0].boardKey).toBe('board-36x56-white')
    expect(state.market).toBe('de')
    expect(state.placements[0]).toMatchObject({ itemKey: 'shelf', rotation: 90 })
    expect(state.excluded).toEqual({ shelf: true })
    expect(state.past).toEqual([])
    expect(state.future).toEqual([])
  })

  it('gives shared placements fresh ids so they cannot collide', () => {
    useConfig.getState().applyShared({
      boards: [{ boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false }],
      market: 'us',
      currency: 'USD',
      placements: [
        { itemKey: 'shelf', holeId: 'A:1,1', rotation: 0, boardIndex: 0 },
        { itemKey: 'clip', holeId: 'A:2,2', rotation: 0, boardIndex: 0 },
      ],
      excluded: [],
      overrides: {},
      extras: {},
    })
    const ids = useConfig.getState().placements.map((p) => p.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('clamps the view ratio to a usable range', () => {
    useConfig.getState().setViewRatio(0.9)
    expect(useConfig.getState().viewRatio).toBe(0.7)
    useConfig.getState().setViewRatio(0.1)
    expect(useConfig.getState().viewRatio).toBe(0.3)
  })

  it('clamps the pane height to a usable range', () => {
    // Clamped in the store, not only in the slider: `migrate` is skipped when
    // the persisted version already matches, so a hand-edited localStorage blob
    // reaches this setter unchecked.
    useConfig.getState().setViewHeight(9)
    expect(useConfig.getState().viewHeight).toBe(1.5)
    useConfig.getState().setViewHeight(0)
    expect(useConfig.getState().viewHeight).toBe(0.4)
  })

  it('removes an override when given a non-number rather than storing NaN', () => {
    useConfig.getState().setOverride('hook-large', 5)
    expect(useConfig.getState().overrides['hook-large']).toBe(5)
    useConfig.getState().setOverride('hook-large', Number.NaN)
    expect('hook-large' in useConfig.getState().overrides).toBe(false)
  })

  it('drops an extra rather than storing a zero or negative quantity', () => {
    useConfig.getState().setExtra('connector-wall', 2)
    expect(useConfig.getState().extras['connector-wall']).toBe(2)
    useConfig.getState().setExtra('connector-wall', 0)
    expect('connector-wall' in useConfig.getState().extras).toBe(false)
  })
})
