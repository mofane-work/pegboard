import { beforeEach, describe, expect, it } from 'vitest'
import {
  clampBoardName,
  MAX_BOARD_NAME_LENGTH,
  MAX_EXTRA,
  migrateConfig,
  useConfig,
} from './store'
import {
  FALLBACK_BOARD_KEY,
  MAX_CELLS,
  MAX_CUSTOM_BOARDS,
} from '../data/customBoards'
import { MAX_PEG_LENGTH_MM, MIN_PEG_MM } from '../data/customParts'
import { MAX_PITCH_MM, SKADIS_GRID, SKADIS_PEGS } from '../lib/grid'

/**
 * Persist migrations run against blobs written by builds that no longer exist,
 * which is the one input the app itself cannot produce. Nothing else covers
 * them, so a saved wall breaking on upgrade would be silent.
 */
describe('migrateConfig', () => {
  it('gives a v8 configuration the new pane height without touching anything else', () => {
    const v8 = {
      // Upright, because this case is about the pane height. A v8 blob CAN
      // carry `rotated: true` on a SKÅDIS board — v14 is what straightens it,
      // and the case below covers that rather than tangling it up in here.
      boards: [{ boardKey: 'board-76x56-white', offsetX: 0, offsetY: 0, rotated: false }],
      placements: [{ id: 'a', itemKey: 'hook-large', holeId: 'A:2,3', rotation: 0, boardIndex: 0 }],
      viewRatio: 0.65,
      printAngle: 'iso',
      customParts: [],
    }

    const out = migrateConfig(structuredClone(v8), 8)

    expect(out.viewHeight).toBe(0.4)
    // The default is the height the pane already filled, so the wall a v8 user
    // saved reopens looking identical.
    expect(out.viewRatio).toBe(0.65)
    expect(out.boards).toEqual(v8.boards)
    expect(out.placements).toEqual(v8.placements)
  })

  it('does not overwrite a pane height that is already stored', () => {
    const out = migrateConfig({ viewHeight: 1.2, boards: [], placements: [] }, 8)
    expect(out.viewHeight).toBe(1.2)
  })

  it('gives a v9 configuration the strict placement rules it was built under', () => {
    // Off is what every wall saved before v10 was built with, so an existing
    // configuration must not reopen with collision quietly switched off.
    const out = migrateConfig({ boards: [], placements: [], viewHeight: 0.4 }, 9)
    expect(out.allowOverlap).toBe(false)
  })

  it('does not overwrite an overlap choice that is already stored', () => {
    const out = migrateConfig({ allowOverlap: true, boards: [], placements: [] }, 9)
    expect(out.allowOverlap).toBe(true)
  })

  it('carries a v1 configuration all the way forward in one pass', () => {
    // Four versions behind: every step has to run, in order, and no step may
    // assume a later one already happened.
    const v1 = {
      boardKey: 'board-36x56-multi',
      placements: [{ id: 'a', itemKey: 'hook-large', holeId: 'A:1,1' }],
    }

    const out = migrateConfig(v1, 1)

    expect(out.placements[0].rotation).toBe(0) // v2
    expect(out.viewRatio).toBe(0.55) // v3
    expect(out.printAngle).toBe('front') // v4
    expect(out.placements[0].boardIndex).toBe(0) // v5
    expect(out.boards[0].boardKey).toBe('board-36x56-white') // v6: multi dropped
    expect(out.customParts).toEqual([]) // v7
    expect(out.boards[0].rotated).toBe(false) // v8
    expect(out.viewHeight).toBe(0.4) // v9
    expect(out.allowOverlap).toBe(false) // v10
    expect(out.boards[0].name).toBeUndefined() // v11
    expect(out.customBoards).toEqual([]) // v12
    expect(out.customParts).toEqual([]) // v13 leaves an empty list empty
    expect('boardKey' in out).toBe(false)
  })

  it('gives a pre-v13 custom part SKÅDIS pegs, so it reopens unchanged', () => {
    const v12 = {
      boards: [{ boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false }],
      placements: [],
      customBoards: [],
      customParts: [{ key: 'custom:a', name: 'Router', cols: 2, rows: 2, depthMm: 60 }],
    }

    const out = migrateConfig(v12, 12)

    expect(out.customParts[0].pegs).toEqual(SKADIS_PEGS)
  })

  it('repairs a malformed peg spec rather than trusting a stored blob', () => {
    const out = migrateConfig(
      {
        boards: [],
        placements: [],
        customBoards: [],
        customParts: [
          {
            key: 'custom:a',
            name: 'x',
            cols: 2,
            rows: 2,
            depthMm: 60,
            pegs: { pitchMm: 9999, layout: 'sideways', shape: 'hex', widthMm: -4, lengthMm: 1e9 },
          },
        ],
      },
      12,
    )

    const pegs = out.customParts[0].pegs
    expect(pegs.pitchMm).toBe(MAX_PITCH_MM)
    expect(pegs.layout).toBe('ends')
    expect(pegs.shape).toBe('slot-v')
    expect(pegs.widthMm).toBe(MIN_PEG_MM)
    expect(pegs.lengthMm).toBe(MAX_PEG_LENGTH_MM)
  })

  it('straightens a pre-v14 SKÅDIS board, which can no longer be turned', () => {
    // Every SKÅDIS panel was rotatable until F42; the slots are upright, so a
    // turned one holds nothing. `boardSpec` refuses to honour a stale flag
    // anyway — this clears it at the source, so the share-link encoder stops
    // writing an orientation nothing will ever apply.
    const v13 = {
      boards: [
        { boardKey: 'board-36x56-white', offsetX: 0, offsetY: 0, rotated: true },
        { boardKey: 'board-56x37-freestanding', offsetX: 0, offsetY: 0, rotated: true },
      ],
      placements: [],
      customParts: [],
      customBoards: [],
    }

    const out = migrateConfig(v13, 13)

    expect(out.boards.map((b) => b.rotated)).toEqual([false, false])
  })

  it('leaves a turned custom board turned, because that one really can turn', () => {
    // The step reads THIS user's boards, not the bare catalog. Reading the
    // catalog alone would straighten a user-defined panel that is allowed to
    // hang either way round, and take everything on it with it.
    const v13 = {
      boards: [{ boardKey: 'custom-board:a', offsetX: 0, offsetY: 0, rotated: true }],
      placements: [],
      customParts: [],
      customBoards: [
        { key: 'custom-board:a', name: 'Shed panel', cols: 6, rows: 6, grid: SKADIS_GRID },
      ],
    }

    const out = migrateConfig(v13, 13)

    expect(out.boards[0].rotated).toBe(true)
  })

  it('leaves a current configuration alone', () => {
    const current = {
      boards: [{ boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false }],
      placements: [],
      viewRatio: 0.55,
      viewHeight: 0.9,
      printAngle: 'front' as const,
      customParts: [],
      customBoards: [],
      allowOverlap: false,
    }
    expect(migrateConfig(structuredClone(current), 14)).toEqual(current)
  })

  it('does not overwrite custom boards that are already stored', () => {
    const stored = [
      {
        key: 'custom-board:a',
        name: 'Workshop',
        cols: 10,
        rows: 8,
        grid: {
          pitchMm: 40,
          arrangement: 'staggered' as const,
          shape: 'slot-v' as const,
          holeWidthMm: 5,
          holeHeightMm: 15,
          thicknessMm: 5,
        },
      },
    ]
    const out = migrateConfig({ boards: [], placements: [], customBoards: stored }, 11)
    expect(out.customBoards).toEqual(stored)
  })

  it('re-clamps a board name rather than trusting what was stored', () => {
    // A blob we did not write is the only way an over-long name gets here:
    // `migrate` is skipped entirely when the stored version already matches.
    const out = migrateConfig(
      {
        boards: [{ boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false, name: 'x'.repeat(80) }],
        placements: [],
      },
      10,
    )
    expect(out.boards[0].name).toHaveLength(MAX_BOARD_NAME_LENGTH)
  })
})

