/**
 * Curated SKÅDIS catalog — the source of truth for what can be configured.
 *
 * Keyed by internal slug, NEVER by item number: IKEA uses different item
 * numbers per market (US 10321618 = JP 90321619 for the same board).
 * See findings.md F1.
 *
 * Dimensions come from IKEA's gb/en product pages (metric), extracted from the
 * `"measurements"` blob — not `"measurementGroups"`, which is package size.
 * Regenerate the underlying data with `python3 data-raw/fetch_skadis_data.py`.
 */

import type { HoleGrid, PegPattern, PegSpec } from '../lib/grid'

export type MarketId = 'us' | 'gb' | 'de' | 'fr' | 'jp'
export type LanguageId = 'en' | 'ja' | 'zh-Hant'

export type Archetype =
  | 'hook'
  | 'hookSmall'
  | 'hookRound'
  | 'hookRack'
  | 'shelf'
  | 'displayShelf'
  | 'container'
  | 'containerLid'
  | 'clip'
  | 'basket'
  | 'cord'
  | 'connector'
  | 'bundle'
  /** Not a SKÅDIS product — a user-defined placeholder body. See customParts.ts. */
  | 'customBox'

export type LocalizedNames = Record<LanguageId, string>

interface BaseItem {
  key: string
  /**
   * Item number per market. Absent means "not sold in that market" — or, for a
   * kit member, that IKEA gives it no article number of its own at all.
   */
  itemNos: Partial<Record<MarketId, string>>
  /** Units per pack. Cost is ceil(qty / packQty) * packPrice — see findings F6a. */
  packQty: number
  /**
   * Set when this thing is only ever sold inside another catalog item's pack —
   * the three SKÅDIS baskets that come in the set of 3. It has no article
   * number and is never costed on its own line; `foldKits` in `lib/pricing.ts`
   * charges the pack instead, and one pack covers one of EVERY member, so the
   * packs needed are the worst member's count and not the sum (findings F36).
   */
  kitKey?: string
  names: LocalizedNames
}

export interface BoardItem extends BaseItem {
  kind: 'board'
  widthMm: number
  heightMm: number
  /**
   * Only white is modelled. The double-sided boards were dropped: we render one
   * face and have no way to show or choose the other, so listing them promised
   * a feature that does not exist. Their lattice is identical to the white
   * board of the same size, and their price can be entered as an override.
   */
  colorway: 'white'
  /**
   * False where the 20 mm-margin lattice model is not confirmed for this board.
   * Only the free-standing board is uncertain: its stated height includes the
   * stand, so the slot field is not necessarily centred.
   */
  latticeVerified: boolean
  /**
   * Whether the panel can be hung a quarter turn round. **False for every board
   * IKEA sells**, for two independent reasons:
   *
   * - The three wall boards: SKÅDIS slots are 5 x 15 mm UPRIGHT ovals, and an
   *   accessory hooks by dropping a tab into one and letting gravity retain it
   *   behind the panel. Turn the board and every slot lies down, so the tab has
   *   nothing to drop into — the panel hangs fine and holds nothing. Reported
   *   by a user and confirmed against the slot geometry (findings F42).
   * - The free-standing board: it sits on a stand at its bottom edge, so there
   *   is no sideways to hang it in the first place.
   *
   * True only for a user-defined board (`data/customBoards.ts`), whose geometry
   * is the user's own statement — a round or square hole field turns perfectly
   * well, and on a staggered one the turn exchanges the lattice tagging rather
   * than merely swapping the dimensions (F24). A user-defined board with
   * upright slots inherits the SKÅDIS problem; Help says so rather than the
   * catalog deciding it for them.
   */
  rotatable: boolean
  /**
   * Hole geometry. Absent means SKÅDIS, which is every board IKEA sells — it is
   * carried here so a user-defined board (`data/customBoards.ts`) can travel
   * through `buildWall` and the mesh builder as an ordinary `BoardItem`.
   */
  grid?: HoleGrid
}

