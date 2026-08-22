/**
 * Counter.dev visit counting — the one third-party request this app makes on
 * load, and the only one.
 *
 * WHY THIS EXISTS, AND WHAT IT COST
 * Every other rung of the pricing chain exists so that opening the page makes
 * no outbound request at all (findings F25, Phase 23). This module knowingly
 * breaks that for a single purpose: knowing how many people actually use the
 * thing. That is a deliberate trade, not an oversight — see findings F27 — and
 * it is why `help.pv1` was rewritten in all three languages. If you are here to
 * add a second tracker, or to make this one report anything beyond a visit,
 * re-read F27 first: the privacy note is a promise to the user, and it is only
 * true as long as this file stays this small.
 *
 * WHAT COUNTER.DEV RECEIVES
 * One POST to t.counter.dev/track on first page view: referrer, screen size,
 * browser language, and a country derived from the IP by their CDN. No cookies,
 * no fingerprint, no per-page tracking, and nothing about the user's wall —
 * placements never leave the browser. Uniques are counted with sessionStorage
 * plus the browser cache, which is why this is a real terminal-equipment access
 * under ePrivacy Art 5(3) and not the consent-free freebie the "cookieless"
 * label implies (F27). Hence the opt-out below, which is not decoration.
 *
 * THE OPT-OUT DELIBERATELY DOES NOT LIVE IN THE ZUSTAND STORE.
 * The store is versioned, migrated, cleared by `applyShared`, and rewritten by
 * share links. A privacy choice must survive all four. A dedicated key that
 * nothing else touches cannot be reset by a migration bug or a pasted link.
 */

/**
 * TODO: replace the empty string with the site token from counter.dev, e.g.
 *   const CONFIGURED_ID = 'a1b2c3d4-...'
 * While it is empty NOTHING is injected and no request is made — a placeholder
 * can never ship as a half-configured tracker. To preview without editing:
 *   VITE_COUNTER_DEV_ID=<token> npm run dev
 */
const CONFIGURED_ID = ''

/** Counter.dev's hosted tracker. 1.1 KB, loaded async, failure is silent. */
const SCRIPT_SRC = 'https://cdn.counter.dev/script.js'

/** Marks our injected tag so a second call cannot add a second one. */
const SCRIPT_MARKER = 'data-pegboard-analytics'

/**
 * Not a store key. See the header — this outlives store migrations on purpose.
 */
export const OPT_OUT_KEY = 'pegboard.analytics-opt-out'

/**
 * The token goes straight into an attribute, so it may only ever be the shape
 * counter.dev actually issues. A stray quote here would be attribute injection
 * sourced from an env var — cheap to forbid, so forbid it.
 */
function isWellFormedId(id: string): boolean {
  return /^[A-Za-z0-9_-]{4,64}$/.test(id)
}

/**
 * The resolution rule, as a pure function of its two sources: the environment
 * wins over the hardcoded constant, and anything malformed resolves to none.
 *
 * Exported because it is the only way to test the unconfigured build. A fork
 * that fills in CONFIGURED_ID cannot reach "no token anywhere" through
 * counterDevId() — the constant is baked in — and "no token means no request"
 * is a privacy guarantee that has to stay provable in every build, not only in
 * the ones that happen to ship unconfigured.
 */
export function resolveCounterDevId(fromEnv: unknown, configured: string): string {
  const id = (typeof fromEnv === 'string' && fromEnv) || configured
  return isWellFormedId(id) ? id : ''
}

/** Empty when analytics is not configured, which is the default. */
export function counterDevId(): string {
  return resolveCounterDevId(import.meta.env.VITE_COUNTER_DEV_ID, CONFIGURED_ID)
}

/** True when a token is configured — i.e. this build would count visits. */
export function analyticsConfigured(): boolean {
  return counterDevId() !== ''
}

/**
 * localStorage throws outright in some privacy modes rather than returning
 * null. A user strict enough to be in one of those is not a user we should
 * count, so a read failure means opted out.
 */
export function isOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === 'true'
  } catch {
    return true
  }
}

/**
 * Takes effect on the next page load, not this one: counter.dev's script has
 * already sent its single beacon by the time anyone can click the checkbox,
 * and there is no recall. The Help text says so rather than implying an
 * undo that does not exist.
 */
export function setOptedOut(optedOut: boolean): void {
  try {
    if (optedOut) localStorage.setItem(OPT_OUT_KEY, 'true')
    else localStorage.removeItem(OPT_OUT_KEY)
  } catch {
    /* Storage unavailable — nothing was going to be counted anyway. */
  }
}

/** Whole hours east of UTC, which is the only form counter.dev accepts. */
function utcOffsetHours(): number {
  return Math.round(-new Date().getTimezoneOffset() / 60)
}

/**
 * Injects the tracker, unless anything at all argues against it.
 *
 * Idempotent, because StrictMode runs mount effects twice in development —
 * the same reason `dismissBoot` is.
 *
 * @param id  defaults to this build's configured token. App.tsx calls this
 *            with no argument; the parameter exists so a test can exercise the
 *            empty-token gate in a build that hardcodes CONFIGURED_ID.
 * @returns whether a script tag was added, so tests can assert the gate
 *          without reaching into the DOM.
 */
export function initAnalytics(id: string = counterDevId()): boolean {
  if (!id) return false
  if (isOptedOut()) return false
  if (typeof document === 'undefined') return false
  if (document.querySelector(`script[${SCRIPT_MARKER}]`)) return false

  const script = document.createElement('script')
  script.src = SCRIPT_SRC
  script.async = true
  script.dataset.id = id
  script.dataset.utcoffset = String(utcOffsetHours())
  script.setAttribute(SCRIPT_MARKER, '')
  // A blocked or failed tracker must never surface to the user. Same rule the
  // price chain follows: degrade, never throw.
  script.onerror = () => script.remove()
  document.head.appendChild(script)
  return true
}
