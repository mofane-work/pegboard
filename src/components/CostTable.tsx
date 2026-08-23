import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BY_KEY } from '../data/catalog'
import { isCustomKey } from '../data/customParts'
import { resolvePlacements } from '../lib/placements'
import { buildWall, connectorsNeeded, layoutBoards } from '../lib/wall'
import snapshotJson from '../data/price-snapshot.json'
import { INTL_LOCALE } from '../i18n'
import {
  buildCostLines,
  foldKits,
  formatPrice,
  totalCost,
  type CostInput,
  type CostLine,
  type PriceContext,
  type PriceMarketId,
  type PriceSnapshot,
} from '../lib/pricing'
import { readCache, refreshMarketPrices } from '../lib/marketPrices'
import { ShoppingList } from './ShoppingList'
import { PrintSheet } from './PrintSheet'
import { FRONT, ISOMETRIC } from '../lib/printProjection'
import { useConfig, usePrices } from '../state/store'

const snapshot = snapshotJson as PriceSnapshot

const MARKETS: PriceMarketId[] = ['us', 'gb', 'de', 'fr', 'jp', 'custom']

/**
 * The shopping list. Its whole reason for existing is the include/exclude
 * checkbox: someone who already owns half the parts needs the cost of the
 * upgrade, not of the wall.
 */
