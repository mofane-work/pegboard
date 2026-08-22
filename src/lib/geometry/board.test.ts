import { describe, expect, it } from 'vitest'
import { slotPath } from './board'
import { SLOT_HEIGHT_MM, SLOT_WIDTH_MM } from '../grid'

/**
 * The obround is built from a mapping and two arcs whose angles turn with it,
 * and nothing else exercises that arithmetic — a slot drawn inside out or a
 * quarter turn off would still triangulate and would still look like a hole.
 */
function extent(rotated: boolean) {
  const points = slotPath(100, 50, rotated).getPoints(32)
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    centreX: (Math.max(...xs) + Math.min(...xs)) / 2,
    centreY: (Math.max(...ys) + Math.min(...ys)) / 2,
  }
}

describe('slot geometry', () => {
  it('stands upright on an upright panel', () => {
    const { width, height } = extent(false)
    expect(width).toBeCloseTo(SLOT_WIDTH_MM)
    expect(height).toBeCloseTo(SLOT_HEIGHT_MM)
  })

  it('lies down on a turned panel', () => {
    const { width, height } = extent(true)
    expect(width).toBeCloseTo(SLOT_HEIGHT_MM)
    expect(height).toBeCloseTo(SLOT_WIDTH_MM)
  })

  it('stays centred on the hole either way', () => {
    for (const rotated of [false, true]) {
      const { centreX, centreY } = extent(rotated)
      expect(centreX, `rotated=${rotated}`).toBeCloseTo(100)
      expect(centreY, `rotated=${rotated}`).toBeCloseTo(50)
    }
  })

  it('closes the outline rather than leaving a gap the extruder would fill', () => {
    for (const rotated of [false, true]) {
      const points = slotPath(0, 0, rotated).getPoints(32)
      const first = points[0]
      const last = points[points.length - 1]
      expect(first.distanceTo(last), `rotated=${rotated}`).toBeCloseTo(0)
    }
  })
})
