/**
 * SKÅDIS hole lattice, snapping, and collision.
 *
 * Geometry measured off IKEA's own product photography — see findings.md F8.
 * The board carries two interleaved 40 mm lattices offset by half a pitch, but
 * the offset is diagonal in opposite senses per axis:
 *
 *     Lattice A (wide rows):   x = 20 + 40i,  y = 40 + 40j
 *     Lattice B (narrow rows): x = 40 + 40i,  y = 20 + 40j
 *
 * So B = A + (20, −20). The top and bottom rows of a board are always B rows
 * sitting 20 mm from the edge; A rows are inset 40 mm vertically but only
 * 20 mm horizontally. The pattern is NOT symmetric under 90° rotation.
 *
 * An earlier revision had B = A + (20, +20), which is self-consistent and
 * matches every board width — but produces 9 slots on the first row of a 36×56
 * board where the real product has 8. Only the photograph could settle it.
 *
 * Coordinates are millimetres in board space: origin at the board's BOTTOM-LEFT
 * corner, +x right, +y up. Convert to a centred mesh with `toBoardLocal`.
 */

export const PITCH_MM = 40
export const MARGIN_MM = 20
export const SLOT_WIDTH_MM = 5
export const SLOT_HEIGHT_MM = 15
export const BOARD_THICKNESS_MM = 4.6

/**
 * Which interleaved lattice a hole belongs to. Pegs sit on 40 mm centres, so a
 * multi-peg accessory can only ever engage holes of a SINGLE lattice — mixing A
 * and B is physically impossible. Snapping must respect this.
 */
export type Lattice = 'A' | 'B'

/** Quarter-turn rotation of an accessory, counter-clockwise, in degrees. */
export type Rotation = 0 | 90 | 180 | 270

export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270]

export type HoleId = string

export interface Hole {
  id: HoleId
  lattice: Lattice
  /** Column index within this lattice (0-based). */
  col: number
  /** Row index within this lattice (0-based). */
  row: number
  /** Slot centre, mm from the board's left edge. */
  x: number
  /** Slot centre, mm from the board's bottom edge. */
  y: number
}

export interface BoardSpec {
  /** Width as hung, i.e. already swapped when `rotated`. */
  widthMm: number
  /** Height as hung. */
  heightMm: number
  /**
   * True when the panel hangs a quarter turn from how IKEA sells it. One
   * boolean covers it: the lattice is 180°-symmetric, so turning it clockwise
   * and anticlockwise produce the same hole field (findings.md F24).
   */
  rotated?: boolean
}

/** Axis-aligned rectangle in board space, anchored at its bottom-left corner. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Where an accessory's pegs sit, expressed in whole lattice steps from its
 * primary anchor hole. `[0, 0]` (the anchor itself) is implicit and need not be
 * listed. A two-peg hook spanning one pitch horizontally is `[[1, 0]]`.
 */
export interface PegPattern {
  /** `'either'` means a single-peg item that fits any hole. */
  lattice: Lattice | 'either'
  offsets: Array<readonly [number, number]>
  /**
   * Vector from the primary anchor hole's centre to the bottom-left corner of
   * the accessory's bounding box. Usually negative in y — things hang below
   * their pegs.
   */
  bodyOffset: readonly [number, number]
  /** Bounding box of the accessory body, mm. */
  bodySize: readonly [number, number]
}

export function holeId(lattice: Lattice, col: number, row: number): HoleId {
  return `${lattice}:${col},${row}`
}

/** Per-axis origin of each lattice, in mm from the board's bottom-left corner. */
const LATTICE_ORIGINS: Record<Lattice, { x: number; y: number }> = {
  A: { x: MARGIN_MM, y: MARGIN_MM + PITCH_MM / 2 },
  B: { x: MARGIN_MM + PITCH_MM / 2, y: MARGIN_MM },
}

/**
 * Origin of a lattice on a board that may be hung sideways.
 *
 * Turning the panel a quarter turn does NOT give you the lattice of a board
 * whose dimensions happen to be swapped — the pattern is not 90°-symmetric.
 * Mapping each lattice through `(x, y) → (H − y, x)` shows the rotated field is
 * exactly the upright generator with the two origins exchanged: A lands on
 * (40, 20) and B on (20, 40). Worked through in findings.md F24, and pinned by
 * a test that rotates every hole of every board and compares the sets.
 *
 * The tags stay A and B because rotation maps each lattice onto itself as a
 * set, which is all peg parity cares about.
 */
function latticeOrigin(lattice: Lattice, rotated = false): { x: number; y: number } {
  if (!rotated) return LATTICE_ORIGINS[lattice]
  return LATTICE_ORIGINS[lattice === 'A' ? 'B' : 'A']
}

