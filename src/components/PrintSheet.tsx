import { useTranslation } from 'react-i18next'
import { gridOf } from '../lib/grid'
import { boardSpec, buildWall, layoutBoards, wallSize } from '../lib/wall'
import { resolvePlacements } from '../lib/placements'
import { FRONT, ISOMETRIC, project, projectedExtent, type ViewAngle } from '../lib/printProjection'
import { BY_KEY } from '../data/catalog'
import { catalogWith } from '../data/customBoards'
import { useConfig } from '../state/store'
import { useListText } from './useListText'
import type { CostLine, CostTotal, PriceMarketId } from '../lib/pricing'

const MARGIN_MM = 24

/**
 * The printable sheet: a scale diagram of the board plus the procurement list.
 *
 * Drawn as SVG rather than a screenshot of the WebGL canvas — crisp at any
 * printer DPI, a few kilobytes, and it inherits the page's colours. Projection
 * is orthographic so slots stay comparable across the board; see findings F17.
 */
interface PrintSheetProps {
  lines: readonly CostLine[]
  total: CostTotal
  market: PriceMarketId
  currency: string
  angle: ViewAngle
}

export function PrintSheet({ lines, total, market, currency, angle }: PrintSheetProps) {
  const { t } = useTranslation()
  const boards = useConfig((s) => s.boards)
  const placements = useConfig((s) => s.placements)
  const customParts = useConfig((s) => s.customParts)
  const customBoards = useConfig((s) => s.customBoards)
  const language = useConfig((s) => s.language)

  const listText = useListText(lines, total, market, currency, 'text')
  const byKey = catalogWith(customParts, customBoards)
  const laid = layoutBoards(boards, byKey)
  const wall = buildWall(laid, byKey)
  const size = wallSize(laid, byKey)
  // The diagram draws custom parts even though the parts list omits them: the
  // drawing is there to match what is on screen, the list is what you buy.
  const resolved = resolvePlacements(placements, wall, byKey)

  const extent = projectedExtent(size.widthMm, size.heightMm, 5, angle)
  const viewBox = [
    extent.minX - MARGIN_MM,
    extent.minY - MARGIN_MM,
    extent.width + MARGIN_MM * 2,
    extent.height + MARGIN_MM * 2,
  ].join(' ')

  const halfW = size.widthMm / 2
  const halfH = size.heightMm / 2
  /** Wall space (origin bottom-left) → centred drawing space. */
  const toWall = (x: number, y: number): [number, number] => [x - halfW, y - halfH]

  return (
    <section className="sheet" aria-label={t('print.title')}>
      <header className="sheet__header">
        <h1>{t('print.title')}</h1>
        <p>
          {laid
            .map((b) => {
              const spec = boardSpec(b, byKey)
              const product = BY_KEY.get(b.boardKey)?.names[language]
              // The user's own name first, if they gave one — but never
              // instead of the product. This is a build document: whoever
              // assembles the wall still has to know which panel to buy.
              const name = b.name ? `${b.name} · ${product}` : product
              // A turned panel is the same product but a different build, so
              // the sheet has to say which way up it goes.
              if (!spec.rotated) return name
              return `${name} · ${t('toolbar.rotatedAs', {
                width: Math.round(spec.widthMm / 10),
                height: Math.round(spec.heightMm / 10),
              })}`
            })
            .join(' + ')}
        </p>
      </header>

      <svg className="sheet__diagram" viewBox={viewBox} role="img" aria-label={t('print.diagram')}>
        {wall.map((b) => {
          const outline = [
            [b.offsetX, b.offsetY],
            [b.offsetX + b.spec.widthMm, b.offsetY],
            [b.offsetX + b.spec.widthMm, b.offsetY + b.spec.heightMm],
            [b.offsetX, b.offsetY + b.spec.heightMm],
          ]
            .map(([x, y]) => project(...toWall(x, y), 0, angle).join(','))
            .join(' ')
          return <polygon key={b.index} points={outline} className="sheet__board" />
        })}

        {wall.flatMap((b) => {
          const grid = gridOf(b.spec)
          // Same fold the mesh builder uses: a turned panel and a horizontal
          // slot are the same statement, so the sheet cannot disagree with the
          // 3D view about which way a slot lies.
          const horizontal = (grid.shape === 'slot-h') !== Boolean(b.spec.rotated)
          const halfW = (horizontal ? grid.holeHeightMm : grid.holeWidthMm) / 2
          const halfH = (horizontal ? grid.holeWidthMm : grid.holeHeightMm) / 2

          return b.holes.map((hole) => {
            const [x, y] = project(...toWall(hole.x + b.offsetX, hole.y + b.offsetY), 0, angle)
            const key = `${b.index}-${hole.id}`

            if (grid.shape === 'square') {
              return (
                <rect
                  key={key}
                  x={x - grid.holeWidthMm / 2}
                  y={y - grid.holeWidthMm / 2}
                  width={grid.holeWidthMm}
                  height={grid.holeWidthMm}
                  className="sheet__slot"
                />
              )
            }

            return (
              <ellipse
                key={key}
                cx={x}
                cy={y}
                rx={grid.shape === 'round' ? grid.holeWidthMm / 2 : halfW}
                ry={grid.shape === 'round' ? grid.holeWidthMm / 2 : halfH}
                className="sheet__slot"
              />
            )
          })
        })}

        {resolved.map(({ placement, pattern, hole, board: b }) => {
          // Draw each accessory's footprint, which is what tells someone where
          // things actually go — the exact mesh silhouette would not print well.
          const x0 = hole.x + b.offsetX + pattern.bodyOffset[0]
          const y0 = hole.y + b.offsetY + pattern.bodyOffset[1]
          const corners = [
            [x0, y0],
            [x0 + pattern.bodySize[0], y0],
            [x0 + pattern.bodySize[0], y0 + pattern.bodySize[1]],
            [x0, y0 + pattern.bodySize[1]],
          ]
            .map(([x, y]) => project(...toWall(x, y), 0, angle).join(','))
            .join(' ')
          return <polygon key={placement.id} points={corners} className="sheet__item" />
        })}
      </svg>

      <pre className="sheet__list">{listText}</pre>
      <p className="sheet__note">{t('disclaimer')}</p>
    </section>
  )
}

export { FRONT, ISOMETRIC }
