import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MAX_CELLS,
  MAX_DEPTH_MM,
  MAX_NAME_LENGTH,
  MAX_PEG_LENGTH_MM,
  MIN_CELLS,
  MIN_DEPTH_MM,
  MIN_PEG_LENGTH_MM,
  MIN_PEG_MM,
  pegFitWarnings,
  type CustomPart,
} from '../data/customParts'
import { catalogWith } from '../data/customBoards'
import {
  MAX_PITCH_MM,
  MIN_PITCH_MM,
  SKADIS_PEGS,
  gridOf,
  type HoleShape,
  type Lattice,
  type PegLayout,
  type PegSpec,
} from '../lib/grid'
import { boardSpec } from '../lib/wall'
import { partDefaults, rememberPartDefaults, type PegMode, type Unit } from '../state/partDefaults'
import { useConfig } from '../state/store'

type Draft = Omit<CustomPart, 'key'>

const MM_PER_INCH = 25.4

/**
 * The two fields session memory deliberately does not carry over. Everything
 * else a new part starts with comes from `partDefaults()` — see
 * state/partDefaults.ts for why the name and the lattice are excluded.
 */
const BLANK: Pick<Draft, 'name' | 'lattice'> = {
  name: '',
  lattice: 'A',
}

/**
 * Whether a part's pegs are plain SKÅDIS. The dialog's peg mode is DERIVED from
 * this rather than stored on the part: equal values mean equal behaviour, so a
 * part reopens collapsed whichever way its pegs got there, and `CustomPart`
 * needs no new field — which is a store version and a migration this costs
 * nothing to avoid.
 */
