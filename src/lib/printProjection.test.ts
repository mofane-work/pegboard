import { describe, expect, it } from 'vitest'
import { FRONT, ISOMETRIC, project, projectedExtent } from './printProjection'

function angleBetween(a: readonly [number, number], b: readonly [number, number]): number {
  const dot = a[0] * b[0] + a[1] * b[1]
  const mag = Math.hypot(...a) * Math.hypot(...b)
  return (Math.acos(dot / mag) * 180) / Math.PI
}

describe('isometric angle', () => {
  it("uses arctan(1/√2) for elevation, not a rounded guess", () => {
    // 35.264° is the value at which the three axes foreshorten equally.
    expect(ISOMETRIC.elevation).toBeCloseTo(35.264, 3)
    expect(ISOMETRIC.azimuth).toBe(45)
  })

  it('foreshortens all three axes equally, which is what makes it isometric', () => {
    const x = project(1, 0, 0, ISOMETRIC)
    const y = project(0, 1, 0, ISOMETRIC)
    const z = project(0, 0, 1, ISOMETRIC)

    const length = (v: readonly [number, number]) => Math.hypot(...v)
    expect(length(x)).toBeCloseTo(length(y), 6)
    expect(length(y)).toBeCloseTo(length(z), 6)
  })

  it('places 120° between the drawn axis triple', () => {
    // With this handedness the mutually-120° triple is +Y (up the page),
    // +Z (toward the viewer, lower right) and −X (lower left). Asserting it
    // for +X instead would be asserting the wrong frame, not a stricter one.
    const up = project(0, 1, 0, ISOMETRIC)
    const toward = project(0, 0, 1, ISOMETRIC)
    const left = project(-1, 0, 0, ISOMETRIC)

    expect(angleBetween(up, toward)).toBeCloseTo(120, 4)
    expect(angleBetween(toward, left)).toBeCloseTo(120, 4)
    expect(angleBetween(left, up)).toBeCloseTo(120, 4)
  })
})

describe('front view', () => {
  it('is a plain elevation with the y axis flipped for SVG', () => {
    expect(project(10, 20, 0, FRONT)).toEqual([10, -20])
  })

  it('hides depth entirely, so a flat board reads at true proportions', () => {
    const front = project(10, 20, 0, FRONT)
    const behind = project(10, 20, -5, FRONT)
    expect(behind).toEqual(front)
  })

  it('keeps a board its exact size on the page', () => {
    const extent = projectedExtent(560, 560, 5, FRONT)
    expect(extent.width).toBeCloseTo(560)
    expect(extent.height).toBeCloseTo(560)
  })
})

describe('extent', () => {
  it('narrows a wide panel but makes it taller when tilted', () => {
    // Rotating 45° about the vertical axis projects width by cos 45°, so the
    // board gets NARROWER — while that same width tilts into the vertical and
    // makes it TALLER. Both matter for sizing the printed viewBox.
    const flat = projectedExtent(760, 560, 5, FRONT)
    const tilted = projectedExtent(760, 560, 5, ISOMETRIC)

    expect(tilted.width).toBeLessThan(flat.width)
    expect(tilted.width).toBeCloseTo(760 * Math.cos(Math.PI / 4) + 5 * Math.sin(Math.PI / 4), 3)
    expect(tilted.height).toBeGreaterThan(flat.height)
  })

  it('shows the board thickness, which the front view cannot', () => {
    const thin = projectedExtent(560, 560, 1, ISOMETRIC)
    const thick = projectedExtent(560, 560, 40, ISOMETRIC)
    expect(thick.width).toBeGreaterThan(thin.width)
  })

  it('is not degenerate for any board size', () => {
    for (const [w, h] of [[360, 560], [560, 560], [760, 560], [560, 370]] as const) {
      const extent = projectedExtent(w, h, 5, ISOMETRIC)
      expect(extent.width).toBeGreaterThan(0)
      expect(extent.height).toBeGreaterThan(0)
    }
  })
})