/** Every slot on the board, both lattices, ordered A then B. */
export function generateHoles(board: BoardSpec): Hole[] {
  const holes: Hole[] = []
  const lattices: Lattice[] = ['A', 'B']

  for (const lattice of lattices) {
    const origin = latticeOrigin(lattice, board.rotated)
    // A slot must clear its own margin on the far side too, which is why the
    // limit mirrors the origin rather than always being MARGIN_MM.
    const maxX = board.widthMm - origin.x
    const maxY = board.heightMm - origin.y

    let row = 0
    for (let y = origin.y; y <= maxY + 1e-9; y += PITCH_MM) {
      let col = 0
      for (let x = origin.x; x <= maxX + 1e-9; x += PITCH_MM) {
        holes.push({ id: holeId(lattice, col, row), lattice, col, row, x, y })
        col += 1
      }
      row += 1
    }
  }

  return holes
}

export function indexHoles(holes: readonly Hole[]): Map<HoleId, Hole> {
  return new Map(holes.map((hole) => [hole.id, hole]))
}

/**
 * Nearest hole to a point, restricted to the lattice the accessory can use.
 * Returns null only when the board has no hole of the requested lattice.
 */
export function nearestHole(
  holes: readonly Hole[],
  xMm: number,
  yMm: number,
  lattice: Lattice | 'either',
): Hole | null {
  let best: Hole | null = null
  let bestDist = Infinity

  for (const hole of holes) {
    if (lattice !== 'either' && hole.lattice !== lattice) continue
    const dx = hole.x - xMm
    const dy = hole.y - yMm
    const dist = dx * dx + dy * dy
    if (dist < bestDist) {
      bestDist = dist
      best = hole
    }
  }

  return best
}

/** The bounding box an accessory would occupy if anchored at `anchor`. */
export function placementRect(anchor: Hole, pattern: PegPattern): Rect {
  return {
    x: anchor.x + pattern.bodyOffset[0],
    y: anchor.y + pattern.bodyOffset[1],
    w: pattern.bodySize[0],
    h: pattern.bodySize[1],
  }
}

/** The holes an accessory's pegs would engage. Null if any peg lands off-board. */
export function pegHoles(
  anchor: Hole,
  pattern: PegPattern,
  byId: ReadonlyMap<HoleId, Hole>,
): Hole[] | null {
  const result: Hole[] = [anchor]

  for (const [dCol, dRow] of pattern.offsets) {
    const hole = byId.get(holeId(anchor.lattice, anchor.col + dCol, anchor.row + dRow))
    if (!hole) return null
    result.push(hole)
  }

  return result
}

/**
 * Rotate a peg pattern a quarter turn at a time, counter-clockwise about the
 * primary peg. Peg offsets are in lattice steps and the body is a rectangle, so
 * both transform exactly — no resampling, no drift.
 */
export function rotatePattern(pattern: PegPattern, rotation: Rotation): PegPattern {
  if (rotation === 0) return pattern

  // Negating a zero offset yields -0, which is harmless in arithmetic but ugly
  // in ids and test output. Normalise it away.
  const z = (n: number) => (n === 0 ? 0 : n)

  const [ox, oy] = pattern.bodyOffset
  const [w, h] = pattern.bodySize

  switch (rotation) {
    case 90:
      return {
        ...pattern,
        offsets: pattern.offsets.map(([c, r]) => [z(-r), c] as const),
        bodyOffset: [-oy - h, ox],
        bodySize: [h, w],
      }
    case 180:
      return {
        ...pattern,
        offsets: pattern.offsets.map(([c, r]) => [z(-c), z(-r)] as const),
        bodyOffset: [-ox - w, -oy - h],
        bodySize: [w, h],
      }
    case 270:
      return {
        ...pattern,
        offsets: pattern.offsets.map(([c, r]) => [r, z(-c)] as const),
        bodyOffset: [oy, -ox - w],
        bodySize: [h, w],
      }
  }
}

/**
 * Offset from the primary peg to the accessory geometry's local origin.
 *
 * Every builder in `geometry/archetypes.ts` works in one frame: **x centred on
 * the body, y at the body's top** (things hang downward from their pegs), z = 0
 * at the board face. For a multi-peg item the body is centred on the peg span,
 * not on the anchor peg, so the mesh must be translated by this much or it
 * renders up to 160 mm away from its own collision box (findings.md F11).
 *
 * Apply it INSIDE the rotated group so it stays correct at every rotation.
 */
export function bodyOriginOffset(pattern: PegPattern): readonly [number, number] {
  return [
    pattern.bodyOffset[0] + pattern.bodySize[0] / 2,
    pattern.bodyOffset[1] + pattern.bodySize[1],
  ]
}

