/**
 * Procedural SKÅDIS board geometry.
 *
 * IKEA's own GLB models are CORS-locked to ikea.com and carry no peg-anchor
 * data (findings.md F2), so the board is extruded here from a rectangle with
 * one obround hole punched per slot. One geometry, triangulated once.
 */

import { ExtrudeGeometry, Path, Shape } from 'three'
import {
  BOARD_THICKNESS_MM,
  SLOT_HEIGHT_MM,
  SLOT_WIDTH_MM,
  type BoardSpec,
  type Hole,
} from '../grid'

/**
 * A SKÅDIS slot is an obround: a 5 mm wide, 15 mm tall slot with semicircular
 * 2.5 mm ends. Coordinates are centred on the slot.
 *
 * On a panel hung sideways the obround lies down with it — a rotated board
 * really does present 15 x 5 mm horizontal slots, and drawing them upright
 * would quietly misrepresent the one thing rotation changes about a slot
 * (findings.md F24).
 */
export function slotPath(cx: number, cy: number, rotated = false): Path {
  const radius = SLOT_WIDTH_MM / 2
  const straight = SLOT_HEIGHT_MM / 2 - radius

  // `along` runs the slot's 15 mm axis, `across` its 5 mm one. Rotating the
  // panel swaps which world axis each maps to, and turns every arc a quarter
  // turn with them; winding is unchanged, so the hole still cuts.
  const at = (along: number, across: number): [number, number] =>
    rotated ? [cx + along, cy - across] : [cx + across, cy + along]
  const quarter = rotated ? -Math.PI / 2 : 0

  const path = new Path()
  path.moveTo(...at(-straight, -radius))
  path.lineTo(...at(straight, -radius))
  path.absarc(...at(straight, 0), radius, Math.PI + quarter, quarter, true)
  path.lineTo(...at(-straight, radius))
  path.absarc(...at(-straight, 0), radius, quarter, Math.PI + quarter, true)

  return path
}

/**
 * Board mesh centred on the origin, extruded along +z with the front face at
 * z = 0. Millimetres are the world unit throughout.
 */
export function buildBoardGeometry(board: BoardSpec, holes: readonly Hole[]): ExtrudeGeometry {
  const halfWidth = board.widthMm / 2
  const halfHeight = board.heightMm / 2

  const outline = new Shape()
  outline.moveTo(-halfWidth, -halfHeight)
  outline.lineTo(halfWidth, -halfHeight)
  outline.lineTo(halfWidth, halfHeight)
  outline.lineTo(-halfWidth, halfHeight)
  outline.closePath()

  for (const hole of holes) {
    outline.holes.push(slotPath(hole.x - halfWidth, hole.y - halfHeight, board.rotated))
  }

  const geometry = new ExtrudeGeometry(outline, {
    depth: BOARD_THICKNESS_MM,
    bevelEnabled: false,
    curveSegments: 8,
  })

  geometry.translate(0, 0, -BOARD_THICKNESS_MM)
  geometry.computeVertexNormals()

  return geometry
}