export interface AccessoryItem extends BaseItem {
  kind: 'accessory'
  archetype: Archetype
  /** Product dimensions in mm: width x depth x height. */
  dims: { w: number; d: number; h: number }
  /**
   * False for items that are mounting hardware or multi-item bundles. They
   * still belong in the cost total, they just don't get dragged onto the board.
   */
  placeable: boolean
  /** Required when `placeable`. */
  pattern?: PegPattern
  /**
   * IKEA does not publish peg spacing. Every `pattern` below is an engineering
   * estimate derived from the product's width against the 40 mm pitch, and is
   * flagged here so it can be corrected against a physical part later.
   */
  patternEstimated: boolean
  /** False where IKEA publishes no product-level measurements at all. */
  dimsVerified: boolean
  /**
   * Peg geometry, for the builder that draws it. Absent means "draw no peg",
   * which is every SKÅDIS item: IKEA publishes no peg dimensions, so inventing
   * them for the catalog would put a guess on screen as though it were measured.
   * Carried here so a user-defined part (`data/customParts.ts`) can travel
   * through `buildAccessoryParts` as an ordinary `AccessoryItem` — exactly as
   * `BoardItem.grid` does for a user-defined board.
   */
  pegs?: PegSpec
}

export type CatalogItem = BoardItem | AccessoryItem

/**
 * GB, DE and FR all use the same IKEA article number as the US for every SKU we
 * carry — verified against live data for all 22 items (findings.md F18). Japan
 * numbers differ and are passed explicitly.
 *
 * Written as a helper rather than repeating each number four times, so the
 * markets cannot silently drift apart in the data.
 */
function shared(
  us: string,
  overrides: Partial<Record<MarketId, string>> = {},
): Partial<Record<MarketId, string>> {
  return { us, gb: us, de: us, fr: us, ...overrides }
}

export const BOARDS: BoardItem[] = [
  {
    key: 'board-36x56-white',
    kind: 'board',
    itemNos: shared('50320805', { jp: '80320804' }),
    packQty: 1,
    widthMm: 360,
    heightMm: 560,
    colorway: 'white',
    latticeVerified: true,
    // Upright slots — a turned panel holds nothing (F42).
    rotatable: false,
    names: { en: 'Pegboard 36×56', ja: '有孔ボード 36×56', 'zh-Hant': '洞洞板 36×56' },
  },
  {
    key: 'board-56x56-white',
    kind: 'board',
    itemNos: shared('00320803', { jp: '30320806' }),
    packQty: 1,
    widthMm: 560,
    heightMm: 560,
    colorway: 'white',
    latticeVerified: true,
    // Upright slots — a turned panel holds nothing (F42).
    rotatable: false,
    names: { en: 'Pegboard 56×56', ja: '有孔ボード 56×56', 'zh-Hant': '洞洞板 56×56' },
  },
  {
    key: 'board-76x56-white',
    kind: 'board',
    itemNos: shared('10321618', { jp: '90321619' }),
    packQty: 1,
    widthMm: 760,
    heightMm: 560,
    colorway: 'white',
    latticeVerified: true,
    // Upright slots — a turned panel holds nothing (F42).
    rotatable: false,
    names: { en: 'Pegboard 76×56', ja: '有孔ボード 76×56', 'zh-Hant': '洞洞板 76×56' },
  },
  {
    key: 'board-56x37-freestanding',
    kind: 'board',
    itemNos: shared('00541574', { jp: '70541575' }),
    packQty: 1,
    widthMm: 560,
    heightMm: 370,
    colorway: 'white',
    // Stated height includes the stand, so the slot field may not be centred.
    latticeVerified: false,
    // Stands on its bottom edge — there is no sideways to hang it.
    rotatable: false,
    names: {
      en: 'Free-standing pegboard 56×37',
      ja: '有孔ボード 自立タイプ 56×37',
      'zh-Hant': '直立式洞洞板 56×37',
    },
  },
]

