/**
 * User-defined pegboards — the boards on someone's wall that IKEA did not make.
 *
 * The move is the same one `customParts.ts` makes for accessories: a
 * `CustomBoard` is converted into a synthetic `BoardItem` and merged into the
 * key -> item map, so `buildWall`, snapping, the mesh builder, the print sheet
 * and the layout need no special case at all — a custom board is just another
 * board to them. What carries the geometry is `BoardItem.grid`, a `HoleGrid`
 * from `lib/grid.ts`; everything downstream reads it off the spec rather than
 * looking anything up.
 *
 * Custom boards stay OUT of `CATALOG` and `BOARDS`, for the same reason custom
 * parts do: `catalog.test.ts` cross-checks those arrays against
 * `data-raw/skadis-raw.json`, and a user-invented board has nothing to check
 * against. They are never costed either — no article number, no line in the
 * shopping list, a footnote in the cost table.
 *
 * Sizes are in whole PITCH CELLS rather than millimetres. That is what keeps
 * the edge margin at exactly half a pitch on all four edges without any
 * centring arithmetic, which is the one modelling choice this file makes.
 * See findings.md F39.
 */

import {
  MAX_PITCH_MM,
  MIN_PITCH_MM,
  holeCount,
  type HoleGrid,
  type HoleShape,
} from '../lib/grid'
import { BY_KEY, type BoardItem, type CatalogItem } from './catalog'
import { catalogWithCustom, type CustomPart } from './customParts'

/**
 * The colon is load-bearing, exactly as in `customParts.ts`: `shareLink.ts`
 * validates plain keys against `/^[a-z0-9-]+$/`, so a custom board key can
 * never be mistaken for a catalog key. Distinct from `custom:` — neither
 * prefix is a prefix of the other, so `isCustomKey` and `isCustomBoardKey`
 * cannot both answer yes.
 */
export const CUSTOM_BOARD_PREFIX = 'custom-board:'

export const MAX_CUSTOM_BOARDS = 6

/**
 * Hole budget for one board, about 2.5x the largest SKÅDIS panel (499 slots).
 * Every hole is a separate path punched into one extruded shape, so this is a
 * triangulation cost paid on every board resize, not a per-frame one — but a
 * full 4x8 ft imperial sheet is ~4600 holes, and that is worth refusing.
 */
export const MAX_HOLES = 1200

/** Re-exported from lib/grid: parts and boards share one set of pitch bounds. */
export { MAX_PITCH_MM, MIN_PITCH_MM } from '../lib/grid'

export const MIN_CELLS = 2
export const MAX_CELLS = 60
export const MIN_HOLE_MM = 1
export const MIN_THICKNESS_MM = 0.5
export const MAX_THICKNESS_MM = 30
export const MAX_NAME_LENGTH = 24

/** The pitch SKÅDIS accessories are built for. Anything else is a warning. */
export const SKADIS_PITCH_MM = 40

export interface CustomBoard {
  /** `custom-board:<id>` — see CUSTOM_BOARD_PREFIX. */
  key: string
  name: string
  /** Width in pitch cells, MIN_CELLS..MAX_CELLS. */
  cols: number
  /** Height in pitch cells. */
  rows: number
  grid: HoleGrid
}

/** A `CustomBoard` without its key or name — everything a share link carries. */
export type BoardGeometry = Pick<CustomBoard, 'cols' | 'rows' | 'grid'>

export function isCustomBoardKey(key: string): boolean {
  return key.startsWith(CUSTOM_BOARD_PREFIX)
}

let boardSeq = 0
export function newCustomBoardKey(): string {
  boardSeq += 1
  return `${CUSTOM_BOARD_PREFIX}${Date.now().toString(36)}${boardSeq.toString(36)}`
}

const SHAPES: readonly HoleShape[] = ['slot-v', 'slot-h', 'round', 'square']

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  // Two decimals, because an inch converts to 25.4 and a quarter inch to 6.35.
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100))
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function customBoardWidthMm(board: CustomBoard): number {
  return board.cols * board.grid.pitchMm
}

export function customBoardHeightMm(board: CustomBoard): number {
  return board.rows * board.grid.pitchMm
}

/** How many holes this definition would produce. */
export function customBoardHoles(board: CustomBoard): number {
  return holeCount({
    widthMm: customBoardWidthMm(board),
    heightMm: customBoardHeightMm(board),
    grid: board.grid,
  })
}

/**
 * Bring a definition inside every limit.
 *
 * Run in the store, not only in the form: `migrate` is skipped entirely when
 * the persisted version already matches, so a hand-edited localStorage blob or
 * a crafted share link would otherwise reach the extruder unchecked — and the
 * thing it reaches is a triangulator, not a text field.
 */
