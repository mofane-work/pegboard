/**
 * Fetching live prices from IKEA — on request only.
 *
 * The app used to fetch on mount, which meant every visitor's browser called an
 * undocumented third-party endpoint, and showed IKEA their IP, just for opening
 * the page. Prices now come from the snapshot committed into the bundle and
 * kept current by a scheduled workflow, so a normal page load makes **no
 * third-party request at all**.
 *
 * This module is what remains: an explicit "refresh prices" the user can press
 * when they want today's number rather than the snapshot's. Failure is still
 * expected and still handled — the endpoint is undocumented and may be blocked,
 * rate-limited or changed — and nothing here throws to the UI. The resolution
 * chain in pricing.ts falls back through cache to the snapshot regardless.
 */

import { LIVE_MARKETS, fetchMarketPrices, type PriceTable } from './ikeaSearch'
import { type CachedPrices, type PriceMarketId } from './pricing'
import { usePrices } from '../state/store'

const cacheKey = (market: string) => `skadis-prices-${market}`

export function readCache(market: PriceMarketId): CachedPrices | undefined {
  try {
    const raw = window.localStorage.getItem(cacheKey(market))
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as CachedPrices
    if (typeof parsed?.fetchedAt !== 'number' || typeof parsed.prices !== 'object') return undefined
    return parsed
  } catch {
    return undefined
  }
}

function writeCache(market: PriceMarketId, prices: PriceTable): void {
  try {
    window.localStorage.setItem(
      cacheKey(market),
      JSON.stringify({ fetchedAt: Date.now(), prices } satisfies CachedPrices),
    )
  } catch {
    // Storage full or disabled — the in-memory prices still work this session.
  }
}

/** In flight, so a second press supersedes the first instead of racing it. */
let inFlight: AbortController | undefined

/**
 * Fetch this market's prices now. Resolves either way — the caller has nothing
 * to handle, because every outcome is already reflected in the price store.
 */
export async function refreshMarketPrices(market: PriceMarketId): Promise<void> {
  const definition = LIVE_MARKETS.find((m) => m.id === market)
  // Custom market: every price is user-supplied, so there is nothing to fetch.
  if (!definition) return

  inFlight?.abort()
  const controller = new AbortController()
  inFlight = controller

  const { setLoading, setPrices, setError } = usePrices.getState()
  setLoading()

  try {
    const prices = await fetchMarketPrices(definition, controller.signal)
    if (controller.signal.aborted) return
    // An empty table is a failure wearing a success's clothes: it would leave
    // the chain silently falling through to the snapshot with an "ok" status.
    if (Object.keys(prices).length === 0) throw new Error('no prices returned')
    writeCache(market, prices)
    setPrices(market, prices)
  } catch (error: unknown) {
    if (controller.signal.aborted) return
    setError(error instanceof Error ? error.message : 'unknown error')
  } finally {
    if (inFlight === controller) inFlight = undefined
  }
}
