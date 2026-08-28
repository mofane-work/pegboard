import { beforeEach, describe, expect, it } from 'vitest'
import { partDefaults, rememberPartDefaults, resetPartDefaults } from './partDefaults'
import { SKADIS_PEGS } from '../lib/grid'

describe('the part dialog’s session memory', () => {
  beforeEach(resetPartDefaults)

  it('starts a fresh session on SKÅDIS, so a first-time user sees no peg fields', () => {
    const d = partDefaults()
    expect(d.pegMode).toBe('skadis')
    expect(d.pegs).toEqual(SKADIS_PEGS)
    expect(d).toMatchObject({ cols: 2, rows: 1, depthMm: 60, unit: 'mm' })
  })

  it('hands back what was last saved', () => {
    rememberPartDefaults({
      cols: 4,
      rows: 3,
      depthMm: 120,
      pegs: { ...SKADIS_PEGS, pitchMm: 25.4, layout: 'corners' },
      pegMode: 'custom',
      unit: 'in',
    })

    expect(partDefaults()).toEqual({
      cols: 4,
      rows: 3,
      depthMm: 120,
      pegs: { ...SKADIS_PEGS, pitchMm: 25.4, layout: 'corners' },
      pegMode: 'custom',
      unit: 'in',
    })
  })

  // The dialog edits its draft in place; without a copy on the way in and out,
  // a half-typed number in an open form would rewrite what the next one starts
  // from — or worse, mutate SKADIS_PEGS itself.
  it('copies the peg spec in both directions', () => {
    const pegs = { ...SKADIS_PEGS, pitchMm: 30 }
    rememberPartDefaults({ cols: 2, rows: 1, depthMm: 60, pegs, pegMode: 'custom', unit: 'mm' })

    pegs.pitchMm = 99
    expect(partDefaults().pegs.pitchMm).toBe(30)

    const out = partDefaults()
    out.pegs.pitchMm = 77
    expect(partDefaults().pegs.pitchMm).toBe(30)
  })

  it('is reset back to the seed, which is what keeps tests independent', () => {
    rememberPartDefaults({
      cols: 8,
      rows: 8,
      depthMm: 400,
      pegs: { ...SKADIS_PEGS, pitchMm: 25.4 },
      pegMode: 'custom',
      unit: 'in',
    })
    resetPartDefaults()

    expect(partDefaults().pegMode).toBe('skadis')
    expect(partDefaults().cols).toBe(2)
  })
})
