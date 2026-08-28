import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ACCESSORIES, isPlaceable } from '../data/catalog'
import { countBreakdown } from '../lib/counts'
import { MAX_CUSTOM_PARTS, type CustomPart } from '../data/customParts'
import { catalogWith } from '../data/customBoards'
import { PITCH_MM } from '../lib/grid'
import { useConfig } from '../state/store'
import { useDrag } from '../state/drag'

function itemClass(picked: boolean): string {
  return picked ? 'palette__item palette__item--picked' : 'palette__item'
}

/** How long "no room" stays up. Long enough to read, short enough to retry. */
const NO_ROOM_FEEDBACK_MS = 3500

/**
 * Drag source for board accessories, plus an add/remove list for hardware and
 * bundles that belong in the cost total but cannot be placed on a board face,
 * plus the user's own custom placeholder bodies.
 *
 * Every placeable row is BOTH a drag handle and a `+` button, because dragging
 * is not available on a phone. The stage sits above the palette when the layout
 * stacks, so a drag to the board is a vertical gesture — and vertical has to
 * belong to the page's scroll, or the list cannot be scrolled past at all
 * (findings F34a, F34b). `+` is the path that needs no gesture.
 */
export function Palette({
  onQuickPlace,
  onNewCustom,
  onEditCustom,
}: {
  /** Places at the middle of the wall. False when nothing fits. */
  onQuickPlace: (itemKey: string) => boolean
  onNewCustom: () => void
  onEditCustom: (part: CustomPart) => void
}) {
  const { t } = useTranslation()
  const language = useConfig((s) => s.language)
  const extras = useConfig((s) => s.extras)
  const setExtra = useConfig((s) => s.setExtra)
  const boards = useConfig((s) => s.boards)
  const customParts = useConfig((s) => s.customParts)
  const customBoards = useConfig((s) => s.customBoards)
  // Counting has to resolve a user-defined board, or a wall built on one would
  // disagree with the cost table about what is on it.
  const byKey = useMemo(
    () => catalogWith(customParts, customBoards),
    [customParts, customBoards],
  )
  const startFromPalette = useDrag((s) => s.startFromPalette)
  const draggingKey = useDrag((s) => s.itemKey)
  const selectedId = useConfig((s) => s.selectedId)
  const placements = useConfig((s) => s.placements)
  const allowOverlap = useConfig((s) => s.allowOverlap)
  const setAllowOverlap = useConfig((s) => s.setAllowOverlap)

  // A full board used to make `+` look like a dead button. Say so instead, and
  // point at the control that fixes it.
  const [noRoom, setNoRoom] = useState(false)
  const noRoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (noRoomTimer.current) clearTimeout(noRoomTimer.current)
  }, [])

  function quickPlace(itemKey: string) {
    if (onQuickPlace(itemKey)) {
      setNoRoom(false)
      return
    }
    setNoRoom(true)
    if (noRoomTimer.current) clearTimeout(noRoomTimer.current)
    noRoomTimer.current = setTimeout(() => setNoRoom(false), NO_ROOM_FEEDBACK_MS)
  }

  // Which row the pane is talking about: whatever is in hand, or failing that
  // whatever is selected on the board. Both are the same question — "which
  // component am I working with" — so they share one highlight.
  const pickedKey =
    draggingKey ?? placements.find((p) => p.id === selectedId)?.itemKey ?? null

  // The same numbers the cost table shows. `connector-board` is the reason this
  // cannot just read `extras`: the wall already needs some, so a stepper over
  // the raw adjustment would disagree with the line the user pays for.
  const { base, final } = useMemo(
    () => countBreakdown(boards, placements, extras, byKey),
    [boards, placements, extras, byKey],
  )

  function setCount(key: string, target: number) {
    setExtra(key, Math.max(0, target) - (base.get(key) ?? 0))
  }

  const placeable = ACCESSORIES.filter(isPlaceable)
  const costOnly = ACCESSORIES.filter((item) => !item.placeable)

  return (
    <aside className="palette">
      <h2>{t('palette.title')}</h2>
      <p className="palette__hint">{t('palette.hint')}</p>

      {/* Placement rules are explained here, so the switch that relaxes them
          belongs here too — and the toolbar's second row is the subject of F30
          and F31 and is not somewhere to add a control on a guess (F34e). */}
      <label className="palette__overlap">
        <input
          type="checkbox"
          checked={allowOverlap}
          onChange={(event) => setAllowOverlap(event.target.checked)}
        />
        <span>{t('palette.allowOverlap')}</span>
      </label>
      <p className="palette__hint">{t('palette.allowOverlapHint')}</p>

      {noRoom && (
        <p className="palette__no-room" role="status">
          {t('palette.noRoom')}
        </p>
      )}

      <ul className="palette__list">
        {placeable.map((item) => (
          <li key={item.key} className="palette__row">
            <button
              type="button"
              className={itemClass(item.key === pickedKey)}
              aria-current={item.key === pickedKey ? true : undefined}
              onPointerDown={(event) => {
                // Touch implicitly captures the pointer to this element; release
                // it so pointermove retargets to the canvas as the finger moves.
                event.currentTarget.releasePointerCapture?.(event.pointerId)
                startFromPalette(item.key)
              }}
              // Dragging is unreachable without a pointer, so keyboard users get
              // a direct placement at the middle of the board instead.
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                quickPlace(item.key)
              }}
            >
              <span className="palette__name">{item.names[language]}</span>
              <span className="palette__dims">
                {item.dims.w}×{item.dims.h} mm
                {item.packQty > 1 && ` · ${item.packQty}×`}
              </span>
            </button>
            {/* A sibling, not a child: `pointerdown` inside `.palette__item`
                starts a drag, so a nested button could never be tapped. */}
            <button
              type="button"
              className="palette__place"
              aria-label={`${t('palette.place')}: ${item.names[language]}`}
              title={t('palette.place')}
              onClick={() => quickPlace(item.key)}
            >
              +
            </button>
          </li>
        ))}
      </ul>

      <h3>{t('palette.costOnly')}</h3>
      <p className="palette__hint">{t('palette.costOnlyHint')}</p>
      <ul className="palette__list">
        {costOnly.map((item) => (
          <li key={item.key} className="palette__extra">
            <span className="palette__name">{item.names[language]}</span>
            <span className="palette__stepper">
              <button
                type="button"
                aria-label={t('palette.remove')}
                onClick={() => setCount(item.key, (final.get(item.key) ?? 0) - 1)}
              >
                −
              </button>
              <output>{final.get(item.key) ?? 0}</output>
              <button
                type="button"
                aria-label={t('palette.add')}
                onClick={() => setCount(item.key, (final.get(item.key) ?? 0) + 1)}
              >
                +
              </button>
            </span>
          </li>
        ))}
      </ul>

      <h3>{t('palette.custom')}</h3>
      <p className="palette__hint">{t('palette.customHint')}</p>
      <ul className="palette__list">
        {customParts.map((part) => (
          <li key={part.key} className="palette__custom-row">
            <button
              type="button"
              className={itemClass(part.key === pickedKey)}
              aria-current={part.key === pickedKey ? true : undefined}
              onPointerDown={(event) => {
                event.currentTarget.releasePointerCapture?.(event.pointerId)
                startFromPalette(part.key)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                quickPlace(part.key)
              }}
            >
              <span className="palette__name">{part.name}</span>
              <span className="palette__dims">
                {part.cols * PITCH_MM}×{part.rows * PITCH_MM}×{part.depthMm} mm
              </span>
            </button>
            <button
              type="button"
              className="palette__place"
              aria-label={`${t('palette.place')}: ${part.name}`}
              title={t('palette.place')}
              onClick={() => quickPlace(part.key)}
            >
              +
            </button>
            <button
              type="button"
              className="palette__custom-edit"
              aria-label={`${t('custom.editTitle')}: ${part.name}`}
              onClick={() => onEditCustom(part)}
            >
              {t('custom.edit')}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="palette__custom-add"
        onClick={onNewCustom}
        disabled={customParts.length >= MAX_CUSTOM_PARTS}
      >
        {t('palette.customAdd')}
      </button>
    </aside>
  )
}
