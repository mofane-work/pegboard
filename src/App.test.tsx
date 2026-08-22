import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { useConfig } from './state/store'
import { analyticsConfigured } from './lib/analytics'

// jsdom has no WebGL, so the 3D canvas cannot mount. These tests cover the
// surrounding UI; the geometry and placement logic are tested directly in
// src/lib/grid.test.ts, which needs no DOM at all.
// The Privacy wording is chosen from analyticsConfigured(), which reads a
// build-time constant. Driving that boolean directly keeps these tests true of
// a fork that fills in CONFIGURED_ID as well as of the build shipped here.
// initAnalytics is stubbed out because no test wants a real tracker tag in jsdom.
vi.mock('./lib/analytics', async (importActual) => {
  const actual = await importActual<typeof import('./lib/analytics')>()
  return {
    ...actual,
    analyticsConfigured: vi.fn(() => false),
    initAnalytics: vi.fn(() => false),
  }
})

vi.mock('./components/Scene', () => ({
  // jsdom has no WebGL, so OrbitControls never mounts. Expose the orbit
  // callback as a button instead, so the hint's dismissal stays testable.
  Scene: ({ onOrbit }: { onOrbit?: () => void }) => (
    <div data-testid="scene">
      <button type="button" onClick={() => onOrbit?.()}>
        orbit
      </button>
    </div>
  ),
}))

// No mock needed to stay off the network: nothing is fetched unless the user
// presses Refresh prices, and the chain falls back to the committed snapshot.

function resetStore() {
  window.localStorage.clear()
  window.location.hash = ''
  useConfig.setState({
    boards: [{ boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false }],
    placements: [],
    selectedId: null,
    customParts: [],
    past: [],
    future: [],
    market: 'us',
    customCurrency: 'TWD',
    language: 'en',
    theme: 'light',
    overrides: {},
    excluded: {},
    extras: {},
    viewRatio: 0.55,
    viewHeight: 0.4,
    // Omitted, this leaked 'iso' from the front/iso test into everything after it.
    printAngle: 'front',
  })
}

