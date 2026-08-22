import { afterEach, describe, expect, it, vi } from 'vitest'
import { supportUrl } from './support'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('supportUrl', () => {
  it('is empty until a page is configured, so no dead link can ship', () => {
    expect(supportUrl()).toBe('')
  })

  it('takes the build-time override, so the footer can be previewed', () => {
    vi.stubEnv('VITE_BMC_URL', 'https://buymeacoffee.com/example')
    expect(supportUrl()).toBe('https://buymeacoffee.com/example')
  })

  it.each([
    ['javascript:alert(1)', 'a script URL'],
    ['/somewhere', 'a relative path'],
    ['http://buymeacoffee.com/example', 'plain http'],
    ['', 'an empty override'],
  ])('rejects %s (%s)', (value) => {
    vi.stubEnv('VITE_BMC_URL', value)
    // Anything that is not an absolute https link renders nothing rather than
    // becoming an open redirect wearing a coffee cup.
    expect(supportUrl()).toBe('')
  })
})
