/**
 * Procurement list export.
 *
 * The audience is not the person using the app: it is whoever keys this into
 * an ordering system and then walks into an IKEA to buy the parts. That drives
 * every decision here — article numbers in IKEA's own dotted form, pack counts
 * rather than piece counts, and no field that could be mistaken for a price the
 * store will honour.
 *
 * Pure formatter over `CostLine[]`, so it inherits pack-aware maths and the
 * "an unknown price is never zero" rule from pricing.ts.
 */

import type { LanguageId } from '../data/catalog'
import type { CostLine, PriceMarketId } from './pricing'
import { formatPrice } from './pricing'

export type ExportFormat = 'text' | 'csv'

export interface ShoppingListOptions {
  format: ExportFormat
  market: PriceMarketId
  currency: string
  /** BCP 47 tag for money formatting. */
  locale: string
  /** Product names follow the UI language, never the price market. */
  language: LanguageId
  /** Localised labels, supplied by the caller so this module stays i18n-free. */
  labels: ShoppingListLabels
  /** Set when any counted price came from the bundled snapshot. */
  snapshotDate?: string
  /** Catalog keys whose price could not be resolved. */
  unknownKeys?: readonly string[]
}

export interface ShoppingListLabels {
  title: string
  marketName: string
  total: string
  packNote: (packQty: number, pieces: number) => string
  unknownNote: string
  snapshotNote: string
  articleNote: string
}

/**
 * IKEA never shows a raw item number. `10321618` is displayed, printed on
 * shelf labels, and searched for as `103.216.18` — so an export that omits the
 * dots is materially harder to use in a store.
 *
 * Anything not exactly 8 digits is returned untouched rather than mangled.
 */
export function formatArticleNumber(itemNo: string): string {
  if (!/^\d{8}$/.test(itemNo)) return itemNo
  return `${itemNo.slice(0, 3)}.${itemNo.slice(3, 6)}.${itemNo.slice(6)}`
}

/**
 * Printed width in a monospace font. CJK and other East Asian Wide/Fullwidth
 * characters occupy two columns, so `.length` is not the width — padding by it
 * leaves ragged columns in Japanese and Chinese, the languages this export most
 * needs to serve.
 */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    width += isWide(char) ? 2 : 1
  }
  return width
}

/** Ranges classified Wide (W) or Fullwidth (F) by Unicode EAW. */
function isWide(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK radicals, Kangxi, punctuation
    (code >= 0x3041 && code <= 0x33ff) || // Hiragana, Katakana, CJK compat
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Ext A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
    (code >= 0xa000 && code <= 0xa4cf) || // Yi
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compat ideographs
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK compat forms
    (code >= 0xff00 && code <= 0xff60) || // Fullwidth forms
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd) // CJK Ext B+
  )
}

export function padDisplay(text: string, width: number): string {
  const pad = width - displayWidth(text)
  return pad > 0 ? text + ' '.repeat(pad) : text
}

function padStartDisplay(text: string, width: number): string {
  const pad = width - displayWidth(text)
  return pad > 0 ? ' '.repeat(pad) + text : text
}

interface Row {
  packs: string
  name: string
  article: string
  price: string
  packNote?: string
}

function toRows(lines: readonly CostLine[], options: ShoppingListOptions): Row[] {
  const { market, locale } = options
  // The Custom market has no country behind it, so we have no local article
  // number and will not imply one by printing another market's.
  const withArticles = market !== 'custom'

  return lines
    .filter((line) => line.included && line.packs > 0)
    .map((line) => {
      const itemNo = withArticles ? line.item.itemNos[market] : undefined
      return {
        packs: String(line.packs),
        name: line.item.names[options.language],
        article: itemNo ? formatArticleNumber(itemNo) : '',
        price:
          line.lineTotal === null
            ? '—'
            : formatPrice(line.lineTotal, line.price.currency, locale),
        packNote:
          line.packQty > 1 ? options.labels.packNote(line.packQty, line.quantity) : undefined,
      }
    })
}

function buildText(rows: Row[], lines: readonly CostLine[], options: ShoppingListOptions): string {
  const { labels } = options
  const total = lines
    .filter((l) => l.included && l.lineTotal !== null)
    .reduce((sum, l) => sum + (l.lineTotal ?? 0), 0)

  const totalText = formatPrice(Math.round(total * 100) / 100, options.currency, options.locale)
  const showArticles = rows.some((r) => r.article !== '')

  const packW = Math.max(...rows.map((r) => displayWidth(r.packs)), 1)
  const nameW = Math.max(...rows.map((r) => displayWidth(r.name)), 4)
  const articleW = showArticles ? Math.max(...rows.map((r) => displayWidth(r.article))) : 0
  const priceW = Math.max(
    ...rows.map((r) => displayWidth(r.price)),
    displayWidth(totalText),
  )

  const body: string[] = []
  for (const row of rows) {
    const parts = [
      `  ${padStartDisplay(row.packs, packW)} ×`,
      padDisplay(row.name, nameW),
      ...(showArticles ? [padDisplay(row.article, articleW)] : []),
      padStartDisplay(row.price, priceW),
    ]
    body.push(parts.join('  '))
    if (row.packNote) body.push(`  ${' '.repeat(packW + 2)}  └ ${row.packNote}`)
  }

  const ruleWidth = packW + 2 + nameW + (showArticles ? articleW + 2 : 0) + priceW + 6
  const totalLine = [
    `  ${' '.repeat(packW + 2)}`,
    padDisplay(labels.total, nameW + (showArticles ? articleW + 2 : 0)),
    padStartDisplay(totalText, priceW),
  ].join('  ')

  const footer: string[] = []
  if (showArticles) footer.push(labels.articleNote)
  if (options.unknownKeys?.length) footer.push(labels.unknownNote)
  if (options.snapshotDate) footer.push(labels.snapshotNote)

  return [
    labels.title,
    labels.marketName,
    '',
    ...body,
    `  ${'─'.repeat(Math.max(ruleWidth, 20))}`,
    totalLine,
    ...(footer.length > 0 ? ['', ...footer] : []),
  ].join('\n')
}

/**
 * Stable English column keys on purpose: this format exists to be imported, and
 * localising headers would break an importer's column mapping every time the UI
 * language changed. Only the values localise.
 */
const CSV_COLUMNS = [
  'article',
  'name',
  'packs',
  'pack_size',
  'pieces',
  'line_total',
  'currency',
] as const

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function buildCsv(lines: readonly CostLine[], options: ShoppingListOptions): string {
  const { market } = options
  const withArticles = market !== 'custom'
  const columns = withArticles ? CSV_COLUMNS : CSV_COLUMNS.filter((c) => c !== 'article')

  const rows = lines
    .filter((line) => line.included && line.packs > 0)
    .map((line) => {
      const itemNo = withArticles ? line.item.itemNos[market] : undefined
      const values: Record<string, string> = {
        article: itemNo ? formatArticleNumber(itemNo) : '',
        name: line.item.names[options.language],
        packs: String(line.packs),
        pack_size: String(line.packQty),
        pieces: String(line.quantity),
        line_total: line.lineTotal === null ? '' : String(line.lineTotal),
        currency: line.price.currency,
      }
      return columns.map((c) => csvEscape(values[c])).join(',')
    })

  return [columns.join(','), ...rows].join('\n')
}

export function buildShoppingList(
  lines: readonly CostLine[],
  options: ShoppingListOptions,
): string {
  const included = lines.filter((line) => line.included && line.packs > 0)
  if (included.length === 0) return ''

  return options.format === 'csv'
    ? buildCsv(lines, options)
    : buildText(toRows(lines, options), lines, options)
}
