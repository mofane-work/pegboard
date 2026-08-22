import { useMemo } from 'react'
import { DoubleSide } from 'three'
import { buildBoardGeometry } from '../lib/geometry/board'
import { generateHoles, type BoardSpec, type Hole } from '../lib/grid'

interface BoardProps {
  board: BoardSpec
  holes: readonly Hole[]
  color: string
}

/**
 * The pegboard itself. Geometry is rebuilt only when the board size changes —
 * punching 500 slots is cheap once and wasteful every frame.
 */
export function Board({ board, holes, color }: BoardProps) {
  const geometry = useMemo(() => buildBoardGeometry(board, holes), [board, holes])

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color={color} roughness={0.85} metalness={0.02} side={DoubleSide} />
    </mesh>
  )
}

/**
 * Invisible plane across the board face, used as the drag raycast target.
 *
 * Reports the raw **world** intersection point. Converting to wall space here
 * would need this board's offset, and getting that subtly wrong is exactly the
 * bug that shipped in the first multi-board version.
 */
export function BoardPlane({
  board,
  onMove,
  onDrop,
}: {
  board: BoardSpec
  onMove: (worldX: number, worldY: number) => void
  onDrop: () => void
}) {
  return (
    <mesh
      position={[0, 0, 0.01]}
      onPointerMove={(event) => {
        event.stopPropagation()
        onMove(event.point.x, event.point.y)
      }}
      onPointerUp={(event) => {
        event.stopPropagation()
        onDrop()
      }}
    >
      <planeGeometry args={[board.widthMm, board.heightMm]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}

export function useBoardHoles(board: BoardSpec): Hole[] {
  return useMemo(() => generateHoles(board), [board])
}