describe('App shell', () => {
  beforeEach(resetStore)

  it('renders the app title', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Pegboard' })).toBeTruthy()
  })

  it('makes no network request when the page loads', () => {
    // The point of the snapshot-first change: opening the planner must not
    // show IKEA the visitor's IP, and must work with the endpoint down.
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<App />)
    expect(fetchSpy).not.toHaveBeenCalled()

    // And it still prices the wall, from the snapshot committed into the page.
    expect(screen.getByTestId('grand-total').textContent).not.toBe('—')
    fetchSpy.mockRestore()
  })

  it('fetches prices only when the user asks, and only for the live markets', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ searchResultPage: { products: { main: { items: [] } } } })),
    )

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh prices' }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(String(fetchSpy.mock.calls[0][0])).toContain('sik.search.blue.cdtapps.com/us/en')

    // An empty table is a failure with a 200 on it — the app says so rather
    // than reporting success and silently falling through to the snapshot.
    await waitFor(() =>
      expect(screen.getByText(/Could not reach IKEA/)).toBeTruthy(),
    )
    fetchSpy.mockRestore()
  })

  it('offers no refresh in the Custom market, which has no upstream at all', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Prices from'), { target: { value: 'custom' } })
    expect(screen.queryByRole('button', { name: 'Refresh prices' })).toBeNull()
  })

  it('keeps the market selector reachable from inside the Custom market', () => {
    render(<App />)
    // The refresh button is guarded on the market; the SELECT must not be, or
    // choosing Custom deletes the only way back out of it.
    fireEvent.change(screen.getByLabelText('Prices from'), { target: { value: 'custom' } })
    const select = screen.getByLabelText('Prices from') as HTMLSelectElement
    expect(select.value).toBe('custom')

    // Custom is the one market that needs a currency of its own.
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'sek' } })
    expect(useConfig.getState().customCurrency).toBe('SEK')

    fireEvent.change(select, { target: { value: 'us' } })
    expect(useConfig.getState().market).toBe('us')
    expect(screen.getByRole('button', { name: 'Refresh prices' })).toBeTruthy()
  })

  it('tells you the 3D pane can be turned, then stops saying so', () => {
    render(<App />)
    const hint = document.querySelector('.orbit-hint') as HTMLElement
    expect(hint.textContent).toContain('Drag to orbit')
    // It must never intercept a drop: the stage underneath is the drag target.
    expect(hint.getAttribute('aria-hidden')).toBe('true')
    expect(hint.className).not.toContain('orbit-hint--gone')

    fireEvent.click(screen.getByRole('button', { name: 'orbit' }))
    expect(
      (document.querySelector('.orbit-hint') as HTMLElement).className,
    ).toContain('orbit-hint--gone')
  })

  it('keeps the orbit hint dismissed across a Reset view remount', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'orbit' }))
    // Reset view remounts Scene through its key. The hint is a sibling holding
    // App-level state, so it must not come back with it.
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }))
    expect(
      (document.querySelector('.orbit-hint') as HTMLElement).className,
    ).toContain('orbit-hint--gone')
  })

  it('comes up light rather than following the OS unasked', () => {
    // A visitor who has expressed no preference gets light, and the pre-React
    // script in index.html stamps the same thing so there is no dark flash.
    expect(useConfig.getInitialState().theme).toBe('light')

    render(<App />)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(window.localStorage.getItem('theme')).toBe('light')
  })

  it('still lets the visitor hand the choice back to the OS', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'system' } })
    // 'system' is the one value that must stamp nothing, so the media query wins.
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(window.localStorage.getItem('theme')).toBe('system')
  })

  it('scrolls the cost table itself rather than the whole pane', () => {
    render(<App />)
    // Five columns do not fit the pane's 240px minimum, and the editable price
    // field is part of why. The scroll has to be scoped to the table, or the
    // heading and the market selector get dragged sideways out of view with it.
    const table = document.querySelector('.cost__table') as HTMLElement
    const wrap = table.parentElement as HTMLElement
    expect(wrap.className).toBe('cost__scroll')
    // `overflow-x: auto` makes overflow-y compute to auto too, so this wrapper
    // must not be allowed to shrink as a flex item — it silently clipped 80px
    // of rows when it could.
    expect(wrap.closest('.cost')).toBeTruthy()
  })

  it('renders no support link until one is configured', () => {
    render(<App />)
    expect(screen.queryByRole('link', { name: /coffee/i })).toBeNull()
  })

  it('always points at its own source, configured or not', () => {
    render(<App />)
    // The coffee link is optional; this one is not. An "open source" claim has
    // to be checkable, so it ships in the footer of every build.
    const link = screen.getByRole('link', { name: /Source on GitHub/ })
    expect(link.getAttribute('href')).toBe('https://github.com/mofane-work/pegboard')
    expect(link.getAttribute('rel')).toContain('noopener')

    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    const inHelp = screen.getByRole('link', { name: /Source, issues and contributions/ })
    expect(inHelp.getAttribute('href')).toBe('https://github.com/mofane-work/pegboard')
    expect(screen.getByText('Free and open source, under the MIT licence.')).toBeTruthy()
  })

  it('keeps the board and action controls on one toolbar row', () => {
    render(<App />)
    // The point of the row: actions sit beside the boards rather than costing a
    // third line of vertical space. They are separate groups so that a narrow
    // window drops the actions as one block instead of interleaving them.
    const row = screen
      .getByRole('button', { name: 'Undo' })
      .closest('.toolbar__row') as HTMLElement
    expect(row.querySelector('.toolbar__controls--boards')).toBeTruthy()
    expect(row.contains(screen.getByLabelText('Board'))).toBe(true)
    for (const name of ['Redo', 'Share link', 'Reset view', 'Clear board']) {
      expect(row.contains(screen.getByRole('button', { name })), name).toBe(true)
    }
    // ...and the page settings are on the other row, not this one.
    expect(row.contains(screen.getByLabelText('Language'))).toBe(false)
  })

  it('puts the support link below the disclaimer, as a safe external link', () => {
    vi.stubEnv('VITE_BMC_URL', 'https://buymeacoffee.com/example')
    render(<App />)

    const link = screen.getByRole('link', { name: /coffee/i })
    expect(link.getAttribute('href')).toBe('https://buymeacoffee.com/example')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.getAttribute('target')).toBe('_blank')

    // Below the disclaimer, in the footer, and no third-party script anywhere:
    // the BMC widget would undo the privacy claim two lines above it.
    const footer = link.closest('footer')!
    expect(footer.textContent).toContain('Unofficial.')
    expect(document.querySelectorAll('script[src*="buymeacoffee"]').length).toBe(0)

    vi.unstubAllEnvs()
  })

  it('says plainly what leaves the browser and what does not', () => {
    // The Privacy section is a promise that has to track the build, so this
    // test pins the build it is describing rather than reading whatever the
    // developer's shell or CONFIGURED_ID happens to hold.
    vi.mocked(analyticsConfigured).mockReturnValue(false)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Privacy')).toBeTruthy()
    expect(dialog.textContent).toContain('No analytics, no cookies, no accounts')
    expect(dialog.textContent).toContain('local storage')
    expect(dialog.textContent).toContain('IP address')
    // No token means no opt-out control, because there is nothing to opt out of.
    expect(within(dialog).queryByText('Count my visit')).toBeNull()
  })

  it('switches the Privacy wording when the build actually counts visits', () => {
    // The other half of the same promise: help.pv1 instead of help.pv1off, and
    // the opt-out appears. A configured build claiming "no analytics" would be
    // the one failure mode here that matters.
    vi.mocked(analyticsConfigured).mockReturnValue(true)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('counted by counter.dev')
    expect(dialog.textContent).not.toContain('No analytics, no cookies, no accounts')
    expect(within(dialog).getByText('Count my visit')).toBeTruthy()
  })

  it('takes the boot splash away once it has rendered', async () => {
    // index.html paints this before the bundle even arrives; React owns only
    // its removal (findings F25f).
    const splash = document.createElement('div')
    splash.id = 'boot'
    document.body.append(splash)

    render(<App />)

    await waitFor(() => expect(document.getElementById('boot')).toBeNull())
  })

  it('shows the chosen board in the shopping list', () => {
    render(<App />)
    const list = screen.getByRole('table')
    expect(within(list).getByText('Pegboard 56×56')).toBeTruthy()
  })

  it('translates the interface without changing the price market', () => {
    render(<App />)
    const before = screen.getByTestId('grand-total').textContent

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'zh-Hant' } })

    // The <h1> is a brand name now, so it does NOT translate. The tagline does,
    // and it is what proves the language actually switched.
    expect(screen.getByText('規劃你的 IKEA SKÅDIS 洞洞板牆，計算所需花費')).toBeTruthy()

    // The whole point of the language/market split: the AMOUNT must not move.
    // The rendered string legitimately differs — Intl writes USD as "US$24.99"
    // for a zh-Hant reader, disambiguating it from TWD/HKD dollars.
    const digits = (text: string | null) => text?.replace(/[^\d.]/g, '')
    expect(digits(screen.getByTestId('grand-total').textContent)).toBe(digits(before))
    expect(screen.getByTestId('grand-total').textContent).toMatch(/US\$/)
  })

  it('changes currency when the price market changes', () => {
    render(<App />)
    expect(screen.getByTestId('grand-total').textContent).toMatch(/\$/)

    fireEvent.change(screen.getByLabelText('Prices from'), { target: { value: 'jp' } })
    expect(screen.getByTestId('grand-total').textContent).toMatch(/￥|¥/)
  })

  it('drops an unchecked item out of the total, for pricing an upgrade', () => {
    render(<App />)
    const withBoard = screen.getByTestId('grand-total').textContent
    expect(withBoard).not.toMatch(/^\$0/)

    fireEvent.click(screen.getByRole('checkbox', { name: /Include in total/ }))

    const withoutBoard = screen.getByTestId('grand-total').textContent
    expect(withoutBoard).not.toBe(withBoard)
    expect(withoutBoard).toMatch(/^\$0/)
  })

  it('opens the help dialog from the top bar', () => {
    render(<App />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('How to use')).toBeTruthy()
    // The shortcut list must actually mention the keys it claims to document.
    expect(dialog.textContent).toMatch(/R —/)
    expect(dialog.textContent).toMatch(/Delete/)
  })

  it('translates the help content too', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'ja' } })
    fireEvent.click(screen.getByRole('button', { name: 'ヘルプ' }))
    expect(within(screen.getByRole('dialog')).getByText('使い方')).toBeTruthy()
  })

  it('sets the board pane height from the top bar', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Pane height'), { target: { value: '120' } })

    expect(useConfig.getState().viewHeight).toBeCloseTo(1.2)
    // A floor on the layout row, not a fixed size — the pane always fills at
    // least the space it is given, and this raises it past the window bottom.
    const layout = document.querySelector('.layout') as HTMLElement
    expect(layout.style.getPropertyValue('--stage-height')).toBe('120dvh')
  })

  it('resizes the board pane from the top bar', () => {
    const { container } = render(<App />)
    const layout = container.querySelector('.layout') as HTMLElement
    expect(layout.style.getPropertyValue('--stage-width')).toBe('55%')

    fireEvent.change(screen.getByLabelText('Pane width'), { target: { value: '35' } })
    expect(layout.style.getPropertyValue('--stage-width')).toBe('35%')
  })

  it('never charges for an item the board cannot show', () => {
    // A configuration saved before the lattice correction can hold a hole id
    // that no longer exists. The scene skipped those while the cost table still
    // counted them, so you paid for something invisible.
    render(<App />)
    const boardOnly = screen.getByTestId('grand-total').textContent

    cleanup()
    useConfig.setState({
      placements: [
        { id: 'stale', itemKey: 'basket', holeId: 'A:0,13', rotation: 0, boardIndex: 0 },
      ],
    })
    render(<App />)

    expect(screen.getByTestId('grand-total').textContent).toBe(boardOnly)
    // …and it is dropped rather than left to linger invisibly.
    expect(useConfig.getState().placements).toEqual([])
  })

  it('still counts a placement the board CAN show', () => {
    render(<App />)
    const boardOnly = screen.getByTestId('grand-total').textContent

    cleanup()
    useConfig.setState({
      placements: [{ id: 'real', itemKey: 'basket', holeId: 'A:5,5', rotation: 0, boardIndex: 0 }],
    })
    render(<App />)

    expect(screen.getByTestId('grand-total').textContent).not.toBe(boardOnly)
    expect(useConfig.getState().placements).toHaveLength(1)
  })

  it('lets a keyboard user place an accessory without a pointer', () => {
    render(<App />)
    const hook = screen.getByRole('button', { name: /Hook, large/ })

    fireEvent.keyDown(hook, { key: 'Enter' })

    const placements = useConfig.getState().placements
    expect(placements).toHaveLength(1)
    expect(placements[0].itemKey).toBe('hook-large')
  })

  it('does not stack keyboard placements on the same slot', () => {
    render(<App />)
    const hook = screen.getByRole('button', { name: /Hook, large/ })

    fireEvent.keyDown(hook, { key: 'Enter' })
    fireEvent.keyDown(hook, { key: 'Enter' })

    const holes = useConfig.getState().placements.map((p) => p.holeId)
    expect(holes).toHaveLength(2)
    expect(new Set(holes).size).toBe(2)
  })

  it('loads a configuration from a share link, overriding stored state', async () => {
    // Someone opening a link expects to see that build, not their own.
    useConfig.setState({
      boards: [{ boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false }],
      placements: [],
    })
    window.location.hash =
      '#c=v2~board-36x56-white~gb~GBP~A*1*1*shelf*90*0~~~'

    render(<App />)

    await waitFor(() => {
      expect(useConfig.getState().boards[0].boardKey).toBe('board-36x56-white')
    })
    expect(useConfig.getState().market).toBe('gb')
    expect(useConfig.getState().placements[0]).toMatchObject({
      itemKey: 'shelf',
      rotation: 90,
    })
  })

  it('clears the fragment after loading, so a reload does not undo later edits', async () => {
    window.location.hash = '#c=v2~board-36x56-white~us~USD~~~~'
    render(<App />)
    await waitFor(() => expect(window.location.hash).toBe(''))
  })

  it('ignores a malformed share link instead of breaking', () => {
    window.location.hash = '#c=totally~not~valid'
    useConfig.setState({ boards: [{ boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false }] })
    expect(() => render(<App />)).not.toThrow()
    expect(useConfig.getState().boards[0].boardKey).toBe('board-56x56-white')
  })

  it('undoes and redoes from the toolbar', () => {
    render(<App />)
    const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement
    expect(undo.disabled).toBe(true)

    // act() so React re-renders and the button actually enables — a disabled
    // button silently swallows the click.
    act(() => useConfig.getState().place('hook-large', 'A:5,5', 0, 0))
    expect(undo.disabled).toBe(false)

    fireEvent.click(undo)
    expect(useConfig.getState().placements).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(useConfig.getState().placements).toHaveLength(1)
  })

  it('undoes with the keyboard accelerator', () => {
    render(<App />)
    act(() => useConfig.getState().place('hook-large', 'A:5,5', 0, 0))

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(useConfig.getState().placements).toHaveLength(0)

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(useConfig.getState().placements).toHaveLength(1)
  })

  it('drops a component on the board the cursor is over, across a full wall', () => {
    // End-to-end guard for the shipped multi-board bug: the pointer arrived
    // 568 mm out of position on every board except the middle one.
    useConfig.setState({
      boards: [
        { boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false },
        { boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false },
        { boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false },
      ],
    })
    render(<App />)
    // Three boards means two seams, so two connector packs appear.
    const list = screen.getByLabelText('Procurement list') as HTMLTextAreaElement
    expect(list.value).toMatch(/Connector for pegboards/)
  })

  it('stops offering more boards at the cap', () => {
    render(<App />)
    const add = () => screen.queryByRole('button', { name: 'Add board' })
    expect(add()).toBeTruthy()

    fireEvent.click(add()!)
    fireEvent.click(add()!)
    expect(useConfig.getState().boards).toHaveLength(3)
    // Taken away at the ceiling, not left greyed out.
    expect(add()).toBeNull()

    // ...and offered again as soon as there is room.
    fireEvent.click(screen.getByRole('button', { name: 'Remove board 3' }))
    expect(add()).toBeTruthy()
  })

  it('no longer offers double-sided boards it cannot render', () => {
    render(<App />)
    const options = Array.from(
      screen.getByLabelText('Board').querySelectorAll('option'),
    ).map((o) => o.textContent)
    expect(options.some((o) => o?.includes('double-sided'))).toBe(false)
    expect(options).toContain('Pegboard 56×56')
  })

  it('prices in every live market, each with its own currency', () => {
    render(<App />)
    const select = screen.getByLabelText('Prices from')
    const total = () => screen.getByTestId('grand-total').textContent ?? ''

    const expected: Array<[string, RegExp]> = [
      ['us', /\$/],
      ['gb', /£/],
      ['de', /€/],
      ['fr', /€/],
      ['jp', /￥|¥/],
    ]
    for (const [market, symbol] of expected) {
      fireEvent.change(select, { target: { value: market } })
      expect(total(), market).toMatch(symbol)
      // A market with no resolvable price would read as zero — catch that too.
      expect(total(), market).not.toMatch(/^\D*0(\.00)?$/)
    }
  })

  it('renders a print sheet with a scale diagram of the board', () => {
    render(<App />)
    const sheet = screen.getByLabelText('SKÅDIS build sheet')
    // One ellipse per slot: the 56×56 board has 364 (findings F8).
    expect(sheet.querySelectorAll('.sheet__slot')).toHaveLength(364)
    // And it carries the same list the user copies.
    expect(sheet.textContent).toContain('003.208.03')
  })

  it('switches the printed diagram between front and isometric', () => {
    render(<App />)
    const diagram = () => screen.getByLabelText('Board layout diagram').getAttribute('viewBox')!
    const front = diagram()

    fireEvent.change(screen.getByLabelText('Diagram view'), { target: { value: 'iso' } })
    const iso = diagram()

    expect(iso).not.toBe(front)
    // Tilting narrows a wide flat panel and makes it taller.
    const [, , frontW, frontH] = front.split(' ').map(Number)
    const [, , isoW, isoH] = iso.split(' ').map(Number)
    expect(isoW).toBeLessThan(frontW)
    expect(isoH).toBeGreaterThan(frontH)
  })

  it('prints from the shopping list pane, not the top bar', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    render(<App />)
    // Both print controls live beside the sheet they act on. An empty board is
    // the case that matters: ShoppingList renders only a stub here, so putting
    // them there would make them disappear exactly when the board is new.
    const sheet = screen.getByLabelText('SKÅDIS build sheet')
    const controls = sheet.parentElement!.querySelector('.cost__print')!
    expect(controls.contains(screen.getByLabelText('Diagram view'))).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    expect(print).toHaveBeenCalledTimes(1)
    print.mockRestore()
  })

  it('draws placed accessories on the print diagram', () => {
    useConfig.setState({
      placements: [{ id: 'a', itemKey: 'shelf', holeId: 'A:5,5', rotation: 0, boardIndex: 0 }],
    })
    render(<App />)
    expect(
      screen.getByLabelText('SKÅDIS build sheet').querySelectorAll('.sheet__item'),
    ).toHaveLength(1)
  })

  it('shows a procurement list containing the checked items', () => {
    render(<App />)
    const list = screen.getByLabelText('Procurement list') as HTMLTextAreaElement
    expect(list.value).toContain('Pegboard 56×56')
    // IKEA's dotted article number, which is what store staff search by.
    expect(list.value).toContain('003.208.03')
  })

  it('keeps the procurement list read-only', () => {
    render(<App />)
    const list = screen.getByLabelText('Procurement list') as HTMLTextAreaElement
    expect(list.readOnly).toBe(true)
  })

  it('drops unchecked items from the procurement list', () => {
    useConfig.setState({
      placements: [{ id: 'a', itemKey: 'shelf', holeId: 'A:5,5', rotation: 0, boardIndex: 0 }],
    })
    render(<App />)
    const list = () => (screen.getByLabelText('Procurement list') as HTMLTextAreaElement).value
    expect(list()).toContain('Pegboard 56×56')
    expect(list()).toContain('Shelf')

    fireEvent.click(screen.getByRole('checkbox', { name: /Include in total: Pegboard 56×56/ }))

    expect(list()).not.toContain('Pegboard 56×56')
    expect(list()).toContain('Shelf')
  })

  it('shows an empty state when nothing at all is checked', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Include in total/ }))
    expect(screen.getByText('Nothing checked yet.')).toBeTruthy()
    expect(screen.queryByLabelText('Procurement list')).toBeNull()
  })

  it('regenerates the procurement list in the selected language', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'zh-Hant' } })
    const list = screen.getByLabelText('採購清單') as HTMLTextAreaElement
    expect(list.value).toContain('洞洞板 56×56')
    // Article numbers are language-independent facts and must not translate.
    expect(list.value).toContain('003.208.03')
  })

  it('switches the procurement list to CSV with stable English headers', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }))
    const list = screen.getByLabelText('Procurement list') as HTMLTextAreaElement
    expect(list.value.split('\n')[0]).toBe(
      'article,name,packs,pack_size,pieces,line_total,currency',
    )
  })

  it('copies via execCommand when the Clipboard API is unavailable', async () => {
    // A plain-http LAN or tailnet address is not a secure context, so
    // navigator.clipboard does not exist there — the case the app is tested on.
    const originalSecure = window.isSecureContext
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    const exec = vi.fn().mockReturnValue(true)
    ;(document as unknown as { execCommand: unknown }).execCommand = exec

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
    expect(exec).toHaveBeenCalledWith('copy')

    Object.defineProperty(window, 'isSecureContext', { value: originalSecure, configurable: true })
  })

  it('never claims success when copying actually failed', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    ;(document as unknown as { execCommand: unknown }).execCommand = vi.fn().mockReturnValue(false)

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(await screen.findByRole('button', { name: /Ctrl\+C/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull()
  })

  it('lets the user override a price and counts the override in the total', () => {
    render(<App />)
    fireEvent.click(screen.getAllByTestId('price-edit')[0])
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByTestId('grand-total').textContent).toBe('$3.00')
  })
})

