import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { analyticsConfigured, isOptedOut, setOptedOut } from '../lib/analytics'
import { REPO_URL } from '../data/support'

const SECTIONS = [
  { title: 'help.basicsTitle', keys: ['help.b1', 'help.b2', 'help.b3', 'help.b4', 'help.b5', 'help.b6', 'help.b7'] },
  { title: 'help.shortcutsTitle', keys: ['help.s1', 'help.s2', 'help.s6', 'help.s3', 'help.s4', 'help.s5', 'help.s7'] },
  { title: 'help.pricingTitle', keys: ['help.p1', 'help.p2', 'help.p3', 'help.p4', 'help.p5'] },
  { title: 'help.notesTitle', keys: ['help.n1', 'help.n2', 'help.n3', 'help.n4'] },
] as const

/**
 * The privacy section is the one place in the UI that makes a promise rather
 * than describing a feature, so it has to track what the build actually does.
 * A fork, or any local build, ships without a counter.dev token and therefore
 * genuinely makes no request on load — `pv1off` is the original wording and
 * stays true for them. Only a build with a token configured claims to count
 * anything (findings F27). Getting this backwards would put a false privacy
 * statement on screen in three languages, which is the failure mode the whole
 * section exists to avoid.
 */
function privacyKeys(counting: boolean): readonly string[] {
  return counting
    ? ['help.pv1', 'help.pv2', 'help.pv3', 'help.pv4']
    : ['help.pv1off', 'help.pv2', 'help.pv3']
}

/**
 * Native <dialog> so focus trapping, Escape, and the backdrop come from the
 * platform rather than being reimplemented badly.
 */
export function Help({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDialogElement>(null)

  // Read once per mount rather than per render: the token cannot change at
  // runtime, and the opt-out is only ever written by the checkbox below.
  const [counting] = useState(analyticsConfigured)
  const [countMe, setCountMe] = useState(() => !isOptedOut())

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog ref={ref} className="help" onClose={onClose}>
      <article className="help__body">
        <h2>{t('help.title')}</h2>

        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h3>{t(section.title)}</h3>
            <ul>
              {section.keys.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </section>
        ))}

        <section>
          <h3>{t('help.privacyTitle')}</h3>
          <ul>
            {privacyKeys(counting).map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>

          {/*
            The objection mechanism, not a nicety: the UK's statistical-purposes
            exemption and CNIL's audience-measurement exemption both require a
            simple, free way to refuse. Without this control the counter has no
            exemption to stand on (findings F27).
          */}
          {counting && (
            <label className="help__optout">
              <input
                type="checkbox"
                checked={countMe}
                onChange={(event) => {
                  setCountMe(event.target.checked)
                  setOptedOut(!event.target.checked)
                }}
              />
              <span>{t('help.countMe')}</span>
            </label>
          )}
        </section>

        {/* Rendered apart from SECTIONS because one of its items is a link,
            and SECTIONS deliberately only knows how to render plain strings. */}
        <section>
          <h3>{t('help.aboutTitle')}</h3>
          <ul>
            <li>{t('help.a1')}</li>
            <li>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                {t('help.a2')}
              </a>
            </li>
          </ul>
        </section>

        <p className="help__disclaimer">{t('disclaimer')}</p>

        <form method="dialog">
          <button type="submit" className="help__close">
            {t('help.close')}
          </button>
        </form>
      </article>
    </dialog>
  )
}
