import { useTranslation } from 'react-i18next'
import { INTL_LOCALE } from '../i18n'
import type { CostLine, CostTotal, PriceMarketId } from '../lib/pricing'
import { buildShoppingList, type ExportFormat } from '../lib/shoppingList'
import { useConfig } from '../state/store'

/**
 * Assembles the localised labels and renders the procurement list.
 *
 * Shared by the on-screen block and the printed sheet so both derive the same
 * string from the same inputs, rather than one being handed a copy that can lag
 * a render behind.
 */
export function useListText(
  lines: readonly CostLine[],
  total: CostTotal,
  market: PriceMarketId,
  currency: string,
  format: ExportFormat,
): string {
  const { t } = useTranslation()
  const language = useConfig((s) => s.language)

  return buildShoppingList(lines, {
    format,
    market,
    currency,
    locale: INTL_LOCALE[language],
    language,
    snapshotDate: total.usesStalePrices ? total.staleCapturedAt : undefined,
    unknownKeys: total.unknownKeys,
    labels: {
      title: t('list.exportTitle'),
      marketName: `${t(`market.${market}`)} · ${currency}`,
      total: t('list.total'),
      packNote: (pack, pieces) => t('list.packNote', { pack, pieces }),
      unknownNote: t('list.unknownNote'),
      snapshotNote: t('list.snapshotNote', { date: total.staleCapturedAt ?? '' }),
      articleNote: t('list.articleNote', { market: t(`market.${market}`) }),
    },
  })
}
