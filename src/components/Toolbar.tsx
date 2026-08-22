import { useTranslation } from 'react-i18next'
import { BOARDS, type LanguageId } from '../data/catalog'
import { boardSpec, canRotateBoard, MAX_BOARDS } from '../lib/wall'
import { LANGUAGES } from '../i18n'
import { useConfig, type ThemePreference } from '../state/store'
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
  onShare,
  shareState,
  shareDropped,
}: {
  onResetView: () => void
  onOpenHelp: () => void
  onShare: () => void
  shareState: 'idle' | 'copied' | 'failed'
  /** Custom placements left out of the last copied link. */
  shareDropped: number
}) {
  const { t } = useTranslation()
  const {
    boards, setBoard, addBoard, removeBoard, rotateBoard,
    language, setLanguage,
    theme, setTheme,
    viewRatio, setViewRatio,
    viewHeight, setViewHeight,
    clearBoard, undo, redo, past, future,
  } = useConfig()

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

          <button type="button" onClick={onOpenHelp} aria-haspopup="dialog">
            {t('toolbar.help')}
          </button>
        </div>
      </div>

      <div className="toolbar__row">
        <div className="toolbar__controls toolbar__controls--boards">
          {boards.map((placed, index) => {
            const suffix = boards.length > 1 ? ` ${index + 1}` : ''
            const rotatable = canRotateBoard(placed.boardKey)
            const spec = boardSpec(placed)
            return (
              <label key={index}>
                <span>
                  {t('toolbar.board')}
                  {suffix}
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
                    value={placed.boardKey}
                    onChange={(e) => setBoard(e.target.value, index)}
                  >
                    {BOARDS.map((board) => (
                      <option key={board.key} value={board.key}>
                        {board.names[language]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`${t('toolbar.rotateBoard')}${suffix}`}
                    aria-pressed={spec.rotated}
                    title={rotatable ? t('toolbar.rotateBoard') : t('toolbar.rotateBoardFixed')}
                    disabled={!rotatable}
                    onClick={() => rotateBoard(index)}
                  >
                    ⟳
                  </button>
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
              </label>
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