/** Offset from the primary peg to the centre of the accessory's body. */
export function bodyCentreOffset(pattern: PegPattern): readonly [number, number] {
  return [
    pattern.bodyOffset[0] + pattern.bodySize[0] / 2,
    pattern.bodyOffset[1] + pattern.bodySize[1] / 2,
  ]
}

/**
 * Where the anchor peg must sit for the body's centre to land on (x, y).
 *
 * Snapping on the primary peg instead makes wide accessories nearly
 * unplaceable: a 280 mm rack anchored on its left peg has only three valid
 * columns on a 360 mm board, all at the far left (findings.md F9).
 */
export function anchorPointForCentre(
  pattern: PegPattern,
  centreX: number,
  centreY: number,
): readonly [number, number] {
  const [cx, cy] = bodyCentreOffset(pattern)
  return [centreX - cx, centreY - cy]
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function rectWithinBoard(rect: Rect, board: BoardSpec): boolean {
  return (
    rect.x >= -1e-9 &&
    rect.y >= -1e-9 &&
    rect.x + rect.w <= board.widthMm + 1e-9 &&
    rect.y + rect.h <= board.heightMm + 1e-9
  )
}

export type PlacementRejection = 'peg-off-board' | 'overlap'

export interface PlacementResult {
  ok: boolean
  anchor: Hole
  rect: Rect
  holes: Hole[]
  reason?: PlacementRejection
  /** True when the body extends past a board edge. Allowed, worth showing. */
  overhangs: boolean
}

/**
 * Full placement check.
 *
 * What actually holds an accessory up is its pegs sitting in real slots, so
 * that is the only hard requirement. The body may overhang a board edge — a
 * shelf wider than its board is fine, and a hook mounted at the boundary to
 * reach the adjacent wall is a legitimate use (findings.md F10).
 *
 * Collision is tested on bounding boxes rather than hole usage: two
 * accessories can engage entirely different slots and still occupy the
 * same space.
 */
export function evaluatePlacement(
  board: BoardSpec,
  anchor: Hole,
  pattern: PegPattern,
  byId: ReadonlyMap<HoleId, Hole>,
  occupied: readonly Rect[] = [],
): PlacementResult {
  const rect = placementRect(anchor, pattern)
  const holes = pegHoles(anchor, pattern, byId)

  if (holes === null) {
    return { ok: false, anchor, rect, holes: [anchor], reason: 'peg-off-board', overhangs: false }
  }

  const overhangs = !rectWithinBoard(rect, board)

  if (occupied.some((other) => rectsOverlap(rect, other))) {
    return { ok: false, anchor, rect, holes, reason: 'overlap', overhangs }
  }

  return { ok: true, anchor, rect, holes, overhangs }
}

/**
 * Nearest hole that yields a VALID placement, rather than the nearest hole
 * outright.
 *
 * Anchoring is on the leftmost peg, so near an edge the geometrically nearest
 * hole often has no room for the remaining pegs. Rejecting there reads to the
 * user as an invisible wall partway across the board (findings.md F12); sliding
 * to the nearest position that does fit is what they expect. Returns null only
 * when nothing on the board works.
 */
export function snapPlacement(
  board: BoardSpec,
  holes: readonly Hole[],
  pattern: PegPattern,
  centreX: number,
  centreY: number,
  byId: ReadonlyMap<HoleId, Hole>,
  occupied: readonly Rect[] = [],
): PlacementResult | null {
  const [targetX, targetY] = anchorPointForCentre(pattern, centreX, centreY)

  let best: PlacementResult | null = null
  let bestDist = Infinity
  let fallback: PlacementResult | null = null
  let fallbackDist = Infinity

  for (const hole of holes) {
    if (pattern.lattice !== 'either' && hole.lattice !== pattern.lattice) continue

    const dist = (hole.x - targetX) ** 2 + (hole.y - targetY) ** 2
    if (dist >= bestDist && dist >= fallbackDist) continue

    const result = evaluatePlacement(board, hole, pattern, byId, occupied)
    if (result.ok) {
      if (dist < bestDist) {
        bestDist = dist
        best = result
      }
    } else if (dist < fallbackDist) {
      fallbackDist = dist
      fallback = result
    }
  }

  // Show the invalid candidate rather than nothing, so the ghost still tracks
  // the cursor and the user can see why the drop will not take.
  return best ?? fallback
}

/**
 * Board-space (bottom-left origin) → mesh-local (centre origin), for three.js.
 */
export function toBoardLocal(
  board: BoardSpec,
  xMm: number,
  yMm: number,
): readonly [number, number] {
  return [xMm - board.widthMm / 2, yMm - board.heightMm / 2]
}
