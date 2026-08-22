import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CostLine, CostTotal, PriceMarketId } from '../lib/pricing'
import { copyText } from '../lib/clipboard'
import type { ExportFormat } from '../lib/shoppingList'
import { useListText } from './useListText'

type CopyState = 'idle' | 'copied' | 'failed'

interface ShoppingListProps {
  lines: readonly CostLine[]
  total: CostTotal
  market: PriceMarketId
  currency: string
}

/**
 * A copyable procurement list for whoever actually buys the parts.
 *
 * Read-only by design: the content is generated from the configuration and the
 * selected language, so it cannot drift from what the app costed.
 */
export function ShoppingList({ lines, total, market, currency }: ShoppingListProps) {
  const { t } = useTranslation()
  const [format, setFormat] = useState<ExportFormat>('text')
  // Tied to the text it applied to, so changing language, format or the
  // configuration resets the button without an effect.
  const [copyResult, setCopyResult] = useState<{ text: string; state: CopyState } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const text = useListText(lines, total, market, currency, format)

  const copyState: CopyState = copyResult?.text === text ? copyResult.state : 'idle'

  async function copy() {
    const ok = await copyText(text)
    // On failure, select the block so the Ctrl+C hint is actionable.
    if (!ok) textareaRef.current?.select()
    setCopyResult({ text, state: ok ? 'copied' : 'failed' })
  }

  if (text === '') {
    return (
      <section className="export">
        <h2>{t('list.title')}</h2>
        <p className="export__hint">{t('list.empty')}</p>
      </section>
    )
  }

  return (
    <section className="export">
      <h2>{t('list.title')}</h2>
      <p className="export__hint">{t('list.hint')}</p>

      <div className="export__controls">
        <div className="export__formats" role="group" aria-label={t('list.formatLabel')}>
          {(['text', 'csv'] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={format === id}
              className={format === id ? 'export__format export__format--on' : 'export__format'}
              onClick={() => setFormat(id)}
            >
              {t(id === 'text' ? 'list.formatText' : 'list.formatCsv')}
            </button>
          ))}
        </div>

        <button type="button" className="export__copy" onClick={() => void copy()}>
          {t(copyState === 'copied' ? 'list.copied' : copyState === 'failed' ? 'list.copyFailed' : 'list.copy')}
        </button>
      </div>

      <textarea
        ref={textareaRef}
        className="export__text"
        readOnly
        spellCheck={false}
        aria-label={t('list.title')}
        value={text}
        rows={Math.min(20, text.split('\n').length + 1)}
      />
    </section>
  )
}
