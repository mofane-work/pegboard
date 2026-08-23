import { useTranslation } from 'react-i18next'
import type { CatalogItem } from '../data/catalog'
import { nudgePlacement, type NudgeDirection } from '../lib/nudge'
import type { WallBoard } from '../lib/wall'
import { useConfig } from '../state/store'

/**
 * The on-canvas controls for whatever is currently selected.
 *
 * WHY THIS EXISTS
 * Rotate was bound to `R` and delete to `Delete`/`Backspace`, and neither key
 * exists on a tablet. Moving an item meant a pointer drag, which on a small
 * screen means competing with the camera for the same gesture. So the three
 * verbs that already existed got buttons, and nudging — which had no keyboard
 * binding either — got written for the occasion (findings F33).
 *
 * WHY IT LIVES HERE AND NOT IN Scene.tsx
 * `App.test.tsx` mocks `Scene` wholesale, because jsdom has no WebGL. Anything
 * rendered inside it is invisible to the suite. Sitting in `App.tsx` beside
 * `.orbit-hint` instead means these controls are covered by the existing tests,
 * and `Scene.tsx` is not edited at all — so the drag and snapping paths carry
 * no risk from this feature (findings F33i).
 *
 * Tapping a button cannot deselect the item: R3F fires `onPointerMissed` only
 * for click-type events that hit nothing, and `<Canvas>` listens on its own
 * inner container, which this is not inside (findings F33f-resolved). Moving
 * this markup into the canvas — via drei's `Html`, say — would reintroduce that.
 */

/** Clockwise from the top, which is the order the arrows are drawn in. */
const ARROWS: ReadonlyArray<{ direction: NudgeDirection; label: string; glyph: string }> = [
  { direction: 'up', label: 'scene.moveUp', glyph: '▲' },
  { direction: 'left', label: 'scene.moveLeft', glyph: '◀' },
  { direction: 'down', label: 'scene.moveDown', glyph: '▼' },
  { direction: 'right', label: 'scene.moveRight', glyph: '▶' },
]

export function SelectionControls({
  wall,
  byKey,
}: {
  wall: WallBoard[]
  /** Catalog plus custom parts, so a user-defined part nudges like the rest. */
  byKey: ReadonlyMap<string, CatalogItem>
}) {
  const { t } = useTranslation()
  const selectedId = useConfig((s) => s.selectedId)
  const placements = useConfig((s) => s.placements)
  const move = useConfig((s) => s.move)
  const rotate = useConfig((s) => s.rotate)
  const remove = useConfig((s) => s.remove)
  const allowOverlap = useConfig((s) => s.allowOverlap)

  if (!selectedId) return null

  // Computed per render rather than on click, so a direction that cannot go
  // anywhere is visibly disabled. The board's edges and its occupied slots are
  // then something you can see instead of something you discover by tapping.
  const targets = ARROWS.map((arrow) => ({
    ...arrow,
    target: nudgePlacement(wall, placements, selectedId, arrow.direction, byKey, allowOverlap),
  }))

  return (
    <div className="selection-controls" role="group" aria-label={t('scene.controls')}>
      <div className="selection-controls__verbs">
        <button
          type="button"
          className="selection-controls__button"
          aria-label={t('scene.rotate')}
          title={t('scene.rotate')}
          onClick={() => rotate(selectedId)}
        >
          ⟳
        </button>
        <button
          type="button"
          className="selection-controls__button selection-controls__button--danger"
          aria-label={t('scene.remove')}
          title={t('scene.remove')}
          onClick={() => remove(selectedId)}
        >
          ✕
        </button>
      </div>

      <div className="selection-controls__pad">
        {targets.map(({ direction, label, glyph, target }) => (
          <button
            key={direction}
            type="button"
            className={`selection-controls__button selection-controls__arrow selection-controls__arrow--${direction}`}
            aria-label={t(label)}
            title={t(label)}
            disabled={target === null}
            onClick={() => {
              if (target) move(selectedId, target.holeId, target.rotation, target.boardIndex)
            }}
          >
            {glyph}
          </button>
        ))}
      </div>
    </div>
  )
}
