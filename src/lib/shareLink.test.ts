import { describe, expect, it } from 'vitest'
import {
  buildShareUrl,
  decodeConfig,
  encodeConfig,
  readSharedConfig,
  type SharedConfig,
} from './shareLink'

function config(over: Partial<SharedConfig> = {}): SharedConfig {
  return {
    boards: [{ boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false }],
    market: 'us',
    currency: 'USD',
    placements: [
      { itemKey: 'hook-large', holeId: 'A:5,5', rotation: 0, boardIndex: 0 },
      { itemKey: 'shelf', holeId: 'B:3,2', rotation: 90, boardIndex: 0 },
    ],
    excluded: ['board-56x56-white'],
    overrides: { 'hook-large': 3.5 },
    extras: { 'connector-wall': 2 },
    ...over,
  }
}

describe('round trip', () => {
  it('survives encode then decode unchanged', () => {
    expect(decodeConfig(encodeConfig(config()))).toEqual(config())
  })

  it('handles a completely empty configuration', () => {
    const empty = config({ placements: [], excluded: [], overrides: {}, extras: {} })
    expect(decodeConfig(encodeConfig(empty))).toEqual(empty)
  })

  it('preserves every rotation', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const one = config({
        placements: [{ itemKey: 'clip', holeId: 'A:1,1', rotation, boardIndex: 0 }],
      })
      expect(decodeConfig(encodeConfig(one))?.placements[0].rotation).toBe(rotation)
    }
  })

  it('preserves fractional override prices', () => {
    const priced = config({ overrides: { 'hook-large': 3.5, shelf: 0 } })
    expect(decodeConfig(encodeConfig(priced))?.overrides).toEqual({ 'hook-large': 3.5, shelf: 0 })
  })

  it('carries a negative adjustment, which is how "I already own two" travels', () => {
    const owned = config({ extras: { 'hook-large': -2, 'connector-wall': 3 } })
    expect(decodeConfig(encodeConfig(owned))?.extras).toEqual({
      'hook-large': -2,
      'connector-wall': 3,
    })
  })

  it('stays a readable string rather than an opaque blob', () => {
    const encoded = encodeConfig(config())
    expect(encoded.startsWith('v3~')).toBe(true)
    expect(encoded).toContain('hook-large')
  })
})

describe('rejecting bad input', () => {
  // A shared link is untrusted: it arrives from outside the app entirely.
  const bad: Array<[string, string]> = [
    ['empty string', ''],
    ['no boards at all', 'v2~~us~USD~~~~'],
    ['placement on a board the link does not carry', 'v2~board-a~us~USD~A*1*1*shelf*0*3~~~'],
    // v1 links predate multi-board walls: recognised as foreign, not guessed at.
    ['superseded v1 link', 'v1~board-56x56-white~us~USD~~~~'],
    ['unknown future version', 'v9~board-56x56-white~us~USD~~~~'],
    ['too few sections', 'v2~board~us~USD'],
    ['too many sections', 'v2~b~us~USD~~~~~extra'],
    ['bad board key', 'v2~../etc/passwd~us~USD~~~~'],
    ['bad market', 'v2~board-a~<script>~USD~~~~'],
    ['bad currency', 'v2~board-a~us~DOLLARS!~~~~'],
    ['bad lattice letter', 'v2~board-a~us~USD~C*1*1*shelf*0*0~~~'],
    ['non-numeric column', 'v2~board-a~us~USD~A*x*1*shelf*0*0~~~'],
    ['illegal rotation', 'v2~board-a~us~USD~A*1*1*shelf*45*0~~~'],
    ['missing placement field', 'v2~board-a~us~USD~A*1*1*shelf*0~~~'],
    ['bad item key', 'v2~board-a~us~USD~A*1*1*Robert");DROP*0*0~~~'],
    ['negative override', 'v2~board-a~us~USD~~~shelf*-5~'],
    ['non-numeric override', 'v2~board-a~us~USD~~~shelf*abc~'],
    ['fractional extra quantity', 'v2~board-a~us~USD~~~~shelf*1.5'],
    // Extras went signed so a user can say they already own some; a negative
    // PRICE is still nonsense and must not have been relaxed along with it.
    ['negative override, still', 'v3~board-a~us~USD~~~shelf*-0.01~'],
    ['non-numeric extra', 'v2~board-a~us~USD~~~~shelf*abc'],
  ]

  for (const [name, input] of bad) {
    it(`rejects ${name}`, () => {
      expect(decodeConfig(input)).toBeNull()
    })
  }

  it('does not throw on adversarial input, it returns null', () => {
    expect(() => decodeConfig('~'.repeat(1000))).not.toThrow()
    expect(decodeConfig('~'.repeat(1000))).toBeNull()
  })
})