describe('clampBoardName', () => {
  it('trims and caps, so a name cannot overflow the toolbar', () => {
    expect(clampBoardName('  Garage  ')).toBe('Garage')
    expect(clampBoardName('y'.repeat(100))).toHaveLength(MAX_BOARD_NAME_LENGTH)
  })

  it('turns an empty name into undefined, so "unnamed" has one representation', () => {
    expect(clampBoardName('')).toBeUndefined()
    expect(clampBoardName('   ')).toBeUndefined()
    expect(clampBoardName(undefined)).toBeUndefined()
  })

  it('drops control characters instead of putting them in the DOM', () => {
    expect(clampBoardName('Ga\u0000ra\u001fge')).toBe('Garage')
  })
})

describe('renameBoard', () => {
  beforeEach(() => {
    useConfig.setState({
      boards: [
        { boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false },
        { boardKey: 'board-36x56-white', offsetX: 560, offsetY: 0, rotated: false },
      ],
      placements: [],
      customParts: [],
      past: [],
      future: [],
    })
  })

  it('names one board and leaves its neighbour alone', () => {
    useConfig.getState().renameBoard(0, 'Garage')
    expect(useConfig.getState().boards[0].name).toBe('Garage')
    expect(useConfig.getState().boards[1].name).toBeUndefined()
  })

  it('clamps in the store, not only in the input', () => {
    useConfig.getState().renameBoard(0, `  ${'z'.repeat(80)}  `)
    expect(useConfig.getState().boards[0].name).toHaveLength(MAX_BOARD_NAME_LENGTH)
  })

  it('clears the name on empty, restoring the numbered fallback', () => {
    useConfig.getState().renameBoard(0, 'Garage')
    useConfig.getState().renameBoard(0, '  ')
    expect(useConfig.getState().boards[0].name).toBeUndefined()
  })

  it('is undoable, because a rename is an edit to the wall like any other', () => {
    useConfig.getState().renameBoard(0, 'Garage')
    useConfig.getState().undo()
    expect(useConfig.getState().boards[0].name).toBeUndefined()
    useConfig.getState().redo()
    expect(useConfig.getState().boards[0].name).toBe('Garage')
  })

  it('ignores an index that is not on the wall', () => {
    const before = useConfig.getState().boards
    useConfig.getState().renameBoard(7, 'Nowhere')
    expect(useConfig.getState().boards).toBe(before)
  })
})

