import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Toolbar } from './components/Toolbar'
import { Palette } from './components/Palette'
import { CostTable } from './components/CostTable'
import { Help } from './components/Help'
import { CustomPartForm } from './components/CustomPartForm'
import { Appearance } from './components/Appearance'
import { Scene } from './components/Scene'
import { SelectionControls } from './components/SelectionControls'
import { isPlaceable } from './data/catalog'
import { catalogWithCustom, isCustomKey, type CustomPart } from './data/customParts'
import { unresolvablePlacementIds } from './lib/placements'
import { nudgePlacement, type NudgeDirection } from './lib/nudge'
import { buildWall, layoutBoards, occupiedRects, snapOnWall, wallSize } from './lib/wall'
import { copyText } from './lib/clipboard'
import { buildShareUrl, readSharedConfig } from './lib/shareLink'
import { useConfig } from './state/store'
import { useDrag } from './state/drag'
import { applyColors, applyTheme } from './lib/theme'
import { dismissBoot } from './lib/boot'
import { initAnalytics } from './lib/analytics'
import { REPO_URL, supportUrl } from './data/support'
import './styles/app.css'

/**
 * How long the Share button acknowledges a copy before going back to its
 * normal label. Long enough to read, short enough that the next click gets
 * fresh feedback rather than a button already stuck on "Link copied".
 */
const SHARE_FEEDBACK_MS = 2500

/** Arrow keys to nudge directions. Board space has +y up, so ArrowUp is `up`. */
const ARROW_KEYS: Record<string, NudgeDirection | undefined> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

