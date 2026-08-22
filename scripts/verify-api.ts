/**
 * Canary for IKEA's undocumented search endpoint.
 *
 * The app never hard-fails when this endpoint breaks — it falls back to the
 * committed snapshot. That is exactly why the breakage would otherwise go
 * unnoticed until prices were badly stale. Run this in CI:
 *
 *     npm run verify-api
 *
 * A failure here means the catalog needs attention, not that the app is down.
 */

import { LIVE_MARKETS, extractPrices, searchEndpoint } from '../src/lib/ikeaSearch.ts'

const failures = []

function check(condition, message) {
  if (!condition) failures.push(message)
}

for (const market of LIVE_MARKETS) {
  const url = searchEndpoint(market.locale)
  let payload

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'pegboard/0.1 (+https://github.com/)' },
    })
    check(res.ok, `${market.id}: expected HTTP 200, got ${res.status}`)
    check(
      res.headers.get('access-control-allow-origin') === '*',
      `${market.id}: CORS header is no longer "*" — the browser can no longer fetch this directly`,
    )
    payload = await res.json()
  } catch (error) {
    failures.push(`${market.id}: request failed — ${error.message}`)
    continue
  }

  const items = payload?.searchResultPage?.products?.main?.items
  check(Array.isArray(items), `${market.id}: searchResultPage.products.main.items is missing`)
  if (!Array.isArray(items)) continue

  const sample = items.find((entry) => entry?.product?.name?.startsWith('SKÅDIS'))?.product
  check(sample !== undefined, `${market.id}: no SKÅDIS products in the result set`)
  if (!sample) continue

  for (const field of ['id', 'name', 'typeName', 'pipUrl']) {
    check(typeof sample[field] === 'string', `${market.id}: product.${field} is no longer a string`)
  }
  check(
    typeof sample.salesPrice?.numeral === 'number',
    `${market.id}: salesPrice.numeral is no longer a number — prices cannot be read`,
  )
  check(
    sample.salesPrice?.currencyCode === market.currency,
    `${market.id}: expected currency ${market.currency}, got ${sample.salesPrice?.currencyCode}`,
  )

  const prices = extractPrices(payload)
  check(
    Object.keys(prices).length >= 15,
    `${market.id}: only ${Object.keys(prices).length} SKÅDIS prices found, expected 15+`,
  )
  console.log(`${market.id}: OK — ${Object.keys(prices).length} prices, currency ${market.currency}`)
}

if (failures.length > 0) {
  console.error('\nIKEA API contract check FAILED:')
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error('\nThe app still works via src/data/price-snapshot.json, but prices will go stale.')
  process.exit(1)
}

console.log('\nIKEA API contract check passed.')
