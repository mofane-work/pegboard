import { Box3, Mesh, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { ACCESSORIES, BOARDS, isPlaceable } from '../../data/catalog'
import { buildAccessoryParts } from './archetypes'
import {
  bodyOriginOffset,
  evaluatePlacement,
  generateHoles,
  indexHoles,
  snapPlacement,
} from '../grid'

/** Union bounding box of an accessory's parts, in the builder's local frame. */
function localBounds(item: (typeof ACCESSORIES)[number]) {
  const box = new Box3()
  for (const part of buildAccessoryParts(item)) {
    const mesh = new Mesh(part.geometry)
    mesh.position.fromArray(part.position)
    if (part.rotation) mesh.rotation.fromArray(part.rotation)
    mesh.updateMatrixWorld()
    box.expandByObject(mesh)
  }
  return box
}

describe('accessory geometry frame', () => {
  // The mesh and the collision rect are two views of one object. They drifted
  // apart by up to 160 mm once (findings.md F11) and nothing caught it, because
  // each was internally consistent. This is the tie between them.
  for (const item of ACCESSORIES.filter(isPlaceable)) {
    it(`${item.key} is drawn centred on x=0 and hanging from y=0`, () => {
      const bounds = localBounds(item)
      const centre = bounds.getCenter(new Vector3())

      // Centred horizontally: the builders must NOT bake in the peg-span offset.
      expect(Math.abs(centre.x), `${item.key} x-centre`).toBeLessThan(1)

      // Body top sits at the peg line and the body hangs below it — how every
      // SKÅDIS accessory actually hooks in (findings.md F13).
      expect(bounds.max.y, `${item.key} top`).toBeLessThanOrEqual(1)
      expect(bounds.min.y, `${item.key} bottom`).toBeLessThan(0)

      // Nothing may be drawn behind the panel: board front face is z = 0.
      expect(bounds.min.z, `${item.key} depth`).toBeGreaterThanOrEqual(-1)
    })
  }

  it('shifts multi-peg bodies onto their peg span, single-peg bodies not at all', () => {
    const hook = ACCESSORIES.find((i) => i.key === 'hook-large')!
    const shelf = ACCESSORIES.find((i) => i.key === 'shelf')!
    if (!isPlaceable(hook) || !isPlaceable(shelf)) throw new Error('expected placeable')

    expect(bodyOriginOffset(hook.pattern)[0]).toBe(0)
    // 240 mm peg span → body centre sits 120 mm right of the anchor peg.
    expect(bodyOriginOffset(shelf.pattern)[0]).toBe(120)
  })
})

describe('snapping slides to the nearest valid hole', () => {
  const board = BOARDS.find((b) => b.key === 'board-56x56-white')!
  const holes = generateHoles(board)
  const byId = indexHoles(holes)
  const shelf = ACCESSORIES.find((i) => i.key === 'shelf')!
  if (!isPlaceable(shelf)) throw new Error('shelf should be placeable')

  it('still places a wide shelf aimed at the far right edge', () => {
    // This is the "invisible wall" the user hit: the nearest hole to the right
    // edge has no room for the second peg, and the old code just refused.
    const result = snapPlacement(board, holes, shelf.pattern, board.widthMm - 10, 300, byId)
    expect(result?.ok).toBe(true)
  })

  it('lands the shelf as far right as it genuinely fits', () => {
    const result = snapPlacement(board, holes, shelf.pattern, board.widthMm - 10, 300, byId)!
    const rightmost = result.holes.reduce((a, h) => Math.max(a, h.x), 0)
    // Last A column is at 540 mm; a 240 mm span puts the anchor at 300 mm.
    expect(rightmost).toBe(540)
    expect(result.anchor.x).toBe(300)
  })

  it('reports the blocking candidate when nothing fits, rather than nothing at all', () => {
    const anchor = byId.get('A:5,5')!
    const blocked = evaluatePlacement(board, anchor, shelf.pattern, byId)
    // Fill the board with one giant occupied rect so no placement can succeed.
    const wall = { x: -1000, y: -1000, w: 4000, h: 4000 }
    const result = snapPlacement(board, holes, shelf.pattern, 280, 280, byId, [wall])
    expect(result).not.toBeNull()
    expect(result!.ok).toBe(false)
    expect(blocked.ok).toBe(true)
  })
})