export function clampCustomBoard(board: CustomBoard): CustomBoard {
  const name = board.name.trim().slice(0, MAX_NAME_LENGTH)
  const pitchMm = clampNumber(board.grid?.pitchMm, MIN_PITCH_MM, MAX_PITCH_MM, SKADIS_PITCH_MM)

  // A hole wider than its own pitch swallows its neighbour and the outline
  // self-intersects, so the ceiling is the pitch rather than a constant.
  const maxHole = Math.max(MIN_HOLE_MM, Math.round(pitchMm * 90) / 100)
  const holeWidthMm = clampNumber(board.grid?.holeWidthMm, MIN_HOLE_MM, maxHole, MIN_HOLE_MM)
  const holeHeightMm = clampNumber(board.grid?.holeHeightMm, MIN_HOLE_MM, maxHole, holeWidthMm)

  const grid: HoleGrid = {
    pitchMm,
    arrangement: board.grid?.arrangement === 'aligned' ? 'aligned' : 'staggered',
    shape: SHAPES.includes(board.grid?.shape) ? board.grid.shape : 'slot-v',
    holeWidthMm,
    holeHeightMm,
    thicknessMm: clampNumber(
      board.grid?.thicknessMm,
      MIN_THICKNESS_MM,
      MAX_THICKNESS_MM,
      MIN_THICKNESS_MM,
    ),
  }

  let cols = clampInt(board.cols, MIN_CELLS, MAX_CELLS, MIN_CELLS)
  let rows = clampInt(board.rows, MIN_CELLS, MAX_CELLS, MIN_CELLS)

  // Shrink the longer side first, so a board pushed past the budget comes back
  // squarer rather than collapsing along one axis. Bounded by MAX_CELLS.
  while (cols > MIN_CELLS || rows > MIN_CELLS) {
    const widthMm = cols * grid.pitchMm
    const heightMm = rows * grid.pitchMm
    if (holeCount({ widthMm, heightMm, grid }) <= MAX_HOLES) break
    if (rows >= cols && rows > MIN_CELLS) rows -= 1
    else if (cols > MIN_CELLS) cols -= 1
    else break
  }

  return {
    key: board.key,
    name: name === '' ? 'Custom board' : name,
    cols,
    rows,
    grid,
  }
}

/**
 * The synthetic catalog entry.
 *
 * `itemNos: {}` is what keeps it out of the cost table honestly: `resolvePrice`
 * returns `source: 'unknown'` for an item with no article number in the market,
 * and an unknown price is rendered "—" rather than counted as zero. The count
 * guard in `counts.ts` stops it reaching that point at all, but the second line
 * of defence costs nothing.
 */
export function customBoardToItem(board: CustomBoard): BoardItem {
  return {
    kind: 'board',
    key: board.key,
    itemNos: {},
    packQty: 1,
    names: { en: board.name, ja: board.name, 'zh-Hant': board.name },
    widthMm: customBoardWidthMm(board),
    heightMm: customBoardHeightMm(board),
    colorway: 'white',
    // The user stated this geometry, so there is nothing unverified about it
    // from our side — it is theirs, not a measurement we owe a source for.
    latticeVerified: true,
    rotatable: true,
    grid: board.grid,
  }
}

/** Catalog plus this user's own parts AND boards. */
export function catalogWith(
  parts: readonly CustomPart[],
  boards: readonly CustomBoard[],
): ReadonlyMap<string, CatalogItem> {
  if (boards.length === 0) return catalogWithCustom(parts)
  const merged = new Map<string, CatalogItem>(catalogWithCustom(parts))
  for (const board of boards) merged.set(board.key, customBoardToItem(board))
  return merged
}

/** True when two definitions describe the same physical board. */
export function sameGeometry(a: BoardGeometry, b: BoardGeometry): boolean {
  return (
    a.cols === b.cols &&
    a.rows === b.rows &&
    a.grid.pitchMm === b.grid.pitchMm &&
    a.grid.arrangement === b.grid.arrangement &&
    a.grid.shape === b.grid.shape &&
    a.grid.holeWidthMm === b.grid.holeWidthMm &&
    a.grid.holeHeightMm === b.grid.holeHeightMm &&
    a.grid.thicknessMm === b.grid.thicknessMm
  )
}

export interface BoardPreset extends BoardGeometry {
  id: string
  /** i18n key for the button label. */
  labelKey: string
  /** Whether the dialog should open this preset in inches. */
  imperial: boolean
}

/**
 * Starting points, not catalog entries — a preset only ever fills the form,
 * which is why an estimated dimension here never ships as something buyable.
 *
 * Sources and confidence in findings.md F39. The two imperial entries carry
 * numbers their own manufacturers do not publish; they are marked below and
 * the user can correct them, which is the whole point of the dialog.
 */
export const BOARD_PRESETS: readonly BoardPreset[] = [
  {
    id: 'skadis-clone',
    labelKey: 'board.presetSkadis',
    imperial: false,
    cols: 14,
    rows: 14,
    // Verified geometry (findings F8), 5 mm thickness per the skraeddar
    // generator's default rather than IKEA's own 4.6 mm — a printed clone is
    // whatever its maker chose, and 5 mm is what the common generator ships.
    grid: {
      pitchMm: 40,
      arrangement: 'staggered',
      shape: 'slot-v',
      holeWidthMm: 5,
      holeHeightMm: 15,
      thicknessMm: 5,
    },
  },
  {
    id: 'us-hardboard',
    labelKey: 'board.presetHardboard',
    imperial: true,
    cols: 24,
    rows: 24,
    grid: {
      pitchMm: 25.4,
      arrangement: 'aligned',
      shape: 'round',
      // 1/4 inch. Every source flags hole size as genuinely unstandardised
      // across manufacturers — 3/16 inch is just as common. UNVERIFIED.
      holeWidthMm: 6.35,
      holeHeightMm: 6.35,
      thicknessMm: 6.35,
    },
  },
  {
    id: 'wall-control',
    labelKey: 'board.presetWallControl',
    imperial: true,
    cols: 32,
    rows: 16,
    grid: {
      pitchMm: 25.4,
      arrangement: 'aligned',
      shape: 'slot-v',
      // 1 inch spacing and 1/4 inch slot width are from Wall Control's own
      // how-to. The slot LENGTH and the panel THICKNESS are published nowhere
      // reachable — both UNVERIFIED, see findings F39.
      holeWidthMm: 6.35,
      holeHeightMm: 19.05,
      thicknessMm: 0.9,
    },
  },
]

/** The catalog board a wall falls back to when a definition is deleted. */
export const FALLBACK_BOARD_KEY = 'board-56x56-white'

export function isKnownBoardKey(key: string): boolean {
  return BY_KEY.get(key)?.kind === 'board'
}
