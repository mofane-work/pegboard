/**
 * Orthographic projection for the printed sheet.
 *
 * Print uses an orthographic camera, never the perspective one the interactive
 * view uses: on paper someone may be counting slot positions, and perspective
 * makes near slots larger than far ones. IKEA's own assembly manuals use
 * exploded axonometric projection for the same reason (findings.md F17).
 *
 * Output is in SVG coordinates — y grows downward.
 */

export interface ViewAngle {
  /** Rotation about the vertical axis, degrees. */
  azimuth: number
  /** Tilt about the horizontal axis, degrees. */
  elevation: number
}

/**
 * True isometric: 45° azimuth with 35.264° elevation. That second value is
 * `arctan(1/√2)`, the angle at which all three axes foreshorten equally and sit
 * 120° apart on the page. Anything else is merely "tilted".
 */
export const ISOMETRIC: ViewAngle = {
  azimuth: 45,
  elevation: (Math.atan(1 / Math.SQRT2) * 180) / Math.PI,
}

/** Straight-on elevation — usually the most legible view of a flat board. */
export const FRONT: ViewAngle = { azimuth: 0, elevation: 0 }

const toRad = (deg: number) => (deg * Math.PI) / 180

/**
 * Project a millimetre point in board space (x right, y up, z toward viewer)
 * onto the page. Yaw about the vertical axis, then pitch about the horizontal.
 */
export function project(
  x: number,
  y: number,
  z: number,
  angle: ViewAngle,
): readonly [number, number] {
  const a = toRad(angle.azimuth)
  const e = toRad(angle.elevation)

  const screenX = x * Math.cos(a) + z * Math.sin(a)
  const depth = -x * Math.sin(a) + z * Math.cos(a)
  const screenY = y * Math.cos(e) - depth * Math.sin(e)

  // SVG y grows downward, so flip.
  return [screenX, -screenY]
}

export interface Extent {
  minX: number
  minY: number
  width: number
  height: number
}

/** Projected bounding box of a board, for sizing the SVG viewBox. */
export function projectedExtent(
  widthMm: number,
  heightMm: number,
  depthMm: number,
  angle: ViewAngle,
): Extent {
  const corners: Array<readonly [number, number]> = []
  for (const x of [-widthMm / 2, widthMm / 2]) {
    for (const y of [-heightMm / 2, heightMm / 2]) {
      for (const z of [-depthMm, 0]) {
        corners.push(project(x, y, z, angle))
      }
    }
  }

  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)

  return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }
}
