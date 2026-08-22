/**
 * IKEA's undocumented search endpoint — the single source of truth for how we
 * talk to it. Imported by both the browser app and the node scripts in
 * `scripts/`, so the runtime fetch and the snapshot generator cannot drift apart.
 *
 * The endpoint responds with `access-control-allow-origin: *`, which is what
 * lets this app stay backend-free. See findings.md F1.
 */

export interface MarketDefinition {
  id: 'us' | 'gb' | 'de' | 'fr' | 'jp'
  locale: string
  currency: string
}

export const LIVE_MARKETS: readonly MarketDefinition[] = [
  { id: 'us', locale: 'us/en', currency: 'USD' },
  { id: 'gb', locale: 'gb/en', currency: 'GBP' },
  { id: 'de', locale: 'de/de', currency: 'EUR' },
  { id: 'fr', locale: 'fr/fr', currency: 'EUR' },
  { id: 'jp', locale: 'jp/ja', currency: 'JPY' },
]

export function searchEndpoint(locale: string): string {
  return (
    `https://sik.search.blue.cdtapps.com/${locale}/search-result-page` +
    `?types=PRODUCT&q=skadis&size=100&c=sr&v=20210322`
  )
}

/** Prices keyed by IKEA item number, valid only within one market. */
export type PriceTable = Record<string, number>

interface SearchProduct {
  id?: unknown
  name?: unknown
  salesPrice?: { numeral?: unknown; currencyCode?: unknown }
}

/**
 * Pull SKÅDIS prices out of a search payload.
 *
 * Two filters matter and both were learned the hard way:
 *  - The result set carries unrelated products (ALEX, SUNNERSTA, VATTENKAR…),
 *    so we match on the product name.
 *  - Japan appends the katakana reading ("SKÅDIS スコーディス"), so the match
 *    must be a prefix, not equality.
 *  - Ids beginning with `s` are pre-built combination bundles, not single SKUs.
 */
export function extractPrices(payload: unknown): PriceTable {
  const items =
    (payload as { searchResultPage?: { products?: { main?: { items?: unknown[] } } } })
      ?.searchResultPage?.products?.main?.items ?? []

  const prices: PriceTable = {}

  for (const entry of items) {
    const product = (entry as { product?: SearchProduct })?.product
    if (!product) continue
    if (typeof product.name !== 'string' || !product.name.startsWith('SKÅDIS')) continue
    if (typeof product.id !== 'string' || product.id.startsWith('s')) continue
    if (typeof product.salesPrice?.numeral !== 'number') continue
    prices[product.id] = product.salesPrice.numeral
  }

  return prices
}

export async function fetchMarketPrices(
  market: MarketDefinition,
  signal?: AbortSignal,
): Promise<PriceTable> {
  const response = await fetch(searchEndpoint(market.locale), { signal })
  if (!response.ok) throw new Error(`IKEA search returned HTTP ${response.status}`)
  return extractPrices(await response.json())
}
