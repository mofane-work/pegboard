import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BOARD_PRESETS,
  MAX_CELLS,
  MAX_HOLES,
  MAX_NAME_LENGTH,
  MAX_PITCH_MM,
  MAX_THICKNESS_MM,
  MIN_CELLS,
  MIN_HOLE_MM,
  MIN_PITCH_MM,
  MIN_THICKNESS_MM,
  SKADIS_PITCH_MM,
  type CustomBoard,
} from '../data/customBoards'
import { holeCount, type Arrangement, type HoleGrid, type HoleShape } from '../lib/grid'
import { useConfig } from '../state/store'

type Draft = Omit<CustomBoard, 'key'>
type Unit = 'mm' | 'in'

const MM_PER_INCH = 25.4

const BLANK: Draft = {
  name: '',
  cols: 14,
  rows: 14,
  grid: {
    pitchMm: SKADIS_PITCH_MM,
    arrangement: 'staggered',
    shape: 'slot-v',
    holeWidthMm: 5,
    holeHeightMm: 15,
    thicknessMm: 5,
  },
}

/** Millimetres in, display units out. Three decimals is exact for a quarter inch. */
function show(mm: number, unit: Unit): number {
  if (!Number.isFinite(mm)) return mm
  return unit === 'in' ? Math.round((mm / MM_PER_INCH) * 1000) / 1000 : mm
}

/** Display units in, millimetres out. Everything is stored in mm. */
function store(value: number, unit: Unit): number {
  if (!Number.isFinite(value)) return value
  return unit === 'in' ? Math.round(value * MM_PER_INCH * 100) / 100 : value
}

const SHAPES: Array<{ value: HoleShape; label: string }> = [
  { value: 'slot-v', label: 'board.shapeSlotV' },
  { value: 'slot-h', label: 'board.shapeSlotH' },
  { value: 'round', label: 'board.shapeRound' },
  { value: 'square', label: 'board.shapeSquare' },
]

/**
 * Define a pegboard that is not a SKÅDIS panel — a self-printed clone, a sheet
 * of imperial hardboard, a metal slotted panel.
 *
 * Two patterns, merged. The <dialog> and the once-at-mount draft are
 * `CustomPartForm`'s; **nothing is applied until Save** is `Appearance`'s, and
 * matters more here than it does for a colour: every keystroke would otherwise
 * re-punch and re-triangulate up to twelve hundred holes.
 *
 * Sizes are in whole peg cells rather than millimetres. That is what keeps the
 * edge margin at exactly half a pitch on all four edges, and it makes the hole
 * budget legible — the count moves by a row at a time, not by a rounding.
 */
