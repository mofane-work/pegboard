/**
 * Regenerates src/data/price-snapshot.json from IKEA's live search endpoint.
 *
 * The snapshot is the price source the app ships with and uses by default —
 * nothing is fetched when a visitor opens the page — so this script, run
 * unattended by .github/workflows/refresh-prices.yml, is what keeps prices
 * current. That makes it the one place a bad upstream response could quietly
 * degrade prices for everyone, which is why every write goes through
 * `mergeSnapshot`'s no-shrink guard (findings F25c).
 *
 * Exit codes matter to the workflow:
 *   0  wrote an update, or had nothing to write. Both are normal.
 *   1  something we control is broken (unreadable/unwritable snapshot).
 * IKEA being down is NOT an error here — it leaves the committed snapshot in
 * place. The endpoint's contract is verify-api.ts's job, not this script's.
 *
 * Run by hand:  npm run refresh-prices
 */

import { readFile, writeFile } from 'node:fs/promises'
import { LIVE_MARKETS, fetchMarketPrices } from '../src/lib/ikeaSearch.ts'
import { mergeSnapshot, type MarketFetch } from '../src/lib/priceSnapshot.ts'
import type { PriceSnapshot } from '../src/lib/pricing.ts'

const out = new URL('../src/data/price-snapshot.json', import.meta.url)

let previous: PriceSnapshot
try {
  previous = JSON.parse(await readFile(out, 'utf8')) as PriceSnapshot
  if (!previous?.markets) throw new Error('snapshot has no markets')
} catch (error) {
  console.error(`cannot read the existing snapshot: ${(error as Error).message}`)
  process.exit(1)
}

const fetched: MarketFetch[] = []
for (const market of LIVE_MARKETS) {
  try {
    const prices = await fetchMarketPrices(market)
    fetched.push({ id: market.id, currency: market.currency, prices })
  } catch (error) {
    // One market failing must not cost us the other four.
    fetched.push({ id: market.id, currency: market.currency, error: (error as Error).message })
  }
}

const capturedAt = new Date().toISOString().slice(0, 10)
const { snapshot, changed, notes } = mergeSnapshot(previous, fetched, capturedAt)

for (const note of notes) console.log(note)

if (!changed) {
  console.log('no change — snapshot left as it is')
  process.exit(0)
}

try {
  await writeFile(out, `${JSON.stringify(snapshot, null, 2)}\n`)
} catch (error) {
  console.error(`cannot write the snapshot: ${(error as Error).message}`)
  process.exit(1)
}
console.log(`wrote ${out.pathname} (captured ${snapshot.capturedAt})`)