describe('setExtra', () => {
  beforeEach(() => {
    useConfig.setState({ extras: {} })
  })

  it('accepts a negative, which is how "I already own two" is said', () => {
    useConfig.getState().setExtra('hook-large', -2)
    expect(useConfig.getState().extras['hook-large']).toBe(-2)
  })

  it('drops the key at zero rather than storing a no-op adjustment', () => {
    useConfig.getState().setExtra('hook-large', 3)
    useConfig.getState().setExtra('hook-large', 0)
    expect('hook-large' in useConfig.getState().extras).toBe(false)
  })

  it('clamps both directions and truncates to a whole count', () => {
    useConfig.getState().setExtra('hook-large', 99_999)
    expect(useConfig.getState().extras['hook-large']).toBe(MAX_EXTRA)
    useConfig.getState().setExtra('hook-large', -99_999)
    expect(useConfig.getState().extras['hook-large']).toBe(-MAX_EXTRA)
    useConfig.getState().setExtra('hook-large', 2.9)
    expect(useConfig.getState().extras['hook-large']).toBe(2)
  })

  it('treats a non-number as no adjustment at all', () => {
    useConfig.getState().setExtra('hook-large', Number.NaN)
    expect('hook-large' in useConfig.getState().extras).toBe(false)
  })
})

