/**
 * How many of each thing the wall needs, and how many the user actually wants
 * to buy.
 *
 * Split out of `CostTable` because two surfaces ask the same question — the
 * cost table and the palette's cost-only steppers — and because an editable
 * count needs a *base* to measure an adjustment against. Without a base there
 * is nothing to subtract from and "I already own two of these" cannot be
 * expressed.
 *
 * Pure, like `pricing.ts` and `wall.ts`: no React, no i18n, no store.
 */

import type { CatalogItem } from '../data/catalog'
import { isCustomKey } from '../data/customParts'
import { foldKits } from './pricing'
import { resolvePlacements } from './placements'
import { isCustomBoardKey } from '../data/customBoards'
import { buildWall, connectorsNeeded, layoutBoards } from './wall'
import type { Placement, PlacedBoard } from '../state/store'

export interface CountBreakdown {
  /**
   * What the wall itself needs: the boards, the connectors that join them, and
   * every placement that actually resolves — kit members already folded into
   * the pack that sells them.
   */
  base: Map<string, number>
  /** `base` plus the user's adjustments, floored at zero. What they buy. */
  final: Map<string, number>
  /** Units only obtainable as a kit, for the cost table's footnote. */
  kitSets: number
}

/**
 * @param extras Signed adjustments by catalog key. Positive adds hardware that
 *   was never placed on a board; negative says the user already owns some.
 */
export function countBreakdown(
  boards: readonly PlacedBoard[],
  placements: readonly Placement[],
  extras: Readonly<Record<string, number>>,
  byKey: ReadonlyMap<string, CatalogItem>,
): CountBreakdown {
  const wallCounts = new Map<string, number>()
  for (const board of boards) {
    // A user-defined board is a visualisation aid, exactly as a custom part is:
    // no article number, so nothing to buy and nothing to count.
    if (isCustomBoardKey(board.boardKey)) continue
    wallCounts.set(board.boardKey, (wallCounts.get(board.boardKey) ?? 0) + 1)
  }

  // Joining boards needs hardware; forgetting it is how you get home from
  // IKEA with a wall you cannot actually assemble.
  const connectors = connectorsNeeded(boards.length)
  if (connectors > 0) {
    wallCounts.set('connector-board', (wallCounts.get('connector-board') ?? 0) + connectors)
  }

  // Count what the scene actually renders, via the same resolver, so an item
  // can never be charged for while being invisible on the wall.
  const wall = buildWall(layoutBoards(boards, byKey), byKey)
  for (const { item } of resolvePlacements(placements, wall, byKey)) {
    if (isCustomKey(item.key)) continue
    wallCounts.set(item.key, (wallCounts.get(item.key) ?? 0) + 1)
  }

  // Placed basket sizes become sets of 3 here, before the include/exclude flags
  // and before the adjustments are read: the checkbox, the price override and
  // the count all belong to the pack the user actually buys, not to a size IKEA
  // does not sell on its own.
  const base = foldKits(wallCounts, byKey)

  // How much of the wall is only buyable as a kit, for the footnote. Read off
  // the difference the fold made rather than recounting, so the note can never
  // disagree with the line it explains. Untouched keys contribute zero.
  let kitSets = 0
  for (const [key, quantity] of base) kitSets += quantity - (wallCounts.get(key) ?? 0)

  // Folded separately, then added — rather than summed in before the fold, as
  // this used to be. The two give the same answer for anything the UI can
  // produce, but keeping them apart is what leaves `base` a number an edit can
  // be measured against.
  const adjustments = foldKits(new Map(Object.entries(extras)), byKey)

  const final = new Map(base)
  for (const [key, quantity] of adjustments) {
    // Floored at zero: a hand-edited localStorage blob or a crafted link must
    // not be able to put a negative quantity into the cost model.
    final.set(key, Math.max(0, (final.get(key) ?? 0) + quantity))
  }

  return { base, final, kitSets }
}
