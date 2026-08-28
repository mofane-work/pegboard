/**
 * Configuration sharing through the URL alone.
 *
 * No backend, no stored entries, no short-link service: the whole configuration
 * travels in the fragment, so a link works from a static host forever and
 * nothing needs to be kept alive to honour it.
 *
 * The format is deliberately readable rather than base64: a malformed link is
 * something a person can look at and understand, and the decoder can reject it
 * precisely. Versioned, so an old link can be recognised rather than
 * misinterpreted.
 *
 *   v1~board-56x56-white~us~USD~A*5*5*hook-large*0!B*3*2*shelf*90~shelf~hook-large*3.5~connector-wall*2
 *      board             market currency  placements                        excluded  overrides       extras
 *
 * A board hung sideways carries a `*r` suffix — `board-36x56-white*r`. v2 links
 * predate orientation and decode as upright, so old links keep working.
 *
 * A user-defined board has no key the recipient could resolve, so v4 carries
 * its GEOMETRY inline instead, as a fixed-arity entry led by a `c` sentinel:
 *
 *   c*<cols>*<rows>*<pitch>*<shape>*<holeW>*<holeH>*<thick>[*r]
 *
 * Dropping it instead would take a whole panel and everything hanging on it,
 * which is a much worse failure than the one custom PARTS accept. The board's
 * NAME does not travel — free text the user typed stays local, as it does for
 * `PlacedBoard.name` and for custom parts.
 */

import type { Rotation } from './grid'
import type { BoardGeometry } from '../data/customBoards'
import type { HoleShape } from './grid'

const VERSION = 'v4'
/**
 * v2 has no board carrying the `*r` suffix; v3 has no board carrying inline
 * geometry. Both remain readable, and a link already in someone's notes keeps
 * opening the wall it was made from.
 */
const ACCEPTED_VERSIONS = new Set(['v2', 'v3', VERSION])
/** Marks a board entry that carries its own geometry rather than a key. */
const CUSTOM = 'c'
/** Hole shapes, abbreviated. The link is read by people when it goes wrong. */
const SHAPE_CODES: Record<HoleShape, string> = {
  'slot-v': 'v',
  'slot-h': 'h',
  round: 'o',
  square: 'q',
}
const SHAPE_BY_CODE: Record<string, HoleShape> = Object.fromEntries(
  Object.entries(SHAPE_CODES).map(([shape, code]) => [code, shape as HoleShape]),
) as Record<string, HoleShape>
/** Millimetres, up to two decimals — a quarter inch is 6.35. */
const NUMBER = /^\d{1,4}(\.\d{1,2})?$/
/** Marks a board hung a quarter turn round. */
const ROTATED = 'r'
const SECTION = '~'
const ENTRY = '!'
const FIELD = '*'

export interface SharedPlacement {
  itemKey: string
  holeId: string
  rotation: Rotation
  boardIndex: number
}

export interface SharedBoard {
  boardKey: string
  offsetX: number
  offsetY: number
  rotated: boolean
  /**
   * Present for a user-defined board: everything needed to rebuild it, with no
   * name and no key. The recipient's store materialises a definition from it.
   */
  custom?: BoardGeometry
}

export interface SharedConfig {
  boards: SharedBoard[]
  market: string
  currency: string
  placements: SharedPlacement[]
  excluded: string[]
  overrides: Record<string, number>
  extras: Record<string, number>
}

/** Catalog keys and market ids are lowercase kebab; nothing else is accepted. */
const KEY = /^[a-z0-9-]+$/
const CURRENCY = /^[A-Za-z]{3,5}$/
const HOLE = /^([AB]):(\d+),(\d+)$/

export function encodeConfig(config: SharedConfig): string {
  const placements = config.placements
    .map((p) => {
      const match = HOLE.exec(p.holeId)
      if (!match) return ''
      return [
        match[1],
        match[2],
        match[3],
        p.itemKey,
        String(p.rotation),
        String(p.boardIndex),
      ].join(FIELD)
    })
    .filter(Boolean)
    .join(ENTRY)

  // Offsets are derived from the layout, so only the board keys travel — plus
  // an orientation flag, which is not derivable from anything else, and the
  // whole geometry for a board the recipient has no way to look up.
  const boards = config.boards
    .map((b) => {
      const fields = b.custom
        ? [
            CUSTOM,
            String(b.custom.cols),
            String(b.custom.rows),
            String(b.custom.grid.pitchMm),
            SHAPE_CODES[b.custom.grid.shape],
            String(b.custom.grid.holeWidthMm),
            String(b.custom.grid.holeHeightMm),
            String(b.custom.grid.thicknessMm),
            b.custom.grid.arrangement === 'aligned' ? 'a' : 's',
          ]
        : [b.boardKey]
      if (b.rotated) fields.push(ROTATED)
      return fields.join(FIELD)
    })
    .join(ENTRY)

  const pairs = (record: Record<string, number>) =>
    Object.entries(record)
      .map(([key, value]) => `${key}${FIELD}${value}`)
      .join(ENTRY)

  return [
    VERSION,
    boards,
    config.market,
    config.currency,
    placements,
    config.excluded.join(ENTRY),
    pairs(config.overrides),
    pairs(config.extras),
  ].join(SECTION)
}

/**
 * Returns null for anything that is not a well-formed v1 link. A shared link is
 * untrusted input — it arrives from outside the app, so every field is checked
 * rather than cast.
 */