/** Body hangs below its peg row, horizontally centred on the peg span. */
function hanging(
  widthMm: number,
  heightMm: number,
  pegSpanPitches: number,
): PegPattern {
  const pegSpan = pegSpanPitches * 40
  return {
    lattice: 'either',
    offsets: pegSpanPitches > 0 ? [[pegSpanPitches, 0] as const] : [],
    // `|| 0` because a body exactly as wide as its peg span yields -0, which
    // reads as an offset in tests and diffs while behaving like zero.
    bodyOffset: [-(widthMm - pegSpan) / 2 || 0, -heightMm],
    bodySize: [widthMm, heightMm],
  }
}

export const ACCESSORIES: AccessoryItem[] = [
  {
    key: 'hook-large',
    kind: 'accessory',
    archetype: 'hook',
    itemNos: shared('50335618', { jp: '30335619' }),
    packQty: 2,
    dims: { w: 40, d: 95, h: 60 },
    placeable: true,
    pattern: hanging(40, 60, 0),
    patternEstimated: true,
    dimsVerified: true,
    names: { en: 'Hook, large', ja: 'フック 大', 'zh-Hant': '掛鉤 大' },
  },
  {
    key: 'hook-small',
    kind: 'accessory',
    archetype: 'hookSmall',
    itemNos: shared('20320802', { jp: '30321617' }),
    packQty: 5,
    dims: { w: 20, d: 25, h: 60 },
    placeable: true,
    pattern: hanging(20, 60, 0),
    patternEstimated: true,
    dimsVerified: true,
    names: { en: 'Hook, small', ja: 'フック 小', 'zh-Hant': '掛鉤 小' },
  },
  {
    key: 'hook-round',
    kind: 'accessory',
    archetype: 'hookRound',
    itemNos: shared('20519888', { jp: '10519884' }),
    packQty: 5,
    dims: { w: 19, d: 19, h: 19 },
    placeable: true,
    pattern: hanging(19, 19, 0),
    patternEstimated: true,
    dimsVerified: true,
    names: { en: 'Hook, round', ja: 'フック 丸', 'zh-Hant': '圓形掛鉤' },
  },
  {
    key: 'hook-rack',
    kind: 'accessory',
    archetype: 'hookRack',
    itemNos: shared('40519887', { jp: '60519886' }),
    packQty: 1,
    dims: { w: 280, d: 20, h: 30 },
    placeable: true,
    pattern: hanging(280, 30, 6),
    patternEstimated: true,
    dimsVerified: true,
    names: { en: 'Hook rack', ja: 'フックラック', 'zh-Hant': '掛鉤架' },
  },
  {
    key: 'shelf',
    kind: 'accessory',
    archetype: 'shelf',
    itemNos: shared('00320799', { jp: '60320800' }),
    packQty: 1,
    dims: { w: 280, d: 90, h: 30 },
    placeable: true,
    pattern: hanging(280, 30, 6),
    patternEstimated: true,
    dimsVerified: true,
    names: { en: 'Shelf', ja: 'シェルフ', 'zh-Hant': '層板' },
  },
  {
    key: 'display-shelf',
    kind: 'accessory',
    archetype: 'displayShelf',
    itemNos: shared('20591841', { jp: '00591842' }),
    packQty: 1,
    // IKEA publishes no height for this item; 40 mm is a visual estimate.
    dims: { w: 320, d: 110, h: 40 },
    placeable: true,
    // Eight pitches, not seven: the two brackets hook into the OUTERMOST holes
    // of a nine-hole row, so the tray runs hook to hook with no overhang.
    // Measured off IKEA's own straight-on photography — findings.md F35.
    pattern: hanging(320, 40, 8),
    patternEstimated: false,
    dimsVerified: true,
    names: { en: 'Display shelf', ja: 'ディスプレイシェルフ', 'zh-Hant': '展示層板' },
  },
  {
    key: 'container',
    kind: 'accessory',
    archetype: 'container',
    itemNos: shared('20320798', { jp: '40320797' }),
    packQty: 1,
    dims: { w: 75, d: 90, h: 80 },
    placeable: true,
    pattern: hanging(75, 80, 1),
    patternEstimated: true,
    dimsVerified: true,
    names: { en: 'Container', ja: '小物入れ', 'zh-Hant': '收納盒' },
  },
  {
    key: 'container-lid',
    kind: 'accessory',
    archetype: 'containerLid',
    itemNos: shared('80335909', { jp: '40335911' }),
    packQty: 3,
    dims: { w: 70, d: 85, h: 80 },
    placeable: true,
    pattern: hanging(70, 80, 1),
    patternEstimated: true,
    dimsVerified: true,
    names: {
      en: 'Container with lid',
      ja: '小物入れ ふた付き',
      'zh-Hant': '附蓋收納盒',
    },
  },
  {
    key: 'clip',
    kind: 'accessory',
    archetype: 'clip',
    itemNos: shared('00321614', { jp: '70321615' }),
    packQty: 2,
    dims: { w: 20, d: 20, h: 80 },
    placeable: true,
    pattern: hanging(20, 80, 0),
    patternEstimated: true,
    dimsVerified: true,
    names: { en: 'Clip', ja: 'クリップ', 'zh-Hant': '夾子' },
  },
  {
    key: 'basket',
    kind: 'accessory',
    archetype: 'basket',
    itemNos: shared('10599499', { jp: '60599519' }),
    packQty: 1,
    dims: { w: 345, d: 116, h: 170 },
    placeable: true,
    pattern: hanging(345, 170, 8),
    patternEstimated: true,
    dimsVerified: true,
    names: { en: 'Storage basket', ja: '収納バスケット', 'zh-Hant': '收納籃' },
  },

  // ---- The three sizes inside the set of 3 (505.177.60) ----
  //
  // IKEA sells no size on its own, so none of them has an article number: the
  // pack is the SKU and `kitKey` points at it. Sizes are IKEA's own, published
  // on the set's page as "24x8x21 cm, 12x7x13 cm and 12x6x5 cm" — width, depth,
  // height, in that order (findings.md F36).
  {
    key: 'basket-set-large',
    kind: 'accessory',
    archetype: 'basket',
    itemNos: {},
    kitKey: 'basket-set-3',
    packQty: 1,
    dims: { w: 240, d: 80, h: 210 },
    placeable: true,
    // Hooks at the two ends, six pitches apart — measured against the hole
    // columns in IKEA's straight-on photograph of all three mounted (F36).
    pattern: hanging(240, 210, 6),
    patternEstimated: false,
    dimsVerified: true,
    names: {
      en: 'Storage basket, large (set of 3)',
      ja: '収納バスケット 大（3個セット）',
      'zh-Hant': '收納籃 大（3 件組）',
    },
  },
  {
    key: 'basket-set-medium',
    kind: 'accessory',
    archetype: 'basket',
    itemNos: {},
    kitKey: 'basket-set-3',
    packQty: 1,
    dims: { w: 120, d: 70, h: 130 },
    placeable: true,
    // 120 mm is exactly three pitches, so hooks at the ends is the only
    // arrangement that lands on the grid — but too small to read off the
    // photograph, hence still flagged estimated.
    pattern: hanging(120, 130, 3),
    patternEstimated: true,
    dimsVerified: true,
    names: {
      en: 'Storage basket, medium (set of 3)',
      ja: '収納バスケット 中（3個セット）',
      'zh-Hant': '收納籃 中（3 件組）',
    },
  },
  {
    key: 'basket-set-small',
    kind: 'accessory',
    archetype: 'basket',
    itemNos: {},
    kitKey: 'basket-set-3',
    packQty: 1,
    dims: { w: 120, d: 60, h: 50 },
    placeable: true,
    pattern: hanging(120, 50, 3),
    patternEstimated: true,
    dimsVerified: true,
    names: {
      en: 'Storage basket, small (set of 3)',
      ja: '収納バスケット 小（3個セット）',
      'zh-Hant': '收納籃 小（3 件組）',
    },
  },
  {
    key: 'elastic-cord',
    kind: 'accessory',
    archetype: 'cord',
    itemNos: shared('40321631', { jp: '20321632' }),
    packQty: 3,
    dims: { w: 270, d: 10, h: 10 },
    placeable: true,
    pattern: hanging(270, 10, 6),
    patternEstimated: true,
    dimsVerified: true,
    names: { en: 'Elastic cord', ja: 'ゴムひも', 'zh-Hant': '彈性繩' },
  },

  // ---- Cost-only items: hardware and bundles, not board-face accessories ----

  {
    key: 'connector-board',
    kind: 'accessory',
    archetype: 'connector',
    itemNos: shared('40477646'),
    packQty: 2,
    dims: { w: 30, d: 2, h: 65 },
    placeable: false,
    patternEstimated: false,
    dimsVerified: true,
    names: {
      en: 'Connector for pegboards',
      ja: '有孔ボード用コネクター',
      'zh-Hant': '洞洞板連接件',
    },
  },
  {
    key: 'connector-wall',
    kind: 'accessory',
    archetype: 'connector',
    itemNos: shared('10320789', { jp: '10320794' }),
    packQty: 2,
    dims: { w: 20, d: 50, h: 180 },
    placeable: false,
    patternEstimated: false,
    dimsVerified: true,
    names: { en: 'Connector', ja: 'コネクター', 'zh-Hant': '連接件' },
  },
  {
    key: 'connector-wardrobe',
    kind: 'accessory',
    archetype: 'connector',
    itemNos: shared('10477643', { jp: '00477648' }),
    packQty: 2,
    dims: { w: 50, d: 60, h: 190 },
    placeable: false,
    patternEstimated: false,
    dimsVerified: true,
    names: {
      en: 'Connector for wardrobe',
      ja: 'ワードローブ用コネクター',
      'zh-Hant': '衣櫃用連接件',
    },
  },
  {
    key: 'basket-set-3',
    kind: 'accessory',
    archetype: 'bundle',
    itemNos: shared('50517760', { jp: '10517762' }),
    packQty: 1,
    // IKEA publishes no product-level measurements for the bundle itself, only
    // for the three baskets inside it — those are modelled as its kit members
    // (`basket-set-large` / `-medium` / `-small`) and are what gets placed.
    dims: { w: 0, d: 0, h: 0 },
    placeable: false,
    patternEstimated: false,
    dimsVerified: false,
    names: {
      en: 'Storage basket, set of 3',
      ja: '収納バスケット3個セット',
      'zh-Hant': '收納籃 3 件組',
    },
  },
  {
    key: 'accessory-set-7',
    kind: 'accessory',
    archetype: 'bundle',
    itemNos: shared('20586420'),
    packQty: 1,
    dims: { w: 0, d: 0, h: 0 },
    placeable: false,
    patternEstimated: false,
    dimsVerified: false,
    names: {
      en: '7-piece accessories set',
      ja: 'アクセサリー7点セット',
      'zh-Hant': '配件 7 件組',
    },
  },
]

export const CATALOG: CatalogItem[] = [...BOARDS, ...ACCESSORIES]

export const BY_KEY: ReadonlyMap<string, CatalogItem> = new Map(
  CATALOG.map((item) => [item.key, item]),
)

/** Item numbers we expect to resolve for a market, for price matching. */
export function itemNumbersFor(market: MarketId): Map<string, string> {
  const out = new Map<string, string>()
  for (const item of CATALOG) {
    const no = item.itemNos[market]
    if (no) out.set(no, item.key)
  }
  return out
}

export function isPlaceable(item: CatalogItem): item is AccessoryItem & { pattern: PegPattern } {
  return item.kind === 'accessory' && item.placeable && item.pattern !== undefined
}

/**
 * True for a size that only exists inside another item's pack, and so has no
 * article number and never gets a cost line of its own.
 */
export function isKitMember(item: CatalogItem): item is CatalogItem & { kitKey: string } {
  return typeof item.kitKey === 'string'
}
