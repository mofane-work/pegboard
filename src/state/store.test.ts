import { beforeEach, describe, expect, it } from 'vitest'
import {
  clampBoardName,
  MAX_BOARD_NAME_LENGTH,
  MAX_EXTRA,
  migrateConfig,
  useConfig,
} from './store'

/**
 * Persist migrations run against blobs written by builds that no longer exist,
 * which is the one input the app itself cannot produce. Nothing else covers
 * them, so a saved wall breaking on upgrade would be silent.
 */
describe('migrateConfig', () => {
  it('gives a v8 configuration the new pane height without touching anything else', () => {
    const v8 = {
      boards: [{ boardKey: 'board-76x56-white', offsetX: 0, offsetY: 0, rotated: true }],
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
    expect('boardKey' in out).toBe(false)
  })

  it('leaves a current configuration alone', () => {
    const current = {
      boards: [{ boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false }],
      placements: [],
      viewRatio: 0.55,
      viewHeight: 0.9,
      printAngle: 'front' as const,
      customParts: [],
      allowOverlap: false,
    }
    expect(migrateConfig(structuredClone(current), 11)).toEqual(current)
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