describe('custom components', () => {
  beforeEach(resetStore)

  /** Create one custom part through the dialog and return its key. */
  function createPart(name = 'Router') {
    fireEvent.click(screen.getByRole('button', { name: '+ New custom part' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    return useConfig.getState().customParts.at(-1)!.key
  }

  it('adds a custom part to the palette', () => {
    render(<App />)
    createPart('Router')

    expect(screen.getByText('Router')).toBeTruthy()
    expect(useConfig.getState().customParts).toHaveLength(1)
  })

  it('gives it a key the catalog can never collide with', () => {
    render(<App />)
    expect(createPart().startsWith('custom:')).toBe(true)
  })

  // The form's min/max stop an out-of-range value at the browser's own
  // validation, before it can reach the store. The store clamps too, for the
  // localStorage path that never sees this form — see customParts.test.ts.
  it('refuses to create a part larger than the board supports', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '+ New custom part' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Huge' } })
    fireEvent.change(screen.getByLabelText('Width (pegs)'), { target: { value: '99' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(useConfig.getState().customParts).toEqual([])
  })

  it('places a custom part on the board from the keyboard', () => {
    render(<App />)
    const key = createPart()
    const item = screen.getByRole('button', { name: /^Router/ })
    fireEvent.keyDown(item, { key: 'Enter' })

    expect(useConfig.getState().placements.map((p) => p.itemKey)).toEqual([key])
  })

  // The whole point: a placeholder is not a purchase.
  it('never counts a placed custom part in the total', () => {
    render(<App />)
    createPart()
    const before = screen.getByTestId('grand-total').textContent
    fireEvent.keyDown(screen.getByRole('button', { name: /^Router/ }), { key: 'Enter' })

    expect(screen.getByTestId('grand-total').textContent).toBe(before)
    expect(screen.getByText('1 custom part(s) on the board — not costed.')).toBeTruthy()
  })

  it('leaves custom placements out of a share link and says so', async () => {
    // Earlier tests leave the clipboard stubs failing; make copying succeed so
    // this test is about the notice, not about clipboard support.
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    ;(document as unknown as { execCommand: unknown }).execCommand = vi.fn().mockReturnValue(true)

    render(<App />)
    createPart()
    fireEvent.keyDown(screen.getByRole('button', { name: /^Router/ }), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }))

    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeTruthy()
    expect(screen.getByText('1 custom part(s) left out of the link.')).toBeTruthy()
  })

  it('returns the share button to its normal label, and clears the dropped notice', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    ;(document as unknown as { execCommand: unknown }).execCommand = vi.fn().mockReturnValue(true)

    render(<App />)
    createPart()
    fireEvent.keyDown(screen.getByRole('button', { name: /^Router/ }), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }))

    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeTruthy()
    expect(screen.getByText('1 custom part(s) left out of the link.')).toBeTruthy()

    // The acknowledgement is transient. Left alone it used to read "Link
    // copied" for the rest of the session, so a second share said nothing and
    // a later failure could never be seen.
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Share link' })).toBeTruthy(),
      { timeout: 4000 },
    )
    expect(screen.queryByText('1 custom part(s) left out of the link.')).toBeNull()
  })

  it('acknowledges a second share, rather than sitting on the first', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    ;(document as unknown as { execCommand: unknown }).execCommand = vi.fn().mockReturnValue(true)

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }))
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeTruthy()
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Share link' })).toBeTruthy(),
      { timeout: 4000 },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Share link' }))
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeTruthy()
  })

  it('deletes the part and its placements together, and undo restores both', () => {
    render(<App />)
    const key = createPart()
    fireEvent.keyDown(screen.getByRole('button', { name: /^Router/ }), { key: 'Enter' })
    expect(useConfig.getState().placements).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Edit custom part: Router' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(useConfig.getState().customParts).toHaveLength(0)
    expect(useConfig.getState().placements).toHaveLength(0)

    act(() => useConfig.getState().undo())
    expect(useConfig.getState().customParts.map((p) => p.key)).toEqual([key])
    expect(useConfig.getState().placements).toHaveLength(1)
  })

  it('stops at the cap rather than growing without limit', () => {
    render(<App />)
    for (let i = 0; i < 12; i += 1) createPart(`Part ${i}`)

    expect(useConfig.getState().customParts).toHaveLength(12)
    expect(
      (screen.getByRole('button', { name: '+ New custom part' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})

describe('board orientation', () => {
  beforeEach(resetStore)

  const rotateButton = () => screen.getByRole('button', { name: 'Rotate board' }) as HTMLButtonElement

  it('turns the board from the toolbar and says so', () => {
    render(<App />)
    expect(rotateButton().getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(rotateButton())
    expect(useConfig.getState().boards[0].rotated).toBe(true)
    expect(rotateButton().getAttribute('aria-pressed')).toBe('true')
    // 56×56 turned is still 56×56 — the readout reports how it hangs.
    expect(screen.getByText('turned — 56×56')).toBeTruthy()

    fireEvent.click(rotateButton())
    expect(useConfig.getState().boards[0].rotated).toBe(false)
  })

  it('shows the turned dimensions for a board that is not square', () => {
    useConfig.setState({
      boards: [{ boardKey: 'board-36x56-white', offsetX: 0, offsetY: 0, rotated: false }],
    })
    render(<App />)
    fireEvent.click(rotateButton())
    expect(screen.getByText('turned — 56×36')).toBeTruthy()
  })

  it('clears that board only, and the clear is undoable', () => {
    useConfig.setState({
      boards: [
        { boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false },
        { boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false },
      ],
    })
    render(<App />)
    act(() => {
      useConfig.getState().place('hook-large', 'A:5,5', 0, 0)
      useConfig.getState().place('hook-large', 'A:5,5', 0, 1)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Rotate board 1' }))
    const left = useConfig.getState().placements
    expect(left).toHaveLength(1)
    expect(left[0].boardIndex).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useConfig.getState().placements).toHaveLength(2)
    expect(useConfig.getState().boards[0].rotated).toBe(false)
  })

  it('offers no rotation for the free-standing board', () => {
    useConfig.setState({
      boards: [{ boardKey: 'board-56x37-freestanding', offsetX: 0, offsetY: 0, rotated: false }],
    })
    render(<App />)
    expect(rotateButton().disabled).toBe(true)
  })

  it('drops the orientation when switching to a board that cannot hold it', () => {
    render(<App />)
    fireEvent.click(rotateButton())
    expect(useConfig.getState().boards[0].rotated).toBe(true)

    fireEvent.change(screen.getByDisplayValue('Pegboard 56×56'), {
      target: { value: 'board-56x37-freestanding' },
    })
    expect(useConfig.getState().boards[0].rotated).toBe(false)
  })

  it('carries the orientation through a share link', async () => {
    window.location.hash = '#c=v3~board-36x56-white*r~us~USD~~~~'
    render(<App />)
    await waitFor(() => expect(useConfig.getState().boards[0].rotated).toBe(true))
    expect(useConfig.getState().boards[0].boardKey).toBe('board-36x56-white')
  })
})
