/**
 * Accessory geometry, one builder per archetype.
 *
 * These are honest low-poly stand-ins at true IKEA dimensions — enough to judge
 * fit, reach, and layout, not product renders. Every shape is built from
 * primitives so the whole catalog costs kilobytes rather than the ~3 MB per
 * product IKEA's own (unusable) GLBs would.
 *
 * Local origin for every builder: the accessory's primary peg, with the body
 * extending in -y (down) and +z (out from the board face).
 */

import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Shape,
  TorusGeometry,
  type Vector3Tuple,
} from 'three'
import type { AccessoryItem, Archetype } from '../../data/catalog'

export interface Part {
  geometry: BufferGeometry
  position: Vector3Tuple
  rotation?: Vector3Tuple
}

const WALL = 2

function box(w: number, h: number, d: number, position: Vector3Tuple): Part {
  return { geometry: new BoxGeometry(w, h, d), position }
}

/** Open-topped tray: four walls and a floor, so you can see what it holds. */
function tray(w: number, h: number, d: number, originY: number): Part[] {
  const y = originY - h / 2
  return [
    box(w, WALL, d, [0, originY - h + WALL / 2, d / 2]),
    box(WALL, h, d, [-w / 2 + WALL / 2, y, d / 2]),
    box(WALL, h, d, [w / 2 - WALL / 2, y, d / 2]),
    box(w, h, WALL, [0, y, d - WALL / 2]),
    box(w, h, WALL, [0, y, WALL / 2]),
  ]
}

/** Hook: a short stem off the board, then an upturned tip. */
function hookParts(depth: number, height: number, thickness: number): Part[] {
  return [
    box(thickness, thickness, depth, [0, -thickness / 2, depth / 2]),
    box(thickness, height - thickness, thickness, [
      0,
      -thickness - (height - thickness) / 2,
      depth - thickness / 2,
    ]),
  ]
}

/**
 * Corner radius for a custom box. DERIVED, never user-set, so
 * `buildAccessoryParts(item)` keeps its single-argument signature and `dims`
 * stays sufficient to draw the part.
 */
export function customCornerRadius(w: number, h: number, d: number): number {
  const proportional = Math.min(w, h, d) * 0.12
  // Must stay under half the shortest side or the arcs cross over each other.
  const ceiling = Math.min(w, h) / 2 - 0.01
  return Math.max(0.5, Math.min(8, proportional, ceiling))
}

/**
 * Rounded rectangle in the XY plane: x centred on 0, top edge at y = 0, hanging
 * down to y = -h. Same `absarc` idiom as the board's obround slots.
 */
function roundedRect(w: number, h: number, r: number): Shape {
  const x0 = -w / 2
  const x1 = w / 2
  const y0 = -h
  const y1 = 0
  const shape = new Shape()

  shape.moveTo(x0 + r, y0)
  shape.lineTo(x1 - r, y0)
  shape.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false)
  shape.lineTo(x1, y1 - r)
  shape.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false)
  shape.lineTo(x0 + r, y1)
  shape.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false)
  shape.lineTo(x0, y0 + r)
  shape.absarc(x0 + r, y0 + r, r, Math.PI, (3 * Math.PI) / 2, false)
  shape.closePath()

  return shape
}

/**
 * A user-defined placeholder: a rounded-rectangle prism extruded out from the
 * board face. Extrusion runs +z from 0, so nothing sits behind the panel.
 */
function customBoxParts(w: number, h: number, d: number): Part[] {
  const geometry = new ExtrudeGeometry(roundedRect(w, h, customCornerRadius(w, h, d)), {
    depth: d,
    bevelEnabled: false,
    curveSegments: 6,
  })
  geometry.computeVertexNormals()

  return [{ geometry, position: [0, 0, 0] }]
}

export function buildAccessoryParts(item: AccessoryItem): Part[] {
  const { w, d, h } = item.dims
  const archetype: Archetype = item.archetype

  switch (archetype) {
    case 'hook':
      return hookParts(d, h, 8)

    case 'hookSmall':
      return hookParts(d, h, 6)

    case 'hookRound':
      return [
        {
          geometry: new CylinderGeometry(w / 2, w / 2, 12, 16),
          position: [0, -w / 2, 6],
          rotation: [Math.PI / 2, 0, 0],
        },
      ]

    case 'hookRack':
      return [
        box(w, h, d, [0, -h / 2, d / 2]),
        // Five pegs along the rail — this is what you actually hang things on.
        ...Array.from({ length: 5 }, (_, i) => ({
          geometry: new TorusGeometry(7, 2, 6, 12, Math.PI),
          position: [-w / 2 + 30 + i * ((w - 60) / 4), -h - 6, d / 2] as Vector3Tuple,
          rotation: [0, 0, Math.PI] as Vector3Tuple,
        })),
      ]

    case 'shelf':
      return [
        box(w, WALL * 1.5, d, [0, -h + WALL, d / 2]),
        box(w, h, WALL, [0, -h / 2, WALL / 2]),
        box(w, h / 2, WALL, [0, -h + h / 4, d - WALL / 2]),
      ]

    case 'displayShelf':
      return [
        box(w, WALL * 1.5, d, [0, -h + WALL, d / 2]),
        box(w, h, WALL, [0, -h / 2, WALL / 2]),
        // Front lip, so displayed items do not slide off.
        box(w, h * 0.6, WALL, [0, -h + h * 0.3, d - WALL / 2]),
      ]

    case 'container':
    case 'containerLid':
      return [
        ...tray(w, h, d, 0),
        // The lid caps the container at the peg line, so it sits just BELOW
        // y = 0 — drawing it above put it on the wrong side of the pegs.
        ...(archetype === 'containerLid' ? [box(w, WALL, d, [0, -WALL / 2, d / 2])] : []),
      ]

    case 'basket':
      return [
        ...tray(w, h, d, 0),
        // Suggest the wire mesh with a few uprights rather than modelling it.
        ...Array.from({ length: 6 }, (_, i) => ({
          geometry: new BoxGeometry(1.5, h, 1.5),
          position: [-w / 2 + 20 + i * ((w - 40) / 5), -h / 2, d - 1] as Vector3Tuple,
        })),
      ]

    case 'clip':
      return [
        box(w, h, WALL, [0, -h / 2, WALL]),
        box(w, h * 0.7, WALL, [0, -h * 0.35, WALL * 3]),
      ]

    case 'cord':
      return [
        {
          geometry: new CylinderGeometry(3, 3, w, 8),
          position: [0, -5, 4],
          rotation: [0, 0, Math.PI / 2],
        },
      ]

    case 'customBox':
      return customBoxParts(w, h, d)

    default:
      // Connectors and bundles are cost-only and never rendered, but a visible
      // box beats an invisible failure if one ever reaches the scene.
      return [box(Math.max(w, 10), Math.max(h, 10), Math.max(d, 10), [0, -h / 2, d / 2])]
  }
}
