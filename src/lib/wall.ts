/**
 * Multi-board geometry.
 *
 * Hole ids stay board-relative and every function in grid.ts is untouched; the
 * only new idea is that each board sits at an offset on the wall, so collision
 * and snapping translate rects into a shared wall space. That keeps the tested
 * lattice maths exactly as it was.
 */

import { BOARDS, BY_KEY, isPlaceable, type BoardItem, type CatalogItem } from '../data/catalog'
import type { PlacedBoard, Placement } from '../state/store'
import {
  evaluatePlacement,
  generateHoles,
  indexHoles,
  rotatePattern,
  snapPlacement,
  type Hole,
  type HoleId,
  type PegPattern,
  type PlacementResult,
  type Rect,
} from './grid'

/** Boards are laid out in a row with this much air between them. */
export const BOARD_GAP_MM = 8

/**
 * Three boards is already a 1.7 m wall. Past that the camera framing and the
 * cost of a mistake both grow faster than the usefulness does.
 */
export const MAX_BOARDS = 3

/**
 * A catalog board as it actually hangs. `widthMm`/`heightMm` are the dimensions
 * after any quarter turn, so everything downstream — layout, sizing, snapping,
 * the print diagram — keeps reading them without knowing about orientation.
 */
export type OrientedBoard = BoardItem & { rotated: boolean }

export interface WallBoard {
  index: number
  spec: OrientedBoard
  offsetX: number
  offsetY: number
  holes: Hole[]
  byId: Map<HoleId, Hole>
}

/**
 * The item map these functions resolve board keys against.
 *
 * Defaulted rather than required so every existing call site and test keeps
 * working unchanged; the paths that must see a user-defined board pass
 * `catalogWith(customParts, customBoards)` instead. Same shape as
 * `resolvePlacements(placements, wall, byKey = BY_KEY)`.
 */
export type ItemMap = ReadonlyMap<string, CatalogItem>

/** Whether this board is one that can be hung sideways at all. */
export function canRotateBoard(boardKey: string, byKey: ItemMap = BY_KEY): boolean {
  const item = byKey.get(boardKey)
  return item?.kind === 'board' && item.rotatable
}

export function boardSpec(placed: PlacedBoard, byKey: ItemMap = BY_KEY): OrientedBoard {
  const resolved = byKey.get(placed.boardKey)
  // A board whose definition has been deleted falls back rather than throwing.
  const item = (resolved?.kind === 'board' ? resolved : BOARDS[0]) as BoardItem
  // A stored orientation is not trusted over the catalog. This is a live path,
  // not a hypothetical: every SKÅDIS board WAS rotatable and is not any more
  // (F42), so a wall saved or shared before that change still carries the flag.
  // `migrateConfig` clears it at v14 as well; this is the second line of
  // defence, and the only one a share link from an older build gets.
  if (!placed.rotated || !item.rotatable) return { ...item, rotated: false }
  // Only the dimensions swap. The grid is carried through untouched: rotation
  // is handled inside `generateHoles`, which exchanges the lattice origins
  // rather than the axes (findings F24).
  return { ...item, widthMm: item.heightMm, heightMm: item.widthMm, rotated: true }
}

export function buildWall(boards: readonly PlacedBoard[], byKey: ItemMap = BY_KEY): WallBoard[] {
  return boards.map((placed, index) => {
    const spec = boardSpec(placed, byKey)
    const holes = generateHoles(spec)
    return { index, spec, offsetX: placed.offsetX, offsetY: placed.offsetY, holes, byId: indexHoles(holes) }
  })
}

/**
 * Lay boards out left to right, vertically centred on the tallest. Positions
 * are derived rather than stored so adding or resizing a board can never leave
 * the wall with overlapping panels.
 */
export function layoutBoards(boards: readonly PlacedBoard[], byKey: ItemMap = BY_KEY): PlacedBoard[] {
  const specs = boards.map((placed) => boardSpec(placed, byKey))
  const tallest = Math.max(...specs.map((s) => s.heightMm), 0)

  let x = 0
  return boards.map((placed, i) => {
    const spec = specs[i]
    const laid = { ...placed, offsetX: x, offsetY: (tallest - spec.heightMm) / 2 }
    x += spec.widthMm + BOARD_GAP_MM
    return laid
  })
}

