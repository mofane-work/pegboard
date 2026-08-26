import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CUSTOMIZABLE_TOKENS,
  readThemeDefaults,
  type ColorOverrides,
  type CustomizableToken,
} from '../lib/theme'
import { useConfig } from '../state/store'

/**
 * The four scene colours, in the order they sit behind one another on screen:
 * the pane, then the board on it, then the components on the board, then the
 * one you have hold of.
 */
const FIELDS: Array<{ token: CustomizableToken; label: string }> = [
  { token: '--scene-bg', label: 'appearance.background' },
  { token: '--board-color', label: 'appearance.board' },
  { token: '--accessory-color', label: 'appearance.accessory' },
  { token: '--selected-color', label: 'appearance.selected' },
]

/**
 * Repaint the 3D pane. Same native <dialog> pattern as Help and CustomPartForm:
 * focus trapping, Escape and the backdrop come from the platform, and the
 * caller mounts it only while it is open.
 *
 * **Nothing is applied until Save.** React maps `onChange` on a colour input to
 * the native `input` event, which fires continuously while a finger or cursor
 * moves through the OS picker — committing each of those to the store repainted
 * every material in the scene, dozens of times per drag. The draft lives here
 * and reaches the store once.
 *
 * The cost of that is losing the live preview, which is the trade the user
 * asked for: Save applies, Cancel throws the draft away, and Reset clears the
 * swatches back to the theme's own colours but still waits for Save.
 */
export function Appearance({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDialogElement>(null)
  const colors = useConfig((s) => s.colors)
  const setColors = useConfig((s) => s.setColors)

  // Both seeded once, at mount: the dialog exists only while it is open, so
  // there is no later state to sync to. `defaults` has to be read with the
  // overrides lifted off, or a Reset would go back to the override it clears.
  const [defaults] = useState(readThemeDefaults)
  const [draft, setDraft] = useState<ColorOverrides>(() => ({ ...colors }))

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  const customised = CUSTOMIZABLE_TOKENS.some((token) => draft[token] !== undefined)

  function save() {
    setColors(draft)
    onClose()
  }

  return (
    <dialog ref={ref} className="appearance" onClose={onClose}>
      <form
        className="appearance__body"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <h2>{t('appearance.title')}</h2>
        <p className="appearance__hint">{t('appearance.hint')}</p>

        {FIELDS.map(({ token, label }) => (
          <label key={token} className="appearance__field">
            <span>{t(label)}</span>
            <input
              type="color"
              value={draft[token] ?? defaults[token]}
              onChange={(event) =>
                setDraft((current) => ({ ...current, [token]: event.target.value }))
              }
            />
          </label>
        ))}

        <p className="appearance__hint">{t('appearance.themeNote')}</p>

        <div className="appearance__actions">
          <button
            type="button"
            className="appearance__reset"
            disabled={!customised}
            onClick={() => setDraft({})}
          >
            {t('appearance.reset')}
          </button>
          <button type="button" onClick={onClose}>
            {t('appearance.cancel')}
          </button>
          <button type="submit" className="appearance__save">
            {t('appearance.save')}
          </button>
        </div>
      </form>
    </dialog>
  )
}
