/**
 * Regenerates .github/badges/visits.json — the visit count the README badge
 * reads through shields.io's endpoint API.
 *
 * WHY A COMMITTED FILE AND NOT A LIVE BADGE
 * counter.dev has no public badge or unauthenticated count endpoint. Reading a
 * count means authenticating, and the only credential it offers for that is the
 * share token, which grants read access to the whole dashboard. Putting that in
 * a README URL would publish it. So the token stays a GitHub Actions secret,
 * this script runs server-side, and only the resulting number is committed.
 *
 * HOW IT READS THE COUNT
 * `/dump` is a Server-Sent Events stream, not a plain JSON endpoint — it holds
 * the connection open and pushes a fresh dump whenever a visit lands. We want
 * exactly the first `dump` event and then to hang up, which is why this reads
 * the body as a stream rather than awaiting `response.text()` (that would never
 * resolve). Sessionless auth is `?user=&token=`, per counter.dev's own
 * GetSessionlessUserId.
 *
 * Exit codes matter to the workflow:
 *   0  wrote an update, or had nothing to write. Both are normal.
 *   1  something we control is broken (missing credentials, unwritable file).
 * counter.dev being down is NOT an error — a badge is not worth a red CI run,
 * and the previously committed number stays on the README.
 *
 * WHICH SITE IT COUNTS
 * counter.dev separates sites by the Origin header, not by the tracking id — one
 * account has ONE `data-id` and as many sites as there are origins reporting to
 * it. So `sites` may hold more than this project. COUNTER_DEV_SITE picks one;
 * without it every site on the account is summed, which is right only while
 * this is the only thing you track. The script always logs the site keys it
 * found, so the first run tells you what to set.
 *
 * Run by hand:  COUNTER_DEV_USER=… COUNTER_DEV_TOKEN=… npm run refresh-visit-count
 */

import { readFile, writeFile } from 'node:fs/promises'

const out = new URL('../.github/badges/visits.json', import.meta.url)

/** How long to wait for the first dump before giving up on the stream. */
const TIMEOUT_MS = 20_000

interface ShieldsEndpoint {
  schemaVersion: 1
  label: string
  message: string
  color: string
}

interface CounterDump {
  sites?: Record<string, { count?: number }>
}

/**
 * Normalises a pasted credential. Both of these present identically — as a
 * `nouser` event — and neither is visible in the stored value:
 *
 * - **Whitespace.** A trailing newline survives a paste into a GitHub secret.
 * - **Percent-encoding.** The dashboard hands you a URL, not two fields, and
 *   `share-account.js` builds it with `encodeURIComponent`. The token is
 *   base64url of 8 bytes, so it ends in one `=` pad — which appears in that URL
 *   as `%3D`. Copy that literally and this script encodes it again to `%253D`,
 *   the server decodes it once, and the comparison fails on the last character.
 *   `%` is not a base64url character, so seeing one can only mean the value is
 *   still encoded; decoding is always the right move.
 *
 * The whole share URL is also accepted in either variable, since a URL is the
 * only thing counter.dev actually gives you to copy.
 */
function credential(name: 'user' | 'token', raw: string | undefined): string {
  let value = (raw ?? '').trim()
  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).searchParams.get(name) ?? value
    } catch {
      // Not a URL after all — fall through and let the server judge it.
    }
  }
  if (value.includes('%')) {
    try {
      value = decodeURIComponent(value)
    } catch {
      // A lone `%`. Leave it alone rather than guess.
    }
  }
  return value
}

// const user = credential('user', process.env.COUNTER_DEV_USER)
// const token = credential('token', process.env.COUNTER_DEV_TOKEN)
const user = credential('user', "mofane.work")
const token = credential('token', "pxof-Zlpzk8%3D")
if (!user || !token) {
  console.error('COUNTER_DEV_USER and COUNTER_DEV_TOKEN must both be set')
  process.exit(1)
}

/**
 * What to check when the share credentials bounce. Worth spelling out because
 * the obvious test does not test anything: `/dump` prefers the share token but
 * falls back to the dashboard session, so opening the share link in a browser
 * you are logged into succeeds no matter what the token says.
 */
