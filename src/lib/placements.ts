/**
 * One resolver for "what is actually on the board", shared by the 3D scene and
 * the shopping list.
 *
 * They used to answer this question separately: the scene skipped placements
 * whose hole did not exist, while the cost table counted every placement
 * regardless. A saved configuration that predates a lattice change therefore
 * held items that were invisible but still charged for. Same question, one
 * answer.
 *
 * A placement is also unresolvable if its board has left the wall.
 */

import { BY_KEY, isPlaceable, type AccessoryItem, type CatalogItem } from '../data/catalog'
import type { Placement } from '../state/store'
import { rotatePattern, type Hole, type PegPattern, type Rotation } from './grid'
import type { WallBoard } from './wall'

export interface ResolvedPlacement {
  placement: Placement
  board: WallBoard
  item: AccessoryItem
  hole: Hole
  /** Unrotated pattern — the mesh applies rotation via its own group. */
  basePattern: PegPattern
  /** Pattern with the placement's rotation already applied. */
  pattern: PegPattern
  rotation: Rotation
}

/**
 * `byKey` is injected so user-defined custom parts resolve alongside the real
 * catalog — see data/customParts.ts. Defaults to the catalog alone.
 */
export function resolvePlacements(
  placements: readonly Placement[],
  wall: readonly WallBoard[],
  byKey: ReadonlyMap<string, CatalogItem> = BY_KEY,
): ResolvedPlacement[] {
  const resolved: ResolvedPlacement[] = []

  for (const placement of placements) {
    const board = wall[placement.boardIndex]
    const item = byKey.get(placement.itemKey)
    const hole = board?.byId.get(placement.holeId)
    if (!board || !item || !hole || !isPlaceable(item)) continue

    resolved.push({
      placement,
      board,
      item,
      hole,
      basePattern: item.pattern,
      pattern: rotatePattern(item.pattern, placement.rotation),
      rotation: placement.rotation,
    })
  }

  return resolved
}

/**
 * Placements that cannot be resolved against the current board — a stale
 * hole id, or an item that has left the catalog. These are dropped rather than
 * left to haunt the total invisibly.
 */
export function unresolvablePlacementIds(
  placements: readonly Placement[],
  wall: readonly WallBoard[],
  byKey: ReadonlyMap<string, CatalogItem> = BY_KEY,
): string[] {
  const kept = new Set(resolvePlacements(placements, wall, byKey).map((r) => r.placement.id))
  return placements.filter((p) => !kept.has(p.id)).map((p) => p.id)
}
