import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MAX_CELLS,
  MAX_DEPTH_MM,
  MAX_NAME_LENGTH,
  MIN_CELLS,
  MIN_DEPTH_MM,
  type CustomPart,
} from '../data/customParts'
import { PITCH_MM, type Lattice } from '../lib/grid'
import { useConfig } from '../state/store'

type Draft = Omit<CustomPart, 'key'>

const BLANK: Draft = { name: '', cols: 2, rows: 1, depthMm: 60, lattice: 'A' }

/**
 * Create or edit a user-defined placeholder body. Same native <dialog> pattern
 * as Help: focus trapping, Escape and the backdrop come from the platform.
 *
 * The caller mounts this only while it is open, so the draft is seeded once at
 * mount from `editing`. Editing one part then creating another therefore cannot
 * inherit the previous values, and no effect has to sync state to do it.
 */
export function CustomPartForm({
  editing,
  onClose,
}: {
  /** The part being edited, or null to create a new one. */
  editing: CustomPart | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDialogElement>(null)
  const addCustomPart = useConfig((s) => s.addCustomPart)
  const updateCustomPart = useConfig((s) => s.updateCustomPart)
  const removeCustomPart = useConfig((s) => s.removeCustomPart)
  const [draft, setDraft] = useState<Draft>(() =>
    editing
      ? {
          name: editing.name,
          cols: editing.cols,
          rows: editing.rows,
          depthMm: editing.depthMm,
          lattice: editing.lattice,
        }
      : BLANK,
  )

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  function submit() {
    if (editing) updateCustomPart(editing.key, draft)
    else addCustomPart(draft)
    onClose()
  }

  const widthMm = draft.cols * PITCH_MM
  const heightMm = draft.rows * PITCH_MM

  return (
    <dialog ref={ref} className="custom" onClose={onClose}>
      <form
        className="custom__body"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <h2>{t(editing ? 'custom.editTitle' : 'custom.newTitle')}</h2>
        <p className="custom__hint">{t('custom.hint')}</p>

        <label className="custom__field">
          <span>{t('custom.name')}</span>
          <input
            type="text"
            value={draft.name}
            maxLength={MAX_NAME_LENGTH}
            placeholder={t('custom.namePlaceholder')}
            autoFocus
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </label>

        <div className="custom__row">
          <label className="custom__field">
            <span>{t('custom.width')}</span>
            <input
              type="number"
              min={MIN_CELLS}
              max={MAX_CELLS}
              step={1}
              value={draft.cols}
              onChange={(e) => setDraft((d) => ({ ...d, cols: e.target.valueAsNumber }))}
            />
          </label>

          <label className="custom__field">
            <span>{t('custom.height')}</span>
            <input
              type="number"
              min={MIN_CELLS}
              max={MAX_CELLS}
              step={1}
              value={draft.rows}
              onChange={(e) => setDraft((d) => ({ ...d, rows: e.target.valueAsNumber }))}
            />
          </label>

          <label className="custom__field">
            <span>{t('custom.depth')}</span>
            <input
              type="number"
              min={MIN_DEPTH_MM}
              max={MAX_DEPTH_MM}
              step={5}
              value={draft.depthMm}
              onChange={(e) => setDraft((d) => ({ ...d, depthMm: e.target.valueAsNumber }))}
            />
          </label>
        </div>

        <label className="custom__field">
          <span>{t('custom.lattice')}</span>
          <select
            value={draft.lattice}
            onChange={(e) => setDraft((d) => ({ ...d, lattice: e.target.value as Lattice }))}
          >
            <option value="A">{t('custom.latticeA')}</option>
            <option value="B">{t('custom.latticeB')}</option>
          </select>
        </label>

        <p className="custom__preview">
          {t('custom.size', { width: widthMm, height: heightMm, depth: draft.depthMm })}
        </p>
        <p className="custom__preview">{t('custom.notCosted')}</p>

        <div className="custom__actions">
          {editing ? (
            <button
              type="button"
              className="custom__delete"
              onClick={() => {
                removeCustomPart(editing.key)
                onClose()
              }}
            >
              {t('custom.delete')}
            </button>
          ) : null}
          <button type="button" onClick={onClose}>
            {t('custom.cancel')}
          </button>
          <button type="submit" className="custom__save">
            {t('custom.save')}
          </button>
        </div>
      </form>
    </dialog>
  )
}