export function wallSize(
  boards: readonly PlacedBoard[],
  byKey: ItemMap = BY_KEY,
): { widthMm: number; heightMm: number } {
  const specs = boards.map((placed) => boardSpec(placed, byKey))
  const width =
    specs.reduce((sum, s) => sum + s.widthMm, 0) + BOARD_GAP_MM * Math.max(0, specs.length - 1)
  return { widthMm: width, heightMm: Math.max(...specs.map((s) => s.heightMm), 0) }
}

/**
 * Three.js world space → wall space.
 *
 * Wall space has its origin at the wall's bottom-left corner; the scene is
 * centred on the origin. Pointer events report a **world** point, so this is
 * the only conversion allowed — deriving it from an individual board's width
 * and offset is wrong for every board except one, which is subtle enough that
 * it shipped once already (findings F21).
 */
export function worldToWall(
  worldX: number,
  worldY: number,
  size: { widthMm: number; heightMm: number },
): readonly [number, number] {
  return [worldX + size.widthMm / 2, worldY + size.heightMm / 2]
}

/** A placement's bounding box translated into wall space. */
export function wallRect(rect: Rect, board: WallBoard): Rect {
  return { ...rect, x: rect.x + board.offsetX, y: rect.y + board.offsetY }
}

export function occupiedRects(
  wall: readonly WallBoard[],
  placements: readonly Placement[],
  skipId?: string | null,
): Rect[] {
  const rects: Rect[] = []

  for (const placement of placements) {
    if (placement.id === skipId) continue
    const board = wall[placement.boardIndex]
    const item = BY_KEY.get(placement.itemKey)
    if (!board || !item || !isPlaceable(item)) continue

    const hole = board.byId.get(placement.holeId)
    if (!hole) continue

    const pattern = rotatePattern(item.pattern, placement.rotation)
    rects.push(wallRect(evaluatePlacement(board.spec, hole, pattern, board.byId).rect, board))
  }

  return rects
}

export interface WallSnap {
  boardIndex: number
  result: PlacementResult
}

/**
 * Snap across every board on the wall, picking whichever board can actually
 * take the item nearest the cursor. Without this, dragging toward a seam would
 * refuse rather than hop to the neighbouring board.
 */
export function snapOnWall(
  wall: readonly WallBoard[],
  pattern: PegPattern,
  wallX: number,
  wallY: number,
  occupied: readonly Rect[],
): WallSnap | null {
  let best: WallSnap | null = null
  let bestDistance = Infinity
  let fallback: WallSnap | null = null

  for (const board of wall) {
    // Each board judges the cursor in its own coordinates, and the occupied
    // rects come back the other way, into wall space.
    const localOccupied = occupied.map((rect) => ({
      ...rect,
      x: rect.x - board.offsetX,
      y: rect.y - board.offsetY,
    }))

    const result = snapPlacement(
      board.spec,
      board.holes,
      pattern,
      wallX - board.offsetX,
      wallY - board.offsetY,
      board.byId,
      localOccupied,
    )
    if (!result) continue

    const centreX = result.rect.x + result.rect.w / 2 + board.offsetX
    const centreY = result.rect.y + result.rect.h / 2 + board.offsetY
    const distance = (centreX - wallX) ** 2 + (centreY - wallY) ** 2

    if (result.ok) {
      if (distance < bestDistance) {
        bestDistance = distance
        best = { boardIndex: board.index, result }
      }
    } else if (!fallback) {
      fallback = { boardIndex: board.index, result }
    }
  }

  return best ?? fallback
}

/**
 * Joining boards needs hardware, and forgetting it is the classic way to get
 * home from IKEA with an unbuildable wall. One connector pack per seam.
 */
export function connectorsNeeded(boardCount: number): number {
  return Math.max(0, boardCount - 1)
}