function explainNoUser(): string {
  return [
    `  sent user="${user}", token=${token.length} chars ending "${token.slice(-3)}"`,
    '  - COUNTER_DEV_USER is the username you log in with — not the sign-up',
    '    email, not the data-id UUID, not the site domain.',
    '  - COUNTER_DEV_TOKEN exists only once guest access is switched on, and a',
    '    later Share/Remove issues a new one. Re-copy it if in doubt.',
    '  - Take the token from the share URL DECODED: a trailing "=" is right,',
    "    a trailing \"%3D\" is the URL's encoding of it and will be rejected.",
    '  - To test the link by hand, use a private window. A real guest view says',
    '    "You are viewing <user>\'s dashboard as guest"; anything else means',
    '    your session cookie logged you in and the token was never checked.',
  ].join('\n')
}

/** The number already on the README, or 0 the first time this runs. */
async function previousCount(): Promise<number> {
  try {
    const badge = JSON.parse(await readFile(out, 'utf8')) as ShieldsEndpoint
    const digits = badge.message.replace(/[^0-9]/g, '')
    return digits ? Number(digits) : 0
  } catch {
    return 0
  }
}

/**
 * Reads the SSE stream until the first `dump` event, then aborts the request.
 * Returns null for anything that is counter.dev's problem rather than ours.
 */
async function fetchDump(): Promise<CounterDump | null> {
  const url = new URL('https://counter.dev/dump')
  url.searchParams.set('user', user)
  url.searchParams.set('token', token)
  url.searchParams.set('utcoffset', '0')

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: abort.signal,
      headers: { accept: 'text/event-stream' },
    })
    if (!response.ok) {
      console.error(`counter.dev returned ${response.status}`)
      return null
    }
    if (!response.body) {
      console.error('counter.dev returned no body')
      return null
    }

    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true })
      // SSE frames are separated by a blank line; each carries one `data:` line.
      let split: number
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, split)
        buffer = buffer.slice(split + 2)
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('')
        if (!data) continue
        const event = JSON.parse(data) as { type?: string; payload?: unknown }
        // `nouser` means the credentials were rejected. That IS ours to fix,
        // but not at the cost of a red run — say so loudly and leave the file.
        if (event.type === 'nouser') {
          console.error('counter.dev rejected the credentials (type: nouser)')
          console.error(explainNoUser())
          return null
        }
        if (event.type === 'dump') return event.payload as CounterDump
      }
    }
    console.error('stream ended before a dump event arrived')
    return null
  } catch (error) {
    console.error(`could not reach counter.dev: ${(error as Error).message}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

const dump = await fetchDump()
if (!dump) {
  console.log('leaving the committed count as it is')
  process.exit(0)
}

const sites = dump.sites ?? {}
const siteKeys = Object.keys(sites)
console.log(`counter.dev sites on this account: ${siteKeys.join(', ') || '(none yet)'}`)

const wanted = process.env.COUNTER_DEV_SITE
if (wanted && !(wanted in sites)) {
  // Naming a site that does not exist would otherwise commit a confident 0 and,
  // on a fresh badge, look exactly like "nobody has visited yet".
  console.error(`COUNTER_DEV_SITE="${wanted}" is not one of: ${siteKeys.join(', ') || '(none)'}`)
  process.exit(0)
}

const counted = wanted ? [sites[wanted]] : Object.values(sites)
if (!wanted && siteKeys.length > 1) {
  console.log(`summing ${siteKeys.length} sites — set COUNTER_DEV_SITE to count just one`)
}
const total = counted.reduce((sum, site) => sum + (site?.count ?? 0), 0)
const previous = await previousCount()

// The no-shrink guard, for the same reason mergeSnapshot has one (findings
// F25c): this runs unattended and commits to the default branch. A visit total
// is cumulative, so a smaller number means a partial or throttled response, not
// fewer visitors — and a badge that counts backwards in public is worse than a
// badge that is a week stale.
if (total < previous) {
  console.error(`refusing to shrink the count: ${previous} → ${total}`)
  process.exit(0)
}
if (total === previous) {
  console.log(`no change — still ${total}`)
  process.exit(0)
}

const badge: ShieldsEndpoint = {
  schemaVersion: 1,
  label: 'visits',
  message: total.toLocaleString('en-US'),
  color: 'blue',
}

try {
  await writeFile(out, `${JSON.stringify(badge, null, 2)}\n`)
} catch (error) {
  console.error(`cannot write the badge: ${(error as Error).message}`)
  process.exit(1)
}
console.log(`wrote ${out.pathname} (${previous} → ${total})`)
