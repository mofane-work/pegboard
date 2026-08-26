import { useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { Board, BoardPlane } from './Board'
import { AccessoryMesh } from './AccessoryMesh'
import { BY_KEY, isPlaceable, type CatalogItem } from '../data/catalog'
import { resolvePlacements } from '../lib/placements'
import { occupiedRects, snapOnWall, wallSize, worldToWall, type WallBoard } from '../lib/wall'
import { rotatePattern, type Rect } from '../lib/grid'
import { useConfig } from '../state/store'
import { useDrag } from '../state/drag'
import { useThemeTokens } from '../lib/theme'

/** Pull the camera back far enough that the whole wall is comfortably framed. */
function cameraDistance(widthMm: number, heightMm: number): number {
  return Math.max(widthMm, heightMm) * 1.45
}

export function Scene({
  wall,
  byKey = BY_KEY,
  onOrbit,
}: {
  wall: WallBoard[]
  /** Catalog plus the user's custom parts, so both drag and render resolve them. */
  byKey?: ReadonlyMap<string, CatalogItem>
  /** Fired the first time the camera actually moves — dismisses the orbit hint. */
  onOrbit?: () => void
}) {
  const tokens = useThemeTokens()
  const size = useMemo(
    () =>
      wallSize(
        wall.map((b) => ({
          boardKey: b.spec.key,
          offsetX: b.offsetX,
          offsetY: b.offsetY,
          rotated: b.spec.rotated,
        })),
      ),
    [wall],
  )
  /** Wall space has its origin at the bottom-left; the scene is centred. */
  const toScene = (x: number, y: number): [number, number] => [
    x - size.widthMm / 2,
    y - size.heightMm / 2,
  ]

  const placements = useConfig((s) => s.placements)
  const selectedId = useConfig((s) => s.selectedId)
  const place = useConfig((s) => s.place)
  const move = useConfig((s) => s.move)
  const select = useConfig((s) => s.select)

  const dragItemKey = useDrag((s) => s.itemKey)
  const dragMovingId = useDrag((s) => s.movingId)
  const dragHoverHoleId = useDrag((s) => s.hoverHoleId)
  const dragValid = useDrag((s) => s.valid)
  const dragBoardIndex = useDrag((s) => s.boardIndex)
  const dragRotation = useDrag((s) => s.rotation)
  const hover = useDrag((s) => s.hover)
  const startMove = useDrag((s) => s.startMove)
  const endDrag = useDrag((s) => s.end)
  const controls = useRef<OrbitControlsImpl>(null)

  const resolved = useMemo(
    () => resolvePlacements(placements, wall, byKey),
    [placements, wall, byKey],
  )

  /**
   * Bounding boxes already taken, in wall space, excluding what is moving.
   *
   * Empty in overlap mode. The flag has to reach the drag path and not only the
   * nudge, or the same wall accepts a position by one input device and refuses
   * it by another — the inconsistency `placements.ts` exists to prevent.
   */
  const allowOverlap = useConfig((s) => s.allowOverlap)
  const occupied: Rect[] = useMemo(
    () => (allowOverlap ? [] : occupiedRects(wall, placements, dragMovingId)),
    [wall, placements, dragMovingId, allowOverlap],
  )

  const dragItem = dragItemKey ? byKey.get(dragItemKey) : undefined
  const dragPattern =
    dragItem && isPlaceable(dragItem)
      ? rotatePattern(dragItem.pattern, dragRotation)
      : undefined

  // Rotating mid-drag must re-snap and re-validate: the ghost was rotating
  // while `valid` kept the answer for the previous orientation, so a drop
  // could commit a placement that no longer fit.
  const lastPoint = useRef<[number, number] | null>(null)

  useEffect(() => {
    const point = lastPoint.current
    if (!point || !dragItemKey) return
    const item = byKey.get(dragItemKey)
    if (!item || !isPlaceable(item)) return
    const pattern = rotatePattern(item.pattern, dragRotation)
    const snap = snapOnWall(wall, pattern, point[0], point[1], occupied)
    if (snap) hover(snap.result.anchor.id, snap.result.ok, snap.boardIndex)
  }, [dragRotation, dragItemKey, byKey, wall, occupied, hover])

  function handleMove(xMm: number, yMm: number) {
    lastPoint.current = [xMm, yMm]
    if (!dragPattern) return
    // Aim the accessory's centre at the cursor (F9), slide to the nearest hole
    // that fits (F12), and consider every board on the wall so dragging toward
    // a seam hops across instead of refusing.
    const snap = snapOnWall(wall, dragPattern, xMm, yMm, occupied)
    if (!snap) return
    hover(snap.result.anchor.id, snap.result.ok, snap.boardIndex)
  }

  function handleDrop() {
    if (!dragItemKey || !dragHoverHoleId || !dragValid) {
      endDrag()
      return
    }
    if (dragMovingId) move(dragMovingId, dragHoverHoleId, dragRotation, dragBoardIndex)
    else place(dragItemKey, dragHoverHoleId, dragRotation, dragBoardIndex)
    endDrag()
  }

  const ghostBoard = wall[dragBoardIndex]
  const ghostHole = dragHoverHoleId ? ghostBoard?.byId.get(dragHoverHoleId) : undefined
  const distance = cameraDistance(size.widthMm, size.heightMm)

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 0, distance], fov: 40, near: 1, far: distance * 6 }}
      style={{ background: tokens['--scene-bg'], touchAction: 'none' }}
      onPointerMissed={() => select(null)}
    >
      <ambientLight intensity={0.75} />
      <directionalLight position={[-400, 600, 900]} intensity={1.5} castShadow />
      <directionalLight position={[500, -200, 400]} intensity={0.4} />

      {wall.map((b) => (
        <group key={b.index} position={[...toScene(b.offsetX, b.offsetY), 0]}>
          <group position={[b.spec.widthMm / 2, b.spec.heightMm / 2, 0]}>
            <Board board={b.spec} holes={b.holes} color={tokens['--board-color']} />
            <BoardPlane
              board={b.spec}
              onMove={(worldX, worldY) => handleMove(...worldToWall(worldX, worldY, size))}
              onDrop={handleDrop}
            />
          </group>
        </group>
      ))}

      {resolved.map(({ placement, item, hole, basePattern, board: b }) => {
        if (placement.id === dragMovingId) return null

        const [x, y] = toScene(hole.x + b.offsetX, hole.y + b.offsetY)
        return (
          <group
            key={placement.id}
            position={[x, y, 0]}
            rotation={[0, 0, (placement.rotation * Math.PI) / 180]}
          >
            <AccessoryMesh
              item={item}
              pattern={basePattern}
              color={tokens['--accessory-color']}
              selectedColor={tokens['--selected-color']}
              selected={placement.id === selectedId}
              onPointerDown={(event) => {
                event.stopPropagation()
                select(placement.id)
                startMove(placement.id, placement.itemKey, placement.rotation)
              }}
            />
          </group>
        )
      })}

      {dragItem && isPlaceable(dragItem) && ghostHole && (
        <group
          position={[...toScene(ghostHole.x + ghostBoard.offsetX, ghostHole.y + ghostBoard.offsetY), 0]}
          rotation={[0, 0, (dragRotation * Math.PI) / 180]}
        >
          <AccessoryMesh
            item={dragItem}
            pattern={dragItem.pattern}
            color={dragValid ? tokens['--snap-ok'] : tokens['--snap-bad']}
            opacity={0.65}
          />
        </group>
      )}

      <OrbitControls
        ref={controls}
        makeDefault
        // Dragging an accessory must not also orbit the camera.
        enabled={dragItemKey === null}
        // OrbitControls fires startEvent on its own pointerdown listener, which
        // runs before React has re-rendered with `dragItemKey` set — so grabbing
        // a placed mesh would otherwise read as an orbit. Ask the drag store
        // directly instead of trusting `enabled` above.
        onStart={() => {
          if (useDrag.getState().itemKey === null) onOrbit?.()
        }}
        enablePan
        minDistance={distance * 0.3}
        maxDistance={distance * 3}
      />
    </Canvas>
  )
}