export function CustomBoardForm({
  editing,
  onClose,
}: {
  /** The board being edited, or null to create a new one. */
  editing: CustomBoard | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDialogElement>(null)
  const addCustomBoard = useConfig((s) => s.addCustomBoard)
  const updateCustomBoard = useConfig((s) => s.updateCustomBoard)
  const removeCustomBoard = useConfig((s) => s.removeCustomBoard)

  const [draft, setDraft] = useState<Draft>(() =>
    editing ? { name: editing.name, cols: editing.cols, rows: editing.rows, grid: editing.grid } : BLANK,
  )
  const [unit, setUnit] = useState<Unit>('mm')

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  const setGrid = (patch: Partial<HoleGrid>) =>
    setDraft((d) => ({ ...d, grid: { ...d.grid, ...patch } }))

  const widthMm = draft.cols * draft.grid.pitchMm
  const heightMm = draft.rows * draft.grid.pitchMm
  const holes = useMemo(() => {
    if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm)) return 0
    return holeCount({ widthMm, heightMm, grid: draft.grid })
  }, [widthMm, heightMm, draft.grid])

  const overCap = holes > MAX_HOLES
  const slotted = draft.grid.shape === 'slot-v' || draft.grid.shape === 'slot-h'
  // Peg offsets are lattice steps, so an accessory snaps to any pitch — it just
  // will not physically hang there. Say so rather than silently allowing it.
  const offPitch = draft.grid.pitchMm !== SKADIS_PITCH_MM

  function submit() {
    if (overCap) return
    if (editing) updateCustomBoard(editing.key, draft)
    else addCustomBoard(draft)
    onClose()
  }

  /** A millimetre field, entered and displayed in whatever unit is selected. */
  const lengthField = (
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (mm: number) => void,
  ) => (
    <label className="custom__field">
      <span>{t(label)}</span>
      <input
        type="number"
        min={show(min, unit)}
        max={show(max, unit)}
        // `any` rather than a fixed step: an inch is 25.4 mm, which no sensible
        // millimetre step accepts, and the browser would reject a valid entry.
        step="any"
        value={show(value, unit)}
        onChange={(e) => onChange(store(e.target.valueAsNumber, unit))}
      />
    </label>
  )

  return (
    <dialog ref={ref} className="custom board-form" onClose={onClose}>
      <form
        className="custom__body"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <h2>{t(editing ? 'board.editTitle' : 'board.newTitle')}</h2>
        <p className="custom__hint">{t('board.hint')}</p>

        <div className="board-form__presets">
          <span className="board-form__presets-label">{t('board.presets')}</span>
          {BOARD_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="board-form__preset"
              onClick={() => {
                setDraft((d) => ({
                  // The name is the user's, so a preset never overwrites one
                  // they have already typed.
                  name: d.name,
                  cols: preset.cols,
                  rows: preset.rows,
                  grid: preset.grid,
                }))
                setUnit(preset.imperial ? 'in' : 'mm')
              }}
            >
              {t(preset.labelKey)}
            </button>
          ))}
        </div>

        <label className="custom__field">
          <span>{t('board.name')}</span>
          <input
            type="text"
            value={draft.name}
            maxLength={MAX_NAME_LENGTH}
            placeholder={t('board.namePlaceholder')}
            autoFocus
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </label>

        <div className="custom__row">
          <label className="custom__field">
            <span>{t('board.widthCells')}</span>
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
            <span>{t('board.heightCells')}</span>
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
            <span>{t('board.units')}</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              <option value="mm">{t('board.unitMm')}</option>
              <option value="in">{t('board.unitInch')}</option>
            </select>
          </label>
        </div>

        <div className="custom__row">
          {lengthField('board.pitch', draft.grid.pitchMm, MIN_PITCH_MM, MAX_PITCH_MM, (mm) =>
            setGrid({ pitchMm: mm }),
          )}
          {lengthField(
            'board.thickness',
            draft.grid.thicknessMm,
            MIN_THICKNESS_MM,
            MAX_THICKNESS_MM,
            (mm) => setGrid({ thicknessMm: mm }),
          )}
        </div>

        <div className="custom__row">
          <label className="custom__field">
            <span>{t('board.arrangement')}</span>
            <select
              value={draft.grid.arrangement}
              onChange={(e) => setGrid({ arrangement: e.target.value as Arrangement })}
            >
              <option value="staggered">{t('board.staggered')}</option>
              <option value="aligned">{t('board.aligned')}</option>
            </select>
          </label>

          <label className="custom__field">
            <span>{t('board.shape')}</span>
            <select
              value={draft.grid.shape}
              onChange={(e) => setGrid({ shape: e.target.value as HoleShape })}
            >
              {SHAPES.map((shape) => (
                <option key={shape.value} value={shape.value}>
                  {t(shape.label)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="custom__row">
          {lengthField(
            slotted ? 'board.holeWidth' : 'board.holeSize',
            draft.grid.holeWidthMm,
            MIN_HOLE_MM,
            MAX_PITCH_MM,
            (mm) => setGrid({ holeWidthMm: mm }),
          )}
          {slotted
            ? lengthField(
                'board.holeHeight',
                draft.grid.holeHeightMm,
                MIN_HOLE_MM,
                MAX_PITCH_MM,
                (mm) => setGrid({ holeHeightMm: mm }),
              )
            : null}
        </div>

        <p className="custom__preview">
          {t('board.size', {
            cols: draft.cols,
            rows: draft.rows,
            width: Math.round(widthMm),
            height: Math.round(heightMm),
            holes,
          })}
        </p>
        {overCap && <p className="board-form__warning">{t('board.tooMany', { max: MAX_HOLES })}</p>}
        {offPitch && <p className="board-form__warning">{t('board.pitchWarning')}</p>}
        <p className="custom__preview">{t('board.notCosted')}</p>

        <div className="custom__actions">
          {editing ? (
            <button
              type="button"
              className="custom__delete"
              onClick={() => {
                removeCustomBoard(editing.key)
                onClose()
              }}
            >
              {t('board.delete')}
            </button>
          ) : null}
          <button type="button" onClick={onClose}>
            {t('board.cancel')}
          </button>
          <button type="submit" className="custom__save" disabled={overCap}>
            {t('board.save')}
          </button>
        </div>
      </form>
    </dialog>
  )
}