describe('colour overrides', () => {
  beforeEach(() => {
    useConfig.setState({ colors: {}, theme: 'light' })
  })

  it('stores six-digit hexes', () => {
    useConfig.getState().setColors({ '--board-color': '#123456', '--scene-bg': '#654321' })
    expect(useConfig.getState().colors).toEqual({
      '--board-color': '#123456',
      '--scene-bg': '#654321',
    })
  })

  it('drops anything that is not a literal colour, keeping the rest', () => {
    for (const bad of ['red', '#ff0', 'url(x)', 'var(--color-accent)', '#12345g']) {
      useConfig.getState().setColors({ '--board-color': bad, '--scene-bg': '#654321' })
      expect(useConfig.getState().colors).toEqual({ '--scene-bg': '#654321' })
    }
  })

  it('ignores a token that is not one of the four', () => {
    useConfig.getState().setColors({ '--snap-ok': '#123456' } as never)
    expect(useConfig.getState().colors).toEqual({})
  })

  it('replaces wholesale, so an empty map is the reset', () => {
    useConfig.getState().setColors({ '--board-color': '#123456' })
    useConfig.getState().setColors({ '--scene-bg': '#654321' })
    expect(useConfig.getState().colors).toEqual({ '--scene-bg': '#654321' })
    useConfig.getState().setColors({})
    expect(useConfig.getState().colors).toEqual({})
  })

  it('goes back to the theme’s own colours when the theme changes', () => {
    useConfig.getState().setColors({ '--board-color': '#123456' })
    useConfig.getState().setTheme('dark')
    expect(useConfig.getState().colors).toEqual({})
  })
})

describe('user-defined boards', () => {
  const GRID = {
    pitchMm: 40,
    arrangement: 'staggered' as const,
    shape: 'slot-v' as const,
    holeWidthMm: 5,
    holeHeightMm: 15,
    thicknessMm: 5,
  }
  const DEF = { name: 'Printed', cols: 8, rows: 8, grid: GRID }

  beforeEach(() => {
    useConfig.setState({
      boards: [{ boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false }],
      placements: [],
      customParts: [],
      customBoards: [],
      extras: {},
      excluded: {},
      overrides: {},
      past: [],
      future: [],
      selectedId: null,
    })
  })

  it('clamps a definition on the way in, not only in the dialog', () => {
    // `migrate` is skipped when the stored version matches, so the store is the
    // only place that sees every value before it reaches the extruder.
    const key = useConfig.getState().addCustomBoard({ ...DEF, cols: 5000 })!
    expect(useConfig.getState().customBoards[0].cols).toBe(MAX_CELLS)
    expect(key.startsWith('custom-board:')).toBe(true)
  })

  it('stops at the cap rather than growing without limit', () => {
    for (let i = 0; i < MAX_CUSTOM_BOARDS; i += 1) {
      expect(useConfig.getState().addCustomBoard(DEF)).not.toBeNull()
    }
    expect(useConfig.getState().addCustomBoard(DEF)).toBeNull()
    expect(useConfig.getState().customBoards).toHaveLength(MAX_CUSTOM_BOARDS)
  })

  it('can be turned sideways, which the catalog alone would refuse', () => {
    // `canRotateBoard` reads the catalog, and a user-defined board is not in
    // it — without the merged map a custom panel silently would not turn.
    const key = useConfig.getState().addCustomBoard(DEF)!
    useConfig.setState({ boards: [{ boardKey: key, offsetX: 0, offsetY: 0, rotated: false }] })
    useConfig.getState().rotateBoard(0)
    expect(useConfig.getState().boards[0].rotated).toBe(true)
  })

  it('clears what hangs on a panel when its definition is edited', () => {
    const key = useConfig.getState().addCustomBoard(DEF)!
    useConfig.setState({
      boards: [{ boardKey: key, offsetX: 0, offsetY: 0, rotated: false }],
      placements: [
        { id: 'a', itemKey: 'hook-large', holeId: 'A:1,1', rotation: 0, boardIndex: 0 },
      ],
    })

    useConfig.getState().updateCustomBoard(key, { ...DEF, cols: 4 })

    // The holes moved, so what was hanging on them is gone — the same thing
    // changing a stock board's size already does.
    expect(useConfig.getState().placements).toEqual([])
    expect(useConfig.getState().customBoards[0].cols).toBe(4)
  })

  it('falls a panel back to a stock board when its definition is deleted', () => {
    const key = useConfig.getState().addCustomBoard(DEF)!
    useConfig.setState({
      boards: [{ boardKey: key, offsetX: 0, offsetY: 0, rotated: true }],
      placements: [
        { id: 'a', itemKey: 'hook-large', holeId: 'A:1,1', rotation: 0, boardIndex: 0 },
      ],
    })

    useConfig.getState().removeCustomBoard(key)

    expect(useConfig.getState().customBoards).toEqual([])
    expect(useConfig.getState().boards[0].boardKey).toBe(FALLBACK_BOARD_KEY)
    expect(useConfig.getState().boards[0].rotated).toBe(false)
    expect(useConfig.getState().placements).toEqual([])
  })

  it('restores the definition and its wall together on undo', () => {
    const key = useConfig.getState().addCustomBoard(DEF)!
    useConfig.setState({ boards: [{ boardKey: key, offsetX: 0, offsetY: 0, rotated: false }] })
    useConfig.getState().removeCustomBoard(key)
    useConfig.getState().undo()

    expect(useConfig.getState().customBoards).toHaveLength(1)
    expect(useConfig.getState().boards[0].boardKey).toBe(key)
  })
})

