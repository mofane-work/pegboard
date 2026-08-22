import { useTranslation } from 'react-i18next'
import { ACCESSORIES, isPlaceable } from '../data/catalog'
import { MAX_CUSTOM_PARTS, type CustomPart } from '../data/customParts'
import { PITCH_MM } from '../lib/grid'
import { useConfig } from '../state/store'
import { useDrag } from '../state/drag'

/**
 * Drag source for board accessories, plus an add/remove list for hardware and
 * bundles that belong in the cost total but cannot be placed on a board face,
 * plus the user's own custom placeholder bodies.
 */
export function Palette({
  onQuickPlace,
  onNewCustom,
  onEditCustom,
}: {
  onQuickPlace: (itemKey: string) => void
  onNewCustom: () => void
  onEditCustom: (part: CustomPart) => void
}) {
  const { t } = useTranslation()
  const language = useConfig((s) => s.language)
  const extras = useConfig((s) => s.extras)
  const setExtra = useConfig((s) => s.setExtra)
  const customParts = useConfig((s) => s.customParts)
  const startFromPalette = useDrag((s) => s.startFromPalette)

  const placeable = ACCESSORIES.filter(isPlaceable)
  const costOnly = ACCESSORIES.filter((item) => !item.placeable)

  return (
    <aside className="palette">
      <h2>{t('palette.title')}</h2>
      <p className="palette__hint">{t('palette.hint')}</p>

      <ul className="palette__list">
        {placeable.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              className="palette__item"
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
                onQuickPlace(item.key)
              }}
            >
              <span className="palette__name">{item.names[language]}</span>
              <span className="palette__dims">
                {item.dims.w}×{item.dims.h} mm
                {item.packQty > 1 && ` · ${item.packQty}×`}
              </span>
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
                onClick={() => setExtra(item.key, (extras[item.key] ?? 0) - 1)}
              >
                −
              </button>
              <output>{extras[item.key] ?? 0}</output>
              <button
                type="button"
                aria-label={t('palette.add')}
                onClick={() => setExtra(item.key, (extras[item.key] ?? 0) + 1)}
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
              className="palette__item"
              onPointerDown={(event) => {
                event.currentTarget.releasePointerCapture?.(event.pointerId)
                startFromPalette(part.key)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onQuickPlace(part.key)
              }}
            >
              <span className="palette__name">{part.name}</span>
              <span className="palette__dims">
                {part.cols * PITCH_MM}×{part.rows * PITCH_MM}×{part.depthMm} mm
              </span>
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