describe('walls', () => {
  it('carries every board on the wall', () => {
    const wall = config({
      boards: [
        { boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false },
        { boardKey: 'board-36x56-white', offsetX: 0, offsetY: 0, rotated: false },
      ],
      placements: [{ itemKey: 'shelf', holeId: 'A:1,1', rotation: 0, boardIndex: 1 }],
    })
    const decoded = decodeConfig(encodeConfig(wall))
    expect(decoded?.boards).toHaveLength(2)
    expect(decoded?.placements[0].boardIndex).toBe(1)
  })
})

describe('urls', () => {
  it('puts the configuration in the fragment, not the query', () => {
    const url = buildShareUrl(config(), 'https://example.com/skadis/')
    expect(url).toContain('#c=')
    expect(new URL(url).search).toBe('')
  })

  it('survives a full url round trip', () => {
    const url = buildShareUrl(config(), 'https://example.com/skadis/')
    expect(readSharedConfig(new URL(url).hash)).toEqual(config())
  })

  it('preserves the base path, so it works on a project Pages site', () => {
    const url = buildShareUrl(config(), 'https://user.github.io/pegboard/')
    expect(url.startsWith('https://user.github.io/pegboard/')).toBe(true)
  })

  it('returns null when there is no shared configuration in the hash', () => {
    expect(readSharedConfig('')).toBeNull()
    expect(readSharedConfig('#something=else')).toBeNull()
  })

  it('keeps the link short enough to paste into a chat message', () => {
    const many = config({
      placements: Array.from({ length: 25 }, (_, i) => ({
        itemKey: 'hook-large',
        holeId: `A:${i % 14},${i % 13}`,
        rotation: 0 as const,
        boardIndex: 0,
      })),
    })
    expect(buildShareUrl(many, 'https://example.com/').length).toBeLessThan(1200)
  })
})

describe('custom parts must never reach the encoder', () => {
  // The encoder writes itemKey raw, so a custom key would sail through it — but
  // the decoder rejects the WHOLE link on a key containing ':'. That is why
  // App.share() filters custom placements out rather than trusting this layer:
  // a leak would break sharing entirely, not merely drop one item (findings F23).
  it('breaks the entire link if a custom key ever gets encoded', () => {
    const leaked = encodeConfig(
      config({
        placements: [
          { itemKey: 'hook-large', holeId: 'A:5,5', rotation: 0, boardIndex: 0 },
          { itemKey: 'custom:abc1', holeId: 'A:2,2', rotation: 0, boardIndex: 0 },
        ],
      }),
    )
    expect(decodeConfig(leaked)).toBeNull()
  })

  it('round-trips cleanly once the custom placement is filtered out', () => {
    const filtered = config({
      placements: [{ itemKey: 'hook-large', holeId: 'A:5,5', rotation: 0, boardIndex: 0 }],
    })
    expect(decodeConfig(encodeConfig(filtered))).toEqual(filtered)
  })
})

describe('board orientation in a link', () => {
  const turned = config({
    boards: [
      { boardKey: 'board-36x56-white', offsetX: 0, offsetY: 0, rotated: true },
      { boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false },
    ],
  })

  it('survives a round trip', () => {
    expect(decodeConfig(encodeConfig(turned))).toEqual(turned)
  })

  it('marks only the turned board, and stays readable', () => {
    const boardsField = encodeConfig(turned).split('~')[1]
    expect(boardsField).toBe('board-36x56-white*r!board-56x56-white')
  })

  it('still reads a v2 link, which predates orientation, as upright', () => {
    const v2 = encodeConfig(config()).replace(/^v3~/, 'v2~')
    expect(decodeConfig(v2)?.boards).toEqual([
      { boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false },
    ])
  })

  it('rejects a board flag it does not recognise rather than guessing', () => {
    expect(decodeConfig(encodeConfig(turned).replace('*r', '*x'))).toBeNull()
    expect(decodeConfig(encodeConfig(turned).replace('*r', '*r*r'))).toBeNull()
  })
})