export function decodeConfig(encoded: string): SharedConfig | null {
  if (!encoded) return null

  const sections = encoded.split(SECTION)
  if (sections.length !== 8) return null

  const [version, boardsRaw, market, currency, placementsRaw, excludedRaw, overridesRaw, extrasRaw] =
    sections

  if (!ACCEPTED_VERSIONS.has(version)) return null
  if (!KEY.test(market) || !CURRENCY.test(currency)) return null

  const boardEntries = splitEntries(boardsRaw)
  if (boardEntries.length === 0) return null
  const boards: SharedBoard[] = []
  for (const entry of boardEntries) {
    const fields = entry.split(FIELD)

    if (fields[0] === CUSTOM) {
      const board = decodeCustomBoard(fields)
      if (board === null) return null
      boards.push(board)
      continue
    }

    if (fields.length > 2) return null
    const [boardKey, flag] = fields
    if (!KEY.test(boardKey)) return null
    if (flag !== undefined && flag !== ROTATED) return null
    boards.push({ boardKey, offsetX: 0, offsetY: 0, rotated: flag === ROTATED })
  }

  const placements: SharedPlacement[] = []
  for (const entry of splitEntries(placementsRaw)) {
    const fields = entry.split(FIELD)
    if (fields.length !== 6) return null

    const [lattice, col, row, itemKey, rotation, boardIndex] = fields
    if (lattice !== 'A' && lattice !== 'B') return null
    if (!/^\d+$/.test(col) || !/^\d+$/.test(row)) return null
    if (!KEY.test(itemKey)) return null
    if (!['0', '90', '180', '270'].includes(rotation)) return null
    if (!/^\d+$/.test(boardIndex)) return null
    // A placement pointing at a board the link does not carry is malformed.
    if (Number(boardIndex) >= boards.length) return null

    placements.push({
      itemKey,
      holeId: `${lattice}:${col},${row}`,
      rotation: Number(rotation) as Rotation,
      boardIndex: Number(boardIndex),
    })
  }

  const excluded: string[] = []
  for (const key of splitEntries(excludedRaw)) {
    if (!KEY.test(key)) return null
    excluded.push(key)
  }

  const overrides = decodePairs(overridesRaw)
  const extras = decodePairs(extrasRaw, true, true)
  if (overrides === null || extras === null) return null

  return { boards, market, currency, placements, excluded, overrides, extras }
}

/**
 * A board entry carrying its own geometry. Every field is checked rather than
 * cast: this arrives from outside the app, and what it feeds is a triangulator.
 * The store clamps the result again on the way in.
 */
function decodeCustomBoard(fields: string[]): SharedBoard | null {
  if (fields.length !== 9 && fields.length !== 10) return null

  const [, cols, rows, pitch, shape, holeW, holeH, thick, arrangement, flag] = fields
  if (!/^\d{1,3}$/.test(cols) || !/^\d{1,3}$/.test(rows)) return null
  for (const value of [pitch, holeW, holeH, thick]) {
    if (!NUMBER.test(value)) return null
  }
  if (!(shape in SHAPE_BY_CODE)) return null
  if (arrangement !== 'a' && arrangement !== 's') return null
  if (flag !== undefined && flag !== ROTATED) return null

  return {
    // A key nothing can resolve, deliberately: the store replaces it with the
    // key of the definition it materialises, and `boardSpec` falls back rather
    // than throwing if that somehow does not happen.
    boardKey: '',
    offsetX: 0,
    offsetY: 0,
    rotated: flag === ROTATED,
    custom: {
      cols: Number(cols),
      rows: Number(rows),
      grid: {
        pitchMm: Number(pitch),
        arrangement: arrangement === 'a' ? 'aligned' : 'staggered',
        shape: SHAPE_BY_CODE[shape],
        holeWidthMm: Number(holeW),
        holeHeightMm: Number(holeH),
        thicknessMm: Number(thick),
      },
    },
  }
}

function splitEntries(raw: string): string[] {
  return raw === '' ? [] : raw.split(ENTRY)
}

/**
 * @param integer      reject a fractional value (counts, not prices)
 * @param allowNegative accept a negative value — true only for `extras`, where
 *   a negative is the user saying they already own some. A negative *price* is
 *   still nonsense and stays refused.
 */
function decodePairs(
  raw: string,
  integer = false,
  allowNegative = false,
): Record<string, number> | null {
  const out: Record<string, number> = {}

  for (const entry of splitEntries(raw)) {
    const fields = entry.split(FIELD)
    if (fields.length !== 2) return null

    const [key, value] = fields
    if (!KEY.test(key)) return null

    const number = Number(value)
    if (!Number.isFinite(number)) return null
    if (!allowNegative && number < 0) return null
    if (integer && !Number.isInteger(number)) return null

    out[key] = number
  }

  return out
}

/** The fragment key a shared configuration travels under. */
export const SHARE_PARAM = 'c'

export function buildShareUrl(config: SharedConfig, base: string): string {
  const url = new URL(base)
  url.hash = `${SHARE_PARAM}=${encodeURIComponent(encodeConfig(config))}`
  return url.toString()
}

export function readSharedConfig(hash: string): SharedConfig | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const params = new URLSearchParams(raw)
  const value = params.get(SHARE_PARAM)
  return value === null ? null : decodeConfig(value)
}
