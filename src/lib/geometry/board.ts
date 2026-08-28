/**
 * Procedural board geometry.
 *
 * IKEA's own GLB models are CORS-locked to ikea.com and carry no peg-anchor
 * data (findings.md F2), so the board is extruded here from a rectangle with
 * one hole punched per slot. One geometry, triangulated once.
 *
 * Holes wind clockwise while the outline winds anticlockwise; that opposition
 * is what makes them cut rather than fill, and every shape below preserves it.
 */

import { ExtrudeGeometry, Path, Shape } from 'three'
import {
  SLOT_HEIGHT_MM,
  SLOT_WIDTH_MM,
  gridOf,
  type BoardSpec,
  type Hole,
  type HoleGrid,
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
export function slotPath(
  cx: number,
  cy: number,
  rotated = false,
  widthMm = SLOT_WIDTH_MM,
  heightMm = SLOT_HEIGHT_MM,
): Path {
  const radius = widthMm / 2
  // A slot no longer than it is wide is a circle; clamping keeps the arcs from
  // crossing over each other rather than producing a bow-tie.
  const straight = Math.max(0, heightMm / 2 - radius)

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

/** A round hole, wound clockwise to match the obround. */
function roundPath(cx: number, cy: number, diameterMm: number): Path {
  const path = new Path()
  path.absarc(cx, cy, diameterMm / 2, 0, Math.PI * 2, true)
  return path
}

/** A square hole: up the left side, across the top, down the right. Clockwise. */
function squarePath(cx: number, cy: number, sideMm: number): Path {
  const half = sideMm / 2
  const path = new Path()
  path.moveTo(cx - half, cy - half)
  path.lineTo(cx - half, cy + half)
  path.lineTo(cx + half, cy + half)
  path.lineTo(cx + half, cy - half)
  path.closePath()
  return path
}

/**
 * One hole of whatever shape this board's grid says, at whatever orientation
 * the panel is hung.
 *
 * Rotation only means anything to a slot, and it means the same thing as
 * declaring the other slot shape — so the two fold into a single `horizontal`
 * flag rather than two branches that could disagree.
 */
export function holePath(cx: number, cy: number, grid: HoleGrid, rotated = false): Path {
  switch (grid.shape) {
    case 'round':
      return roundPath(cx, cy, grid.holeWidthMm)
    case 'square':
      return squarePath(cx, cy, grid.holeWidthMm)
    default: {
      const horizontal = (grid.shape === 'slot-h') !== Boolean(rotated)
      return slotPath(cx, cy, horizontal, grid.holeWidthMm, grid.holeHeightMm)
    }
  }
}

/**
 * Board mesh centred on the origin, extruded along +z with the front face at
 * z = 0. Millimetres are the world unit throughout.
 */
export function buildBoardGeometry(board: BoardSpec, holes: readonly Hole[]): ExtrudeGeometry {
  const grid = gridOf(board)
  const halfWidth = board.widthMm / 2
  const halfHeight = board.heightMm / 2

  const outline = new Shape()
  outline.moveTo(-halfWidth, -halfHeight)
  outline.lineTo(halfWidth, -halfHeight)
  outline.lineTo(halfWidth, halfHeight)
  outline.lineTo(-halfWidth, halfHeight)
  outline.closePath()

  for (const hole of holes) {
    outline.holes.push(holePath(hole.x - halfWidth, hole.y - halfHeight, grid, board.rotated))
  }

  const geometry = new ExtrudeGeometry(outline, {
    depth: grid.thicknessMm,
    bevelEnabled: false,
    curveSegments: 8,
  })

  geometry.translate(0, 0, -grid.thicknessMm)
  geometry.computeVertexNormals()

  return geometry
}
