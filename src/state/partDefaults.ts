/**
 * What the custom-part dialog reopens with — session-only, in memory, and
 * deliberately NOT in the config store.
 *
 * The request this exists for is a user modelling several bays of the same
 * 3D-printed rack: the second one should not make them retype the cells, the
 * depth and the peg numbers they just entered. So the dialog remembers its last
 * draft and seeds the next NEW part from it.
 *
 * Kept out of `useConfig` on the `drag.ts` principle: this is a convenience
 * about the form, not a fact about the user's wall. It is never persisted, never
 * migrated, never in a share link, and it dies with the page — which is exactly
 * the scope the user asked for.
 *
 * **The name and the lattice are deliberately absent.** Pre-filling a name
 * invites two parts called the same thing, which is worse than an empty field;
 * the lattice is a property of where a part hangs rather than of its size, and
 * carrying it over would silently pin a new part to B.
 */

import { SKADIS_PEGS, type PegSpec } from '../lib/grid'

/** Which half of the dialog's peg section is showing. */
export type PegMode = 'skadis' | 'custom'

/** The mm/inch selector — not a `CustomPart` field, but the same friction. */
export type Unit = 'mm' | 'in'

export interface PartDefaults {
  cols: number
  rows: number
  depthMm: number
  pegs: PegSpec
  pegMode: PegMode
  unit: Unit
}

/** A brand-new user's first part: two cells wide, 60 mm deep, SKÅDIS pegs. */
const SEED: PartDefaults = {
  cols: 2,
  rows: 1,
  depthMm: 60,
  pegs: SKADIS_PEGS,
  pegMode: 'skadis',
  unit: 'mm',
}

let current: PartDefaults = SEED

/** Copied on the way out so a dialog's draft cannot mutate what is remembered. */
export function partDefaults(): PartDefaults {
  return { ...current, pegs: { ...current.pegs } }
}

/** Called on every successful save, whether the part was added or edited. */
export function rememberPartDefaults(next: PartDefaults): void {
  current = { ...next, pegs: { ...next.pegs } }
}

/** Tests only. Module state outlives a test case; the store's reset does not. */
export function resetPartDefaults(): void {
  current = SEED
}
