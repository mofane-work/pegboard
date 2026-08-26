import { useMemo } from 'react'
import type { AccessoryItem } from '../data/catalog'
import { buildAccessoryParts } from '../lib/geometry/archetypes'
import { bodyOriginOffset, type PegPattern } from '../lib/grid'

interface AccessoryMeshProps {
  item: AccessoryItem
  /** Unrotated pattern — the frame shift is applied inside the rotated group. */
  pattern: PegPattern
  color: string
  /** Repaints the whole body while selected, rather than tinting it. */
  selectedColor?: string
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
  selectedColor,
  opacity = 1,
  selected = false,
  onPointerDown,
}: AccessoryMeshProps) {
  const parts = useMemo(() => buildAccessoryParts(item), [item])
  const transparent = opacity < 1

  // Selection repaints the body rather than glowing it in its own colour: an
  // emissive tint of `color` is nearly invisible on a bright board. The glow
  // stays, at the same hue, so the shape still reads in a dark scene.
  const bodyColor = selected && selectedColor ? selectedColor : color

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
            color={bodyColor}
            roughness={0.6}
            metalness={0.05}
            transparent={transparent}
            opacity={opacity}
            depthWrite={!transparent}
            emissive={bodyColor}
            emissiveIntensity={selected ? 0.35 : 0}
          />
        </mesh>
      ))}
    </group>
  )
}