export function CostTable({ onPrint }: { onPrint: () => void }) {
  const { t } = useTranslation()
  const {
    boards, placements, extras, market, customCurrency,
    language, overrides, excluded, setOverride, toggleIncluded,
    setMarket, setCustomCurrency,
  } = useConfig()
  const printAngle = useConfig((s) => s.printAngle)
  const setPrintAngle = useConfig((s) => s.setPrintAngle)
  const live = usePrices((s) => s.live)
  const liveMarket = usePrices((s) => s.liveMarket)
  const status = usePrices((s) => s.status)

  // Custom parts are a visualisation aid, not a purchase: they have no article
  // number and no price, so they are counted for the footnote and then left out
  // of the list entirely.
  const customPlaced = useMemo(
    () => placements.filter((p) => isCustomKey(p.itemKey)).length,
    [placements],
  )

  const { entries, kitSets } = useMemo<{ entries: CostInput[]; kitSets: number }>(() => {
    const counts = new Map<string, number>()
    for (const board of boards) {
      counts.set(board.boardKey, (counts.get(board.boardKey) ?? 0) + 1)
    }

    // Joining boards needs hardware; forgetting it is how you get home from
    // IKEA with a wall you cannot actually assemble.
    const connectors = connectorsNeeded(boards.length)
    if (connectors > 0) {
      counts.set('connector-board', (counts.get('connector-board') ?? 0) + connectors)
    }

    // Count what the scene actually renders, via the same resolver, so an item
    // can never be charged for while being invisible on the wall.
    const wall = buildWall(layoutBoards(boards))
    for (const { item } of resolvePlacements(placements, wall)) {
      if (isCustomKey(item.key)) continue
      counts.set(item.key, (counts.get(item.key) ?? 0) + 1)
    }
    for (const [key, qty] of Object.entries(extras)) {
      counts.set(key, (counts.get(key) ?? 0) + qty)
    }
    // Placed basket sizes become sets of 3 here, before the include/exclude
    // flags are read: the checkbox and the price override belong to the pack
    // the user actually buys, not to a size IKEA does not sell on its own.
    const folded = foldKits(counts, BY_KEY)

    // How much of the wall is only buyable as a kit, for the footnote. Read off
    // the difference the fold made rather than recounting, so the note can
    // never disagree with the line it explains. Untouched keys contribute zero.
    let kitSets = 0
    for (const [key, quantity] of folded) kitSets += quantity - (counts.get(key) ?? 0)

    return {
      kitSets,
      entries: [...folded].map(([key, quantity]) => ({
        key,
        quantity,
        included: !excluded[key],
      })),
    }
  }, [boards, placements, extras, excluded])

  const currency =
    market === 'custom' ? customCurrency : (snapshot.markets[market]?.currency ?? 'USD')

  const context: PriceContext = {
    market,
    currency,
    overrides,
    // Only ever this market's own table: article numbers differ per market, so
    // reading one market's prices against another silently misses every lookup.
    live: liveMarket === market ? live : undefined,
    cache: market === 'custom' ? undefined : readCache(market),
    snapshot,
  }

  const lines = buildCostLines(entries, BY_KEY, context)
  const total = totalCost(lines, currency)
  const locale = INTL_LOCALE[language]

  return (
    <section className="cost">
      <h2>{t('cost.title')}</h2>
      <p className="cost__hint">{t('cost.uncheckedHint')}</p>

      {/* Where the prices come from, next to the prices. The select is
          UNCONDITIONAL: put it inside the `market !== 'custom'` guard below and
          choosing Custom would delete the only way back out of it. */}
      <div className="cost__source">
        <label>
          <span>{t('toolbar.market')}</span>
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value as PriceMarketId)}
          >
            {MARKETS.map((id) => (
              <option key={id} value={id}>{t(`market.${id}`)}</option>
            ))}
          </select>
        </label>

        {market === 'custom' && (
          <label>
            <span>{t('market.currency')}</span>
            <input
              className="cost__currency"
              value={customCurrency}
              maxLength={5}
              onChange={(e) => setCustomCurrency(e.target.value.toUpperCase())}
            />
          </label>
        )}

        {/* Nothing is fetched on load — prices come from the snapshot committed
            into the page. This is the only thing that ever contacts IKEA, and
            only because the user pressed it. */}
        {market !== 'custom' && (
          <button
            type="button"
            className="cost__refresh-button"
            onClick={() => void refreshMarketPrices(market)}
            disabled={status === 'loading'}
          >
            {t(status === 'loading' ? 'status.loading' : 'status.refresh')}
          </button>
        )}
      </div>

      {status === 'error' && <p className="cost__status cost__status--warn">{t('status.error')}</p>}
      {market === 'custom' && <p className="cost__status">{t('status.customHint')}</p>}

      {lines.length === 0 ? (
        <p className="cost__empty">{t('cost.empty')}</p>
      ) : (
        <div className="cost__scroll">
          <table className="cost__table">
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">{t('cost.included')}</span></th>
                <th scope="col">{t('cost.item')}</th>
                <th scope="col">{t('cost.packs')}</th>
                <th scope="col">{t('cost.price')}</th>
                <th scope="col">{t('cost.lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <Row
                  key={line.key}
                  line={line}
                  locale={locale}
                  name={line.item.names[language]}
                  onOverride={(value) => setOverride(line.key, value)}
                  onToggle={() => toggleIncluded(line.key)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="cost__footer">
        <span>{t('cost.grandTotal')}</span>
        <strong data-testid="grand-total">{formatPrice(total.total, currency, locale)}</strong>
      </footer>

      {total.unknownKeys.length > 0 && (
        <p className="cost__status cost__status--warn">
          {t('cost.unknownNote', { count: total.unknownKeys.length })}
        </p>
      )}
      {total.usesStalePrices && total.staleCapturedAt && (
        <p className="cost__status">{t('cost.stale', { date: total.staleCapturedAt })}</p>
      )}
      {kitSets > 0 && <p className="cost__status">{t('cost.kitNote', { count: kitSets })}</p>}
      {customPlaced > 0 && (
        <p className="cost__status">{t('custom.notCostedNote', { count: customPlaced })}</p>
      )}

      <ShoppingList lines={lines} total={total} market={market} currency={currency} />

      {/* The build sheet is rendered just below, so its two controls belong
          here rather than in the top bar. Both are hidden by @media print. */}
      <div className="cost__print">
        <label>
          <span>{t('print.angle')}</span>
          <select
            value={printAngle}
            onChange={(e) => setPrintAngle(e.target.value as 'front' | 'iso')}
          >
            <option value="front">{t('print.front')}</option>
            <option value="iso">{t('print.iso')}</option>
          </select>
        </label>
        <button type="button" onClick={onPrint}>{t('print.print')}</button>
      </div>

      <PrintSheet
        lines={lines}
        total={total}
        market={market}
        currency={currency}
        angle={printAngle === 'iso' ? ISOMETRIC : FRONT}
      />
    </section>
  )
}

function Row({
  line,
  locale,
  name,
  onOverride,
  onToggle,
}: {
  line: CostLine
  locale: string
  name: string
  onOverride: (value: number | null) => void
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const overridden = line.price.source === 'override'
  const unknown = line.price.amount === null

  function commit() {
    const parsed = Number.parseFloat(draft)
    onOverride(Number.isFinite(parsed) && parsed >= 0 ? parsed : null)
    setEditing(false)
  }

  return (
    <tr className={line.included ? undefined : 'cost__row--excluded'}>
      <td>
        <input
          type="checkbox"
          checked={line.included}
          onChange={onToggle}
          aria-label={`${t('cost.included')}: ${name}`}
        />
      </td>
      <td>
        <span className="cost__name">{name}</span>
        {line.packQty > 1 && (
          <span className="cost__pack">
            {t('cost.packNote', { qty: line.quantity, pack: line.packQty })}
          </span>
        )}
      </td>
      <td className="cost__num">{line.packs}</td>
      <td className="cost__num">
        {editing ? (
          <input
            className="cost__input"
            type="number"
            min={0}
            step="0.01"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <button
            type="button"
            className="cost__price"
            data-testid="price-edit"
            title={overridden ? t('cost.yourPrice') : t('cost.edit')}
            onClick={() => {
              setDraft(line.price.amount === null ? '' : String(line.price.amount))
              setEditing(true)
            }}
          >
            {unknown
              ? t('cost.unknown')
              : formatPrice(line.price.amount!, line.price.currency, locale)}
            {overridden && <span className="cost__badge">{t('cost.yourPrice')}</span>}
          </button>
        )}
        {overridden && (
          <button type="button" className="cost__reset" onClick={() => onOverride(null)}>
            {t('cost.reset')}
          </button>
        )}
      </td>
      <td className="cost__num">
        {line.lineTotal === null
          ? t('cost.unknown')
          : formatPrice(line.lineTotal, line.price.currency, locale)}
      </td>
    </tr>
  )
}