function App() {
  const { t, i18n } = useTranslation()
  const boards = useConfig((s) => s.boards)
  const language = useConfig((s) => s.language)
  const theme = useConfig((s) => s.theme)
  const colors = useConfig((s) => s.colors)
  const selectedId = useConfig((s) => s.selectedId)
  const remove = useConfig((s) => s.remove)
  const rotate = useConfig((s) => s.rotate)
  const move = useConfig((s) => s.move)
  const allowOverlap = useConfig((s) => s.allowOverlap)
  const place = useConfig((s) => s.place)
  const placements = useConfig((s) => s.placements)
  const customParts = useConfig((s) => s.customParts)
  const pruneUnresolvable = useConfig((s) => s.pruneUnresolvable)
  const applyShared = useConfig((s) => s.applyShared)
  const undo = useConfig((s) => s.undo)
  const redo = useConfig((s) => s.redo)
  const endDrag = useDrag((s) => s.end)
  const rotateDrag = useDrag((s) => s.rotate)
  const draggingKey = useDrag((s) => s.itemKey)

  const viewRatio = useConfig((s) => s.viewRatio)
  const viewHeight = useConfig((s) => s.viewHeight)
  const [viewNonce, setViewNonce] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [shareDropped, setShareDropped] = useState(0)
  // Bumped on every share attempt. Without it, sharing twice in a row leaves
  // `shareState` on 'copied' unchanged, the effect below never re-runs, and the
  // second click inherits the first click's already-expiring timer.
  const [shareNonce, setShareNonce] = useState(0)
  const [customOpen, setCustomOpen] = useState(false)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [editingCustom, setEditingCustom] = useState<CustomPart | null>(null)
  // The 3D pane looks like a picture until you try it. Show a hint until the
  // camera actually moves, then take it away for the rest of the session. It is
  // deliberately NOT a store field: a cosmetic, session-scoped flag is not worth
  // a persisted version bump, and it must not travel in a share link.
  const [orbited, setOrbited] = useState(false)

  // Empty until a page is configured, and then it never changes.
  const support = useMemo(() => supportUrl(), [])

  // The catalog as this user sees it: real SKÅDIS plus their own placeholders.
  const byKey = useMemo(() => catalogWithCustom(customParts), [customParts])

  // The splash in index.html has been on screen since the first byte. React is
  // running now, so take it away.
  useEffect(dismissBoot, [])

  // The only third-party request this app makes on load, and only when a
  // counter.dev token is configured AND the visitor has not opted out. Both
  // gates live in initAnalytics; it returns a boolean, so it cannot be passed
  // to useEffect directly — React would mistake the result for a cleanup
  // function. See findings F27 for why this exception exists at all.
  useEffect(() => {
    initAnalytics()
  }, [])

  // A shared link wins over whatever was in localStorage: someone who opened a
  // link expects to see that configuration, not their own previous one. Run
  // once, and drop the fragment so a later reload does not re-apply it over
  // edits the user has since made.
  useEffect(() => {
    const shared = readSharedConfig(window.location.hash)
    if (!shared) return
    applyShared(shared)
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [applyShared])

  useEffect(() => {
    void i18n.changeLanguage(language)
    document.documentElement.lang = language
  }, [language, i18n])

  useEffect(() => {
    applyTheme(theme)
    // On 'system' the resolved colours move with the OS, and the browser-chrome
    // tint applyTheme sets has to move with them.
    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => applyTheme('system')
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [theme])

  // The user's own colours go on as inline custom properties, above whatever
  // the theme defined. Ordered after the theme effect on purpose: applyTheme
  // swaps the whole palette, and these sit on top of the result.
  useEffect(() => {
    applyColors(colors)
  }, [colors])

  // The Share button's label is a transient acknowledgement, not a mode. Left
  // alone it read "Link copied" for the rest of the session, so a second share
  // gave no feedback at all and a failure could never be seen after a success.
  useEffect(() => {
    if (shareState === 'idle') return
    const timer = window.setTimeout(() => {
      setShareState('idle')
      setShareDropped(0)
    }, SHARE_FEEDBACK_MS)
    return () => window.clearTimeout(timer)
  }, [shareState, shareNonce])

  // A saved configuration can outlive the board it was made on — a lattice
  // change can strand a placement on a hole that no longer exists. Drop those
  // here rather than inside the 3D view, so it happens even if the canvas
  // never mounts and an invisible item can never reach the total.
  useEffect(() => {
    pruneUnresolvable(
      unresolvablePlacementIds(placements, buildWall(layoutBoards(boards)), byKey),
    )
  }, [boards, placements, byKey, pruneUnresolvable])

  // A drag that ends anywhere other than the board must not leave a stuck ghost.
  useEffect(() => {
    const onUp = () => endDrag()
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [endDrag])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Not every event target is an Element — a keypress with nothing focused
      // targets the document, which has no tagName and no closest().
      const target = event.target instanceof Element ? event.target : null
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return
      // A focused <button> inside a dialog would otherwise swallow R as "rotate".
      if (target?.closest('dialog')) return
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault()
        remove(selectedId)
      }
      const accel = event.metaKey || event.ctrlKey
      if (accel && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (accel && (event.key === 'y' || event.key === 'Y')) {
        event.preventDefault()
        redo()
        return
      }
      if (event.key === '?') {
        event.preventDefault()
        setHelpOpen(true)
      }
      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault()
        // Rotate whatever is in hand; otherwise rotate the current selection.
        if (draggingKey) rotateDrag()
        else if (selectedId) rotate(selectedId)
      }
      // The same nudge the on-canvas arrows use. Desktop had no way to move an
      // item except a drag either, so this is not only a touch feature.
      const direction = ARROW_KEYS[event.key]
      if (direction && selectedId) {
        // Claimed unconditionally: an arrow with something selected must never
        // also scroll the page out from under the board.
        event.preventDefault()
        const state = useConfig.getState()
        const target = nudgePlacement(
          buildWall(layoutBoards(state.boards)),
          state.placements,
          selectedId,
          direction,
          catalogWithCustom(state.customParts),
          state.allowOverlap,
        )
        if (target) move(selectedId, target.holeId, target.rotation, target.boardIndex)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, remove, rotate, rotateDrag, draggingKey, undo, redo, move])

  const wall = buildWall(layoutBoards(boards))

  async function share() {
    const state = useConfig.getState()
    // Custom parts are local-only, so their placements never travel. This
    // filter is not cosmetic: `encodeConfig` writes itemKey raw, but the
    // decoder rejects the WHOLE link on a key containing ':' — a leaked custom
    // key would break sharing entirely rather than dropping one item (F23).
    const shareable = state.placements.filter((p) => !isCustomKey(p.itemKey))
    setShareDropped(state.placements.length - shareable.length)
    setShareNonce((n) => n + 1)

    const url = buildShareUrl(
      {
        boards: state.boards,
        market: state.market,
        currency: state.market === 'custom' ? state.customCurrency : 'USD',
        placements: shareable.map(({ itemKey, holeId, rotation, boardIndex }) => ({
          itemKey,
          holeId,
          rotation,
          boardIndex,
        })),
        excluded: Object.keys(state.excluded),
        overrides: state.overrides,
        extras: state.extras,
      },
      window.location.href,
    )
    setShareState((await copyText(url)) ? 'copied' : 'failed')
  }

  /**
   * Place without dragging: drop the item at the middle of the board, sliding
   * to the nearest free slot. Same snapping the pointer uses, so the two paths
   * cannot disagree about what is a legal position.
   *
   * Reached from the palette's + button and from Enter/Space on a palette item.
   * On a phone it is the *only* way in: the stage sits above the palette there,
   * so dragging to the board is a vertical gesture and vertical belongs to the
   * page's scroll (findings F34b).
   *
   * @returns whether anything was placed, so a full board can say so instead of
   *          looking like a dead button.
   */
  function quickPlace(itemKey: string): boolean {
    const item = byKey.get(itemKey)
    if (!item || !isPlaceable(item)) return false

    const size = wallSize(boards)
    const centreX = size.widthMm / 2
    const centreY = size.heightMm / 2

    // Free space first, EVEN IN OVERLAP MODE. Overlap exists so a placed item
    // can be moved past its neighbours; if it also governed placement, every
    // press of + would drop another item on the same centre hole and they would
    // stack invisibly. Prefer a free slot, and only fall back to overlapping
    // when the board genuinely has none.
    const free = snapOnWall(
      wall,
      item.pattern,
      centreX,
      centreY,
      occupiedRects(wall, placements),
    )
    const snap =
      free?.result.ok || !allowOverlap
        ? free
        : snapOnWall(wall, item.pattern, centreX, centreY, [])

    if (!snap?.result.ok) return false
    place(itemKey, snap.result.anchor.id, 0, snap.boardIndex)
    return true
  }

  return (
    <div
      className="layout"
      // Rounded: 0.55 * 100 is 55.00000000000001, which lands in the CSS.
      style={
        {
          '--stage-width': `${Math.round(viewRatio * 100)}%`,
          '--stage-height': `${Math.round(viewHeight * 100)}dvh`,
        } as React.CSSProperties
      }
    >
      <Toolbar
        onResetView={() => setViewNonce((n) => n + 1)}
        onOpenHelp={() => setHelpOpen(true)}
        onOpenAppearance={() => setAppearanceOpen(true)}
        onShare={() => void share()}
        shareState={shareState}
        shareDropped={shareDropped}
      />

      <main className="layout__main">
        <Palette
          onQuickPlace={quickPlace}
          onNewCustom={() => {
            setEditingCustom(null)
            setCustomOpen(true)
          }}
          onEditCustom={(part) => {
            setEditingCustom(part)
            setCustomOpen(true)
          }}
        />
        <div className="layout__stage">
          <Scene
            // Orientation is part of the identity: turning a panel changes the
            // wall's extent, so the camera needs re-framing just as a size
            // change does.
            key={`${boards.map((b) => `${b.boardKey}${b.rotated ? 'r' : ''}`).join('+')}-${viewNonce}`}
            wall={wall}
            byKey={byKey}
            onOrbit={() => setOrbited(true)}
          />
          {/* A sibling of Scene, not a child, and deliberately without the key:
              Reset view remounts the canvas, and the hint must not come back.
              Kept mounted and faded rather than unmounted, so there is a
              transition to see. Help already says this for screen readers. */}
          <SelectionControls wall={wall} byKey={byKey} />
          <p
            className={orbited ? 'orbit-hint orbit-hint--gone' : 'orbit-hint'}
            aria-hidden="true"
          >
            <span className="orbit-hint__glyph">⟲</span> {t('scene.orbitHint')}
          </p>
        </div>
        <CostTable onPrint={() => window.print()} />
      </main>

      <footer className="layout__footer">
        <p className="layout__disclaimer">{t('disclaimer')}</p>
        {/* Always present, unlike the coffee link: the project is open source
            whether or not anyone has configured a way to be paid for it. */}
        <p className="layout__links">
          <a
            className="layout__support-link"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('support.source')}
          </a>
          {support && (
            <a
              className="layout__support-link"
              href={support}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('support.bmc')}
            </a>
          )}
        </p>
      </footer>

      <Help open={helpOpen} onClose={() => setHelpOpen(false)} />
      {customOpen && (
        <CustomPartForm editing={editingCustom} onClose={() => setCustomOpen(false)} />
      )}
      {appearanceOpen && <Appearance onClose={() => setAppearanceOpen(false)} />}
    </div>
  )
}

export default App
