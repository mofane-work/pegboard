import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BOARDS, type LanguageId } from '../data/catalog'
import {
  MAX_CUSTOM_BOARDS,
  catalogWith,
  isCustomBoardKey,
  type CustomBoard,
} from '../data/customBoards'
import { boardSpec, canRotateBoard, MAX_BOARDS } from '../lib/wall'
import { LANGUAGES } from '../i18n'
import { MAX_BOARD_NAME_LENGTH, useConfig, type ThemePreference } from '../state/store'
import { applyTheme } from '../lib/theme'

const THEMES: ThemePreference[] = ['light', 'dark', 'system']

/**
 * The top bar, in three rows that answer three different questions:
 *
 *   1. who is looking      — page-level settings, level with the title
 *   2. the wall and what   — the boards, and history / sharing / the camera
 *      I do to it            right of them
 *
 * Row 2 is one wrapping flex row with two groups, so the actions travel with
 * the boards until the window is too narrow and then drop as a single block —
 * they never interleave with the board pickers.
 *
 * Pricing and printing are deliberately absent: those controls live beside the
 * cost table and the build sheet they act on, in `CostTable`.
 */
export function Toolbar({
  onResetView,
  onOpenHelp,
  onOpenAppearance,
  onOpenBoardForm,
  onShare,
  shareState,
  shareDropped,
}: {
  onResetView: () => void
  onOpenHelp: () => void
  onOpenAppearance: () => void
  /** Opens the pegboard editor; `null` creates a new definition. */
  onOpenBoardForm: (editing: CustomBoard | null) => void
  onShare: () => void
  shareState: 'idle' | 'copied' | 'failed'
  /** Custom placements left out of the last copied link. */
  shareDropped: number
}) {
  const { t } = useTranslation()
  const {
    boards, setBoard, addBoard, removeBoard, rotateBoard, renameBoard,
    language, setLanguage,
    theme, setTheme,
    viewRatio, setViewRatio,
    viewHeight, setViewHeight,
    clearBoard, undo, redo, past, future,
  } = useConfig()
  const customBoards = useConfig((s) => s.customBoards)
  // The board picker has to resolve a user-defined board like any other, or a
  // custom panel would report itself as the fallback 36×56.
  const byKey = useMemo(() => catalogWith([], customBoards), [customBoards])

  return (
    <header className="toolbar">
      <div className="toolbar__row">
        <div className="toolbar__brand">
          <h1>{t('app.title')}</h1>
          <p>{t('app.tagline')}</p>
        </div>

        <div className="toolbar__controls toolbar__controls--utility">
          <label>
            <span>{t('toolbar.view')}</span>
            <input
              type="range"
              className="toolbar__range"
              min={30}
              max={70}
              step={5}
              value={Math.round(viewRatio * 100)}
              onChange={(e) => setViewRatio(Number(e.target.value) / 100)}
            />
          </label>

          <label>
            <span>{t('toolbar.viewHeight')}</span>
            <input
              type="range"
              className="toolbar__range"
              min={40}
              max={150}
              step={10}
              value={Math.round(viewHeight * 100)}
              onChange={(e) => setViewHeight(Number(e.target.value) / 100)}
            />
          </label>

          <label>
            <span>{t('toolbar.language')}</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as LanguageId)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </label>

          <label>
            <span>{t('toolbar.theme')}</span>
            <select
              value={theme}
              onChange={(e) => {
                const next = e.target.value as ThemePreference
                setTheme(next)
                applyTheme(next)
              }}
            >
              {THEMES.map((id) => (
                <option key={id} value={id}>{t(`theme.${id}`)}</option>
              ))}
            </select>
          </label>

          {/* One button rather than four inline swatches: this row is already
              four controls wide and F30/F31 record it being tight near 1000 px. */}
          <button type="button" onClick={onOpenAppearance} aria-haspopup="dialog">
            {t('toolbar.colours')}
          </button>

          <button type="button" onClick={onOpenHelp} aria-haspopup="dialog">
            {t('toolbar.help')}
          </button>
        </div>
      </div>

      <div className="toolbar__row">
        <div className="toolbar__controls toolbar__controls--boards">
          {boards.map((placed, index) => {
            const suffix = boards.length > 1 ? ` ${index + 1}` : ''
            const rotatable = canRotateBoard(placed.boardKey, byKey)
            const spec = boardSpec(placed, byKey)
            // What this panel is called: the user's name for it, or its
            // position on the wall. Everything that needs to refer to the board
            // — the caption, the select, both buttons — uses this one string.
            const display = placed.name ?? `${t('toolbar.board')}${suffix}`
            return (
              // A <div>, not a <label>: the caption is a button now, and a
              // button inside a label forwards its click to the select.
              <div key={index} className="toolbar__board-field">
                <span className="toolbar__board-caption">
                  <BoardName
                    display={display}
                    value={placed.name ?? ''}
                    onRename={(name) => renameBoard(index, name)}
                  />
                  {/* The select names the product; this names how it hangs. */}
                  {spec.rotated && (
                    <em className="toolbar__rotated">
                      {t('toolbar.rotatedAs', {
                        width: Math.round(spec.widthMm / 10),
                        height: Math.round(spec.heightMm / 10),
                      })}
                    </em>
                  )}
                </span>
                <span className="toolbar__board">
                  <select
                    aria-label={display}
                    value={placed.boardKey}
                    onChange={(e) => setBoard(e.target.value, index)}
                  >
                    {BOARDS.map((board) => (
                      <option key={board.key} value={board.key}>
                        {board.names[language]}
                      </option>
                    ))}
                    {customBoards.map((board) => (
                      <option key={board.key} value={board.key}>
                        {board.name}
                      </option>
                    ))}
                  </select>
                  {/* Editing a definition is reachable from the panel using it,
                      which is where someone notices it is wrong. */}
                  {isCustomBoardKey(placed.boardKey) && (
                    <button
                      type="button"
                      aria-label={`${t('board.edit')}${suffix}`}
                      title={t('board.edit')}
                      aria-haspopup="dialog"
                      onClick={() => {
                        const board = customBoards.find((b) => b.key === placed.boardKey)
                        if (board) onOpenBoardForm(board)
                      }}
                    >
                      ✎
                    </button>
                  )}
                  {/* Hidden, not disabled. No board IKEA sells can be turned —
                      SKÅDIS slots are upright (F42) — so a disabled control
                      would sit dead on every default wall. The rule and its
                      reason live in Help (`n4`) instead; this button appears
                      only for a user-defined board, which can be turned. */}
                  {rotatable && (
                    <button
                      type="button"
                      aria-label={`${t('toolbar.rotateBoard')}${suffix}`}
                      aria-pressed={spec.rotated}
                      title={t('toolbar.rotateBoard')}
                      onClick={() => rotateBoard(index)}
                    >
                      ⟳
                    </button>
                  )}
                  {boards.length > 1 && (
                    <button
                      type="button"
                      aria-label={`${t('toolbar.removeBoard')} ${index + 1}`}
                      onClick={() => removeBoard(index)}
                    >
                      −
                    </button>
                  )}
                </span>
              </div>
            )
          })}

          {/* Gone rather than disabled at the cap: three is the ceiling, and a
              permanently greyed-out button is just clutter once you are there. */}
          {boards.length < MAX_BOARDS && (
            <button
              type="button"
              onClick={() => addBoard(boards[boards.length - 1].boardKey)}
            >
              {t('toolbar.addBoard')}
            </button>
          )}

          {/* Deliberately a button rather than an option in the select: the
              select's job is choosing a board, and one that opens a dialog on
              change is a different verb wearing the same control. */}
          <button
            type="button"
            aria-haspopup="dialog"
            disabled={customBoards.length >= MAX_CUSTOM_BOARDS}
            onClick={() => onOpenBoardForm(null)}
          >
            {t('toolbar.customBoard')}
          </button>
        </div>

        <div className="toolbar__controls toolbar__controls--actions">
          <button type="button" onClick={undo} disabled={past.length === 0}>
            {t('toolbar.undo')}
          </button>
          <button type="button" onClick={redo} disabled={future.length === 0}>
            {t('toolbar.redo')}
          </button>
          <button type="button" onClick={onShare}>
            {t(
              shareState === 'copied'
                ? 'toolbar.shared'
                : shareState === 'failed'
                  ? 'toolbar.shareFailed'
                  : 'toolbar.share',
            )}
          </button>
          {shareState === 'copied' && shareDropped > 0 ? (
            <span className="toolbar__note" role="status">
              {t('custom.shareDropped', { count: shareDropped })}
            </span>
          ) : null}
          <button type="button" onClick={onResetView}>{t('toolbar.resetView')}</button>
          <button type="button" onClick={clearBoard}>{t('toolbar.clear')}</button>
        </div>
      </div>
    </header>
  )
}

/**
 * The board's caption, doubling as its name field.
 *
 * Click-to-edit rather than a permanently visible input: this row already holds
 * up to three board pickers and F30/F31 record it running out of width. The
 * input is only there while it is being used.
 */
function BoardName({
  display,
  value,
  onRename,
}: {
  /** What to show when not editing — the name, or the positional fallback. */
  display: string
  /** The stored name, '' when unnamed, so an edit starts from the real value. */
  value: string
  onRename: (name: string) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function commit() {
    onRename(draft)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        type="text"
        className="toolbar__board-name-input"
        aria-label={t('toolbar.rename')}
        placeholder={t('toolbar.namePlaceholder')}
        maxLength={MAX_BOARD_NAME_LENGTH}
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setEditing(false)
        }}
      />
    )
  }

  return (
    <button
      type="button"
      className="toolbar__board-name"
      title={t('toolbar.rename')}
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
    >
      {display}
    </button>
  )
}