describe('applyShared with a user-defined board', () => {
  const GEOMETRY = {
    cols: 12,
    rows: 9,
    grid: {
      pitchMm: 25.4,
      arrangement: 'aligned' as const,
      shape: 'round' as const,
      holeWidthMm: 6.35,
      holeHeightMm: 6.35,
      thicknessMm: 6.35,
    },
  }

  function link(count = 1) {
    return {
      boards: Array.from({ length: count }, () => ({
        boardKey: '',
        offsetX: 0,
        offsetY: 0,
        rotated: false,
        custom: GEOMETRY,
      })),
      market: 'us',
      currency: 'USD',
      placements: [],
      excluded: [],
      overrides: {},
      extras: {},
    }
  }

  beforeEach(() => {
    useConfig.setState({ boards: [], placements: [], customBoards: [], past: [], future: [] })
  })

  it('materialises a definition the recipient did not have', () => {
    useConfig.getState().applyShared(link())
    const { customBoards, boards } = useConfig.getState()

    expect(customBoards).toHaveLength(1)
    expect(customBoards[0].grid.pitchMm).toBe(25.4)
    expect(boards[0].boardKey).toBe(customBoards[0].key)
  })

  it('gives one definition to a wall that uses the same board twice', () => {
    useConfig.getState().applyShared(link(2))
    const { customBoards, boards } = useConfig.getState()

    expect(customBoards).toHaveLength(1)
    expect(boards[0].boardKey).toBe(boards[1].boardKey)
  })

  it('does not pile up duplicates when the same link is opened twice', () => {
    useConfig.getState().applyShared(link())
    useConfig.getState().applyShared(link())

    expect(useConfig.getState().customBoards).toHaveLength(1)
  })

  it('names it by its size, since the sender’s own name never travels', () => {
    useConfig.getState().applyShared(link())
    expect(useConfig.getState().customBoards[0].name).toBe('305×229')
  })

  it('clamps a crafted link rather than trusting its numbers', () => {
    const crafted = link()
    crafted.boards[0] = {
      ...crafted.boards[0],
      custom: { ...GEOMETRY, cols: 900, rows: 900 },
    }
    useConfig.getState().applyShared(crafted)

    const board = useConfig.getState().customBoards[0]
    expect(board.cols).toBeLessThanOrEqual(MAX_CELLS)
    expect(board.rows).toBeLessThanOrEqual(MAX_CELLS)
  })
})
