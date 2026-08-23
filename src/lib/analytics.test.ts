import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OPT_OUT_KEY,
  analyticsConfigured,
  counterDevId,
  initAnalytics,
  isOptedOut,
  resolveCounterDevId,
  setOptedOut,
} from './analytics'

const VALID_ID = 'abc123-token'

function injectedScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll<HTMLScriptElement>('script[data-pegboard-analytics]'))
}

beforeEach(() => {
  localStorage.clear()
  // Vite exposes any VITE_-prefixed variable from the ambient process
  // environment, so a developer who exports VITE_COUNTER_DEV_ID to preview the
  // tracker would otherwise see the "unconfigured" tests below fail against a
  // real token. Pin the default; the tests that want a token stub over this.
  vi.stubEnv('VITE_COUNTER_DEV_ID', '')
})

afterEach(() => {
  injectedScripts().forEach((node) => node.remove())
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('resolveCounterDevId', () => {
  it('takes a well-formed token from the environment', () => {
    expect(resolveCounterDevId(VALID_ID)).toBe(VALID_ID)
  })

  it('resolves to nothing when the environment has no token', () => {
    expect(resolveCounterDevId('')).toBe('')
    expect(resolveCounterDevId(undefined)).toBe('')
  })

  it.each([
    ['a quote that would break out of the attribute', 'abc" data-evil="1'],
    ['a value with whitespace', 'abc 123'],
    ['a value that is too short', 'ab'],
    ['an outright URL', 'https://evil.example/x'],
  ])('rejects %s', (_label, value) => {
    expect(resolveCounterDevId(value)).toBe('')
  })
})

describe('counterDevId', () => {
  it('reads the token from the environment', () => {
    vi.stubEnv('VITE_COUNTER_DEV_ID', VALID_ID)
    expect(counterDevId()).toBe(VALID_ID)
    expect(analyticsConfigured()).toBe(true)
  })

  // The whole fork story rests on this: the build env is the ONLY source, so
  // a checkout with nothing exported counts nothing. If someone reintroduces a
  // hardcoded fallback constant, this is the test that goes red.
  it('has no source but the environment, so an unset build is unconfigured', () => {
    vi.stubEnv('VITE_COUNTER_DEV_ID', '')
    expect(counterDevId()).toBe('')
    expect(analyticsConfigured()).toBe(false)
  })
})

describe('initAnalytics', () => {
  it('injects nothing when no token is configured', () => {
    expect(initAnalytics('')).toBe(false)
    expect(injectedScripts()).toHaveLength(0)
  })

  it('injects nothing when called with no argument and the env is unset', () => {
    vi.stubEnv('VITE_COUNTER_DEV_ID', '')
    expect(initAnalytics()).toBe(false)
    expect(injectedScripts()).toHaveLength(0)
  })

  it('injects the tracker when configured', () => {
    vi.stubEnv('VITE_COUNTER_DEV_ID', VALID_ID)
    expect(initAnalytics()).toBe(true)

    const [script] = injectedScripts()
    expect(script.src).toBe('https://cdn.counter.dev/script.js')
    expect(script.dataset.id).toBe(VALID_ID)
    expect(script.async).toBe(true)
    // Whole hours, in either direction — jsdom runs in whatever TZ the host has.
    expect(Number(script.dataset.utcoffset)).toBe(Math.round(Number(script.dataset.utcoffset)))
  })

  it('is idempotent, because StrictMode mounts effects twice', () => {
    vi.stubEnv('VITE_COUNTER_DEV_ID', VALID_ID)
    expect(initAnalytics()).toBe(true)
    expect(initAnalytics()).toBe(false)
    expect(injectedScripts()).toHaveLength(1)
  })

  it('injects nothing when the visitor has opted out', () => {
    vi.stubEnv('VITE_COUNTER_DEV_ID', VALID_ID)
    setOptedOut(true)
    expect(initAnalytics()).toBe(false)
    expect(injectedScripts()).toHaveLength(0)
  })

  it('counts again once the visitor opts back in', () => {
    vi.stubEnv('VITE_COUNTER_DEV_ID', VALID_ID)
    setOptedOut(true)
    expect(initAnalytics()).toBe(false)
    setOptedOut(false)
    expect(initAnalytics()).toBe(true)
  })
})

describe('the opt-out', () => {
  it('defaults to opted in', () => {
    expect(isOptedOut()).toBe(false)
  })

  it('round-trips through localStorage under a key of its own', () => {
    setOptedOut(true)
    expect(localStorage.getItem(OPT_OUT_KEY)).toBe('true')
    expect(isOptedOut()).toBe(true)

    setOptedOut(false)
    expect(localStorage.getItem(OPT_OUT_KEY)).toBeNull()
    expect(isOptedOut()).toBe(false)
  })

  it('treats unreadable storage as opted out, never as consent', () => {
    vi.stubEnv('VITE_COUNTER_DEV_ID', VALID_ID)
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('storage disabled')
      },
      setItem() {
        throw new Error('storage disabled')
      },
      removeItem() {
        throw new Error('storage disabled')
      },
    })

    expect(isOptedOut()).toBe(true)
    expect(initAnalytics()).toBe(false)
    // And writing must not throw either — the Help checkbox calls this blind.
    expect(() => setOptedOut(false)).not.toThrow()
  })
})
