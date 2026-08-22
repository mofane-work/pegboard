import { useMemo } from 'react'
import type { AccessoryItem } from '../data/catalog'
import { buildAccessoryParts } from '../lib/geometry/archetypes'
import { bodyOriginOffset, type PegPattern } from '../lib/grid'

interface AccessoryMeshProps {
  item: AccessoryItem
  /** Unrotated pattern — the frame shift is applied inside the rotated group. */
  pattern: PegPattern
  color: string
  opacity?: number
  selected?: boolean
  onPointerDown?: (event: { stopPropagation: () => void }) => void
}

/**
 * Renders one accessory from its archetype's primitive parts. The group origin
 * is the primary peg, so positioning is just "put the group at the hole".
 */
export function AccessoryMesh({
  item,
  pattern,
  color,
  opacity = 1,
  selected = false,
  onPointerDown,
}: AccessoryMeshProps) {
  const parts = useMemo(() => buildAccessoryParts(item), [item])
  const transparent = opacity < 1

  // The builders draw in the body's own frame; this puts that frame where the
  // pattern says the body sits relative to the anchor peg (findings.md F11).
  const [dx, dy] = bodyOriginOffset(pattern)

  return (
    <group position={[dx, dy, 0]} onPointerDown={onPointerDown}>
      {parts.map((part, index) => (
        <mesh
          key={index}
          geometry={part.geometry}
          position={part.position}
          rotation={part.rotation}
          castShadow={!transparent}
        >
          <meshStandardMaterial
            color={color}
            roughness={0.6}
            metalness={0.05}
            transparent={transparent}
            opacity={opacity}
            depthWrite={!transparent}
            emissive={selected ? color : '#000000'}
            emissiveIntensity={selected ? 0.35 : 0}
          />
        </mesh>
      ))}
    </group>
  )
}
