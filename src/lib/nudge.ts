/**
 * Moving an already-placed accessory one hole at a time.
 *
 * WHY THIS IS NOT A RE-SNAP
 * The obvious implementation is "take the body centre, add 40 mm, call
 * snapOnWall". It is wrong, and quietly so. `snapPlacement` returns the nearest
 * *valid* hole to the point it is given, so when the intended neighbour is
 * occupied it slides to whichever other hole happens to be the same distance
 * away — pressing Up moves the item sideways. Holes carry `col`/`row` and ids
 * are `holeId(lattice, col, row)`, so the intended neighbour is an exact map
 * lookup. A step that does not work refuses; it never approximates
 * (findings F33b).
 *
 * PARITY COMES FREE
 * Both lattices have the same 40 mm pitch, so a ±1 step in `col`/`row` stays on
 * the same lattice by construction. A multi-peg accessory therefore cannot be
 * nudged onto a mixed A/B position — the case the whole snapper exists to
 * prevent — without a single parity check in this file (findings F33c).
 *
 * This module is pure: no React, no store, no side effects. It answers "where
 * would this land?" and the caller decides whether to commit it with the
 * existing `move()` action.
 */

import { BY_KEY, type CatalogItem } from '../data/catalog'
import {
  bodyCentreOffset,
  evaluatePlacement,
  gridOf,
  holeId,
  type HoleId,
  type Rect,
  type Rotation,
} from './grid'
import { resolvePlacements, type ResolvedPlacement } from './placements'
import type { Placement } from '../state/store'
import { occupiedRects, snapOnWall, type WallBoard } from './wall'

export type NudgeDirection = 'left' | 'right' | 'up' | 'down'

/**
 * Lattice steps per direction. Board space has its origin bottom-left with +y
 * up (see grid.ts), so `up` is row + 1 and not row − 1.
 */
const STEPS: Record<NudgeDirection, readonly [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, 1],
  down: [0, -1],
}

/** Exactly the arguments `move()` takes, minus the id. */
export interface NudgeTarget {
  holeId: HoleId
  boardIndex: number
  /** Unchanged by a nudge — carried because `move()` requires it. */
  rotation: Rotation
}

/**
 * Where `id` would land if nudged one hole in `direction`, or null if it
 * cannot go that way.
 *
 * `byKey` is injected for the same reason `resolvePlacements` takes it: a
 * user-defined custom part is a synthetic `AccessoryItem` that lives outside
 * `BY_KEY`, and it must nudge like anything else.
 */
export function nudgePlacement(
  wall: readonly WallBoard[],
  placements: readonly Placement[],
  id: string,
  direction: NudgeDirection,
  byKey: ReadonlyMap<string, CatalogItem> = BY_KEY,
  /**
   * Ignore other items' bodies. Pegs still have to land in real slots — this
   * only relaxes collision, which is what walls an item in with no legal step
   * toward where the user wants it (findings F34d).
   */
  allowOverlap = false,
): NudgeTarget | null {
  const resolved = resolvePlacements(placements, wall, byKey).find((r) => r.placement.id === id)
  if (!resolved) return null

  // Excluding the mover is mandatory, not an optimisation: without it the item
  // collides with the box it is currently standing in and every nudge fails
  // (findings F33g). Same argument the drag path already relies on.
  const occupied = allowOverlap ? [] : occupiedRects(wall, placements, id)
  const { board, hole } = resolved
  const [dCol, dRow] = STEPS[direction]

  const neighbour = board.byId.get(holeId(hole.lattice, hole.col + dCol, hole.row + dRow))
  if (neighbour) {
    const result = evaluatePlacement(
      board.spec,
      neighbour,
      resolved.pattern,
      board.byId,
      toBoardSpace(occupied, board),
    )
    return result.ok ? target(neighbour.id, board.index, resolved) : null
  }

  // No such hole on this board — we are at an edge. Hole ids are
  // board-relative, so crossing the seam has to go through wall space.
  return crossSeam(wall, resolved, direction, occupied)
}

/** Wall-space rects into one board's local frame, as `snapOnWall` also does. */
function toBoardSpace(rects: readonly Rect[], board: WallBoard): Rect[] {
  return rects.map((rect) => ({
    ...rect,
    x: rect.x - board.offsetX,
    y: rect.y - board.offsetY,
  }))
}

function target(hole: HoleId, boardIndex: number, resolved: ResolvedPlacement): NudgeTarget {
  return { holeId: hole, boardIndex, rotation: resolved.placement.rotation }
}

/**
 * Step onto the next board along.
 *
 * A cross-seam step is inherently uneven and there is no way to make it even:
 * boards sit `BOARD_GAP_MM` apart and neither lattice continues across the gap
 * on a 40 mm rhythm. Landing on lattice A off a 560 mm board is an 8 mm
 * overshoot; landing on B is 48 mm. So the guard cannot be "exactly one pitch".
 * It is instead:
 *
 *   - a different board (the same board was already handled, exactly), and
 *   - near where we aimed, and
 *   - actually displaced in the direction asked for.
 *
 * The direction test is what keeps this honest. Distance alone would happily
 * accept a hole one pitch *back* across the seam, which is how a nudge ends up
 * moving the item the wrong way (findings F33d).
 */
function crossSeam(
  wall: readonly WallBoard[],
  resolved: ResolvedPlacement,
  direction: NudgeDirection,
  occupied: readonly Rect[],
): NudgeTarget | null {
  const { board, hole, pattern } = resolved
  const [dCol, dRow] = STEPS[direction]

  // The step is one of THIS board's pitches, not a hardcoded 40 mm. A custom
  // board may be on any pitch, and aiming 40 mm across a 25.4 mm panel lands
  // between holes and fails the distance test below for no good reason.
  const pitchMm = gridOf(board.spec).pitchMm
  const aimX = hole.x + dCol * pitchMm + board.offsetX
  const aimY = hole.y + dRow * pitchMm + board.offsetY

  // snapOnWall is given a body centre, not an anchor — the same convention the
  // drag path uses, and the reason wide items are placeable at all (F9).
  const [centreX, centreY] = bodyCentreOffset(pattern)
  const snap = snapOnWall(wall, pattern, aimX + centreX, aimY + centreY, occupied)
  if (!snap || !snap.result.ok || snap.boardIndex === board.index) return null

  const landed = wall[snap.boardIndex]
  const landedX = snap.result.anchor.x + landed.offsetX
  const landedY = snap.result.anchor.y + landed.offsetY

  // Tolerance scales with the coarser of the two pitches, or a seam between
  // boards of different spacing rejects every legal crossing.
  const tolerance = Math.max(pitchMm, gridOf(landed.spec).pitchMm) * 1.5
  if (Math.hypot(landedX - aimX, landedY - aimY) > tolerance) return null

  const movedX = landedX - (hole.x + board.offsetX)
  const movedY = landedY - (hole.y + board.offsetY)
  if (movedX * dCol + movedY * dRow <= 0) return null

  return target(snap.result.anchor.id, snap.boardIndex, resolved)
}
