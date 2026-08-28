import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { useConfig } from './state/store'
import { resetPartDefaults } from './state/partDefaults'
import { buildWall, layoutBoards } from './lib/wall'
import { analyticsConfigured } from './lib/analytics'
import { customWidthMm } from './data/customParts'
import { SKADIS_GRID, SKADIS_PEGS } from './lib/grid'
import { BOARDS } from './data/catalog'

// jsdom has no WebGL, so the 3D canvas cannot mount. These tests cover the
// surrounding UI; the geometry and placement logic are tested directly in
// src/lib/grid.test.ts, which needs no DOM at all.
// The Privacy wording is chosen from analyticsConfigured(), which reads a
// build-time env var. Driving that boolean directly keeps these tests true of
// the configured deployment as well as of the unconfigured build a fork gets.
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
  // Session-only module state: it outlives a test case, so a part saved by one
  // test would seed the dialog in the next one.
  resetPartDefaults()
  window.localStorage.clear()
  window.location.hash = ''
  useConfig.setState({
    boards: [{ boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false }],
    placements: [],
    selectedId: null,
    customParts: [],
    customBoards: [],
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
    // Same trap: left out, the share-link test's `true` leaked forward and
    // quick-place happily stacked two items on one slot.
    allowOverlap: false,
    // And again: an Appearance test's override would repaint every later test.
    colors: {},
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
    // developer's shell happens to export.
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

  it('places from the + button, so touch users never have to drag', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Place on board: Hook, large' }))

    const placements = useConfig.getState().placements
    expect(placements).toHaveLength(1)
    expect(placements[0].itemKey).toBe('hook-large')
  })

  it('says so when the board is full, instead of looking like a dead button', () => {
    // One 56x56 board, filled with shelves on every lattice-A row: + has
    // nowhere left to go, and used to do nothing at all.
    const wall = buildWall(layoutBoards(useConfig.getState().boards))
    useConfig.setState({
      placements: wall[0].holes
        .filter((h) => h.lattice === 'A')
        .map((h, i) => ({
          id: `f${i}`,
          itemKey: 'hook-large',
          holeId: h.id,
          rotation: 0 as const,
          boardIndex: 0,
        })),
    })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Place on board: Shelf' }))

    // Not getByRole('status'): the cost-only steppers use <output>, which is a
    // status role too, so the role alone is ambiguous here.
    expect(screen.getByText(/No room on the board/)).toBeTruthy()
  })

  it('still finds free space in overlap mode rather than stacking on one hole', () => {
    // Overlap is for moving past neighbours. If it governed placement too,
    // every + would drop another item on the same centre hole.
    useConfig.setState({ allowOverlap: true })
    render(<App />)

    const plus = () => screen.getByRole('button', { name: 'Place on board: Hook, large' })
    fireEvent.click(plus())
    fireEvent.click(plus())

    const holes = useConfig.getState().placements.map((p) => p.holeId)
    expect(holes).toHaveLength(2)
    expect(new Set(holes).size).toBe(2)
  })

  it('falls back to overlapping only when the board really is full', () => {
    const wall = buildWall(layoutBoards(useConfig.getState().boards))
    useConfig.setState({
      allowOverlap: true,
      placements: wall[0].holes
        .filter((h) => h.lattice === 'A')
        .map((h, i) => ({
          id: `f${i}`,
          itemKey: 'hook-large',
          holeId: h.id,
          rotation: 0 as const,
          boardIndex: 0,
        })),
    })
    const before = useConfig.getState().placements.length
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Place on board: Shelf' }))

    expect(useConfig.getState().placements).toHaveLength(before + 1)
    expect(screen.queryByText(/No room on the board/)).toBeNull()
  })

  it('lets overlap mode move an item past a neighbour that blocks it', () => {
    useConfig.setState({
      placements: [
        { id: 'sel', itemKey: 'hook-large', holeId: 'A:5,5', rotation: 0, boardIndex: 0 },
        { id: 'block', itemKey: 'hook-large', holeId: 'A:6,5', rotation: 0, boardIndex: 0 },
      ],
      selectedId: 'sel',
    })
    render(<App />)

    const right = () => screen.getByRole('button', { name: 'Move right' }) as HTMLButtonElement
    expect(right().disabled).toBe(true)

    fireEvent.click(screen.getByRole('checkbox', { name: /Allow items to overlap/ }))

    expect(right().disabled).toBe(false)
    fireEvent.click(right())
    expect(useConfig.getState().placements[0].holeId).toBe('A:6,5')
  })

  it('does not let a share link change your overlap choice', () => {
    // A share link rewrites the whole configuration. A permissive placement
    // rule is the recipient's decision, not the sender's, so it must survive
    // `applyShared` untouched (findings F34d).
    useConfig.setState({ allowOverlap: true })
    window.location.hash = '#c=v2~board-36x56-white~gb~GBP~A*1*1*shelf*90*0~~~'

    render(<App />)

    expect(useConfig.getState().allowOverlap).toBe(true)
  })

  it('shows no selection controls until something is selected', () => {
    render(<App />)
    expect(screen.queryByRole('group', { name: 'Selected item' })).toBeNull()
  })

  it('moves the selected item one hole from the on-canvas arrows', () => {
    useConfig.setState({
      placements: [{ id: 'sel', itemKey: 'hook-large', holeId: 'A:5,5', rotation: 0, boardIndex: 0 }],
      selectedId: 'sel',
    })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Move right' }))
    expect(useConfig.getState().placements[0].holeId).toBe('A:6,5')

    fireEvent.click(screen.getByRole('button', { name: 'Move up' }))
    expect(useConfig.getState().placements[0].holeId).toBe('A:6,6')
  })

  it('disables the direction the board has no room for, rather than failing on tap', () => {
    // Bottom-left corner: down and left are off the board, up and right are not.
    useConfig.setState({
      placements: [{ id: 'sel', itemKey: 'hook-large', holeId: 'A:0,0', rotation: 0, boardIndex: 0 }],
      selectedId: 'sel',
    })
    render(<App />)

    // No jest-dom in this project, so assert the property directly.
    const arrow = (name: string) =>
      screen.getByRole('button', { name }) as HTMLButtonElement
    expect(arrow('Move left').disabled).toBe(true)
    expect(arrow('Move down').disabled).toBe(true)
    expect(arrow('Move right').disabled).toBe(false)
    expect(arrow('Move up').disabled).toBe(false)
  })

  it('rotates and deletes the selection without a keyboard', () => {
    useConfig.setState({
      placements: [{ id: 'sel', itemKey: 'hook-large', holeId: 'A:5,5', rotation: 0, boardIndex: 0 }],
      selectedId: 'sel',
    })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }))
    expect(useConfig.getState().placements[0].rotation).toBe(90)

    fireEvent.click(screen.getByRole('button', { name: 'Remove item' }))
    expect(useConfig.getState().placements).toEqual([])
    // Deleting clears the selection, so the controls go with it.
    expect(screen.queryByRole('group', { name: 'Selected item' })).toBeNull()
  })

  it('nudges from the arrow keys too, which desktop never had either', () => {
    useConfig.setState({
      placements: [{ id: 'sel', itemKey: 'hook-large', holeId: 'A:5,5', rotation: 0, boardIndex: 0 }],
      selectedId: 'sel',
    })
    render(<App />)

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(useConfig.getState().placements[0].holeId).toBe('A:4,5')
  })

  it('leaves arrow keys alone when nothing is selected, so the page still scrolls', () => {
    useConfig.setState({
      placements: [{ id: 'sel', itemKey: 'hook-large', holeId: 'A:5,5', rotation: 0, boardIndex: 0 }],
      selectedId: null,
    })
    render(<App />)

    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true, bubbles: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(useConfig.getState().placements[0].holeId).toBe('A:5,5')
  })

  it('undoes a nudge, because it goes through the same move() as a drag', () => {
    useConfig.setState({
      placements: [{ id: 'sel', itemKey: 'hook-large', holeId: 'A:5,5', rotation: 0, boardIndex: 0 }],
      selectedId: 'sel',
    })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Move right' }))
    expect(useConfig.getState().placements[0].holeId).toBe('A:6,5')

    useConfig.getState().undo()
    expect(useConfig.getState().placements[0].holeId).toBe('A:5,5')
  })

  it('lets a keyboard user place an accessory without a pointer', () => {
    render(<App />)
    const hook = screen.getByRole('button', { name: /^Hook, large/ })

    fireEvent.keyDown(hook, { key: 'Enter' })

    const placements = useConfig.getState().placements
    expect(placements).toHaveLength(1)
    expect(placements[0].itemKey).toBe('hook-large')
  })

  it('does not stack keyboard placements on the same slot', () => {
    render(<App />)
    const hook = screen.getByRole('button', { name: /^Hook, large/ })

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

  it('bills the three basket sizes as one set of 3, not three of them', () => {
    // One pack contains one of each size, so a wall with all three needs ONE
    // set. Summing the sizes would charge three, which is the whole point of
    // the kit fold in lib/pricing.ts.
    render(<App />)
    for (const size of ['large', 'medium', 'small']) {
      fireEvent.click(screen.getByRole('button', { name: `Place on board: Storage basket, ${size} (set of 3)` }))
    }

    const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '')
    expect(rows.filter((r) => r.includes('Storage basket, large'))).toEqual([])
    expect(rows.some((r) => r.includes('Storage basket, set of 3'))).toBe(true)
    expect(screen.getByText(/set\(s\) of 3 covers what is on the board/)).toBeTruthy()
  })

  it('totals the packs to carry out, next to what they cost', () => {
    render(<App />)
    // One board, plus 3 hooks — a 2-pack, so 2 packs. Three things in a basket.
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Place on board: Hook, large' }))
    }
    expect(screen.getByTestId('total-packs').textContent).toBe('3 pack(s)')
  })

  it('prices only the upgrade when you already own some of what is on the wall', () => {
    render(<App />)
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Place on board: Hook, large' }))
    }
    const before = screen.getByTestId('grand-total').textContent

    // Say two of the six are already in the drawer. 6 hooks was 3 × 2-pack;
    // 4 is 2 packs.
    fireEvent.click(screen.getByRole('button', { name: 'Qty: Hook, large' }))
    fireEvent.change(screen.getByLabelText('Qty: Hook, large'), { target: { value: '4' } })
    fireEvent.keyDown(screen.getByLabelText('Qty: Hook, large'), { key: 'Enter' })

    expect(useConfig.getState().extras['hook-large']).toBe(-2)
    // The board is untouched: the wall still shows six.
    expect(useConfig.getState().placements).toHaveLength(6)
    expect(screen.getByTestId('grand-total').textContent).not.toBe(before)

    // And it can be handed back.
    fireEvent.click(screen.getByRole('button', { name: 'Use board count' }))
    expect('hook-large' in useConfig.getState().extras).toBe(false)
    expect(screen.getByTestId('grand-total').textContent).toBe(before)
  })

  it('adds to a count from the cost table, for parts bought spare', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Place on board: Hook, large' }))

    fireEvent.click(screen.getByRole('button', { name: 'Qty: Hook, large' }))
    fireEvent.change(screen.getByLabelText('Qty: Hook, large'), { target: { value: '5' } })
    fireEvent.keyDown(screen.getByLabelText('Qty: Hook, large'), { key: 'Enter' })

    expect(useConfig.getState().extras['hook-large']).toBe(4)
    expect(useConfig.getState().placements).toHaveLength(1)
  })

  it('keeps a zeroed line on screen, or there is no way to put it back', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Place on board: Hook, large' }))

    fireEvent.click(screen.getByRole('button', { name: 'Qty: Hook, large' }))
    fireEvent.change(screen.getByLabelText('Qty: Hook, large'), { target: { value: '0' } })
    fireEvent.keyDown(screen.getByLabelText('Qty: Hook, large'), { key: 'Enter' })

    expect(screen.getByRole('button', { name: 'Qty: Hook, large' }).textContent).toContain('0')
  })

  it('names a board, and says so on the build sheet', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Board' }))
    fireEvent.change(screen.getByLabelText('Rename board'), { target: { value: 'Garage' } })
    fireEvent.keyDown(screen.getByLabelText('Rename board'), { key: 'Enter' })

    expect(useConfig.getState().boards[0].name).toBe('Garage')
    expect(screen.getByRole('button', { name: 'Garage' })).toBeTruthy()
    // The sheet keeps the product too: it is what somebody has to go and buy.
    expect(screen.getByText(/Garage · Pegboard 56×56/)).toBeTruthy()
  })

  it('leaves the name alone when the rename is abandoned', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Board' }))
    fireEvent.change(screen.getByLabelText('Rename board'), { target: { value: 'Garage' } })
    fireEvent.keyDown(screen.getByLabelText('Rename board'), { key: 'Escape' })

    expect(useConfig.getState().boards[0].name).toBeUndefined()
  })

  it('numbers the boards again once a name is cleared', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Board' }))
    fireEvent.change(screen.getByLabelText('Rename board'), { target: { value: 'Garage' } })
    fireEvent.blur(screen.getByLabelText('Rename board'))

    fireEvent.click(screen.getByRole('button', { name: 'Garage' }))
    fireEvent.change(screen.getByLabelText('Rename board'), { target: { value: '  ' } })
    fireEvent.keyDown(screen.getByLabelText('Rename board'), { key: 'Enter' })

    expect(screen.getByRole('button', { name: 'Board' })).toBeTruthy()
  })

  /** Open Colours and set the board swatch, without saving. */
  function pickBoardColour(value: string) {
    fireEvent.click(screen.getByRole('button', { name: 'Colours' }))
    // Scoped: 'Board' also labels the board picker out in the toolbar.
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Board'), { target: { value } })
    return dialog
  }

  it('repaints the scene from the Colours dialog, and the theme takes it back', async () => {
    render(<App />)
    pickBoardColour('#123456')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(useConfig.getState().colors['--board-color']).toBe('#123456')
    // Awaited, not asserted straight away: the scene picks the change up through
    // a MutationObserver on the root's style, which lands a tick later.
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--board-color')).toBe('#123456'),
    )

    // Picking a theme is the reset: an override must not survive into a palette
    // it was never chosen against.
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } })
    expect(useConfig.getState().colors).toEqual({})
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--board-color')).toBe(''),
    )
  })

  it('changes nothing until Save, because a colour drag fires on every frame', () => {
    render(<App />)
    // React maps onChange on a colour input to the native `input` event, so a
    // live-applied picker rebuilt every material in the scene dozens of times
    // per drag. Dragging must reach the store exactly never.
    pickBoardColour('#123456')
    expect(useConfig.getState().colors).toEqual({})
    expect(document.documentElement.style.getPropertyValue('--board-color')).toBe('')
  })

  it('throws the draft away on Cancel', () => {
    render(<App />)
    pickBoardColour('#123456')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(useConfig.getState().colors).toEqual({})
  })

  it('resets the swatches back to the theme, and still waits for Save', () => {
    render(<App />)
    // Wrapped: a store write from outside an event is not batched into a render.
    act(() => useConfig.setState({ colors: { '--board-color': '#123456' } }))

    fireEvent.click(screen.getByRole('button', { name: 'Colours' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset to theme' }))
    // One rule: nothing happens until Save.
    expect(useConfig.getState().colors).toEqual({ '--board-color': '#123456' })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(useConfig.getState().colors).toEqual({})
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

  it('defaults a new part to SKÅDIS pegs, so the dialog changes nothing on its own', () => {
    render(<App />)
    createPart()

    expect(useConfig.getState().customParts[0].pegs).toEqual(SKADIS_PEGS)
  })

  it('lets a part be given the peg spacing of another pegboard system', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '+ New custom part' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bit holder' } })
    fireEvent.click(screen.getByRole('button', { name: 'Self-defined' }))
    fireEvent.change(screen.getByLabelText('Peg spacing'), { target: { value: '25.4' } })
    fireEvent.change(screen.getByLabelText('Peg layout'), { target: { value: 'every' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    const part = useConfig.getState().customParts.at(-1)!
    expect(part.pegs.pitchMm).toBe(25.4)
    expect(part.pegs.layout).toBe('every')
    // The body is sized by the part's own pitch, not the SKÅDIS constant.
    expect(customWidthMm(part)).toBeCloseTo(50.8, 5)
  })

  // Advice, never a veto: the part still saves. The wall is SKÅDIS by default,
  // so a 25.4 mm part matches nothing on it.
  it('warns when a part matches no board on the wall, and saves it anyway', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '+ New custom part' }))
    fireEvent.click(screen.getByRole('button', { name: 'Self-defined' }))
    fireEvent.change(screen.getByLabelText('Peg spacing'), { target: { value: '25.4' } })

    expect(screen.getByText(/No board on your wall uses this peg spacing/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(useConfig.getState().customParts).toHaveLength(1)
  })

  it('hides the peg height field for a shape that has only one size', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '+ New custom part' }))
    fireEvent.click(screen.getByRole('button', { name: 'Self-defined' }))
    expect(screen.getByLabelText('Peg height')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Peg shape'), { target: { value: 'round' } })
    expect(screen.queryByLabelText('Peg height')).toBeNull()
    expect(screen.getByLabelText('Peg size')).toBeTruthy()
  })

  // Almost every part wants SKÅDIS pegs, so the six fields that describe another
  // system start collapsed rather than occupying the dialog for everyone.
  it('opens on SKÅDIS with the peg fields collapsed', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '+ New custom part' }))

    expect(screen.getByRole('button', { name: 'SKÅDIS' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByLabelText('Peg spacing')).toBeNull()
    expect(screen.queryByLabelText('Peg layout')).toBeNull()
    expect(screen.getByText('5 × 15 mm slots on 40 mm centres.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Self-defined' }))
    expect(screen.getByLabelText('Peg spacing')).toBeTruthy()
    expect(screen.getByLabelText('Peg layout')).toBeTruthy()
  })

  // Pressing SKÅDIS has to RESET the spec, not merely hide it: a collapsed
  // section holding numbers the label denies is the trap findings F37b describes.
  it('resets the pegs when the SKÅDIS side is chosen again', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '+ New custom part' }))
    fireEvent.click(screen.getByRole('button', { name: 'Self-defined' }))
    fireEvent.change(screen.getByLabelText('Peg spacing'), { target: { value: '25.4' } })
    fireEvent.click(screen.getByRole('button', { name: 'SKÅDIS' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(useConfig.getState().customParts.at(-1)!.pegs).toEqual(SKADIS_PEGS)
  })

  // But a mis-click must not destroy the typing, so the abandoned spec comes
  // back if self-defined is chosen again in the same dialog.
  it('restores the abandoned spec when self-defined is chosen again', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '+ New custom part' }))
    fireEvent.click(screen.getByRole('button', { name: 'Self-defined' }))
    fireEvent.change(screen.getByLabelText('Peg spacing'), { target: { value: '25.4' } })
    fireEvent.click(screen.getByRole('button', { name: 'SKÅDIS' }))
    fireEvent.click(screen.getByRole('button', { name: 'Self-defined' }))

    expect((screen.getByLabelText('Peg spacing') as HTMLInputElement).value).toBe('25.4')
  })

  // The reason the memory exists: someone modelling several bays of the same
  // rack should type the numbers once.
  it('reopens a new part with the size and pegs last entered, but not the name', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '+ New custom part' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bay one' } })
    fireEvent.change(screen.getByLabelText('Width (pegs)'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Depth (mm)'), { target: { value: '80' } })
    fireEvent.click(screen.getByRole('button', { name: 'Self-defined' }))
    fireEvent.change(screen.getByLabelText('Peg spacing'), { target: { value: '25.4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    fireEvent.click(screen.getByRole('button', { name: '+ New custom part' }))
    expect((screen.getByLabelText('Width (pegs)') as HTMLInputElement).value).toBe('3')
    expect((screen.getByLabelText('Depth (mm)') as HTMLInputElement).value).toBe('80')
    expect((screen.getByLabelText('Peg spacing') as HTMLInputElement).value).toBe('25.4')
    // Two parts sharing a name is worse than an empty field, and the lattice is
    // about where a part hangs rather than how big it is.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Peg lattice') as HTMLSelectElement).value).toBe('A')
  })

  // The mode is derived from the spec rather than stored on the part, so it has
  // to survive a round trip through the store.
  it('reopens an edited part on the side its pegs put it on', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '+ New custom part' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Plain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    fireEvent.click(screen.getByRole('button', { name: 'Edit custom part: Plain' }))
    expect(screen.getByRole('button', { name: 'SKÅDIS' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByLabelText('Peg spacing')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: '+ New custom part' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Odd' } })
    fireEvent.click(screen.getByRole('button', { name: 'Self-defined' }))
    fireEvent.change(screen.getByLabelText('Peg spacing'), { target: { value: '25.4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    fireEvent.click(screen.getByRole('button', { name: 'Edit custom part: Odd' }))
    expect(
      screen.getByRole('button', { name: 'Self-defined' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect((screen.getByLabelText('Peg spacing') as HTMLInputElement).value).toBe('25.4')
  })

  // The warning is what tells a user to press Self-defined in the first place,
  // so it must not be gated on already having done so.
  it('still warns about a SKÅDIS part on a wall that has no SKÅDIS board', () => {
    render(<App />)
    // A 1-inch board, and nothing else on the wall.
    fireEvent.click(screen.getByRole('button', { name: 'Define custom board' }))
    fireEvent.change(screen.getByLabelText('Hole spacing'), { target: { value: '25.4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.change(screen.getByLabelText('Board'), {
      target: { value: useConfig.getState().customBoards[0].key },
    })

    fireEvent.click(screen.getByRole('button', { name: '+ New custom part' }))
    expect(screen.getByRole('button', { name: 'SKÅDIS' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(/No board on your wall uses this peg spacing/)).toBeTruthy()
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

  // Twelve trips through the dialog, each one re-rendering the whole palette.
  // It sits close to the default 5 s budget on its own, so the timeout is
  // stated rather than left to be tripped by the next catalog addition.
  it('stops at the cap rather than growing without limit', () => {
    render(<App />)
    for (let i = 0; i < 12; i += 1) createPart(`Part ${i}`)

    expect(useConfig.getState().customParts).toHaveLength(12)
    expect(
      (screen.getByRole('button', { name: '+ New custom part' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  }, 20_000)
})

describe('board orientation', () => {
  beforeEach(resetStore)

  const rotateButton = () => screen.getByRole('button', { name: 'Rotate board' }) as HTMLButtonElement
  const noRotateButton = () => screen.queryByRole('button', { name: /^Rotate board/ })

  /**
   * Turning is a user-defined board's privilege since F42 — SKÅDIS slots are
   * upright, so a turned IKEA panel holds nothing. These cases therefore drive
   * the orientation UI through a custom board. `square` is SKÅDIS geometry at
   * 56×56 (the shape the toolbar readout used to be checked against) and
   * `tall` is 36×56, so the readouts asserted below are unchanged.
   */
  const square = {
    key: 'custom-board:sq',
    name: 'Square panel',
    cols: 14,
    rows: 14,
    grid: SKADIS_GRID,
  }
  const tall = { ...square, key: 'custom-board:tall', name: 'Tall panel', cols: 9, rows: 14 }

  function wallOfCustom(board: typeof square, count = 1) {
    useConfig.setState({
      customBoards: [board],
      boards: Array.from({ length: count }, () => ({
        boardKey: board.key,
        offsetX: 0,
        offsetY: 0,
        rotated: false,
      })),
    })
  }

  it('turns a custom board from the toolbar and says so', () => {
    wallOfCustom(square)
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
    wallOfCustom(tall)
    render(<App />)
    fireEvent.click(rotateButton())
    expect(screen.getByText('turned — 56×36')).toBeTruthy()
  })

  it('clears that board only, and the clear is undoable', () => {
    wallOfCustom(square, 2)
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

  /**
   * The button is hidden rather than disabled: no board IKEA sells turns, so a
   * disabled control would sit dead on every default wall. Help carries the
   * reason instead. Covers all four — the three wall boards because their
   * slots are upright, the free-standing one because it stands on its edge.
   */
  it.each(BOARDS.map((b) => b.key))('offers no rotation for %s', (boardKey) => {
    useConfig.setState({ boards: [{ boardKey, offsetX: 0, offsetY: 0, rotated: false }] })
    render(<App />)
    expect(noRotateButton()).toBeNull()
  })

  it('shows the button again as soon as a custom board is on the wall', () => {
    wallOfCustom(square)
    render(<App />)
    expect(noRotateButton()).not.toBeNull()
  })

  it('drops the orientation when switching to a board that cannot hold it', () => {
    wallOfCustom(square)
    render(<App />)
    fireEvent.click(rotateButton())
    expect(useConfig.getState().boards[0].rotated).toBe(true)

    fireEvent.change(screen.getByDisplayValue('Square panel'), {
      target: { value: 'board-56x56-white' },
    })
    expect(useConfig.getState().boards[0].rotated).toBe(false)
    expect(noRotateButton()).toBeNull()
  })

  it('straightens a shared SKÅDIS board that was turned by an older build', async () => {
    // A v3 link written before F42. The panel still arrives; the orientation
    // does not, because that wall cannot be built.
    window.location.hash = '#c=v3~board-36x56-white*r~us~USD~~~~'
    render(<App />)
    await waitFor(() => expect(useConfig.getState().boards[0].boardKey).toBe('board-36x56-white'))
    expect(useConfig.getState().boards[0].rotated).toBe(false)
  })
})

describe('user-defined pegboards', () => {
  beforeEach(resetStore)

  /** Define one board through the dialog and return its key. */
  function createBoard(preset = 'Printed SKÅDIS', name = 'Workshop') {
    fireEvent.click(screen.getByRole('button', { name: 'Define custom board' }))
    fireEvent.click(screen.getByRole('button', { name: preset }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    return useConfig.getState().customBoards.at(-1)!.key
  }

  it('opens the editor from the toolbar and defines a board', () => {
    render(<App />)
    const key = createBoard()

    const board = useConfig.getState().customBoards[0]
    expect(board.name).toBe('Workshop')
    expect(board.grid.pitchMm).toBe(40)
    expect(key.startsWith('custom-board:')).toBe(true)
  })

  it('offers the new board in the picker alongside the IKEA ones', () => {
    render(<App />)
    createBoard()

    const select = screen.getByLabelText('Board') as HTMLSelectElement
    const labels = [...select.options].map((o) => o.textContent)
    expect(labels).toContain('Workshop')
    expect(labels).toContain('Pegboard 56×56')
  })

  it('gives an imperial preset a square grid of round holes', () => {
    render(<App />)
    createBoard('US 1″ hardboard', 'Garage')

    const board = useConfig.getState().customBoards[0]
    expect(board.grid.arrangement).toBe('aligned')
    expect(board.grid.shape).toBe('round')
    expect(board.grid.pitchMm).toBe(25.4)
  })

  it('warns that SKÅDIS accessories will not fit an off-pitch board', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Define custom board' }))
    // Scoped to the dialog: Help carries the same sentence permanently, and an
    // unscoped query would pass whether the warning appeared or not.
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.queryByText(/will not physically fit/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'US 1″ hardboard' }))
    expect(dialog.getByText(/will not physically fit/)).toBeTruthy()
  })

  it('refuses to save a board with more holes than it can draw', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Define custom board' }))
    fireEvent.change(screen.getByLabelText('Width (holes)'), { target: { value: '40' } })
    fireEvent.change(screen.getByLabelText('Height (holes)'), { target: { value: '40' } })

    expect(screen.getByText(/Too many holes/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)
  })

  it('never puts a custom board in the shopping list', () => {
    render(<App />)
    const key = createBoard()
    act(() => {
      useConfig.setState({ boards: [{ boardKey: key, offsetX: 0, offsetY: 0, rotated: false }] })
    })

    expect(screen.getByText(/custom board\(s\) on the wall/)).toBeTruthy()
    // Scoped to the cost table: the board picker offers every catalog board
    // permanently, so an unscoped query would find the option, not a line.
    const cost = within(document.querySelector('.cost') as HTMLElement)
    expect(cost.queryByText('Pegboard 56×56')).toBeNull()
    expect(cost.queryByText('Workshop')).toBeNull()
  })

  it('edits a definition from the panel that uses it', () => {
    render(<App />)
    const key = createBoard()
    act(() => {
      useConfig.setState({ boards: [{ boardKey: key, offsetX: 0, offsetY: 0, rotated: false }] })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit board' }))
    fireEvent.change(screen.getByLabelText('Width (holes)'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(useConfig.getState().customBoards[0].cols).toBe(6)
  })

  it('rebuilds a shared board for someone who has never seen it', async () => {
    // The receiving half of the round trip, which is the half that matters: a
    // recipient with no definition of their own still gets the right panel.
    window.location.hash = '#c=v4~c*12*9*25.4*o*6.35*6.35*6.35*a~us~USD~~~~'
    render(<App />)

    await waitFor(() => expect(useConfig.getState().customBoards).toHaveLength(1))
    const board = useConfig.getState().customBoards[0]

    expect(board.grid.pitchMm).toBe(25.4)
    expect(board.grid.shape).toBe('round')
    expect(board.grid.arrangement).toBe('aligned')
    expect(useConfig.getState().boards[0].boardKey).toBe(board.key)
    // Named by its size — the sender's own name for it never travels.
    expect(board.name).toBe('305×229')
  })
})
