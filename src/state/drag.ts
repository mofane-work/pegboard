/**
 * Transient drag state — deliberately separate from the persisted config store
 * so a half-finished drag can never be written to localStorage.
 */

import { create } from 'zustand'
import type { HoleId, Rotation } from '../lib/grid'

interface DragState {
  /** Set while dragging a new item out of the palette. */
  itemKey: string | null
  /** Set while moving an already-placed item. */
  movingId: string | null
  hoverHoleId: HoleId | null
  valid: boolean
  /** Which board on the wall the ghost is currently over. */
  boardIndex: number
  /** Rotation applied to the item currently in flight. */
  rotation: Rotation

  startFromPalette: (itemKey: string) => void
  startMove: (placementId: string, itemKey: string, rotation?: Rotation) => void
  hover: (holeId: HoleId | null, valid: boolean, boardIndex: number) => void
  rotate: () => void
  end: () => void
}

export const useDrag = create<DragState>()((set) => ({
  itemKey: null,
  movingId: null,
  hoverHoleId: null,
  valid: false,
  boardIndex: 0,
  rotation: 0,

  startFromPalette: (itemKey) =>
    set({ itemKey, movingId: null, hoverHoleId: null, valid: false, boardIndex: 0, rotation: 0 }),
  startMove: (movingId, itemKey, rotation = 0) =>
    set({ movingId, itemKey, hoverHoleId: null, valid: false, boardIndex: 0, rotation }),
  hover: (hoverHoleId, valid, boardIndex) => set({ hoverHoleId, valid, boardIndex }),
  rotate: () => set((s) => ({ rotation: ((s.rotation + 90) % 360) as Rotation })),
  end: () =>
    set({ itemKey: null, movingId: null, hoverHoleId: null, valid: false, boardIndex: 0, rotation: 0 }),
}))
