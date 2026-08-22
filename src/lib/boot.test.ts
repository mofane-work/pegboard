import { afterEach, describe, expect, it, vi } from 'vitest'
import { BOOT_FADE_MS, dismissBoot } from './boot'

function mountSplash(): HTMLElement {
  const node = document.createElement('div')
  node.id = 'boot'
  document.body.append(node)
  return node
}

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
}

afterEach(() => {
  document.getElementById('boot')?.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('dismissBoot', () => {
  it('marks the splash done immediately, then removes it after the fade', () => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    const node = mountSplash()

    dismissBoot()

    // Marked at once so the fade can start; still in the DOM until it finishes.
    expect(node.dataset.done).toBe('true')
    expect(document.getElementById('boot')).not.toBeNull()

    vi.advanceTimersByTime(BOOT_FADE_MS + 100)
    expect(document.getElementById('boot')).toBeNull()
  })

  it('removes the splash outright when the user asked for reduced motion', () => {
    stubReducedMotion(true)
    mountSplash()

    dismissBoot()

    // No fade to wait for, so no timer either.
    expect(document.getElementById('boot')).toBeNull()
  })

  it('removes the splash as soon as the fade transition ends', () => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    const node = mountSplash()

    dismissBoot()
    node.dispatchEvent(new Event('transitionend'))

    // Gone without the timeout backstop having to fire.
    expect(document.getElementById('boot')).toBeNull()
  })

  it('is safe to call when there is no splash', () => {
    stubReducedMotion(false)
    // jsdom tests render App into a bare container, and StrictMode runs mount
    // effects twice. Neither may throw.
    expect(() => dismissBoot()).not.toThrow()
  })

  it('is idempotent — a second call does not restart the fade', () => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    const node = mountSplash()
    const listen = vi.spyOn(node, 'addEventListener')

    dismissBoot()
    dismissBoot()

    expect(listen).toHaveBeenCalledTimes(1)
  })
})
