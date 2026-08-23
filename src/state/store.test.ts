import { describe, expect, it } from 'vitest'
import { migrateConfig } from './store'

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
    expect(migrateConfig(structuredClone(current), 10)).toEqual(current)
  })
})