function isSkadisPegs(pegs: PegSpec): boolean {
  const keys = Object.keys(SKADIS_PEGS) as Array<keyof PegSpec>
  return keys.every((key) => pegs[key] === SKADIS_PEGS[key])
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

const LAYOUTS: Array<{ value: PegLayout; label: string }> = [
  { value: 'ends', label: 'custom.layoutEnds' },
  { value: 'every', label: 'custom.layoutEvery' },
  { value: 'single', label: 'custom.layoutSingle' },
  { value: 'corners', label: 'custom.layoutCorners' },
]

/**
 * Create or edit a user-defined placeholder body. Same native <dialog> pattern
 * as Help: focus trapping, Escape and the backdrop come from the platform.
 *
 * The caller mounts this only while it is open, so the draft is seeded once at
 * mount and no effect has to sync state. An existing part is seeded from itself;
 * a NEW one is seeded from `partDefaults()`, the session's last-used size and
 * pegs, so a user building several bays of the same rack types the numbers once.
 *
 * The peg section mirrors the pegboard dialog field for field, because a peg is
 * the counterpart of a hole. It sits behind a two-way choice — SKÅDIS or
 * self-defined — and shows nothing at all on the SKÅDIS side, which is what
 * almost every part wants and what the code did before peg specs existed.
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
  const boards = useConfig((s) => s.boards)
  const customBoards = useConfig((s) => s.customBoards)
  // Read once, at mount: a save later in this dialog must not re-seed the form
  // that is still open.
  const [session] = useState(partDefaults)
  const [unit, setUnit] = useState<Unit>(session.unit)
  const [pegMode, setPegMode] = useState<PegMode>(() =>
    editing ? (isSkadisPegs(editing.pegs) ? 'skadis' : 'custom') : session.pegMode,
  )
  const [draft, setDraft] = useState<Draft>(() =>
    editing
      ? {
          name: editing.name,
          cols: editing.cols,
          rows: editing.rows,
          depthMm: editing.depthMm,
          lattice: editing.lattice,
          pegs: { ...editing.pegs },
        }
      : {
          ...BLANK,
          cols: session.cols,
          rows: session.rows,
          depthMm: session.depthMm,
          pegs: { ...session.pegs },
        },
  )
  // What was typed before SKÅDIS was pressed, so pressing self-defined again in
  // the same dialog restores it rather than starting over.
  const stashed = useRef<PegSpec | null>(null)

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  // The grids actually on the wall, so the warnings below can be about this
  // user's boards rather than about SKÅDIS in the abstract.
  const grids = useMemo(() => {
    const byKey = catalogWith([], customBoards)
    return boards.map((placed) => gridOf(boardSpec(placed, byKey)))
  }, [boards, customBoards])

  const warnings = useMemo(() => pegFitWarnings({ ...draft, key: '' }, grids), [draft, grids])

  const setPegs = (patch: Partial<PegSpec>) =>
    setDraft((d) => ({ ...d, pegs: { ...d.pegs, ...patch } }))

  /**
   * Choosing SKÅDIS RESETS the spec, it does not merely hide it. A collapsed
   * section holding numbers the label denies is the mistake findings F37b
   * describes: the reset has to actually reset.
   */
  function chooseMode(mode: PegMode) {
    if (mode === pegMode) return
    if (mode === 'skadis') {
      stashed.current = draft.pegs
      setDraft((d) => ({ ...d, pegs: { ...SKADIS_PEGS } }))
    } else if (stashed.current) {
      const restore = stashed.current
      setDraft((d) => ({ ...d, pegs: { ...restore } }))
    }
    setPegMode(mode)
  }

  function submit() {
    if (editing) updateCustomPart(editing.key, draft)
    else addCustomPart(draft)
    // Remembered on both branches: the dialog carries forward the last thing the
    // user set, however they got there.
    rememberPartDefaults({
      cols: draft.cols,
      rows: draft.rows,
      depthMm: draft.depthMm,
      pegs: draft.pegs,
      pegMode,
      unit,
    })
    onClose()
  }

  const widthMm = draft.cols * draft.pegs.pitchMm
  const heightMm = draft.rows * draft.pegs.pitchMm
  const slotted = draft.pegs.shape === 'slot-v' || draft.pegs.shape === 'slot-h'

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

        <p className="custom__section">{t('custom.pegsTitle')}</p>

        <div className="custom__modes" role="group" aria-label={t('custom.pegModeLabel')}>
          {(['skadis', 'custom'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={pegMode === mode}
              className={pegMode === mode ? 'custom__mode custom__mode--on' : 'custom__mode'}
              onClick={() => chooseMode(mode)}
            >
              {t(mode === 'skadis' ? 'custom.pegModeSkadis' : 'custom.pegModeCustom')}
            </button>
          ))}
        </div>

        {pegMode === 'skadis' ? (
          <p className="custom__hint">
            {t('custom.pegsSkadis', {
              width: SKADIS_PEGS.widthMm,
              height: SKADIS_PEGS.heightMm,
              pitch: SKADIS_PEGS.pitchMm,
            })}
          </p>
        ) : null}

        {pegMode === 'custom' ? (
          <>
            <p className="custom__hint">{t('custom.pegsHint')}</p>

            <div className="custom__row">
              {lengthField(
                'custom.pegPitch',
                draft.pegs.pitchMm,
                MIN_PITCH_MM,
                MAX_PITCH_MM,
                (mm) => setPegs({ pitchMm: mm }),
              )}
              {lengthField(
                'custom.pegLength',
                draft.pegs.lengthMm,
                MIN_PEG_LENGTH_MM,
                MAX_PEG_LENGTH_MM,
                (mm) => setPegs({ lengthMm: mm }),
              )}
              <label className="custom__field">
                <span>{t('board.units')}</span>
                <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
                  <option value="mm">{t('board.unitMm')}</option>
                  <option value="in">{t('board.unitInch')}</option>
                </select>
              </label>
            </div>

            <div className="custom__row">
              <label className="custom__field">
                <span>{t('custom.pegLayout')}</span>
                <select
                  value={draft.pegs.layout}
                  onChange={(e) => setPegs({ layout: e.target.value as PegLayout })}
                >
                  {LAYOUTS.map((layout) => (
                    <option key={layout.value} value={layout.value}>
                      {t(layout.label)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="custom__field">
                <span>{t('custom.pegShape')}</span>
                <select
                  value={draft.pegs.shape}
                  onChange={(e) => setPegs({ shape: e.target.value as HoleShape })}
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
                slotted ? 'custom.pegWidth' : 'custom.pegSize',
                draft.pegs.widthMm,
                MIN_PEG_MM,
                MAX_PITCH_MM,
                (mm) => setPegs({ widthMm: mm }),
              )}
              {slotted
                ? lengthField(
                    'custom.pegHeight',
                    draft.pegs.heightMm,
                    MIN_PEG_MM,
                    MAX_PITCH_MM,
                    (mm) => setPegs({ heightMm: mm }),
                  )
                : null}
            </div>
          </>
        ) : null}

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
          {t('custom.size', {
            width: Math.round(widthMm),
            height: Math.round(heightMm),
            depth: draft.depthMm,
          })}
        </p>
        {warnings.map((warning) => (
          <p key={warning} className="board-form__warning">
            {t(`custom.warn.${warning}`)}
          </p>
        ))}
        <p className="custom__preview">{t('custom.notCosted')}</p>
        <p className="custom__preview">{t('custom.notShared')}</p>

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
